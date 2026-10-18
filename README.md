<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo.svg">
    <img src="assets/logo-badge.svg" alt="JecBridge" width="360">
  </picture>
</p>

🇬🇧 English · 🇺🇿 [O'zbekcha](README.uz.md)

Connects **any code project** on your computer to **any AI** over MCP: claude.ai, ChatGPT, Claude Desktop, Cursor, Claude Code, VS Code. The AI can read the project, change it, run its tests or build it from scratch. A checkpoint is taken automatically before every change, so if the AI makes a mistake you roll back with one command.

## Quick start

The only requirement is [Node.js 22+](https://nodejs.org). Then one line:

```bash
npx jecbridge my-app --tunnel
```

That's it. The folder is created if it doesn't exist, the tunnel tool (cloudflared) is downloaded automatically the first time, and the connector URL is copied to your clipboard. Paste it into your AI:

- **claude.ai:** Settings → Connectors → *Add custom connector*
- **ChatGPT:** Settings → Apps & Connectors → *Developer mode* → *Create*
- **Gemini:** Settings → Connected Apps → *Add a custom app*

Then ask, for example: *"Build a calculator with HTML and CSS in this project."* or *"Create a Vite + React site and start it."* The AI starts the dev server itself and gives you the `http://localhost:...` link.

> [git](https://git-scm.com) is optional but recommended: with it, every change gets an automatic checkpoint and can be undone. Without git, everything else works.

## Install from source

```bash
git clone https://github.com/sanakulovme/jecbridge.git
cd jecbridge
npm install
npm link        # optional: makes the "jecbridge" command available everywhere
```

## Windows

Install Node.js (and optionally git) once, from PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git        # optional: enables checkpoints and undo
```

Close and reopen PowerShell, then:

```powershell
npx jecbridge $HOME\Desktop\my-app --tunnel
```

Windows notes:
- **Paths with spaces.** Put them in quotes: `npx jecbridge "C:\My Projects\app" --tunnel`
- **npx in JSON config.** Claude Desktop on Windows may not find `npx` directly; use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "jecbridge", ...]`.
- **JSON config.** In Claude Desktop or Cursor config, write `\` twice (`"C:\Users\Abbos\my-app"`) or use `/` (`"C:/Users/Abbos/my-app"`).
- **Windows Firewall.** If asked, allow *Private networks*. The server only listens on `127.0.0.1` and is reachable from outside only through the tunnel.
- **CRLF files.** Windows line endings (CRLF) are handled automatically: edits don't break the file format.

## 1. Web AIs (claude.ai, ChatGPT, Gemini)

A web AI can't see your computer, so JecBridge opens a tunnel:

```bash
npx jecbridge ~/projects/my-app --tunnel
```

The terminal prints a public URL like `https://xxxx.trycloudflare.com/mcp/<token>` and copies it to the clipboard. If cloudflared isn't installed, the official binary is downloaded once from Cloudflare's GitHub releases into `~/.jecbridge/bin`.

> ⚠️ The URL contains a secret token, never share it. If it leaks, restart with `--new-token`: every old URL stops working.
> A quick tunnel URL changes on every start. For a permanent address, see [Tunnel URL security](#tunnel-url-security).

## 2. Local clients (stdio)

**Claude Desktop** (`claude_desktop_config.json`) and **Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "jecbridge": {
      "command": "npx",
      "args": ["-y", "jecbridge", "/FULL/PATH/my-app", "--stdio"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add jecbridge -- npx -y jecbridge /path/my-app --stdio
```

## 3. A new project from scratch

```bash
npx jecbridge ~/projects/new-project --tunnel
```

Then tell the AI: *"Build a Next.js + Tailwind landing page in this folder and check it with `npm run build`."*

## Options

| Option | What it does |
|---|---|
| `--stdio` | stdio transport (Claude Desktop, Cursor, Claude Code) |
| `--port <n>` | HTTP port (default `8787`, or the next free one) |
| `--host <h>` | HTTP host (default `127.0.0.1`) |
| `--tunnel` | Public HTTPS URL for web AIs (cloudflared is downloaded automatically) |
| `--token <t>` | Secret token (default: generated and saved; also `JECBRIDGE_TOKEN`) |
| `--deny <a,b,c>` | Hide more files from the AI, e.g. `"*.csv,*.sql,fixtures/"` (also read from `.jecbridgeignore`) |
| `--new-token` | Replace the saved token, so every old URL stops working |
| `--read-only` | No writes, no commands, nothing saved in the project |
| `--allow <a,b,c>` | Replace the command allowlist |
| `--allow-all-commands` | Allow any shell command (use with care) |

## Tools the AI gets

| Tool | What it does |
|---|---|
| `project_info` | Project type and key files (package.json, README…) |
| `list_files` | File tree (respects .gitignore, skips node_modules) |
| `read_file` | Read with line numbers, optionally a line range |
| `search_code` | Regex search across the project (ripgrep) |
| `write_file` | Create a file or replace it completely |
| `edit_file` | Replace an exact text snippet (no full rewrite) |
| `delete_path`, `move_path` | Delete, move, rename |
| `run_command` | `npm install`, `npm test`, `python main.py`… |
| `start_process` | Run a dev server or watcher in the background (`npm run dev`) and get its URL |
| `process_output`, `stop_process` | Read a background process's logs (errors are collected under `problems`), stop it |
| `check_page` | Open a page in a headless browser: screenshot, console errors, failed requests; click and type to test it. Works for dev servers and plain HTML files |
| `http_get` | Check a page or API of its own dev server (only ports started with `start_process`) |
| `use_skill`, `run_skill_script` | Load a skill's instructions or files, run a script that ships with it |
| `task_plan` | A checklist for multi-step work, so the AI doesn't report "done" too early |
| `checkpoint`, `list_checkpoints` | Save and list project states |
| `diff` | What changed since a checkpoint |
| `undo` | Roll back to a checkpoint (the undo itself can be undone) |

## Works like a coding agent

JecBridge tells every connected AI to work the way Claude Code does, and backs it up in every tool response:

- **It does the work itself.** It never asks you to copy code, create files or run commands. Files are written with `write_file`, commands run with `run_command` and `start_process`.
- **It fixes problems right away.** A failed command, a test error or a crashed server comes back with "fix the cause and try again yourself".
- **It checks before it reports, like a careful developer.** It runs the tests or the build, opens the page in a real headless browser with `check_page`, looks at the screenshot, the console errors and failed requests, clicks through the main interactions, and reads the server logs. It fixes what it finds and checks again.
  Chrome or Edge is used if installed, otherwise headless Chrome is downloaded once (~100 MB) into `~/.jecbridge/browser`.
- **It doesn't say "done" early.** Multi-step work is tracked in `task_plan` until every item is verified.
- **You get the result, not the process:** what works now and where.

Safety rules are the exception: the AI is told not to work around them, and to tell you exactly what it would need instead.

## Undo: recovering from a bad change

A checkpoint is taken automatically before every change, labeled with the file or command, for example `auto: before edit_file src/math.js`. Say the AI makes a useful change, then a second change that breaks something:

1. Ask: *"Show the checkpoints."* The AI calls `list_checkpoints`, newest first:
   ```
   a1b2c3d  auto: before edit_file src/math.js     ← taken right before the breaking change
   e4f5a6b  auto: before edit_file src/math.js     ← taken before the useful change
   ```
2. Ask: *"Undo to a1b2c3d."* The breaking change is rolled back, the useful one stays.
3. Changed your mind? The state before the undo was saved too (`redoId`), so you can undo the undo.

What undo covers and what it doesn't:

| Restored | Not restored |
|---|---|
| Files in the project, including deleted and new files | Ignored folders: `node_modules`, `dist`, `build`, `.venv`, `.env*` and anything in your `.gitignore` |
| | Side effects of commands: global installs, databases, API calls, emails, `git` operations on your own repo |
| | Anything outside the project folder |

It is "restore to a point", not "revert one change": everything after the checkpoint you pick is rolled back.

## Skills

Skills are folders with a `SKILL.md`: step-by-step know-how for a kind of task, plus optional scripts and reference files. JecBridge uses **the same format as Claude Code**, so existing skills work as-is, and web AIs like Gemini, ChatGPT and claude.ai can use them too.

The AI sees each skill's name and description. When a task matches, it loads the full instructions with `use_skill`, reads the skill's files and runs its scripts with `run_skill_script`.

```bash
npx jecbridge skills list                                   # skills the AI can use here
npx jecbridge skills add anthropics/skills/skills/webapp-testing
npx jecbridge skills add https://github.com/owner/repo/tree/main/skills/my-skill
npx jecbridge skills add ./my-skill                         # from a folder
npx jecbridge skills add ./my-skill --project               # into this project's .claude/skills
npx jecbridge skills remove webapp-testing
```

Where skills come from (a project skill overrides a user skill of the same name, which overrides a built-in one):

| Source | Folder |
|---|---|
| Project | `.claude/skills/<name>/` or `.agents/skills/<name>/` (commit them with the project) |
| You | `~/.jecbridge/skills/<name>/` (what `skills add` installs; available in every project) |
| Built-in | `web-app-qa`, `vite-react-app`, `static-site` ship with JecBridge |

A minimal skill:

```markdown
---
name: house-style
description: Our colors, fonts and component rules. Use when building or restyling any page.
---
Use #2563EB as the primary color and Inter for text. Buttons are 40px tall with 8px corners.
```

> A skill is instructions for the AI, so treat it like code: install skills only from sources you trust. Skill scripts run only through `run_skill_script`, their interpreter must be on the command allowlist, and their arguments stay inside the project.

## What the AI sees, and where it goes

**A read is a copy.** Every file the AI reads through JecBridge becomes part of that AI chat. It is stored in your claude.ai, ChatGPT or Gemini account under that provider's retention and training settings, long after the tunnel is closed. Hiding `.env` doesn't help with a customer export or a SQL dump sitting in the project.

So JecBridge lets you decide what the AI never sees:

- **`.jecbridgeignore`** in the project root, same syntax as `.gitignore`:
  ```
  # real customer data
  *.csv
  *.sql
  fixtures/
  /exports/2024.xlsx
  ```
- **`--deny "*.csv,*.sql,fixtures/"`** on the command line, for a one-off session.

Hidden files are blocked for every tool: read, write, search, listing, `diff` (even against older checkpoints), command arguments and the page checker. The AI can't read or edit `.jecbridgeignore` to lift the restriction.

**You see the exposure before you connect.** At startup JecBridge lists readable files that look like real data (CSV/Excel exports, SQL dumps and backups, databases, fixture and seed folders) and shows the exact pattern to hide them:

```
Heads-up: the AI can read these files, and whatever it reads is copied into the AI chat:
  data exports:           customers.csv, orders.csv
  SQL dumps and backups:  backup.sql
If they hold real or customer data, hide them: add patterns to .jecbridgeignore (e.g. *.csv) or restart with --deny "*.csv,*.sql".
```

For client work, prefer a copy of the repo without real data, or a provider and plan whose data settings you have checked.

## Security

- **Folder jail.** `../`, absolute paths and symlinks can't escape the project. Every path is resolved with `realpath` before the check, so a symlink to `~/.ssh` is rejected by file tools, search, `project_info` and command arguments alike.
- **Secrets are hidden.** `.env*`, `.git/`, `*.pem`, `*.key` and SSH keys can't be read, written or found by search.
- **Command allowlist.** By default only `npm`, `node`, `python`, `pytest`, `go`, `cargo`… are allowed. Chaining with `&&`, `|`, `;`, `$(`, plus `git push` and `git -C` / `--git-dir`, is blocked.
  - Command arguments are checked too: `cat .env`, `cat ../file`, `ls /` and `--prefix=..` are rejected.
  - Environment variables whose names contain `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY` or `AUTH` are not passed to commands.
  - No shell is used: `%VAR%` isn't expanded on Windows, and arguments with spaces stay intact.
  - On timeout the command is stopped together with all its child processes.
  - Change the list: `--allow npm,node,python`
  - Allow everything: `--allow-all-commands`. Only on your own machine and with an AI you trust.
- **Separate checkpoints.** Stored in `.jecbridge/shadow.git`. Your own `.git` history is never touched.
- **Token.** A random 192-bit token is required on every HTTP request, in the URL or as `Authorization: Bearer`. Wrong tokens are logged with the caller's IP; after 20 failures in 10 minutes that caller is blocked.
- **`--read-only`.** Read-only mode (for code review). Nothing is written into the project; server data lives in the temp folder.

> ⚠️ **Safe mode is not a sandbox.** Allowed programs such as `node`, `python` or `npm test` run project code, and that code can read any file on disk. The allowlist protects against accidents, not against a malicious AI or project. For real isolation, run JecBridge inside a Docker container or as a separate user.

> Add `.jecbridge/` to your own `.gitignore`.

### Tunnel URL security

With `--tunnel`, the URL is the secret: anyone who has it has the same access as your AI.

- **Quick tunnels are short-lived.** The URL dies when you stop JecBridge, and a new one is created on every start.
- **Leaked URL?** Restart with `--new-token`. Old URLs then get `401 Unauthorized`.
- **Watch the terminal.** Every rejected request is shown with the caller's IP.

For a permanent address with extra protection, run your own **Cloudflare named tunnel** (needs a free Cloudflare account and a domain) in front of JecBridge without `--tunnel`:

```bash
npx jecbridge my-app                       # serves http://127.0.0.1:8787
cloudflared tunnel login
cloudflared tunnel create jecbridge
cloudflared tunnel route dns jecbridge mcp.example.com
cloudflared tunnel run --url http://127.0.0.1:8787 jecbridge
```

You can then put **Cloudflare Access** in front of `mcp.example.com` (Zero Trust → Access → Applications). Be aware that a web AI's servers can't complete an interactive Access login. Use an Access **service token** for clients that can send custom headers, and keep the JecBridge token as the second factor.

## AIs without MCP support

Plain APIs like DeepSeek, Ollama or the OpenAI API need an agent with an MCP client, for example:
- **Cline** or **Continue** (VS Code). They work with any OpenAI-compatible API and MCP servers.
- **OpenAI Agents SDK**. Connect to the same URL with `MCPServerStreamableHttp`.

## Tests

```bash
npm test     # 44 end-to-end tests: build from scratch, edit, undo, security, dev servers, stdio, read-only, no-git
```

## License

[MIT](LICENSE)
