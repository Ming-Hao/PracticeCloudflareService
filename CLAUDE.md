# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A practice project for building a URL shortener on Cloudflare Pages: a Vue 3 SPA frontend plus Cloudflare Pages Functions backend, backed by a D1 (SQLite) database. The frontend has a single page ([src/views/HomeView.vue](src/views/HomeView.vue)) with a form that calls the shortener API and shows the resulting short link.

## Commands

```sh
npm install        # install dependencies
npm run dev         # start Vite dev server (frontend), proxies /api to localhost:8788
npm run build       # type-check (vue-tsc --build) + production build to dist/
npm run type-check  # vue-tsc --build only
npm run preview     # preview the production build
```

There is no lint or test script configured.

To exercise the full stack locally (frontend + Pages Functions + D1), you need **two processes running at once**:

```sh
npx wrangler pages dev dist   # serves functions/ + D1 binding on http://localhost:8788
npm run dev                   # serves the Vite SPA on http://localhost:5173, proxying /api/* to 8788
```

`wrangler.toml` binds the D1 database as `DB` (database name `shortlink-db`); the schema in [schema.sql](schema.sql) must be applied to that database (e.g. `npx wrangler d1 execute shortlink-db --file=schema.sql`) before the functions will work. The Vite dev proxy is configured in [vite.config.ts](vite.config.ts) (`server.proxy['/api']`) — it only forwards `/api/*`, not the `GET /:code` redirect route, so visiting a generated short link only resolves against `http://localhost:8788`, not the Vite dev server.

## Architecture

- **Frontend**: Vite + Vue 3 + vue-router SPA under `src/`, single route (`home` → [src/views/HomeView.vue](src/views/HomeView.vue)) defined in [src/router/index.ts](src/router/index.ts). `HomeView.vue` posts to `/api/shorten` with `fetch` and renders the returned short link.
- **Backend**: Cloudflare Pages Functions under `functions/`, using file-based routing:
  - [functions/api/shorten.js](functions/api/shorten.js) — `POST /api/shorten`: accepts `{ url }`, validates it by parsing with `new URL(url)` and checking `protocol` is `http:` or `https:`, generates a random 6-char short code (retrying up to 5 times on collision), inserts into the `links` table, returns `{ short_code, target_url }`.
  - [functions/[code].js](functions/[code].js) — `GET /:code`: looks up `short_code` in the `links` table, increments its `clicks` counter, and issues a 302 redirect to `target_url`; returns a 404 response if not found.
- **Database**: single `links` table ([schema.sql](schema.sql)) with `short_code` (unique), `target_url`, `clicks`, `created_at`. Accessed via the `env.DB` D1 binding declared in [wrangler.toml](wrangler.toml) using `.prepare(...).bind(...)` parameterized queries — always use parameter binding, never string-interpolate SQL.
- Pages Functions build output directory is `dist` (`pages_build_output_dir` in `wrangler.toml`), i.e. the same output as the Vite frontend build.

## Conventions observed in this repo

- Backend code (`functions/`) uses plain JavaScript (`.js`), not TypeScript, even though the frontend is TypeScript.
- User-facing strings and code comments in the existing backend code are written in Traditional Chinese (e.g. error messages in `shorten.js`); follow the global instruction to write new code/comments in English regardless — treat the existing Chinese as legacy content, not a pattern to extend.
- URL validation (`functions/api/shorten.js`) uses `new URL(url)` wrapped in try/catch, then checks `protocol` is `http:`/`https:` — do not validate URLs with string prefix checks (e.g. `url.startsWith('http')`), which was tried first and let malformed input through (mismatched protocols, embedded whitespace).
- Native `<dialog>` elements (e.g. the result modal in `HomeView.vue`) cannot rely on the browser's default `dialog:modal { margin: auto }` centering — `src/assets/base.css` has a global `*, *::before, *::after { margin: 0 }` reset that overrides it. Any new dialog needs explicit centering (`position: fixed; top/left: 50%; transform: translate(-50%, -50%); margin: 0`).
