// Agent Skills: folders with a SKILL.md (name + description frontmatter, then instructions),
// optionally with scripts and reference files. Same format as Claude Code, so existing skills work as-is.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const jbHome = () => process.env.JECBRIDGE_HOME || path.join(os.homedir(), ".jecbridge");
export const userSkillsDir = () => path.join(jbHome(), "skills");
const BUILTIN_DIR = fileURLToPath(new URL("../skills/", import.meta.url));
// Where a project keeps its own skills (Claude Code's folder and the cross-agent one)
export const PROJECT_SKILL_DIRS = [".claude/skills", ".agents/skills"];

const SKIP = new Set(["node_modules", ".git", "__pycache__", ".venv"]);
const SCRIPT_EXT = /\.(py|js|mjs|cjs|sh|ps1|ts|rb)$/i;
const MAX_SKILL_BYTES = 20 * 1024 * 1024;

// Minimal YAML frontmatter: "key: value" lines, quoted values, and | or > blocks
export function parseFrontmatter(text) {
  const m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[|>][-+]?$/.test(v)) {
      const parts = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) parts.push(lines[++i].trim());
      v = parts.join(v.startsWith("|") ? "\n" : " ").trim();
    } else v = v.replace(/^(['"])([\s\S]*)\1$/, "$2");
    meta[kv[1]] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

export function readSkill(dir, source) {
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) return null;
  const { meta, body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
  const name = (meta.name || path.basename(dir)).trim();
  const description = (meta.description || "").replace(/\s+/g, " ").trim();
  if (!name || !description) return null; // the description is what lets the AI pick a skill
  return { name, description, dir, source, body: body.trim() };
}

function skillDirsIn(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));
  } catch { return []; }
}

/**
 * All skills the AI can use. On a name clash the project wins over the user's, which wins over built-in.
 * isHidden(rel) lets the workspace's deny list hide project skills too.
 */
export function discoverSkills(projectRoot, isHidden = () => false) {
  const found = new Map();
  const add = (skill) => { if (skill && !found.has(skill.name.toLowerCase())) found.set(skill.name.toLowerCase(), skill); };
  for (const rel of PROJECT_SKILL_DIRS) {
    for (const dir of skillDirsIn(path.join(projectRoot, rel))) {
      const r = path.relative(projectRoot, dir).split(path.sep).join("/");
      if (!isHidden(r) && !isHidden(`${r}/SKILL.md`)) add(readSkill(dir, "project"));
    }
  }
  for (const dir of skillDirsIn(userSkillsDir())) add(readSkill(dir, "user"));
  for (const dir of skillDirsIn(BUILTIN_DIR)) add(readSkill(dir, "built-in"));
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function skillFiles(skill, limit = 300) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(skill.dir, rel), { withFileTypes: true })) {
      if (out.length >= limit || SKIP.has(e.name)) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(p);
    }
  };
  walk("");
  return out.sort();
}

export const isScript = (file) => SCRIPT_EXT.test(file);

// A file inside the skill's folder; symlinks and ../ can't leave it
export function resolveSkillFile(skill, rel) {
  const base = fs.realpathSync(skill.dir);
  const abs = path.resolve(base, String(rel).replace(/^\/+/, ""));
  if (!fs.existsSync(abs)) throw new Error(`"${rel}" is not in the ${skill.name} skill. Files: ${skillFiles(skill).join(", ")}`);
  const real = fs.realpathSync(abs);
  if (real !== base && !real.startsWith(base + path.sep)) throw new Error(`Access denied: "${rel}" is outside the ${skill.name} skill`);
  return real;
}

// ---------- installing ----------

function extractTarGz(file, dir) {
  // Windows' own bsdtar; relative paths so a GNU tar from Git Bash doesn't read "C:" as a host
  const win = process.platform === "win32" && path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  const tar = win && fs.existsSync(win) ? win : "tar";
  execFileSync(tar, ["-xzf", path.basename(file)], { cwd: dir, stdio: "ignore" });
}

// "owner/repo", "owner/repo/sub/path" or a github.com URL (…/tree/<ref>/<sub/path>)
export function parseGithubSource(src) {
  let m = src.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/);
  if (m) return { owner: m[1], repo: m[2], ref: m[3] || "HEAD", sub: m[4] || "" };
  m = src.match(/^([\w.-]+)\/([\w.-]+)(?:\/(.+?))?\/?$/);
  if (m) return { owner: m[1], repo: m[2], ref: "HEAD", sub: m[3] || "" };
  return null;
}

