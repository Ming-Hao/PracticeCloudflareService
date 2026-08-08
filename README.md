# URL Shortener (Cloudflare Practice)

A small practice project for exploring Cloudflare's platform features (Pages, Pages Functions, D1).
The app itself is a simple URL shortener — paste a long URL and get back a short link.

## Cloudflare setup

1. **Create the Pages project.** In the Cloudflare dashboard: Workers & Pages → Create → Pages →
   Connect to Git → GitHub, and pick this repository. Build command `npm run build`, output
   directory `dist`. Every push to `main` deploys from then on.

2. **Create the D1 database.**

   ```sh
   npx wrangler d1 create shortlink-db
   ```

   That prints a config snippet containing the new `database_id` — the value in the
   `[[d1_databases]]` block of `wrangler.toml` comes from there. The snippet's `binding` defaults to
   the database name; here it is `DB`, the name the Functions read as `env.DB`.

   The `Env` type the Functions are checked against is generated from these bindings, so any change
   to them needs a regenerated `worker-configuration.d.ts`:

   ```sh
   npm run wrangler:types        # regenerate
   npm run wrangler:types:check  # fail if it is out of date
   ```

   Skipping this leaves `env.DB` typed under the old binding name: type-checking still passes and
   the failure only shows up at runtime.

3. **Apply the schema to the remote database.** Run the contents of `schema.sql` in the dashboard's
   D1 Console, or from the CLI:

   ```sh
   npx wrangler d1 execute shortlink-db --remote --file=schema.sql
   ```

   Until the `links` table exists, `POST /api/shorten` fails on the deployed site. A column added
   after the table already holds rows goes in one at a time instead:

   ```sql
   ALTER TABLE links ADD COLUMN deleted_at TEXT;
   ```

   (That is how `deleted_at` and `delete_token` arrived, so a live database's column order can
   differ from `schema.sql` while staying equivalent.)

## Running locally

`wrangler pages dev` serves the built `dist/` folder, so `npm run build` has to run first either way.
The local D1 database needs the schema once:

```sh
npx wrangler d1 execute shortlink-db --local --file=schema.sql
```

**Working on the frontend** — two processes:

```sh
npx wrangler pages dev dist   # :8788 — Functions + D1
npm run dev                   # :5173 — Vite with HMR, proxies /api/* to :8788
```

Open <http://localhost:5173>. The proxy only forwards `/api/*`, so anything that hits `/:code` —
following a short link from the history list, deleting one — has to be exercised on :8788. On :5173
those requests reach Vite instead, which answers with the SPA.

**Everything else** — one process:

```sh
npm run build
npx wrangler pages dev dist
```

Open <http://localhost:8788>. Static responses come from Cloudflare's asset handling here, so this is
the only local setup where `_headers` and the `exclude` list in `_routes.json` have any effect — on
:5173 those responses come from Vite.

### Forcing a database fault

Every handler in `functions/[code].ts` catches its own D1 failure and answers in the shape its caller
already expects. The unit tests cover those branches with a stub; renaming the table away is how to
exercise the same paths against a real local D1.

```sh
npx wrangler d1 execute shortlink-db --local --command "ALTER TABLE links RENAME TO links_off"
```

| Request | Response |
| --- | --- |
| `GET /:code` | 500 + the `serverErrorPage()` HTML |
| `HEAD /:code` | bare 500 — **not** 404 |
| `DELETE /:code` | 500 JSON, so the frontend can still `await res.json()` |

`HEAD` is the one worth looking at: `resolveLinkClick` treats only a 404 as a dead link, so a 404
here would tell users their link is gone because the database blinked, and the frontend would drop
their local copy of a link that still exists.

**Create the short link before breaking the table.** `POST /api/shorten` reads the same table, so
nothing can be shortened while it is renamed.

Checking `DELETE` through the history UI has to happen on :8788, for the proxy reason above — on
:5173 the request reaches Vite, which answers with the SPA, so `res.ok` is true and the delete looks
like it succeeded. On :8788 the entry stays in the list instead, with `Failed to delete short link
(status 500)` under it.

Restore the table afterwards, then reload and confirm an unknown code gives the 404 page again —
that also proves the rename took effect rather than `wrangler pages dev` holding the old schema:

```sh
npx wrangler d1 execute shortlink-db --local --command "ALTER TABLE links_off RENAME TO links"
```

## Pages Functions routing

Cloudflare Pages Functions map routes using two conventions, both handled by the Cloudflare
runtime itself — nothing in this repo configures them explicitly:

