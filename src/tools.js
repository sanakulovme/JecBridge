// MCP tools that let an AI read, change and build the project.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./version.js";

// How the AI must work, the way a coding agent like Claude Code does. Sent as server
// instructions and repeated in project_info, because some clients ignore instructions.
export const WORKING_RULES = [
  "Do the work yourself with these tools. Never ask the user to copy, paste, create or edit files, or run commands: write files with write_file/edit_file and run commands with run_command/start_process.",
  "Never paste file contents into the chat instead of writing them. If your client refuses a write to some path, write to a temporary name (e.g. page.txt) and rename it with move_path.",
  "When something fails (an error, a failing test, a crashed server), read the output, fix the cause and run it again. Keep going until it works.",
  "Verify before you report: run the tests or the build, start dev servers with start_process and check them with http_get, read process_output for errors.",
  "For work with several steps, keep a task_plan and update it as you go. Never say the work is done while an item is still open or unverified.",
  "Reply with the result, not the process: what now works and where (files, URL). Ask the user only for what you cannot do yourself: a decision about what they want, credentials, or something outside this project.",
  "Safety rules are not obstacles to work around. If safe mode blocks a command, use an allowed alternative; if there is none, tell the user exactly what they would need to allow.",
];

const SAFETY_BLOCK = /Access denied|not in the command allowlist|blocked in safe mode|Safe mode does not allow|read-only mode|points outside the project/;

const ok = (text) => ({ content: [{ type: "text", text: typeof text === "string" ? text : JSON.stringify(text, null, 2) }] });
// Every error tells the AI what to do next, so it fixes problems instead of handing them to the user
const fail = (e) => {
  const msg = String(e?.message || e);
  const next = SAFETY_BLOCK.test(msg)
    ? "This is a safety rule, not a bug: don't try to bypass it. Use an allowed alternative, or tell the user what they would need to allow."
    : "Fix the cause and try again yourself. Don't ask the user to do it.";
  return { isError: true, content: [{ type: "text", text: `Error: ${msg}\n\nNext: ${next}` }] };
};
const safe = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(e); } };

const MAX_READ = 400_000;

