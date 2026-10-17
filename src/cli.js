#!/usr/bin/env node
// JecBridge — connect a local project to any AI over MCP.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import express from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Workspace } from "./workspace.js";
import { createServer } from "./tools.js";
import { VERSION } from "./version.js";

const HELP = `
JecBridge — connect a local project to any AI over MCP

Usage:
  jecbridge <project-folder> [options]

Options:
  --stdio                 stdio transport (Claude Desktop, Cursor, Claude Code)
  --port <n>              HTTP port (default: 8787)
  --host <h>              HTTP host (default: 127.0.0.1)
  --tunnel                open a Cloudflare quick tunnel (public URL for ChatGPT, claude.ai)
  --token <t>             secret token (default: generated and saved)
  --read-only             read-only mode (no writes, no commands, nothing saved in the project)
  --allow-all-commands    allow any shell command (USE WITH CARE)
  --allow <a,b,c>         replace the command allowlist
  --init                  create the folder if it doesn't exist (new projects)
  -v, --version
  -h, --help
`;

function usageError(msg) { console.error(`${msg}
Run "jecbridge --help" for usage.`); process.exit(2); }

function parseArgs(argv) {
  const o = { port: 8787, host: "127.0.0.1" };
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
    else if (a === "--init") o.init = true;
    else if (a === "--port") {
      o.port = Number(value(++i, a));
      if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) usageError(`--port must be a number from 1 to 65535, got "${argv[i]}"`);
    }
    else if (a === "--host") o.host = value(++i, a);
    else if (a === "--token") o.token = value(++i, a);
    else if (a === "--allow") {
      o.allow = value(++i, a).split(",").map((s) => s.trim()).filter(Boolean);
      if (!o.allow.length) usageError("--allow needs at least one command, e.g. --allow npm,node");
    }
    else if (!a.startsWith("-") && !o.root) o.root = a;
    else usageError(`Unknown option: ${a}`);
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.version) { console.log(VERSION); process.exit(0); }
if (opts.help || !opts.root) { console.log(HELP); process.exit(opts.help ? 0 : 1); }

const rootAbs = path.resolve(opts.root);
if (!fs.existsSync(rootAbs)) {
  if (opts.init) fs.mkdirSync(rootAbs, { recursive: true });
  else { console.error(`Folder not found: ${rootAbs}\nAdd --init to create it for a new project.`); process.exit(1); }
}

const ws = new Workspace(rootAbs, {
  readOnly: opts.readOnly,
  allowAllCommands: opts.allowAll,
  allowedCommands: opts.allow,
});

// In stdio mode stdout carries MCP traffic, so logs go to stderr
const log = (...a) => console.error(`[${new Date().toLocaleTimeString()}]`, ...a);

if (opts.stdio) {
  const server = createServer(ws, log);
  await server.connect(new StdioServerTransport());
  log(`JecBridge (stdio) is running: ${ws.root}`);
} else {
  await startHttp();
}

async function startHttp() {
  const tokenFile = path.join(ws.metaDir, "token");
  let token = opts.token || process.env.JECBRIDGE_TOKEN;
  if (!token) {
    if (fs.existsSync(tokenFile)) token = fs.readFileSync(tokenFile, "utf8").trim();
    else { token = crypto.randomBytes(24).toString("base64url"); fs.writeFileSync(tokenFile, token, { mode: 0o600 }); }
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

  // Two auth styles: token in the URL path (easy for claude.ai/ChatGPT connectors) or a Bearer header
  const auth = (req, res, next) => {
    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (valid(req.params.token) || valid(bearer)) return next();
    log("REJECTED: invalid token from", req.ip);
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

  await new Promise((r) => app.listen(opts.port, opts.host, r));
  const local = `http://${opts.host}:${opts.port}`;
  console.log(`
┌─ JecBridge is running ───────────────────────────────────
│ Project:  ${ws.root}
│ Mode:     ${ws.readOnly ? "read-only" : "read + write"} · commands: ${ws.allowAllCommands ? "ALL ALLOWED" : "safe allowlist"}
│ Local:    ${local}/mcp/${token}
│ Token:    ${token}
└───────────────────────────────────────────────────────────`);

  if (opts.tunnel) startTunnel(local, token);
  else console.log(`\nNeed a public URL for ChatGPT or claude.ai? Restart with --tunnel.\n`);
}

function startTunnel(local, token) {
  const cf = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", local], { stdio: ["ignore", "pipe", "pipe"] });
  let shown = false;
  const onData = (d) => {
    const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !shown) {
      shown = true;
      console.log(`
┌─ Public URL — add this to your AI as a connector ─────────
│ ${m[0]}/mcp/${token}
│
│ claude.ai:  Settings → Connectors → Add custom connector
│ ChatGPT:    Settings → Apps & Connectors → Developer mode → Create
│ ⚠ Never share this URL — it contains your secret token.
└───────────────────────────────────────────────────────────`);
    }
  };
  cf.stdout.on("data", onData);
  cf.stderr.on("data", onData);
  cf.on("error", () => {
    console.log(`
⚠ cloudflared not found. Install it:
   macOS:   brew install cloudflared
   Windows: winget install --id Cloudflare.cloudflared
   Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
Or use ngrok:  ngrok http ${local.split(":").pop()}   → then append /mcp/<token> to its URL.`);
  });
  process.on("exit", () => cf.kill());
  process.on("SIGINT", () => { cf.kill(); process.exit(0); });
}
