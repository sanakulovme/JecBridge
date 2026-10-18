---
name: web-app-qa
description: Check a website or web app the way a careful developer does before saying it works - build, start it, open it in a real browser, read console errors and server logs, click through the main flows, and fix what breaks. Use after building or changing any web page, site or front-end app.
---

# Web app QA

Use this before you tell the user a web page or app is done. Report only after every step passes.

## 1. Make a checklist
Call `task_plan` with one item per step below, plus one item per main feature the user asked for
(for example "adding a todo works", "the contact form shows a success message").

## 2. Build or type-check
If `package.json` has a `build` script, run it with `run_command` (`npm run build`).
If it has `lint` or `test` scripts, run them too. Fix every error, then run them again.

## 3. Open the page
- Project with a dev server: `start_process` with `npm run dev` (or the project's start script).
  Use the URL it returns.
- Plain HTML project (no package.json): skip the server and use `check_page` with `path: "index.html"`.

## 4. Check what a user would see
Call `check_page` and go through its result:
- `status` is 200 and `title` is right
- `consoleErrors`, `pageErrors` and `failedRequests` are empty. Each entry is a bug: fix it, then check again.
- Look at the screenshot: is the layout right, is anything cut off, overlapping, unstyled or empty?
- Check `viewport: "mobile"` too, unless the user only wants desktop.

## 5. Test the main interactions
For each feature, call `check_page` with `steps` that do what a user does, then `evaluate` to read the result:

```json
{ "url": "http://localhost:5173/",
  "steps": [{ "type": "#new-todo", "text": "Buy milk" }, { "press": "Enter" }],
  "evaluate": "document.querySelectorAll('li').length" }
```

Use stable selectors (ids, `data-*` attributes). If a step fails with "no element matches", read the page
source and fix the selector, or add an id to the element.

## 6. Read the server logs
`process_output` for the dev server: anything under `problems` needs a fix.

## 7. Report
Mark every `task_plan` item done, then tell the user in a few lines: what works, the URL to open,
and anything you could not verify.
