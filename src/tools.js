// MCP tools that let an AI read, change and build the project.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./version.js";

const ok = (text) => ({ content: [{ type: "text", text: typeof text === "string" ? text : JSON.stringify(text, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: `Error: ${e?.message || e}` }] });
const safe = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(e); } };

const MAX_READ = 400_000;

export function createServer(ws, log = () => {}) {
  const server = new McpServer(
    { name: "jecbridge", version: VERSION },
    {
      instructions:
        `You are working on a local project on the user's computer: ${path.basename(ws.root)}. ` +
        "Start with project_info and list_files. Prefer edit_file over rewriting whole files. " +
        "To run a dev server, use start_process and give the user the URL it returns. " +
        (ws.hasGit
          ? "A checkpoint is taken automatically before every change; if something goes wrong, use list_checkpoints + undo. " +
            "When you finish, show the result with diff. "
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
    description: "Project name, key files (package.json, README, etc.), top-level file count and server mode. Call this first.",
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
    description: "Create a new file or fully replace an existing one. Parent folders are created automatically. To change part of an existing file, use edit_file.",
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
    return { ...ok(`exit code: ${r.exitCode}\n${r.output || "(no output)"}`), isError: r.exitCode !== 0 };
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
