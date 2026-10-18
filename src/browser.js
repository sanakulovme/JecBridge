// Headless browser checks over the Chrome DevTools Protocol: open a page, run a few user steps,
// collect console messages, page errors and failed requests, and take a screenshot.
// Uses Chrome or Edge if installed, otherwise downloads Chrome for Testing (headless shell) once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const CFT_INDEX = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";

const home = () => process.env.JECBRIDGE_HOME || path.join(os.homedir(), ".jecbridge");

// Chrome for Testing platform name, or null if Google doesn't publish one
export function cftPlatform(platform = process.platform, arch = process.arch) {
  if (platform === "win32") return arch === "ia32" ? "win32" : "win64";
  if (platform === "darwin") return arch === "arm64" ? "mac-arm64" : "mac-x64";
  if (platform === "linux") return arch === "arm64" ? "linux-arm64" : arch === "x64" ? "linux64" : null;
  return null;
}

function installedBrowsers() {
  if (process.platform === "win32") {
    const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap((r) => [
      path.join(r, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(r, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(r, "Chromium", "Application", "chrome.exe"),
    ]);
  }
  if (process.platform === "darwin") {
    return ["Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"]
      .map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]
    .map((n) => spawnSync("which", [n], { encoding: "utf8" }).stdout?.trim()).filter(Boolean);
}

const cachedShell = (plat) => path.join(home(), "browser", `chrome-headless-shell-${plat}`,
  process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");

function extractZip(zip, dir) {
  const opts = { cwd: dir, stdio: "ignore" };
  if (process.platform === "win32") {
    // Use Windows' own bsdtar: a GNU tar from Git Bash earlier on PATH can't read zip and treats "C:" as a host
    const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (fs.existsSync(tar) && spawnSync(tar, ["-xf", path.basename(zip)], opts).status === 0) return;
    execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `Expand-Archive -Force -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}'`], { stdio: "ignore" });
  } else if (process.platform === "darwin") {
    execFileSync("/usr/bin/ditto", ["-x", "-k", zip, dir]);
  } else if (spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0) {
    execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
  } else {
    execFileSync("python3", ["-m", "zipfile", "-e", zip, dir]);
  }
}

async function downloadShell(log) {
  const plat = cftPlatform();
  if (!plat) throw new Error(`no Chrome build for ${process.platform}/${process.arch}; install Chrome and try again`);
  const index = await (await fetch(CFT_INDEX)).json();
  const entry = index.channels.Stable.downloads["chrome-headless-shell"].find((d) => d.platform === plat);
  if (!entry) throw new Error(`no headless Chrome download for ${plat}`);
  const dir = path.join(home(), "browser");
  fs.mkdirSync(dir, { recursive: true });
  log(`Downloading headless Chrome (one time, ~100 MB) from Google's Chrome for Testing ...`);
  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const zip = path.join(dir, `${plat}.zip.part`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zip));
  extractZip(zip, dir);
  fs.rmSync(zip, { force: true });
  const bin = cachedShell(plat);
  fs.chmodSync(bin, 0o755);
  log("Headless Chrome is ready.");
  return bin;
}

export async function findBrowser(log = () => {}) {
  if (process.env.JECBRIDGE_BROWSER) return process.env.JECBRIDGE_BROWSER;
  const found = installedBrowsers().find((p) => fs.existsSync(p));
  if (found) return found;
  const plat = cftPlatform();
  if (plat && fs.existsSync(cachedShell(plat))) return cachedShell(plat);
  return downloadShell(log);
}

function killTree(child) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch {}
}

// Minimal CDP client over the page's WebSocket
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    const listeners = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail } = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
      } else if (msg.method) (listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
    };
    ws.onerror = () => reject(new Error("could not connect to the browser"));
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((ok, fail) => {
        const id = ++nextId; pending.set(id, { ok, fail });
        ws.send(JSON.stringify({ id, method, params }));
      }),
      on: (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]),
      close: () => ws.close(),
    });
  });
}

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n = 500) => (s.length > n ? s.slice(0, n) + "…" : s);

function argText(a) {
  if (a.value !== undefined) return typeof a.value === "string" ? a.value : JSON.stringify(a.value);
  return a.description || a.unserializableValue || a.type;
}

/**
 * Open url in a headless browser, run steps, and report what a user would see.
 * steps: [{click: "css"}, {type: "css", text: "..."}, {press: "Enter"}, {wait_ms: 500}, {wait_for: "css"}]
 */
