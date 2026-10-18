---
name: vite-react-app
description: Create a new React + TypeScript app with Vite (optionally Tailwind CSS), start the dev server and verify it in a browser. Use when the user asks for a new React app, SPA, dashboard, landing page or portfolio built with React.
---

# Vite + React app

## 1. Scaffold without prompts
In an empty project folder:

```
npx create-vite@latest . --template react-ts --no-interactive --no-immediate
npm install
```

- `--no-interactive` keeps it from waiting for answers (it would time out).
- `--no-immediate` keeps it from starting the dev server inside `run_command`.
- If the folder is not empty, ask the user before using `--overwrite`, or scaffold into a subfolder.

## 2. Tailwind CSS (if the user wants it, or for quick styling)
```
npm install tailwindcss @tailwindcss/vite
```
In `vite.config.ts` add the plugin:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({ plugins: [react(), tailwindcss()] });
```

Replace the contents of `src/index.css` with:

```css
@import "tailwindcss";
```

No `tailwind.config.js` or PostCSS config is needed with Tailwind v4.

## 3. Build the UI
- Remove the Vite demo content from `src/App.tsx` and `src/App.css`.
- Split bigger pages into components in `src/components/`.
- Give interactive elements ids or `data-testid` attributes so they can be tested.
- 3D scenes: `npm install three @react-three/fiber @react-three/drei`.

## 4. Verify
1. `npm run build` with `run_command`. Fix all TypeScript and build errors.
2. `start_process` with `npm run dev`.
3. Follow the `web-app-qa` skill: `check_page` on desktop and mobile, no console errors, the main interactions work.

## 5. Report
Give the user the local URL from `start_process` and a short summary of what is on the page.
