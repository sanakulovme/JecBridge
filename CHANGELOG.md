# Changelog

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