async function fetchGithub({ owner, repo, ref }, tmp, log) {
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`;
  log(`Downloading ${owner}/${repo}${ref === "HEAD" ? "" : `@${ref}`} from GitHub ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not download ${owner}/${repo}: HTTP ${res.status} (is the repository public and the path right?)`);
  const file = path.join(tmp, "repo.tar.gz");
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  extractTarGz(file, tmp);
  fs.rmSync(file);
  const top = fs.readdirSync(tmp, { withFileTypes: true }).find((e) => e.isDirectory());
  if (!top) throw new Error("the download was empty");
  return path.join(tmp, top.name);
}

function findSkillDirs(root, depth = 4) {
  if (fs.existsSync(path.join(root, "SKILL.md"))) return [root];
  if (depth === 0) return [];
  return skillDirsIn(root).filter((d) => !SKIP.has(path.basename(d))).flatMap((d) => findSkillDirs(d, depth - 1));
}

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : e.isFile() ? fs.statSync(p).size : 0;
  }
  return total;
}

/**
 * Install skills from a local folder or GitHub into destRoot (default: the user's skills folder).
 * A source with SKILL.md is one skill; otherwise every skill folder inside it is installed.
 */
export async function installSkills(source, { destRoot = userSkillsDir(), log = () => {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jecbridge-skill-"));
  try {
    let root;
    if (fs.existsSync(source)) root = path.resolve(source);
    else {
      const gh = parseGithubSource(source);
      if (!gh) throw new Error(`"${source}" is not a folder or a GitHub repository (owner/repo/path or https://github.com/...)`);
      const repoDir = await fetchGithub(gh, tmp, log);
      root = gh.sub ? path.join(repoDir, ...gh.sub.split("/")) : repoDir;
      if (!fs.existsSync(root)) throw new Error(`"${gh.sub}" was not found in ${gh.owner}/${gh.repo}`);
    }
    const dirs = findSkillDirs(root);
    if (!dirs.length) throw new Error(`no SKILL.md found in ${source}`);
    fs.mkdirSync(destRoot, { recursive: true });
    const installed = [];
    for (const dir of dirs) {
      const skill = readSkill(dir, "user");
      if (!skill) { log(`skipped ${path.basename(dir)}: SKILL.md needs a name and a description`); continue; }
      if (dirSize(dir) > MAX_SKILL_BYTES) { log(`skipped ${skill.name}: larger than 20 MB`); continue; }
      const folder = skill.name.replace(/[^\w.-]+/g, "-");
      const dest = path.join(destRoot, folder);
      const existed = fs.existsSync(dest);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(dir, dest, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
      const files = skillFiles({ ...skill, dir: dest });
      installed.push({ name: skill.name, description: skill.description, dir: dest, updated: existed, files: files.length, scripts: files.filter(isScript) });
    }
    return installed;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function removeSkill(name, destRoot = userSkillsDir()) {
  const skill = skillDirsIn(destRoot).map((d) => readSkill(d, "user")).find((s) => s && s.name.toLowerCase() === name.toLowerCase());
  const dir = skill ? skill.dir : path.join(destRoot, name);
  if (!fs.existsSync(path.join(dir, "SKILL.md"))) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// ---------- script trust ----------
// A skill's scripts run only after the user trusted them with `jecbridge skills trust <name>`.
// Trust is pinned to each script's SHA-256, so an updated or swapped file has to be approved again.
// Built-in skills ship with JecBridge itself and are trusted.

const trustFile = () => path.join(jbHome(), "skills-trust.json");
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const trustKey = (skill) => fs.realpathSync(skill.dir);

function readTrust() {
  try { return JSON.parse(fs.readFileSync(trustFile(), "utf8")); } catch { return {}; }
}

export function scriptHashes(skill) {
  return Object.fromEntries(skillFiles(skill).filter(isScript).map((f) => [f, sha256(path.join(skill.dir, f))]));
}

// "trusted", "untrusted" or "changed" for one script (rel path inside the skill)
export function scriptTrust(skill, rel) {
  if (skill.source === "built-in") return "trusted";
  const entry = readTrust()[trustKey(skill)];
  if (!entry || !(rel in entry.scripts)) return "untrusted";
  return entry.scripts[rel] === sha256(path.join(skill.dir, rel)) ? "trusted" : "changed";
}

// Summary for a whole skill: "none" (no scripts), "trusted", "untrusted" or "changed"
export function skillTrust(skill) {
  const scripts = skillFiles(skill).filter(isScript);
  if (!scripts.length) return "none";
  const states = scripts.map((s) => scriptTrust(skill, s));
  if (states.every((s) => s === "trusted")) return "trusted";
  return states.includes("changed") ? "changed" : "untrusted";
}

export function trustSkill(skill) {
  const all = readTrust();
  all[trustKey(skill)] = { name: skill.name, scripts: scriptHashes(skill), trustedAt: new Date().toISOString() };
  fs.mkdirSync(jbHome(), { recursive: true });
  fs.writeFileSync(trustFile(), JSON.stringify(all, null, 2));
}

export function untrustSkill(skill) {
  const all = readTrust();
  const had = trustKey(skill) in all;
  delete all[trustKey(skill)];
  if (had) fs.writeFileSync(trustFile(), JSON.stringify(all, null, 2));
  return had;
}

// Script runner for a skill file: the interpreter must still be on the command allowlist
export function interpreterFor(file) {
  const ext = path.extname(file).toLowerCase();
  if ([".js", ".mjs", ".cjs"].includes(ext)) return "node";
  if (ext === ".py") return spawnSync("python", ["--version"], { stdio: "ignore" }).status === 0 ? "python" : "python3";
  if (ext === ".sh") return "bash";
  if (ext === ".ps1") return "powershell";
  if (ext === ".rb") return "ruby";
  if (ext === ".ts") return "npx";
  return null;
}
