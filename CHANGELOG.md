# Changelog

## 0.1.0 — 2026-10-17

First public release.

- Command arguments are checked against the folder jail and protected files (`cat .env`, `cat ../x`, `git -C ..` are blocked)
- Credential-like environment variables are not passed to commands in safe mode
- Commands run without a shell (cross-spawn): arguments with spaces survive on Windows, `%VAR%` is not expanded
- Timeouts kill the whole process tree, not just the direct child
- `--read-only` writes nothing into the project
- CLI options are validated (`--port`, `--allow`, missing values)
- English README

- 13 MCP tools: read, search, write, edit, delete, move, run commands, checkpoint, diff, undo
- Streamable HTTP transport with token auth, plus stdio
- `--tunnel`: Cloudflare quick tunnel for ChatGPT and claude.ai
- Shadow-git checkpoints that never touch the project's own `.git`
- Folder jail with symlink protection, hidden secrets, command allowlist
- Windows support: CRLF-aware edits, case-insensitive secret matching
- Secrets are filtered from search and file listings regardless of letter case
