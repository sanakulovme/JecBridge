#!/usr/bin/env node
// JecBridge — connect a local project to any AI over MCP.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import http from "node:http";
import express from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Workspace, IGNORE_FILE } from "./workspace.js";
import { createServer } from "./tools.js";
import { VERSION } from "./version.js";
import { startTunnel, copyToClipboard } from "./tunnel.js";
import { discoverSkills, installSkills, removeSkill, userSkillsDir, PROJECT_SKILL_DIRS,
  scriptHashes, skillTrust, trustSkill, untrustSkill, readSkill } from "./skills.js";

const HELP = `
JecBridge — connect a local project to any AI over MCP

Usage:
  jecbridge [project-folder] [options]

  The folder defaults to the current one and is created if it doesn't exist.

Quick start (claude.ai, ChatGPT, Gemini):
  npx jecbridge my-app --tunnel

Skills (SKILL.md, same format as Claude Code):
  jecbridge skills list                    skills the AI can use here
  jecbridge skills add <source>            from GitHub (owner/repo/path or URL) or a folder
  jecbridge skills trust <name>            let the AI run the skill's scripts (pinned to their contents)
  jecbridge skills untrust <name>
  jecbridge skills remove <name>
  add --project to install into this project's .claude/skills, --trust to trust scripts on add

Options:
  --stdio                 stdio transport (Claude Desktop, Cursor, Claude Code)
  --port <n>              HTTP port (default: 8787)
  --host <h>              HTTP host (default: 127.0.0.1)
  --tunnel                public HTTPS URL for web AIs (cloudflared is downloaded automatically)
  --token <t>             secret token (default: generated and saved)
  --new-token             replace the saved token, so every old URL stops working
  --deny <a,b,c>          hide more files from the AI, e.g. "*.csv,*.sql,fixtures/"
                          (also read from a .jecbridgeignore file in the project)
  --read-only             read-only mode (no writes, no commands, nothing saved in the project)
  --allow-all-commands    allow any shell command (USE WITH CARE)
  --allow <a,b,c>         replace the command allowlist
  -v, --version
  -h, --help
`;

const DEFAULT_PORT = 8787;

function usageError(msg) { console.error(`${msg}\nRun "jecbridge --help" for usage.`); process.exit(2); }

function parseArgs(argv) {
  const o = { port: DEFAULT_PORT, host: "127.0.0.1" };
  const value = (i, name) => {
    const v = argv[i];
    if (v === undefined || v.startsWith("-")) usageError(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "-v" || a === "--version") o.version = true;
    else if (a === "--stdio") o.stdio = true;
    else if (a === "--tunnel") o.tunnel = true;
    else if (a === "--read-only") o.readOnly = true;
    else if (a === "--allow-all-commands") o.allowAll = true;
    else if (a === "--init") {} // kept for compatibility: missing folders are created anyway
    else if (a === "--port") {
      o.portSet = true;
      o.port = Number(value(++i, a));
      if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) usageError(`--port must be a number from 1 to 65535, got "${argv[i]}"`);
    }
    else if (a === "--host") o.host = value(++i, a);
    else if (a === "--token") o.token = value(++i, a);
    else if (a === "--new-token") o.newToken = true;
    else if (a === "--deny") {
      o.deny = [...(o.deny || []), ...value(++i, a).split(",").map((s) => s.trim()).filter(Boolean)];
      if (!o.deny.length) usageError('--deny needs patterns, e.g. --deny "*.csv,*.sql,fixtures/"');
    }
    else if (a === "--allow") {
      o.allow = value(++i, a).split(",").map((s) => s.trim()).filter(Boolean);
      if (!o.allow.length) usageError("--allow needs at least one command, e.g. --allow npm,node");
    }
    else if (!a.startsWith("-") && !o.root) o.root = a;
    else usageError(`Unknown option: ${a}`);
  }
  return o;
}

if (process.argv[2] === "skills") { await skillsCommand(process.argv.slice(3)); process.exit(0); }