export function createServer(ws, log = () => {}) {
  const server = new McpServer(
    { name: "jecbridge", version: VERSION },
    {
      instructions:
        `You are the hands-on coding agent for a local project on the user's computer: ${path.basename(ws.root)}. ` +
        "Work like Claude Code. Rules:\n" + WORKING_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n") + "\n" +
        "Start with project_info and list_files. Prefer edit_file over rewriting whole files. " +
        "To run a dev server, use start_process, check it with http_get and give the user the URL. " +
        (ws.hasGit
          ? "A checkpoint is taken automatically before every change; if something goes wrong, use list_checkpoints + undo. "
          : "Checkpoints and undo are OFF (git is not installed), so be careful with destructive changes. ") +
        "Reply to the user in their own language.",
    },
  );

  // Automatic snapshot before every mutating call (no commit if nothing changed)
  const mutate = (label, fn) => safe(async (args) => {
    if (ws.readOnly) throw new Error("Server is running in read-only mode");
    // Name the file or command in the label so the right checkpoint is easy to pick for undo
    const target = args.path || (args.from ? `${args.from} → ${args.to}` : "") || args.command || "";
    const what = target.length > 100 ? target.slice(0, 97) + "..." : target;
    ws.checkpoint(`auto: before ${label} ${what}`.trim());
    log(label, what);
    return fn(args);
  });

  const ro = { readOnlyHint: true, openWorldHint: false };
  const rw = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

  server.registerTool("project_info", {
    title: "Project info",
    description: "Project name, key files (package.json, README, etc.), top-level file count, server mode and the working rules you must follow. Call this first.",
    inputSchema: {},
    annotations: ro,
  }, safe(async () => {
    const { files, total } = ws.listFiles(".", 1, 500);
    const markers = ["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod",
      "composer.json", "pom.xml", "README.md", "tsconfig.json", "vite.config.ts", "next.config.js"];
    const found = {};
    for (const m of markers) {
      // ws.resolve skips a key file that is a symlink pointing outside the project
      try { const { abs } = ws.resolve(m); if (fs.existsSync(abs)) found[m] = fs.readFileSync(abs, "utf8").slice(0, 3000); } catch {}
    }
    return ok({
      name: path.basename(ws.root),
      empty: total === 0,
      topLevel: files,
      totalFilesTopLevel: total,
      mode: { readOnly: ws.readOnly, checkpoints: ws.hasGit, commands: ws.allowAllCommands ? "all allowed" : [...ws.allowed] },
      keyFiles: found,
      ...(ws.plan ? { taskPlan: ws.plan } : {}),
      workingRules: WORKING_RULES,
    });
  }));

  server.registerTool("list_files", {
    title: "List files",
    description: "List files in a folder. Respects .gitignore; skips node_modules and protected files.",
    inputSchema: {
      dir: z.string().default(".").describe("Folder relative to the project root"),
      max_depth: z.number().int().min(1).max(20).default(4),
    },
    annotations: ro,
  }, safe(async ({ dir, max_depth }) => {
    const r = ws.listFiles(dir, max_depth);
    return ok(r.files.join("\n") + (r.truncated ? `\n[...${r.total} files total, truncated]` : "") || "(empty)");
  }));

  server.registerTool("read_file", {
    title: "Read file",
    description: "Return file contents with line numbers. Use start_line/end_line for large files.",
    inputSchema: {
      path: z.string(),
      start_line: z.number().int().min(1).optional(),
      end_line: z.number().int().min(1).optional(),
    },
    annotations: ro,
  }, safe(async ({ path: p, start_line, end_line }) => {
    const { abs, rel } = ws.resolve(p);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) throw new Error(`"${rel}" is a directory — use list_files`);
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return ok(`"${rel}" is a binary file (${stat.size} bytes) and can't be read as text.`);
    const lines = buf.toString("utf8").split(/\r?\n/);
    const s = (start_line || 1) - 1, e = Math.min(end_line || lines.length, lines.length);
    let text = lines.slice(s, e).map((l, i) => `${String(s + i + 1).padStart(5)}  ${l}`).join("\n");
    if (text.length > MAX_READ) text = text.slice(0, MAX_READ) + "\n[...truncated — use start_line/end_line]";
    return ok(`${rel} (${lines.length} lines)\n${text}`);
  }));

  server.registerTool("search_code", {
    title: "Search code",
    description: "Regex search across the whole project (ripgrep). Output: file:line:text.",
    inputSchema: {
      pattern: z.string().describe("Regex"),
      glob: z.string().optional().describe("e.g. *.ts or src/**"),
      case_insensitive: z.boolean().default(false),
    },
    annotations: ro,
  }, safe(async ({ pattern, glob, case_insensitive }) => ok(ws.search(pattern, { glob, caseInsensitive: case_insensitive }))));

  server.registerTool("write_file", {
    title: "Write file",
    description: "Create a new file or fully replace an existing one. Parent folders are created automatically. To change part of an existing file, use edit_file. " +
      "This is how files get created: never paste file contents into the chat for the user to copy.",
    inputSchema: { path: z.string(), content: z.string() },
    annotations: rw,
  }, mutate("write_file", async ({ path: p, content }) => {
    const { abs, rel } = ws.resolve(p, { forWrite: true });
    const existed = fs.existsSync(abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // Keep CRLF line endings when replacing an existing CRLF file
    if (existed && fs.readFileSync(abs, "utf8").includes("\r\n")) content = content.replace(/\r?\n/g, "\r\n");
    fs.writeFileSync(abs, content, "utf8");
    return ok(`${existed ? "Updated" : "Created"}: ${rel} (${content.split("\n").length} lines)`);
  }));

  server.registerTool("edit_file", {
    title: "Edit file",
    description: "Replace an exact text snippet (old_text) with new_text. old_text must appear exactly once unless replace_all=true. Several edits can be applied in one call.",
    inputSchema: {
      path: z.string(),
      edits: z.array(z.object({
        old_text: z.string().min(1),
        new_text: z.string(),
        replace_all: z.boolean().default(false),
      })).min(1),
    },
    annotations: rw,
  }, mutate("edit_file", async ({ path: p, edits }) => {
    const { abs, rel } = ws.resolve(p, { forWrite: true });
    let text = fs.readFileSync(abs, "utf8");
    // Windows CRLF files: the AI sends \n, so match the file's line endings
    const crlf = text.includes("\r\n");
    const fix = (t) => (crlf ? t.replace(/\r?\n/g, "\r\n") : t);
    edits = edits.map((ed) => ({ ...ed, old_text: fix(ed.old_text), new_text: fix(ed.new_text) }));
    edits.forEach((ed, i) => {
      const count = text.split(ed.old_text).length - 1;
      if (count === 0) throw new Error(`Edit #${i + 1}: old_text not found in "${rel}". Use read_file to get the exact current text first.`);
      if (count > 1 && !ed.replace_all) throw new Error(`Edit #${i + 1}: old_text matches ${count} times. Include surrounding lines to make it unique, or set replace_all=true.`);
      text = ed.replace_all ? text.split(ed.old_text).join(ed.new_text) : text.replace(ed.old_text, () => ed.new_text);
    });
    fs.writeFileSync(abs, text, "utf8");
    return ok(`Edited: ${rel} (${edits.length} change${edits.length > 1 ? "s" : ""})`);
  }));

  server.registerTool("delete_path", {
    title: "Delete file or folder",
    description: "Delete a file or folder. A checkpoint is taken first, so this can be undone.",
    inputSchema: { path: z.string() },
    annotations: destructive,
  }, mutate("delete_path", async ({ path: p }) => {
    const { abs, rel } = ws.resolve(p, { forWrite: true });
    if (rel === ".") throw new Error("Cannot delete the project root");
    fs.rmSync(abs, { recursive: true });
    return ok(`Deleted: ${rel}`);
  }));

  server.registerTool("move_path", {
    title: "Move or rename",
    description: "Move or rename a file or folder.",
    inputSchema: { from: z.string(), to: z.string() },
    annotations: rw,
  }, mutate("move_path", async ({ from, to }) => {
    const a = ws.resolve(from, { forWrite: true }), b = ws.resolve(to, { forWrite: true });
    if (fs.existsSync(b.abs)) throw new Error(`"${b.rel}" already exists`);
    fs.mkdirSync(path.dirname(b.abs), { recursive: true });
    fs.renameSync(a.abs, b.abs);
    return ok(`${a.rel} → ${b.rel}`);
  }));

  server.registerTool("run_command", {
    title: "Run command",
    description: "Run a terminal command in the project folder (e.g. npm install, npm test, python main.py). In safe mode only allowlisted programs run, without chaining (&&, |, ;). For dev servers, watchers and other commands that never finish, use start_process instead — run_command kills them at the timeout.",
    inputSchema: {
      command: z.string(),
      cwd: z.string().default("."),
      timeout_sec: z.number().int().min(1).max(900).default(120),
    },
    annotations: destructive,
  }, mutate("run_command", async ({ command, cwd, timeout_sec }) => {
    const r = await ws.run(command, { cwd, timeoutSec: timeout_sec });
    const next = r.exitCode === 0 ? "" :
      "\n\nNext: the command failed. Read the output above, fix the cause and run it again yourself. Don't ask the user to do it.";
    return { ...ok(`exit code: ${r.exitCode}\n${r.output || "(no output)"}${next}`), isError: r.exitCode !== 0 };
  }));

  server.registerTool("start_process", {
    title: "Start background process",
    description: "Start a long-running command in the background, e.g. a dev server (npm run dev, python manage.py runserver) or a watcher. " +
      "Returns as soon as the process prints a local URL (like http://localhost:5173) or after wait_sec, with the first output. " +
      "Tell the user the URL so they can open it in their browser. Same allowlist as run_command. Check logs with process_output, stop with stop_process.",
    inputSchema: {
      command: z.string(),
      cwd: z.string().default("."),
      wait_sec: z.number().int().min(1).max(60).default(10).describe("How long to wait for the process to print a URL"),
    },
    annotations: destructive,
  }, mutate("start_process", async ({ command, cwd, wait_sec }) => {
    const info = await ws.startProcess(command, { cwd, waitSec: wait_sec });
    info.next = !info.running
      ? (info.exitCode === 0 ? "The process finished; if it should keep running, check its output." : "The process crashed. Read its output, fix the cause and start it again yourself.")
      : info.url ? `Check it with http_get ${info.url} before you give the user the URL.`
      : "No URL seen yet. Check process_output; if it is still starting, wait and look again.";
    return { ...ok(info), isError: !info.running && info.exitCode !== 0 };
  }));

  server.registerTool("process_output", {
    title: "Background process output",
    description: "Recent output of a background process (errors, rebuilds) and whether it is still running. Without id: list all background processes.",
    inputSchema: {
      id: z.string().optional().describe("Process id from start_process, e.g. p1"),
      lines: z.number().int().min(1).max(1000).default(100),
    },
    annotations: ro,
  }, safe(async ({ id, lines }) => ok(ws.processOutput(id, lines))));

  server.registerTool("stop_process", {
    title: "Stop background process",
    description: "Stop a background process started with start_process, together with its child processes.",
    inputSchema: { id: z.string().describe("Process id from start_process, e.g. p1") },
    annotations: rw,
  }, safe(async ({ id }) => { log("stop_process", id); return ok(await ws.stopProcess(id)); }));

  server.registerTool("http_get", {
    title: "Check a local URL",
    description: "Fetch a page or API endpoint from a dev server started with start_process (e.g. http://localhost:5173/) to verify that it works. " +
      "Returns the status, content type, page title and the start of the body. Only the local ports of running background processes can be reached.",
    inputSchema: { url: z.string().describe("e.g. http://localhost:5173/ or http://localhost:3000/api/health") },
    annotations: ro,
  }, safe(async ({ url }) => {
    const r = await ws.httpGet(url);
    return { ...ok(r), isError: r.status >= 400 };
  }));

  server.registerTool("task_plan", {
    title: "Task plan",
    description: "Your checklist for work with several steps. Send the whole list every time, each item with its status (pending, in_progress, done). " +
      "Mark an item done only after you verified it. Don't tell the user the work is finished while any item is not done.",
    inputSchema: {
      items: z.array(z.object({
        title: z.string().min(1),
        status: z.enum(["pending", "in_progress", "done"]),
      })).min(1).max(50),
    },
    annotations: ro,
  }, safe(async ({ items }) => {
    ws.plan = items;
    const open = items.filter((i) => i.status !== "done");
    if (!open.length) return ok(`All ${items.length} items are done. Report the result to the user: what works now and where.`);
    return ok(`${items.length - open.length}/${items.length} done. Still open:\n` +
      open.map((i) => `- [${i.status}] ${i.title}`).join("\n") +
      "\nKeep working. Don't report the work as finished yet.");
  }));

  server.registerTool("checkpoint", {
    title: "Save checkpoint",
    description: "Save the current project state under a label (does not touch the project's own .git).",
    inputSchema: { label: z.string().default("manual checkpoint") },
    annotations: rw,
  }, safe(async ({ label }) => ok(ws.checkpoint(label))));

  server.registerTool("list_checkpoints", {
    title: "List checkpoints",
    description: "Recent checkpoints (id, time, label), newest first.",
    inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
    annotations: ro,
  }, safe(async ({ limit }) => ok(ws.listCheckpoints(limit))));

  server.registerTool("diff", {
    title: "Show diff",
    description: "Show changes since a checkpoint (default: the latest) as a unified diff.",
    inputSchema: { since: z.string().optional().describe("Checkpoint id; defaults to the latest checkpoint") },
    annotations: ro,
  }, safe(async ({ since }) => ok(ws.diff(since))));

  server.registerTool("undo", {
    title: "Undo to checkpoint",
    description: "Restore the project to a checkpoint. The current state is saved first (redoId), so the undo itself can be undone.",
    inputSchema: { checkpoint_id: z.string() },
    annotations: destructive,
  }, safe(async ({ checkpoint_id }) => { log("undo", checkpoint_id); return ok(ws.restore(checkpoint_id)); }));

  return server;
}
