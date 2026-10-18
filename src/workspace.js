// Workspace: every file and command operation is confined to the project root.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import crossSpawn from "cross-spawn";

const DENY_PATTERNS = [
  // "i": Windows and macOS filesystems are case-insensitive (.ENV == .env)
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.jecbridge(\/|$)/i,
  /(^|\/)\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/i,
  /(^|\/)\.jecbridgeignore$/i, // the AI must not be able to lift its own restrictions
];

const builtinDenied = (p) => DENY_PATTERNS.some((re) => re.test(p));

export const IGNORE_FILE = ".jecbridgeignore";

// .gitignore-style pattern → RegExp on a project-relative path ("data/customers.csv").
// "*.csv" matches in any folder, "fixtures/" is a folder anywhere, "/private.json" or "a/b" are anchored to the root.
export function patternToRegex(pattern) {
  let p = pattern.trim().replace(/\\/g, "/");
  if (!p || p.startsWith("#")) return null;
  if (p.endsWith("/")) p = p.slice(0, -1);
  const anchored = p.includes("/");
  p = p.replace(/^\/+/, "");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") { re += ".*"; i++; if (p[i + 1] === "/") i++; }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // matching a folder also hides everything inside it
  return new RegExp((anchored ? "^" : "(^|/)") + re + "(/|$)", "i");
}

// Data files that often hold real people's data, flagged at startup so the user sees the exposure
const SENSITIVE_DATA = [
  { kind: "data exports", re: /\.(csv|tsv|xlsx?|parquet|jsonl|ndjson)$/i },
  { kind: "databases", re: /\.(db|sqlite3?|mdb|accdb)$/i },
  { kind: "SQL dumps and backups", re: /\.(sql|dump|bak)$/i },
  { kind: "fixture and seed data", re: /(^|\/)(fixtures?|seeds?|dumps?|backups?|exports?)\// },
];

// Environment variables that look like credentials are not passed to commands in safe mode
const SECRET_ENV = /TOKEN|SECRET|PASSW(OR)?D|API_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH/i;

const BLOCKED_GIT = ["push", "remote", "config", "credential"];

// Children still running when the server exits are killed with it
const running = new Set();
process.on("exit", () => { for (const c of running) killTree(c); });
// Ctrl+C / closing the window normally skips "exit" handlers; exit explicitly so children are cleaned up
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => process.exit(0));

const MAX_PROCESSES = 5;
const PROCESS_LOG_MAX = 200_000;
// Dev servers print where they listen, e.g. "Local: http://localhost:5173/"
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d+[^\s'"<>]*/;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
const HTTP_BODY_MAX = 20_000;
const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};
// Redaction of hidden-file content in command output
const REDACT_MIN_LINE = 6;           // shorter lines ("}", "id,a") are too common to mean anything
const REDACT_MAX_FILE = 50 * 1024 * 1024;
const REDACT_MAX_LINES = 2_000_000;
const lineHash = (s) => crypto.createHash("sha1").update(s).digest("base64").slice(0, 16);
const SUBSTRING_MAX = 5_000;          // beyond this, only whole lines and single values are matched (speed)
// A single value inside a line: split on separators used by CSV, .env, JSON, logs and HTML
const FIELD = /[^,;\t|=:"'`\s<>(){}[\]]{8,}/g;
// Values that look like data rather than ordinary words: emails, keys, ids, phone numbers
const dataLike = (f) => /[\d@]/.test(f) || f.length >= 20;
const PROBLEM_LINE =/\b(error|exception|failed|failure|cannot|can't|not found|traceback|panic|fatal|warn(ing)?)\b|ERR!|✘|✖/i;

function killTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL"); // the child leads its own process group (detached)
  } catch { try { child.kill("SIGKILL"); } catch {} }
}

