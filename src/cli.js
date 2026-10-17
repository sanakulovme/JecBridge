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
import { Workspace } from "./workspace.js";
import { createServer } from "./tools.js";
import { VERSION } from "./version.js";
import { startTunnel, copyToClipboard } from "./tunnel.js";

const HELP = `
JecBridge — connect a local project to any AI over MCP

Usage:
  jecbridge [project-folder] [options]

  The folder defaults to the current one and is created if it doesn't exist.

Quick start (claude.ai, ChatGPT, Gemini):
  npx jecbridge my-app --tunnel

Options:
  --stdio                 stdio transport (Claude Desktop, Cursor, Claude Code)
  --port <n>              HTTP port (default: 8787)
  --host <h>              HTTP host (default: 127.0.0.1)
  --tunnel                public HTTPS URL for web AIs (cloudflared is downloaded automatically)
  --token <t>             secret token (default: generated and saved)
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

  const port = await listen(app);
  const local = `http://${opts.host}:${port}`;
  console.log(`
┌─ JecBridge is running ───────────────────────────────────
│ Project:  ${ws.root}
│ Mode:     ${ws.readOnly ? "read-only" : "read + write"} · commands: ${ws.allowAllCommands ? "ALL ALLOWED" : "safe allowlist"}
│ Undo:     ${ws.hasGit ? "automatic checkpoints on" : "OFF — install git to enable checkpoints and undo"}
│ Local:    ${local}/mcp/${token}
└───────────────────────────────────────────────────────────`);

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
