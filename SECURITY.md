# Security Policy

JecBridge gives an AI model read/write access to a folder on your machine and the ability to run commands there. We take that seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private reporting instead: go to the **Security** tab of this repository and choose **Report a vulnerability**.

Include steps to reproduce, the JecBridge version, your OS, and the impact (for example: path escape, secret exposure, allowlist bypass, or auth bypass). You'll get a reply within 7 days.

## In scope

- Reading or writing files outside the project root
- Reading protected files (`.env*`, keys, `.git/`)
- Running commands outside the allowlist in default mode
- Using an allowlisted command's arguments to reach files outside the project or protected files
- Leaking credential-like environment variables to commands in default mode
- Reaching the HTTP endpoint without a valid token

## Known limitations (by design)

- With `--allow-all-commands`, the AI can run any shell command as your user.
- Default mode is not a sandbox. Allowed tools can still run project code, and that code runs as your user with full disk access. For example, `npm test` executes whatever the test script contains, and `npm install` runs install scripts. Only connect projects and AIs you trust.
- For real isolation, run JecBridge in a container or as a separate OS user.
- Anyone who has your tunnel URL has the token. Treat the URL like a password.
