---
name: static-site
description: Build a plain HTML, CSS and JavaScript site or widget with no framework and no build step (calculator, landing page, small game, single-page tool) and test it in a browser. Use when the user asks for something simple, or explicitly for HTML/CSS/JS.
---

# Static site (HTML + CSS + JS)

## 1. Files
Write them with `write_file` (never paste code into the chat for the user to copy):

- `index.html`: semantic HTML, `<meta name="viewport" content="width=device-width, initial-scale=1">`,
  `<link rel="stylesheet" href="style.css">`, and `<script src="script.js" defer></script>`
- `style.css`: CSS variables for colors, flexbox/grid layout, a mobile-friendly design
- `script.js`: plain JavaScript, no external libraries unless the user asks

If your client refuses to write `.html` files, write `index.txt` and rename it with `move_path`.

## 2. Make it testable
- Put an `id` or `data-*` attribute on every button, input and output element.
- Handle edge cases the user would hit (empty input, division by zero, very long numbers) with a visible message, not an exception.

## 3. Test in a browser
No server is needed: use `check_page` with `path: "index.html"`.

- The console, page errors and failed requests must be empty. A 404 usually means a wrong file name in a `href` or `src`.
- Look at the screenshot on desktop and with `viewport: "mobile"`.
- Click through the main feature with `steps` and read the result with `evaluate`. For a calculator:

```json
{ "path": "index.html",
  "steps": [{ "click": "[data-number='1']" }, { "click": "[data-number='2']" },
            { "click": "[data-operator='*']" }, { "click": "[data-number='3']" },
            { "click": "[data-action='calculate']" }],
  "evaluate": "document.getElementById('display').textContent" }
```

Expect `36`. Test one edge case the same way.

## 4. Report
Tell the user the site works and how to open it: double-click `index.html` in the project folder.