export async function checkPage(url, { steps = [], evaluate, viewport = "desktop", fullPage = false, log = () => {} } = {}) {
  const bin = await findBrowser(log);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "jecbridge-browser-"));
  const size = viewport === "mobile" ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800, mobile: false };
  const child = spawn(bin, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
    `--window-size=${size.width},${size.height}`,
    // Chrome refuses to run as root (e.g. in Docker) unless its sandbox is off
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });

  const report = { url, status: null, title: null, console: [], pageErrors: [], failedRequests: [], steps: [] };
  let cdp;
  try {
    // Chrome writes the chosen debugging port into DevToolsActivePort
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
    if (!fs.existsSync(portFile)) throw new Error("the browser did not start");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    let page;
    for (let i = 0; i < 50 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
      if (!page) await sleep(100);
    }
    if (!page) throw new Error("no browser tab to control");
    cdp = await connect(page.webSocketDebuggerUrl);

    const requests = new Map();
    cdp.on("Runtime.consoleAPICalled", (p) => report.console.push({ type: p.type, text: short(p.args.map(argText).join(" ")) }));
    cdp.on("Runtime.exceptionThrown", (p) => {
      const d = p.exceptionDetails;
      report.pageErrors.push(short(d.exception?.description || d.text || "Uncaught error", 800));
    });
    // Browsers ask for /favicon.ico on their own; a missing one is not a bug in the page
    const noise = (u = "") => /\/favicon\.ico(\?|$)/.test(u);
    cdp.on("Log.entryAdded", ({ entry }) => {
      // Network failures are reported once, under failedRequests
      if (entry.source === "network") return;
      if (entry.level === "error" || entry.level === "warning") {
        report.console.push({ type: entry.level === "error" ? "error" : "warning", text: short(entry.text + (entry.url ? ` (${entry.url})` : "")) });
      }
    });
    cdp.on("Network.requestWillBeSent", (p) => requests.set(p.requestId, p.request.url));
    cdp.on("Network.responseReceived", (p) => {
      if (p.type === "Document" && report.status === null) report.status = p.response.status;
      if (p.response.status >= 400 && !noise(p.response.url)) report.failedRequests.push(`${p.response.status} ${p.response.url}`);
    });
    cdp.on("Network.loadingFailed", (p) => {
      const u = requests.get(p.requestId) || "";
      if (!p.canceled && !noise(u)) report.failedRequests.push(`${p.errorText} ${u}`.trim());
    });

    await Promise.all(["Runtime.enable", "Log.enable", "Network.enable", "Page.enable"].map((m) => cdp.send(m)));
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 1 });
    const loaded = new Promise((r) => cdp.on("Page.loadEventFired", r));
    const nav = await cdp.send("Page.navigate", { url });
    if (nav.errorText) throw new Error(`could not open ${url}: ${nav.errorText}`);
    await withTimeout(loaded, 20_000, "page load");
    await sleep(500); // let scripts settle and log

    const js = async (expression) => {
      const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const find = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
    for (const step of steps) {
      const name = Object.keys(step).filter((k) => k !== "text").join(",");
      try {
        if (step.click) {
          if (!(await js(`(() => { const el = ${find(step.click)}; if (!el) return false; el.scrollIntoView({block: "center"}); el.click(); return true; })()`))) throw new Error(`no element matches ${step.click}`);
        } else if (step.type) {
          if (!(await js(`(() => { const el = ${find(step.type)}; if (!el) return false; el.focus(); return true; })()`))) throw new Error(`no element matches ${step.type}`);
          await cdp.send("Input.insertText", { text: String(step.text ?? "") });
        } else if (step.press) {
          for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key: step.press, code: step.press, windowsVirtualKeyCode: step.press === "Enter" ? 13 : 0 });
        } else if (step.wait_for) {
          const ok = await js(`new Promise((r) => { const t0 = Date.now(); const tick = () => ${find(step.wait_for)} ? r(true) : Date.now() - t0 > 10000 ? r(false) : setTimeout(tick, 100); tick(); })`);
          if (!ok) throw new Error(`${step.wait_for} did not appear within 10s`);
        } else if (step.wait_ms) {
          await sleep(Math.min(Number(step.wait_ms) || 0, 10_000));
        } else throw new Error(`unknown step ${JSON.stringify(step)}`);
        report.steps.push({ step: name, ok: true });
        await sleep(150);
      } catch (e) {
        report.steps.push({ step: name, ok: false, error: e.message });
        break;
      }
    }
    if (evaluate) {
      try { report.evaluate = await js(evaluate); } catch (e) { report.evaluate = { error: e.message }; }
    }
    await sleep(300);
    report.title = await js("document.title").catch(() => null);
    report.finalUrl = await js("location.href").catch(() => url);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!fullPage });
    return { report, screenshot: shot.data };
  } finally {
    try { cdp?.close(); } catch {}
    killTree(child);
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }), 1000).unref();
  }
}