// Folders skipped when listing files without git (git uses .gitignore + info/exclude instead)
const SKIP_DIRS = new Set(["node_modules", ".git", ".jecbridge", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target"]);

const NO_GIT = "Checkpoints and undo are off because git is not installed. Install git (https://git-scm.com) and restart JecBridge.";

const DEFAULT_ALLOWED = [
  "npm", "npx", "pnpm", "yarn", "bun", "node", "deno", "tsc",
  "python", "python3", "pip", "pip3", "pytest", "uv",
  "go", "cargo", "rustc", "dotnet", "java", "javac", "mvn", "gradle",
  "make", "php", "composer", "ruby", "bundle",
  "ls", "cat", "echo", "pwd", "dir", "type", "where", "git", "eslint", "prettier", "jest", "vitest",
];

export class Workspace {
  processes = new Map();
  #nextProcessId = 0;
  #static = null;
  #fingerprints = null;
  #fingerprintsAt = 0;

  constructor(root, opts = {}) {
    this.root = fs.realpathSync(path.resolve(root));
    this.allowAllCommands = !!opts.allowAllCommands;
    this.allowed = new Set(opts.allowedCommands || DEFAULT_ALLOWED);
    this.readOnly = !!opts.readOnly;
    // User deny list: .jecbridgeignore in the project plus --deny patterns
    const ignoreFile = path.join(this.root, IGNORE_FILE);
    const fromFile = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8").split(/\r?\n/) : [];
    this.denyPatterns = [...fromFile, ...(opts.deny || [])].map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
    this.userDeny = this.denyPatterns.map(patternToRegex).filter(Boolean);
    // Read-only mode must not write into the project, so its metadata lives in the temp folder
    this.metaDir = this.readOnly
      ? path.join(os.tmpdir(), "jecbridge", crypto.createHash("sha256").update(this.root).digest("hex").slice(0, 16))
      : path.join(this.root, ".jecbridge");
    this.gitDir = path.join(this.metaDir, "shadow.git");
    fs.mkdirSync(this.metaDir, { recursive: true });
    fs.writeFileSync(path.join(this.metaDir, ".gitignore"), "*\n");
    // Without git everything still works, only checkpoints/undo/diff are unavailable
    this.hasGit = spawnSync("git", ["--version"], { stdio: "ignore", windowsHide: true }).status === 0;
    if (this.hasGit) this.#initShadowGit();
  }

  // ---------- safe path resolution ----------
  resolve(rel = ".", { forWrite = false } = {}) {
    if (typeof rel !== "string") throw new Error("path must be a string");
    const abs = path.resolve(this.root, rel.replace(/^\/+/, ""));
    const relToRoot = path.relative(this.root, abs);
    if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
      throw new Error(`Access denied: "${rel}" is outside the project folder`);
    }
    // block escapes through symlinks
    let probe = abs;
    while (!fs.existsSync(probe)) probe = path.dirname(probe);
    const real = fs.realpathSync(probe);
    if (real !== this.root && !real.startsWith(this.root + path.sep)) {
      throw new Error(`Access denied: "${rel}" resolves outside the project via a symlink`);
    }
    const norm = relToRoot.split(path.sep).join("/");
    if (norm && builtinDenied(norm)) {
      throw new Error(`Access denied: "${norm}" is protected (secret or internal file)`);
    }
    if (norm && this.userDeny.some((re) => re.test(norm))) {
      throw new Error(`Access denied: "${norm}" is hidden by the user (${IGNORE_FILE} or --deny)`);
    }
    if (forWrite && this.readOnly) throw new Error("Server is running in read-only mode");
    return { abs, rel: norm || "." };
  }

  isDenied(p) {
    return builtinDenied(p) || this.userDeny.some((re) => re.test(p));
  }

  // Readable files that look like real data (CSV exports, SQL dumps, databases, fixtures), grouped by kind
  // Hashes of the lines of every hidden file (.env, keys, .jecbridgeignore / --deny matches), so output
  // that echoes them verbatim can be caught: a script the AI runs may read a hidden file the tools can't.
  #hiddenLines() {
    if (this.#fingerprints && Date.now() - this.#fingerprintsAt < 10_000) return this.#fingerprints;
    const map = new Map();      // whole lines
    const fields = new Map();   // values inside lines: emails, keys, ids
    const longLines = [];       // for finding a hidden line inside a longer output line
    let scanned = 0;
    const visit = (dirRel) => {
      let entries;
      try { entries = fs.readdirSync(path.join(this.root, dirRel), { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (++scanned > 50_000 || map.size > REDACT_MAX_LINES) return;
        const p = dirRel === "." ? e.name : `${dirRel}/${e.name}`;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) visit(p); continue; }
        if (!e.isFile() || !this.isDenied(p)) continue;
        let buf;
        try { if (fs.statSync(path.join(this.root, p)).size > REDACT_MAX_FILE) continue; buf = fs.readFileSync(path.join(this.root, p)); } catch { continue; }
        if (buf.subarray(0, 8000).includes(0)) continue; // binary
        for (const line of buf.toString("utf8").split("\n")) {
          const t = line.trim();
          if (t.length < REDACT_MIN_LINE) continue;
          map.set(lineHash(t), p);
          if (t.length >= 12 && longLines.length <= SUBSTRING_MAX) longLines.push([t, p]);
          for (const f of t.match(FIELD) || []) if (dataLike(f)) fields.set(lineHash(f), p);
        }
      }
    };
    visit(".");
    this.#fingerprints = { lines: map, fields, longLines: longLines.length <= SUBSTRING_MAX ? longLines : [] };
    this.#fingerprintsAt = Date.now();
    return this.#fingerprints;
  }

  // Replace lines that come verbatim from a hidden file before they reach the AI
  redact(text) {
    if (typeof text !== "string" || !text) return text;
    const { lines, fields, longLines } = this.#hiddenLines();
    if (!lines.size) return text;
    let changed = false;
    const out = text.split("\n").map((line) => {
      const t = line.trim();
      const file = t.length >= REDACT_MIN_LINE && lines.get(lineHash(t));
      if (file) { changed = true; return `[hidden: a line from ${file}]`; }
      // A hidden line inside a longer one (HTML, JSON, a log prefix), then single values (emails, keys, ids)
      let l = line;
      for (const [hidden, from] of longLines) if (l.includes(hidden)) l = l.split(hidden).join(`[hidden: a line from ${from}]`);
      l = l.replace(FIELD, (f) => (dataLike(f) && fields.has(lineHash(f)) ? "[hidden]" : f));
      if (l !== line) changed = true;
      return l;
    });
    return changed ? out.join("\n") : text;
  }

  exposureReport(maxScan = 20_000) {
    const groups = new Map();
    let scanned = 0;
    const visit = (dirRel) => {
      let entries;
      try { entries = fs.readdirSync(path.join(this.root, dirRel), { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (++scanned > maxScan) return;
        const p = dirRel === "." ? e.name : `${dirRel}/${e.name}`;
        if (this.isDenied(p)) continue;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) visit(p); continue; }
        if (!e.isFile()) continue;
        const hit = SENSITIVE_DATA.find((s) => s.re.test(p));
        if (hit) groups.set(hit.kind, [...(groups.get(hit.kind) || []), p]);
      }
    };
    visit(".");
    return SENSITIVE_DATA.filter((s) => groups.has(s.kind)).map((s) => ({ kind: s.kind, files: groups.get(s.kind).sort() }));
  }

  // ---------- shadow git (never touches the project's own .git) ----------
  #git(args, opts = {}) {
    return execFileSync("git", args, {
      cwd: this.root,
      env: {
        ...process.env,
        GIT_DIR: this.gitDir,
        GIT_WORK_TREE: this.root,
        GIT_AUTHOR_NAME: "JecBridge", GIT_AUTHOR_EMAIL: "jecbridge@local",
        GIT_COMMITTER_NAME: "JecBridge", GIT_COMMITTER_EMAIL: "jecbridge@local",
      },
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
  }

  #initShadowGit() {
    if (!fs.existsSync(this.gitDir)) {
      execFileSync("git", ["init", "--bare", "-q", this.gitDir], { stdio: "ignore" });
      this.#git(["config", "core.bare", "false"]);
      this.#git(["config", "core.autocrlf", "false"]);
      this.#git(["config", "core.ignorecase", "true"]);
    }
    const exclude = path.join(this.gitDir, "info", "exclude");
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.writeFileSync(exclude, [".jecbridge/", ".git/", "node_modules/", ".venv/", "venv/",
      "__pycache__/", "dist/", "build/", ".next/", "target/", ".DS_Store", ".env", ".env.*", IGNORE_FILE,
      ...this.denyPatterns, ""].join("\n"));
    // Hidden files must not show up in diffs either: stop tracking any that earlier checkpoints picked up
    if (this.denyPatterns.length && this.hasCommits()) {
      const tracked = this.#git(["ls-files"]).split("\n").filter((f) => f && this.isDenied(f));
      for (let i = 0; i < tracked.length; i += 100) this.#git(["rm", "-q", "--cached", "--", ...tracked.slice(i, i + 100)]);
    }
  }

  hasCommits() {
    if (!this.hasGit) return false;
    try { this.#git(["rev-parse", "--verify", "HEAD"]); return true; } catch { return false; }
  }

  checkpoint(label = "checkpoint") {
    if (!this.hasGit) return { created: false, id: null, note: NO_GIT };
    this.#git(["add", "-A"]);
    const changed = !this.hasCommits() ||
      this.#git(["diff", "--cached", "--name-only"]).trim().length > 0;
    if (!changed) return { created: false, id: this.#git(["rev-parse", "--short", "HEAD"]).trim() };
    this.#git(["commit", "-q", "--allow-empty", "-m", label]);
    return { created: true, id: this.#git(["rev-parse", "--short", "HEAD"]).trim() };
  }

  listCheckpoints(limit = 20) {
    if (!this.hasCommits()) return [];
    return this.#git(["log", `-${limit}`, "--format=%h|%cI|%s"]).trim().split("\n")
      .filter(Boolean).map((l) => { const [id, time, ...m] = l.split("|"); return { id, time, label: m.join("|") }; });
  }

  diff(since) {
    if (!this.hasGit) return NO_GIT;
    if (!this.hasCommits()) return "(no checkpoints yet)";
    this.#git(["add", "-A", "-N"]); // include new files in the diff
    const out = this.#git(["diff", since || "HEAD", "--stat", "--patch", "--no-color"]);
    // An old checkpoint may still hold a file that is hidden now: drop its section from the diff
    const sections = out.split(/(?=^diff --git )/m).filter((s) => {
      const m = s.match(/^diff --git a\/(.+?) b\//);
      return !m || !this.isDenied(m[1]);
    });
    // ...and its line from the --stat summary at the top
    if (sections[0] && !sections[0].startsWith("diff --git ")) {
      sections[0] = sections[0].split("\n").filter((l) => {
        const m = l.match(/^\s(.+?)\s+\|\s/);
        return !m || !this.isDenied(m[1].trim());
      }).join("\n");
    }
    return sections.join("").trim() || "(no changes)";
  }

  restore(id) {
    if (this.readOnly) throw new Error("Server is running in read-only mode");
    if (!this.hasGit) throw new Error(NO_GIT);
    this.#git(["rev-parse", "--verify", `${id}^{commit}`]);
    const safety = this.checkpoint(`auto-save before undo (→ ${id})`);
    const current = this.#git(["rev-parse", "HEAD"]).trim();
    const added = this.#git(["diff", "--name-only", "--diff-filter=A", id, current]).trim().split("\n").filter(Boolean);
    for (const f of added) fs.rmSync(path.join(this.root, f), { force: true });
    this.#git(["checkout", id, "--", "."]);
    this.#git(["reset", "-q", "--mixed", id]);
    this.#git(["update-ref", "refs/jecbridge/before-undo", current]);
    return { restoredTo: id, removedFiles: added, redoId: safety.id };
  }

  listFiles(dir = ".", maxDepth = 4, limit = 2000) {
    const { rel } = this.resolve(dir);
    let files;
    if (this.hasGit) {
      this.#git(["add", "-A", "-N"]);
      files = this.#git(["ls-files", "-co", "--exclude-standard", ...(rel === "." ? [] : ["--", rel])])
        .split("\n").filter(Boolean);
    } else {
      files = this.#walk(rel, maxDepth, limit + 1);
    }
    files = [...new Set(files)].filter((f) => {
      const depth = (rel === "." ? f : path.posix.relative(rel, f)).split("/").length;
      return depth <= maxDepth && !this.isDenied(f) && fs.existsSync(path.join(this.root, f));
    }).sort();
    return { files: files.slice(0, limit), truncated: files.length > limit, total: files.length };
  }

  // Plain directory walk used when git is not installed; doesn't follow symlinks
  #walk(rel, maxDepth, cap) {
    const out = [];
    const visit = (dirRel, depth) => {
      if (out.length >= cap || depth > maxDepth) return;
      let entries;
      try { entries = fs.readdirSync(path.join(this.root, dirRel), { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = dirRel === "." ? e.name : `${dirRel}/${e.name}`;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) visit(p, depth + 1); }
        else if (e.isFile()) out.push(p);
        if (out.length >= cap) return;
      }
    };
    visit(rel, 1);
    return out;
  }

  // ---------- commands ----------
  #parseArgs(cmd) {
    const out = []; let cur = ""; let q = null;
    for (const ch of cmd) {
      if (q) { if (ch === q) q = null; else cur += ch; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ""; } }
      else cur += ch;
    }
    if (q) throw new Error("Unclosed quote in command");
    if (cur) out.push(cur);
    return out;
  }

  #childEnv() {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.toUpperCase() === "JECBRIDGE_TOKEN") continue;
      if (!this.allowAllCommands && SECRET_ENV.test(k)) continue;
      env[k] = v;
    }
    return env;
  }

  // Arguments (and --opt=value values) that point outside the project or at protected files are rejected,
  // so allowlisted tools like cat, ls or git can't be used to bypass the folder jail
  #checkArgs(args, cwdAbs) {
    for (const arg of args) {
      const eq = arg.indexOf("=");
      for (const a of eq > 0 ? [arg, arg.slice(eq + 1)] : [arg]) {
        if (!a || /^[a-z][a-z0-9+.-]*:\/\//i.test(a)) continue; // URLs
        try { this.resolve(path.relative(this.root, path.resolve(cwdAbs, a))); }
        catch { throw new Error(`Argument "${arg}" points outside the project or at a protected file — blocked in safe mode`); }
      }
    }
  }

  // Validates a command against the safe-mode rules and starts it; shared by run() and startProcess()
  #spawn(command, cwd) {
    if (this.readOnly) throw new Error("Server is running in read-only mode");
    const { abs: cwdAbs } = this.resolve(cwd);
    const opts = { cwd: cwdAbs, env: this.#childEnv(), windowsHide: true, detached: process.platform !== "win32" };
    let child;
    if (this.allowAllCommands) {
      child = spawn(command, { ...opts, shell: true });
    } else {
      if (/[;&|`<>\r\n]|\$\(/.test(command)) {
        throw new Error("Safe mode does not allow ; && | ` > < $( or line breaks. Run each command in a separate call, or start the server with --allow-all-commands.");
      }
      const [bin, ...args] = this.#parseArgs(command);
      if (!bin || !this.allowed.has(bin)) {
        throw new Error(`"${bin}" is not in the command allowlist. Allowed: ${[...this.allowed].join(", ")}`);
      }
      if (bin === "git" && args[0]?.startsWith("-")) {
        throw new Error("git options before the subcommand (-C, -c, --git-dir, ...) are blocked in safe mode");
      }
      if (bin === "git" && BLOCKED_GIT.includes(args[0])) {
        throw new Error(`"git ${args[0]}" is blocked in safe mode`);
      }
      this.#checkArgs(args, cwdAbs);
      // cross-spawn finds .cmd shims (npm, npx) on Windows and escapes every argument for cmd.exe,
      // so spaces stay inside one argument and %VAR% / ^ are not expanded
      child = crossSpawn(bin, args, opts);
    }
    running.add(child);
    return child;
  }

  run(command, { cwd = ".", timeoutSec = 120 } = {}) {
    return this.#collect(this.#spawn(command, cwd), timeoutSec);
  }

  // Run a script that ships inside a skill (outside the project). The script itself is trusted because
  // the user installed the skill; its interpreter must be allowed and its arguments stay in the jail.
  runScript(scriptAbs, args = [], { cwd = ".", timeoutSec = 120, interpreter } = {}) {
    if (this.readOnly) throw new Error("Server is running in read-only mode");
    if (!interpreter) throw new Error(`Don't know how to run ${path.basename(scriptAbs)}: use .js, .py, .sh, .ps1, .rb or .ts`);
    if (!this.allowAllCommands && !this.allowed.has(interpreter)) {
      throw new Error(`"${interpreter}" is not in the command allowlist, so this skill script can't run. Allowed: ${[...this.allowed].join(", ")}`);
    }
    const { abs: cwdAbs } = this.resolve(cwd);
    if (!this.allowAllCommands) this.#checkArgs(args, cwdAbs);
    const pre = interpreter === "npx" ? ["tsx"] : interpreter === "powershell" ? ["-NoProfile", "-File"] : [];
    const child = crossSpawn(interpreter, [...pre, scriptAbs, ...args],
      { cwd: cwdAbs, env: this.#childEnv(), windowsHide: true, detached: process.platform !== "win32" });
    running.add(child);
    return this.#collect(child, timeoutSec);
  }

  #collect(child, timeoutSec) {
    return new Promise((resolve) => {
      let out = ""; const cap = 60_000;
      const add = (d) => { if (out.length < cap) out += d.toString(); };
      child.stdout.on("data", add); child.stderr.on("data", add);
      const timer = setTimeout(() => { killTree(child); out += `\n[killed after ${timeoutSec}s timeout]`; }, timeoutSec * 1000);
      const done = (r) => { clearTimeout(timer); running.delete(child); resolve(r); };
      child.on("error", (e) => done({ exitCode: -1, output: String(e.message) }));
      child.on("close", (code) => {
        if (out.length >= cap) out = out.slice(0, cap) + "\n[...output truncated]";
        done({ exitCode: code, output: this.redact(out) });
      });
    });
  }

  // ---------- background processes (dev servers, watchers) ----------
  async startProcess(command, { cwd = ".", waitSec = 10 } = {}) {
    const alive = [...this.processes.values()].filter((p) => p.exitCode === null);
    if (alive.length >= MAX_PROCESSES) {
      throw new Error(`Already ${MAX_PROCESSES} background processes running (${alive.map((p) => p.id).join(", ")}). Stop one with stop_process first.`);
    }
    const child = this.#spawn(command, cwd);
    const proc = { id: `p${++this.#nextProcessId}`, command, cwd, child, startedAt: new Date().toISOString(), out: "", exitCode: null, url: null };
    this.processes.set(proc.id, proc);
    const add = (d) => {
      proc.out += stripAnsi(d.toString());
      if (proc.out.length > PROCESS_LOG_MAX) proc.out = proc.out.slice(-PROCESS_LOG_MAX / 2);
      if (!proc.url) {
        const m = proc.out.match(LOCAL_URL);
        if (m) proc.url = m[0].replace(/0\.0\.0\.0|\[::\]/, "localhost");
      }
    };
    child.stdout.on("data", add); child.stderr.on("data", add);
    child.on("error", (e) => { proc.out += `\n[failed to start: ${e.message}]`; proc.exitCode = -1; running.delete(child); });
    child.on("close", (code, signal) => { proc.exitCode = code ?? -1; if (signal) proc.out += `\n[stopped by ${signal}]`; running.delete(child); });

    // Return as soon as the process prints a local URL or exits, or after waitSec
    const deadline = Date.now() + waitSec * 1000;
    while (!proc.url && proc.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    return this.#processInfo(proc, 40);
  }

  processOutput(id, lines = 100) {
    if (!id) return [...this.processes.values()].map((p) => this.#processInfo(p, 0));
    return this.#processInfo(this.#getProcess(id), lines);
  }

  async stopProcess(id) {
    const proc = this.#getProcess(id);
    if (proc.exitCode === null) {
      killTree(proc.child);
      const deadline = Date.now() + 5000;
      while (proc.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    }
    return this.#processInfo(proc, 20);
  }

  // GET a URL served by one of our background processes, so the AI can check its own work.
  // Only those ports are reachable: other local services (databases, Docker, admin panels) stay off limits.
  devUrl(url, tool = "http_get") {
    let u;
    try { u = new URL(url); } catch { throw new Error(`"${url}" is not a valid URL, e.g. http://localhost:5173/`); }
    const portOf = (x) => x.port || (x.protocol === "https:" ? "443" : "80");
    const ports = new Set([...this.processes.values()].filter((p) => p.exitCode === null && p.url).map((p) => portOf(new URL(p.url))));
    if (!/^https?:$/.test(u.protocol) || !LOCAL_HOSTS.has(u.hostname) || !ports.has(portOf(u))) {
      throw new Error(`${tool} only reaches dev servers started with start_process` +
        (ports.size ? ` (running on port ${[...ports].join(", ")})` : " (none is running)") + ". Start the server with start_process first.");
    }
    return u;
  }

  // Serve project files over http://127.0.0.1 so check_page can open plain HTML projects.
  // Every request goes through resolve(), so the jail and the secret-file rules apply;
  // http pages also can't read file:// URLs, which a file:// page could show in a screenshot.
  async staticUrl(rel) {
    const { rel: clean } = this.resolve(rel);
    if (!this.#static) {
      const server = http.createServer((req, res) => {
        try {
          let p = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || ".";
          let { abs } = this.resolve(p);
          if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) abs = this.resolve(path.posix.join(p, "index.html")).abs;
          if (!fs.existsSync(abs)) { res.statusCode = 404; return res.end("Not found"); }
          res.setHeader("content-type", MIME[path.extname(abs).toLowerCase()] || "application/octet-stream");
          fs.createReadStream(abs).pipe(res);
        } catch { res.statusCode = 403; res.end("Forbidden"); }
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      server.unref();
      this.#static = server;
    }
    return `http://127.0.0.1:${this.#static.address().port}/${clean === "." ? "" : clean.split("/").map(encodeURIComponent).join("/")}`;
  }

  async httpGet(url) {
    const u = this.devUrl(url);
    // "localhost" may resolve to IPv6 while the server listens on IPv4 (or the other way round)
    const hosts = u.hostname === "localhost" || u.hostname === "0.0.0.0" ? [u.hostname, "127.0.0.1", "[::1]"] : [u.hostname];
    let lastError;
    for (const h of hosts) {
      const target = new URL(u); target.hostname = h === "0.0.0.0" ? "127.0.0.1" : h;
      try {
        const res = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
        const type = res.headers.get("content-type") || "";
        const textual = /text|json|javascript|xml|html/.test(type) || !type;
        const body = textual ? await res.text() : "";
        const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1];
        return {
          url, status: res.status, contentType: type,
          ...(res.headers.get("location") ? { redirectsTo: res.headers.get("location") } : {}),
          ...(title !== undefined ? { title: title.trim() } : {}),
          body: textual ? this.redact(body.slice(0, HTTP_BODY_MAX)) : `(${type} body not shown)`,
          ...(body.length > HTTP_BODY_MAX ? { truncated: true } : {}),
        };
      } catch (e) { lastError = e; }
    }
    throw new Error(`Could not reach ${url}: ${lastError?.cause?.code || lastError?.message}. Check process_output for errors.`);
  }

  #getProcess(id) {
    const proc = this.processes.get(id);
    if (!proc) throw new Error(`No background process "${id}". Known: ${[...this.processes.keys()].join(", ") || "none"}`);
    return proc;
  }

  #processInfo(p, lines) {
    const info = { id: p.id, command: p.command, cwd: p.cwd, running: p.exitCode === null, exitCode: p.exitCode, url: p.url, startedAt: p.startedAt };
    if (lines > 0) {
      const all = p.out.split(/\r?\n/);
      info.output = this.redact(all.slice(-lines).join("\n").trim());
      // Error-looking lines from the whole log, so they aren't missed in a long output
      const problems = [...new Set(all.filter((l) => PROBLEM_LINE.test(l)).map((l) => this.redact(l.trim())))].slice(-20);
      if (problems.length) info.problems = problems;
    }
    return info;
  }

  search(pattern, { glob, caseInsensitive = false, maxResults = 200 } = {}) {
    const args = ["--line-number", "--no-heading", "--path-separator", "/", "--color=never", "--max-columns=300",
      "--glob-case-insensitive", "-g", "!.jecbridge", "-g", "!.git", "-g", "!.env*"];
    if (caseInsensitive) args.push("-i");
    if (glob) args.push("-g", glob);
    args.push("--", pattern, ".");
    try {
      const out = execFileSync("rg", args, { cwd: this.root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
      // rg globs/ignore rules may be case-sensitive — filter protected paths again
      const lines = out.split("\n").filter(Boolean).map((l) => l.replace(/^\.\//, ""))
        .filter((l) => !this.isDenied(l.split(":")[0]));
      if (!lines.length) return "(no matches)";
      return lines.slice(0, maxResults).join("\n") + (lines.length > maxResults ? `\n[...${lines.length - maxResults} more matches]` : "");
    } catch (e) {
      if (e.status === 1) return "(no matches)";
      if (e.code === "ENOENT") return this.#grepFallback(pattern, caseInsensitive, maxResults);
      throw new Error(e.stderr?.toString() || e.message);
    }
  }

  #grepFallback(pattern, ci, max) {
    const re = new RegExp(pattern, ci ? "i" : "");
    const res = [];
    for (const f of this.listFiles(".", 50, 20000).files) {
      // resolve() follows symlinks and rejects ones that point outside the project
      let text; try { text = fs.readFileSync(this.resolve(f).abs, "utf8"); } catch { continue; }
      text.split("\n").forEach((l, i) => { if (res.length < max && re.test(l)) res.push(`${f}:${i + 1}:${l.slice(0, 300)}`); });
    }
    return res.join("\n") || "(no matches)";
  }
}