1. **File path → URL route.** The file's path under `functions/` becomes the route. `[code]` is
   dynamic-segment syntax (like Vue Router's `:code`) — it matches any single path segment, and
   the matched value is parsed out for you.
2. **Exported function name → HTTP method.** Within a file, Cloudflare looks for specifically-named
   exports.

| File | Route |
| --- | --- |
| `functions/[code].ts` | `/:code` |
| `functions/api/shorten.ts` | `/api/shorten` |

| Export name | HTTP method |
| --- | --- |
| `onRequestGet` | GET |
| `onRequestHead` | HEAD |
| `onRequestPost` | POST |
| `onRequestDelete` | DELETE |
| `onRequest` | any method (catch-all) |

Static routes (like `/api/shorten`) take priority over dynamic ones (like `/:code`), so a request
to `/api/shorten` is never mistaken for `[code].ts` with `code = "api"`.

`onRequestHead` is here for a reason worth knowing. The history list checks whether a short link
is still live before navigating to it, and that probe originally used `GET` — the same request the
browser was about to make anyway, so every click was counted twice. The fix
([`7e13057`](https://github.com/Ming-Hao/PracticeCloudflareService/commit/7e13057), *stop counting
a link click twice*) split the probe onto `HEAD`, which `functions/[code].ts` answers without
touching the counter. It also answers **200**, not the `302` that `GET` returns — the probe follows
redirects by default, and a `302` would send it cross-origin to the target site, where it fails
CORS.

### Frontend calls → which handler runs

The frontend never registers routes itself — it just calls a URL with `fetch` and a given HTTP
`method`. Cloudflare matches that (URL, method) pair to the right file/export using the rules
above.

| Frontend call | URL + method | Matches |
| --- | --- | --- |
| `onSubmit()` ([HomeView.vue](src/views/HomeView.vue)) | `fetch('/api/shorten', { method: 'POST' })` | `functions/api/shorten.ts` → `onRequestPost` |
| `deleteLinkOnServer()` ([useHistory.ts](src/composables/useHistory.ts)) | `` fetch(`/${shortCode}`, { method: 'DELETE' }) `` — e.g. `shortCode = "abc123"` actually requests `fetch('/abc123', { method: 'DELETE' })` | `functions/[code].ts` → `onRequestDelete` |
| `resolveLinkClick()` ([linkClick.ts](src/utils/linkClick.ts)), called from `onLinkClick()` in [HistoryItem.vue](src/components/history/HistoryItem.vue) | `fetch(shortUrl, { method: 'HEAD' })` | `functions/[code].ts` → `onRequestHead` |

### Where the dynamic segment ends up: `context.params`

When a request matches a dynamic route like `/:code`, Cloudflare parses the matched segment out
of the URL and passes it into the handler via `context.params` — the frontend never sends this
separately, it's extracted from the URL itself:

```ts
// functions/[code].ts
export async function onRequestDelete(
  context: EventContext<Env, "code", unknown>
): Promise<Response> {
  const { params, env, request } = context;
  const code = params.code as string; // "abc123", parsed from the request URL /abc123
  // ...
}
```

`context` is the object Cloudflare automatically builds for every request; besides `params`, it
also carries `request` (the raw `Request`, e.g. for reading the JSON body) and `env` (bindings
such as `env.DB`).

`params.code` is typed `string | string[]` because the same type covers catch-all routes, which
can match several segments. `[code]` matches exactly one, so the array form never occurs here and
`as string` says so. `EventContext` and `Env` are global types — no import is needed, they come
from the generated `worker-configuration.d.ts` (see the setup section above).

## Redirect flow

How a short link is created, and how visiting it later resolves back to the original URL:

```mermaid
sequenceDiagram
    participant Browser
    participant Pages Function
    participant D1 (links table)

    Note over Browser,D1: Create short link
    Browser->>Pages Function: POST /api/shorten { url }
    Pages Function->>D1 (links table): INSERT short_code, target_url
    Pages Function-->>Browser: { short_code, delete_token }

    Note over Browser,D1: Visit short link
    Browser->>Pages Function: GET /:code
    Pages Function->>D1 (links table): SELECT target_url WHERE short_code = ?
    D1 (links table)-->>Pages Function: target_url
    Pages Function-->>Browser: 302 Redirect (Location: target_url)
    Browser->>Browser: Follow redirect (new GET request)
```

Same logic, split into two separate step-by-step flowcharts:

### 1. Creating a short link

```mermaid
flowchart TD
    A[User submits long URL] --> B[POST /api/shorten<br/><i>→ handled by onRequestPost</i>]
    B --> C[(D1: INSERT short_code + target_url)]
    C --> D[Browser gets short link + delete_token]
```

### 2. Visiting a short link

Two ways in. A visitor following the short link from anywhere goes straight to `GET`. A click
inside this app's own history list probes with `HEAD` first, so a link someone else already
deleted is dropped locally instead of navigating to a 404:

```mermaid
flowchart TD
    A[Visitor opens the short link] --> D[GET /:code<br/><i>→ handled by onRequestGet</i>]
    B[User clicks an entry in the history list] --> C[HEAD /:code<br/><i>→ handled by onRequestHead</i>]
    C -->|404: already deleted| X[Remove the stale local copy,<br/>do not navigate]
    C -->|200: still live| D
    D --> F[(D1: SELECT target_url<br/>WHERE short_code = code)]
    F --> G[Server returns 302<br/>Location: target_url]
    G --> H[Browser auto-requests<br/>target_url]
```

Only the `GET` branch increments `clicks` — that split is what
[`7e13057`](https://github.com/Ming-Hao/PracticeCloudflareService/commit/7e13057) fixed.