// jecbridge skills [list | add <source> | remove <name>] [--project]
async function skillsCommand([sub = "list", ...rest]) {
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const args = rest.filter((a) => !a.startsWith("--"));
  const project = flags.has("--project");
  const dest = project ? path.resolve(PROJECT_SKILL_DIRS[0]) : userSkillsDir();
  const where = project ? `this project (${PROJECT_SKILL_DIRS[0]})` : `your skills folder (${userSkillsDir()})`;
  const TRUST_LABEL = { none: "no scripts", trusted: "scripts trusted", untrusted: "scripts NOT trusted", changed: "scripts CHANGED" };
  const find = (name) => {
    const s = discoverSkills(process.cwd()).find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (!s) throw new Error(`no skill "${name}" here. See: jecbridge skills list`);
    return s;
  };
  // Show what would run, then ask (or take --yes). Without a terminal the answer is no.
  const showScripts = (skill) => {
    console.log(`\nScripts in ${skill.name} (${skill.dir}):`);
    for (const [f, h] of Object.entries(scriptHashes(skill))) {
      console.log(`  ${f.padEnd(40)} ${String(fs.statSync(path.join(skill.dir, f)).size).padStart(7)} bytes  sha256 ${h.slice(0, 12)}`);
    }
  };
  const confirmTrust = async (skill) => {
    showScripts(skill);
    console.log("Trusting lets the AI run these files with run_skill_script. Review them first if the skill isn't yours.");
    if (flags.has("--yes")) return true;
    if (!process.stdin.isTTY) { console.log("No terminal to confirm in: not trusted. Re-run with --yes to trust."); return false; }
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Trust the scripts of ${skill.name}? [y/N] `)).trim().toLowerCase();
    rl.close();
    return answer === "y" || answer === "yes";
  };
  try {
    if (sub === "list") {
      const skills = discoverSkills(process.cwd());
      if (!skills.length) return console.log("No skills yet. Add one: jecbridge skills add <github owner/repo/path | folder>");
      console.log(`Skills the AI can use in ${process.cwd()}:\n`);
      for (const s of skills) {
        console.log(`  ${s.name.padEnd(24)} ${`[${s.source}]`.padEnd(12)} ${TRUST_LABEL[skillTrust(s)].padEnd(20)} ${s.description.slice(0, 70)}${s.description.length > 70 ? "…" : ""}`);
      }
      return;
    }
    if (sub === "add") {
      if (!args[0]) throw new Error("usage: jecbridge skills add <github owner/repo/path | https://github.com/... | folder> [--project] [--trust]");
      if (flags.has("--trust")) flags.add("--yes");
      const installed = await installSkills(args[0], { destRoot: dest, log: (m) => console.log(m) });
      if (!installed.length) throw new Error("nothing was installed");
      for (const s of installed) {
        console.log(`\n+ ${s.updated ? "updated" : "installed"} ${s.name}: ${s.description.slice(0, 120)}${s.description.length > 120 ? "…" : ""}`);
        console.log(`  ${s.files} file(s) in ${s.dir}`);
        if (!s.scripts.length) continue;
        const skill = readSkill(s.dir, project ? "project" : "user"); // the copy just installed, not a same-named one elsewhere
        if (skillTrust(skill) === "trusted") { console.log("  Scripts unchanged and already trusted."); continue; }
        if ((flags.has("--trust") || process.stdin.isTTY) && await confirmTrust(skill)) {
          trustSkill(skill);
          console.log(`  Scripts trusted: the AI can run them.`);
        } else {
          if (!flags.has("--trust") && !process.stdin.isTTY) showScripts(skill);
          console.log(`  Scripts are NOT trusted: the AI can read this skill but can't run its scripts. Trust later: jecbridge skills trust ${s.name}`);
        }
      }
      console.log(`\nInstalled into ${where}. A skill is instructions for the AI: only install skills from sources you trust.`);
      return;
    }
    if (sub === "trust") {
      if (!args[0]) throw new Error("usage: jecbridge skills trust <name> [--yes]");
      const skill = find(args[0]);
      if (skillTrust(skill) === "none") return console.log(`${skill.name} has no scripts; nothing to trust.`);
      if (!(await confirmTrust(skill))) return console.log("Not trusted.");
      trustSkill(skill);
      return console.log(`Trusted ${skill.name}. If any of its scripts change, they'll need to be trusted again.`);
    }
    if (sub === "untrust") {
      if (!args[0]) throw new Error("usage: jecbridge skills untrust <name>");
      const skill = find(args[0]);
      return console.log(untrustSkill(skill) ? `${skill.name}'s scripts are no longer trusted.` : `${skill.name} wasn't trusted.`);
    }
    if (sub === "remove") {
      if (!args[0]) throw new Error("usage: jecbridge skills remove <name> [--project]");
      const skill = discoverSkills(process.cwd()).find((x) => x.name.toLowerCase() === args[0].toLowerCase() && x.dir.startsWith(dest));
      if (skill) untrustSkill(skill);
      if (!removeSkill(args[0], dest)) throw new Error(`no skill "${args[0]}" in ${where}`);
      return console.log(`Removed ${args[0]} from ${where}.`);
    }
    throw new Error(`unknown command "skills ${sub}". Use: skills list | add <source> | trust <name> | untrust <name> | remove <name>`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

const opts = parseArgs(process.argv.slice(2));
if (opts.version) { console.log(VERSION); process.exit(0); }
if (opts.help) { console.log(HELP); process.exit(0); }

const rootAbs = path.resolve(opts.root || ".");
// Never hand the AI a whole home folder or drive by accident
if (!opts.root && (rootAbs === os.homedir() || rootAbs === path.parse(rootAbs).root)) {
  console.error(`You are in ${rootAbs}. Name a project folder, e.g.:\n  jecbridge my-app --tunnel`);
  process.exit(1);
}
if (!fs.existsSync(rootAbs)) {
  fs.mkdirSync(rootAbs, { recursive: true });
  console.error(`Created new folder: ${rootAbs}`);
}

const ws = new Workspace(rootAbs, {
  readOnly: opts.readOnly,
  allowAllCommands: opts.allowAll,
  allowedCommands: opts.allow,
  deny: opts.deny,
});

// Everything the AI reads lands in its chat, so show which data-like files it could read before anyone connects
function exposureWarning() {
  const note = "Note: every file the AI reads is copied into the AI chat and kept by your AI provider. " +
    `Hide files with ${IGNORE_FILE} or --deny.`;
  const groups = ws.exposureReport();
  if (!groups.length) return `\n${note}\n`;
  const lines = groups.map(({ kind, files }) =>
    `  ${(kind + ":").padEnd(24)}${files.slice(0, 3).join(", ")}${files.length > 3 ? ` (+${files.length - 3} more)` : ""}`);
  const examples = [...new Set(groups.flatMap(({ files }) => files.map((f) => {
    const ext = path.extname(f);
    return ext ? `*${ext.toLowerCase()}` : `${f.split("/")[0]}/`;
  })))].slice(0, 4);
  return `\nHeads-up: the AI can read these files, and whatever it reads is copied into the AI chat:\n${lines.join("\n")}\n` +
    `If they hold real or customer data, hide them: add patterns to ${IGNORE_FILE} (e.g. ${examples[0]}) ` +
    `or restart with --deny "${examples.join(",")}".\n`;
}

// In stdio mode stdout carries MCP traffic, so logs go to stderr
const log = (...a) => console.error(`[${new Date().toLocaleTimeString()}]`, ...a);

if (opts.stdio) {
  const server = createServer(ws, log);
  await server.connect(new StdioServerTransport());
  // When the client goes away, exit so background processes are stopped too
  process.stdin.on("close", () => process.exit(0));
  log(`JecBridge (stdio) is running: ${ws.root}`);
  console.error(exposureWarning());
} else {
  await startHttp();
}

async function startHttp() {
  const tokenFile = path.join(ws.metaDir, "token");
  let token = opts.token || process.env.JECBRIDGE_TOKEN;
  if (!token) {
    if (fs.existsSync(tokenFile) && !opts.newToken) token = fs.readFileSync(tokenFile, "utf8").trim();
    else {
      token = crypto.randomBytes(24).toString("base64url");
      fs.writeFileSync(tokenFile, token, { mode: 0o600 });
      if (opts.newToken) console.error("New token generated: old connector URLs no longer work.");
    }
  }
  const tokenBuf = Buffer.from(token);
  // Compare byte lengths: timingSafeEqual throws on buffers of different size (e.g. non-ASCII input)
  const valid = (t) => {
    if (typeof t !== "string") return false;
    const b = Buffer.from(t);
    return b.length === tokenBuf.length && crypto.timingSafeEqual(b, tokenBuf);
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "20mb" }));
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/", (_req, res) => res.type("text").send("JecBridge is running. Endpoint: /mcp/<token> or /mcp with Authorization: Bearer <token>"));

  // Failed attempts per caller. Behind the tunnel every request comes from 127.0.0.1,
  // so the real caller is taken from Cloudflare's CF-Connecting-IP header.
  const failures = new Map();
  const FAIL_WINDOW_MS = 10 * 60_000, FAIL_LIMIT = 20;
  const callerOf = (req) => String(req.headers["cf-connecting-ip"] || req.ip);

  // Two auth styles: token in the URL path (easy for claude.ai/ChatGPT connectors) or a Bearer header
  const auth = (req, res, next) => {
    const caller = callerOf(req);
    const now = Date.now();
    const f = failures.get(caller);
    if (f && now - f.since > FAIL_WINDOW_MS) failures.delete(caller);
    const recent = failures.get(caller);
    if (recent && recent.count >= FAIL_LIMIT) {
      res.setHeader("Retry-After", String(Math.ceil((recent.since + FAIL_WINDOW_MS - now) / 1000)));
      return res.status(429).json({ jsonrpc: "2.0", error: { code: -32001, message: "Too many failed attempts" }, id: null });
    }
    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (valid(req.params.token) || valid(bearer)) return next();
    const entry = recent || { since: now, count: 0 };
    entry.count++;
    failures.set(caller, entry);
    if (failures.size > 1000) for (const [k, v] of failures) if (now - v.since > FAIL_WINDOW_MS) failures.delete(k);
    log(`WARNING: rejected a request with a wrong token from ${caller} (${entry.count} in the last 10 min).` +
      (entry.count === FAIL_LIMIT ? " Blocking this caller for 10 minutes. If your URL leaked, restart with --new-token." : ""));
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  };

  // Stateless mode: a fresh server + transport per request, so many clients can connect at once
  const handle = async (req, res) => {
    const server = createServer(ws, log);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      log("Error:", e.message);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  };
  const notAllowed = (_req, res) =>
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });

  for (const route of ["/mcp", "/mcp/:token"]) {
    app.post(route, auth, handle);
    app.get(route, auth, notAllowed);
    app.delete(route, auth, notAllowed);
  }

  const port = await listen(app);
  const local = `http://${opts.host}:${port}`;
  console.log(`
┌─ JecBridge is running ───────────────────────────────────
│ Project:  ${ws.root}
│ Mode:     ${ws.readOnly ? "read-only" : "read + write"} · commands: ${ws.allowAllCommands ? "ALL ALLOWED" : "safe allowlist"}
│ Undo:     ${ws.hasGit ? "automatic checkpoints on" : "OFF — install git to enable checkpoints and undo"}
│ Hidden:   .env, keys, .git${ws.denyPatterns.length ? ", " + ws.denyPatterns.join(", ") : ""}
│ Local:    ${local}/mcp/${token}
└───────────────────────────────────────────────────────────`);
  console.log(exposureWarning());

  if (!opts.tunnel) {
    console.log(`\nUsing claude.ai, ChatGPT or Gemini? Restart with --tunnel to get a public URL.\n`);
    return;
  }
  console.log("\nOpening a public tunnel...");
  let publicUrl;
  try { publicUrl = await startTunnel(local, (m) => console.log(m)); }
  catch (e) {
    console.error(`\nWARNING: could not open the tunnel: ${e.message}\n` +
      `The server still works locally. Alternative: ngrok http ${port}  → then append /mcp/${token} to its URL.`);
    return;
  }
  const url = `${publicUrl}/mcp/${token}`;
  const copied = copyToClipboard(url);
  console.log(`
┌─ Add this URL to your AI as a connector ──────────────────
│ ${url}
│ ${copied ? "Copied to the clipboard — just paste it." : ""}
│
│ claude.ai:  Settings → Connectors → Add custom connector
│ ChatGPT:    Settings → Apps & Connectors → Developer mode → Create
│ Gemini:     Settings → Connected Apps → Add a custom app
│
│ WARNING: never share this URL — it contains your secret token.
│ If it leaks, restart with --new-token to make it useless.
│ Keep this window open. Press Ctrl+C to stop.
└───────────────────────────────────────────────────────────`);
}

// Listen on the chosen port; if it's busy and the user didn't pick one, try the next ones
function listen(app) {
  return new Promise((resolve, reject) => {
    const tryPort = (port, left) => {
      // http.createServer, not app.listen: Express 5 also calls the listen callback on errors
      const server = http.createServer(app);
      server.once("listening", () => resolve(port));
      server.once("error", (e) => {
        if (e.code === "EADDRINUSE" && !opts.portSet && left > 0) tryPort(port + 1, left - 1);
        else if (e.code === "EADDRINUSE") { console.error(`Port ${port} is already in use. Pick another one with --port.`); process.exit(1); }
        else reject(e);
      });
      server.listen(port, opts.host);
    };
    tryPort(opts.port, 20);
  });
}
