# Contributing

Thanks for helping! The basic flow:

1. Fork the repo and create a branch: `git checkout -b fix/short-description`
2. Run `npm install`, then `npm test`. All tests must pass.
3. Add a test in `test/e2e.js` for any new tool or security rule.
4. Open a pull request that explains *what* changed and *why*.

## Guidelines

- No build step: plain Node.js ES modules, Node 22+.
- Keep dependencies minimal: `@modelcontextprotocol/sdk`, `zod`, `express` and `cross-spawn` only, unless there is a strong reason.
- Security-relevant changes (path handling, command execution, auth) need a test that proves the protection works.
- Error messages are shown to the AI, so make them actionable ("do X instead").
