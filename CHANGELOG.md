# Changelog

## 0.5.0 — 2026-10-18

The AI now tests its work in a real browser before it reports.

- New tool `check_page`: opens a page in a headless browser and returns a screenshot, browser console errors/warnings/logs, uncaught page errors and failed requests. Steps (click, type, press, wait_for) and `evaluate` let the AI test interactions, e.g. press 1 2 × 3 = and read the result. Desktop and mobile viewports, optional full-page screenshot
- Works for dev servers started with `start_process` and for plain HTML projects (`path: "index.html"`) through a built-in file server that only serves project files (no secrets, no escapes)
- Uses installed Chrome or Edge, otherwise downloads headless Chrome for Testing once into `~/.jecbridge/browser`
- `process_output` collects error and warning lines from the whole log under `problems`
- Working rules now require checking the page, the console and the server logs, and fixing every error before reporting
- Dev servers that print `http://[::]:port` (e.g. Python's http.server) are recognized

## 0.4.0 — 2026-10-18

The AI now works like a coding agent such as Claude Code.

- Working rules sent as server instructions and repeated in `project_info`: do the work yourself (never ask the user to copy, paste or run things), never paste file contents into chat, fix failures and retry, verify before reporting, don't say "done" early, reply with the result
- Every error now says what to do next: "fix the cause and try again yourself", or for safety blocks "don't bypass it, tell the user what to allow"
- New tool `http_get`: the AI checks pages and APIs of its own dev servers. Only ports of processes started with `start_process` are reachable, so other local services stay off limits
- New tool `task_plan`: a checklist for multi-step work that keeps the AI from reporting "done" while items are open
- `start_process` results include the next step (check with `http_get`, or fix a crash)

## 0.3.0 — 2026-10-18

Based on feedback from the AI Automation Society community.

- **Security fix:** a symlink inside the project pointing to a file outside it could be read through `search_code` (when ripgrep is not installed) and through `project_info` key files. Both now go through the folder jail like every other tool.
- `--new-token` replaces the saved token, so a leaked URL stops working
- Wrong tokens are logged with the caller's IP (taken from Cloudflare's CF-Connecting-IP behind the tunnel); after 20 failures in 10 minutes that caller gets 429
- Checkpoint labels name the file or command, e.g. `auto: before edit_file src/math.js`, so the right one is easy to pick for undo
- README: an undo walkthrough with what undo does and doesn't restore, and a tunnel URL security guide (named tunnel, Cloudflare Access)

## 0.2.1 — 2026-10-17

- Logo in the README (npm and GitHub)

## 0.2.0 — 2026-10-17

- New tools for long-running commands: `start_process` runs a dev server or watcher in the background and returns its local URL, `process_output` shows its logs, `stop_process` stops it with all child processes
- Background processes are stopped when JecBridge exits (Ctrl+C, closed window, or the stdio client disconnecting)
- `run_command` points the AI to `start_process` for dev servers instead of letting them time out

## 0.1.1 — 2026-10-17

- Console messages no longer use ✓ and ⚠, which show up as "?" in Windows cmd.exe

## 0.1.0 — 2026-10-17

First public release.

- Command arguments are checked against the folder jail and protected files (`cat .env`, `cat ../x`, `git -C ..` are blocked)
- Credential-like environment variables are not passed to commands in safe mode
- Commands run without a shell (cross-spawn): arguments with spaces survive on Windows, `%VAR%` is not expanded
- Timeouts kill the whole process tree, not just the direct child
- `--read-only` writes nothing into the project
- CLI options are validated (`--port`, `--allow`, missing values)
- English README
- One-line start: `npx jecbridge my-app --tunnel`
  - the folder defaults to the current one and is created if missing (`--init` is no longer needed)
  - cloudflared is downloaded automatically on first `--tunnel` use
  - the connector URL is copied to the clipboard, with steps for claude.ai, ChatGPT and Gemini
  - a busy port moves to the next free one
- Works without git: checkpoints and undo are turned off with a clear message, everything else works

- 13 MCP tools: read, search, write, edit, delete, move, run commands, checkpoint, diff, undo
- Streamable HTTP transport with token auth, plus stdio
- `--tunnel`: Cloudflare quick tunnel for ChatGPT and claude.ai
- Shadow-git checkpoints that never touch the project's own `.git`
- Folder jail with symlink protection, hidden secrets, command allowlist
- Windows support: CRLF-aware edits, case-insensitive secret matching
- Secrets are filtered from search and file listings regardless of letter case
