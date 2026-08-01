# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project overview

URL shortener practice project on Cloudflare Pages: a Vue 3 SPA (`src/`) plus Pages Functions (`functions/`) backed by a D1 (SQLite) database. One frontend route; link history is stored client-side in IndexedDB, encrypted.

## Commands

```bash
npm install
npm run dev         # Vite dev server :5173, proxies /api/* to :8788
npm run build       # vue-tsc --build + production build to dist/
npm run type-check  # vue-tsc --build only
npm run preview
npm test            # node --test, runs __tests__/**/*.test.{ts,js} under src/ and functions/
```

No lint script is configured.

Running the full stack locally needs **two processes at once**:

```bash
npx wrangler pages dev dist   # functions/ + D1 binding on :8788
npm run dev                   # SPA on :5173
```

The Vite proxy only forwards `/api/*` — `GET /:code` and `DELETE /:code` have to be exercised against `http://localhost:8788` directly.

First-time setup: apply `schema.sql` to the D1 database bound as `DB` in `wrangler.toml`:
`npx wrangler d1 execute shortlink-db --file=schema.sql`.

## Architecture

- **Frontend** — Vite + Vue 3 + vue-router, single route → `src/views/HomeView.vue`, which POSTs to `/api/shorten` and mounts the history UI (`src/components/history/`).
- **Backend** — Pages Functions, file-based routing: `functions/api/shorten.js` (create), `functions/[code].js` (`GET` → 302 redirect + click counter, `DELETE` → soft-delete via `deleted_at`).
- **Database** — one `links` table (`schema.sql`), accessed through the `env.DB` binding. Always use `.prepare().bind()`; never string-interpolate SQL.
- **Client-side history** — `src/utils/crypto.ts` (PBKDF2 → AES-GCM; `decrypt` returns `null` on wrong password, doesn't throw), `src/utils/historyDb.ts` (IndexedDB, stores encrypted blobs only, `id` is a caller-generated UUID independent of `short_code`), `src/composables/useHistory.ts` (singleton reactive state, memory-only, resets on reload).
- Pages build output dir is `dist` — the same output as the Vite build.

## Authorization model

The server never records who created a link. `delete_token` is returned **only** in the `POST /api/shorten` response and there is no other way to look it up, so the frontend must capture it immediately; possession of that token is the sole authorization check for delete.

Ownership therefore lives entirely client-side: encrypted under a user-chosen password (random salt/IV per record), never persisted, no recovery. The same link can be saved under more than one password, so one local copy can go stale after another deletes the server-side row — the frontend only discovers this reactively, on click (404) or re-delete (idempotent 200). See `removeStaleLocalOnly` / `onLinkClick` in `HistoryItem.vue`.

## Gotchas

Non-obvious constraints. Most of these fail silently when broken.

- **`created_at`** is written explicitly with `new Date().toISOString()`, not SQLite's `CURRENT_TIMESTAMP` default — the default has no timezone marker and browsers parse it as *local* time.
- **`functions/[code].js` response contract** is deliberate, not incidental. `GET` looks up `short_code` with `deleted_at IS NULL` — a query that drops that filter resurrects deleted links — and 404s when there's no match. `DELETE` 404s on an unknown code, 403s on a token mismatch, and treats re-deleting an already soft-deleted link with a matching token as an idempotent **200**, not an error; the frontend relies on that to detect stale local copies.
- **The 302** in `functions/[code].js` is hand-built rather than `Response.redirect()`, which returns immutable headers that can't take `Cache-Control: no-store`. Without `no-store`, a cached redirect outlives edits/deletes and stops the counter.
- **Click counting** is handed to `context.waitUntil`, not awaited. Tests hitting that route must `await ctx._settle()` before the test DB is disposed, or the background write fails with `ERR_DISPOSED`.
- **Error responses** are always `Response.json({ error })`, never plain text, so the frontend can always `await res.json()`.
- **URL validation** (`functions/api/shorten.js`): reject non-strings and inputs over `MAX_URL_LENGTH` (2048) first, then `new URL()` in try/catch, then check `protocol` is `http:`/`https:`, then refuse the request's own hostname. Never use prefix checks like `url.startsWith('http')` — that was tried first and let mismatched protocols and embedded whitespace through. (The self-hostname check only sees the hostname the request arrived on; a deployment reachable under both `*.pages.dev` and a custom domain can still shorten a link to its other hostname. Accepted for this project.)
- **Native `<dialog>`** can't rely on the browser's default modal centering — the global `* { margin: 0 }` reset in `src/assets/base.css` overrides it. Center explicitly: `position: fixed; top/left: 50%; transform: translate(-50%, -50%); margin: 0`.
- **`public/_routes.json`** is hand-written and overrides Wrangler's generated version, which would be `{"include":["/*"],"exclude":[]}` because `functions/[code].js` is a root-level catch-all — waking a Function once per static asset. Any new path that must reach a Function has to stay out of `exclude`; getting it wrong fails silently, so exercise the route after adding one.
- **`public/_headers`** CSP deliberately omits `'unsafe-inline'`. That only holds because nothing emits inline script/style — no `:style` bindings, no `v-show`, no `<Transition>`, no external fonts or CDNs. Introducing any of those must widen the CSP in the same change. `_headers` applies to static responses only; Function responses set headers in code.
- **Tests** run on Node's built-in runner with type-stripping (no ts-node/vitest). Non-erasable TS syntax — e.g. `constructor(public x: number)` — breaks; keep test-covered classes plain-JS-shaped.
- **IndexedDB tests** run against `fake-indexeddb`. Call `resetIndexedDb()` (`src/utils/__tests__/indexedDbHelpers.ts`) from `beforeEach`, not per test — it's global state a new test can silently forget. Any helper that opens the DB must `close()` before resolving: `openDb()` registers no `onblocked`, so a connection left open at an older version makes the upgrade hang rather than fail.
- **`HistoryDbDeps` has two implementations** — the real one and the in-memory fake injected by `useHistory.test.ts`. `historyDb.contract.test.ts` runs one assertion set against both and is the only thing that detects drift; a stale fake leaves every `useHistory` test green while describing a storage layer that no longer exists (already happened once). Fix whichever implementation is wrong — never relax the contract.

## Conventions

- `functions/` is plain JavaScript; `src/` is TypeScript.
- All code, comments, and user-facing strings in English — do not introduce Traditional Chinese.
- Reuse `.btn-primary` / `.btn-secondary` / `.btn-icon` from `src/assets/buttons.css` (imported globally via `main.css`) instead of redefining button styles in `<style scoped>`. Icons follow the shape used in `HomeView.vue`: 24×24 viewBox, `stroke="currentColor"`, `stroke-width="2"`, `class="btn-icon"`.
- Before adding a dialog under `src/components/history/`, check whether an existing one can be parameterized. `ConfirmDialog.vue` already doubles as the binary "use current identity vs. save with a new password" prompt, deliberately avoiding a sixth component.
- Destructive/dismissive actions add `.btn-danger` on top of `.btn-secondary`, switching the green hover to a red wash. Reuse it rather than inventing a new red variant.
- Bumping `version` in `package.json` also means adding a matching `## [x.y.z]` entry (with compare link) to `CHANGELOG.md` and creating a `vX.Y.Z` git tag on that commit.

## Workflow

- For UI with no visual precedent in the repo (a brand-new drawer, dialog, or page layout), produce a local HTML mockup via the mockup skill and get it approved before editing `src/`. Layout/spacing/color tweaks to existing components don't need this.
- When one change touches styles across two or more `.vue` files, run `/simplify` before wrapping up to consolidate duplicated styles into shared files like `src/assets/buttons.css`.