// Cloudflare quick tunnel. If cloudflared isn't installed, the official binary is downloaded once
// from Cloudflare's GitHub releases into ~/.jecbridge/bin, so --tunnel works with no extra setup.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const RELEASES = "https://github.com/cloudflare/cloudflared/releases/latest/download";

export const binDir = () => path.join(process.env.JECBRIDGE_HOME || path.join(os.homedir(), ".jecbridge"), "bin");

// Release asset name for this platform, or null if Cloudflare doesn't publish one
export function assetName(platform = process.platform, arch = process.arch) {
  const a = { x64: "amd64", arm64: "arm64", ia32: "386", arm: "arm" }[arch];
  if (platform === "win32") return `cloudflared-windows-${a === "386" ? "386" : "amd64"}.exe`; // arm64 runs amd64 via emulation
  if (platform === "darwin") return `cloudflared-darwin-${a === "arm64" ? "arm64" : "amd64"}.tgz`;
  if (platform === "linux" && a) return `cloudflared-linux-${a}`;
  return null;
}

const works = (bin) => spawnSync(bin, ["--version"], { stdio: "ignore", windowsHide: true }).status === 0;

async function download(log) {
  const asset = assetName();
  if (!asset) throw new Error(`no cloudflared build for ${process.platform}/${process.arch}`);
  const dir = binDir();
  const target = path.join(dir, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  fs.mkdirSync(dir, { recursive: true });

  log(`Downloading cloudflared (one time, ~55 MB) from github.com/cloudflare/cloudflared ...`);
  const res = await fetch(`${RELEASES}/${asset}`, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let got = 0, lastPct = -10;
  const tmp = path.join(dir, `${asset}.part`);
  const body = Readable.fromWeb(res.body);
  body.on("data", (c) => {
    got += c.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct >= lastPct + 10) { lastPct = pct; process.stderr.write(`  ${pct}%\r`); }
  });
  await pipeline(body, fs.createWriteStream(tmp));
  process.stderr.write("        \r");

  if (asset.endsWith(".tgz")) {
    execFileSync("tar", ["-xzf", tmp, "-C", dir]);
    fs.rmSync(tmp, { force: true });
  } else {
    fs.renameSync(tmp, target);
  }
  fs.chmodSync(target, 0o755);
  if (!works(target)) throw new Error("the downloaded cloudflared does not run on this machine");
  log("cloudflared is ready.");
  return target;
}

// Path to a working cloudflared: on PATH, cached, or freshly downloaded
export async function findCloudflared(log = console.log) {
  if (works("cloudflared")) return "cloudflared";
  const cached = path.join(binDir(), process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (fs.existsSync(cached) && works(cached)) return cached;
  return download(log);
}

// Starts the tunnel and resolves with its public https URL
export async function startTunnel(localUrl, log = console.log) {
  const bin = await findCloudflared(log);
  const cf = spawn(bin, ["tunnel", "--no-autoupdate", "--url", localUrl], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  process.on("exit", () => cf.kill());
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cf.kill(); process.exit(0); });

  return new Promise((resolve, reject) => {
    let out = "", ready = false;
    const timer = setTimeout(() => reject(new Error(`no tunnel URL after 60s. cloudflared said:\n${out.slice(-1500)}`)), 60_000);
    const onData = (d) => {
      if (ready) return;
      out += d.toString();
      const m = out.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) { ready = true; clearTimeout(timer); resolve(m[0]); }
    };
    cf.stdout.on("data", onData);
    cf.stderr.on("data", onData);
    cf.on("error", (e) => { clearTimeout(timer); reject(e); });
    cf.on("exit", (code) => {
      clearTimeout(timer);
      if (ready) log(`WARNING: the tunnel stopped (cloudflared exited with code ${code}). Restart JecBridge to get a new URL.`);
      else reject(new Error(`cloudflared exited (code ${code}):\n${out.slice(-1500)}`));
    });
  });
}

// Best effort: put text on the clipboard so the user can paste it straight into the AI
export function copyToClipboard(text) {
  const tools = process.platform === "win32" ? [["clip"]]
    : process.platform === "darwin" ? [["pbcopy"]]
    : [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
  for (const [cmd, ...args] of tools) {
    const r = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    if (r.status === 0) return true;
  }
  return false;
}
