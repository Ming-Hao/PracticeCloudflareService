# URL Shortener (Cloudflare Practice)

A small practice project for exploring Cloudflare's platform features (Pages, Pages Functions, D1).
The app itself is a simple URL shortener — paste a long URL and get back a short link.

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
| `functions/[code].js` | `/:code` |
| `functions/api/shorten.js` | `/api/shorten` |

| Export name | HTTP method |
| --- | --- |
| `onRequestGet` | GET |
| `onRequestPost` | POST |
| `onRequestDelete` | DELETE |
| `onRequest` | any method (catch-all) |

Static routes (like `/api/shorten`) take priority over dynamic ones (like `/:code`), so a request
to `/api/shorten` is never mistaken for `[code].js` with `code = "api"`.

### Frontend calls → which handler runs

The frontend never registers routes itself — it just calls a URL with `fetch` and a given HTTP
`method`. Cloudflare matches that (URL, method) pair to the right file/export using the rules
above.

| Frontend call | URL + method | Matches |
| --- | --- | --- |
| `onSubmit()` ([HomeView.vue](src/views/HomeView.vue)) | `fetch('/api/shorten', { method: 'POST' })` | `functions/api/shorten.js` → `onRequestPost` |
| `deleteLinkOnServer()` ([useHistory.ts](src/composables/useHistory.ts)) | `` fetch(`/${shortCode}`, { method: 'DELETE' }) `` — e.g. `shortCode = "abc123"` actually requests `fetch('/abc123', { method: 'DELETE' })` | `functions/[code].js` → `onRequestDelete` |

### Where the dynamic segment ends up: `context.params`

When a request matches a dynamic route like `/:code`, Cloudflare parses the matched segment out
of the URL and passes it into the handler via `context.params` — the frontend never sends this
separately, it's extracted from the URL itself:

```js
// functions/[code].js
export async function onRequestDelete(context) {
  const { params, env, request } = context;
  const code = params.code; // "abc123", parsed from the request URL /abc123
  // ...
}
```

`context` is the object Cloudflare automatically builds for every request; besides `params`, it
also carries `request` (the raw `Request`, e.g. for reading the JSON body) and `env` (bindings
such as `env.DB`).

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

```mermaid
flowchart TD
    E[User visits short link<br/>GET /:code<br/><i>→ handled by onRequestGet</i>] --> F[(D1: SELECT target_url<br/>WHERE short_code = code)]
    F --> G[Server returns 302<br/>Location: target_url]
    G --> H[Browser auto-requests<br/>target_url]
```
