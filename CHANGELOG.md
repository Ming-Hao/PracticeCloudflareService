# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The three handlers in `functions/[code].ts` now catch database faults instead
  of letting them escape. A transient D1 error reached the visitor as the
  platform's own error page, next to a styled 404 page it never got to use.
  `GET` answers with a 500 page, `HEAD` with a bare 500, `DELETE` with 500 JSON.
  `HEAD` deliberately avoids 404 there: the frontend reads that as a dead link
  and would drop the user's local copy of a link that still exists.

### Changed

- `DELETE /:code` now writes `deleted_at` as ISO 8601 with an explicit `Z`,
  the same way `created_at` is written, instead of SQLite's `CURRENT_TIMESTAMP`.
  Nothing reads the column as a time yet, so this is consistency rather than a
  fix. Rows soft-deleted earlier keep the old format.

- `notFoundPage()` and `serverErrorPage()` now share one `errorPage()` helper and
  differ only in status, title, heading and body. The same 49 lines of markup were
  previously held twice.

### Added

- `scripts/preview-error-pages.ts` renders the two `GET /:code` error pages to
  `mockups/` as standalone HTML. Both are assembled inside `functions/[code].ts`,
  so looking at them otherwise means running `wrangler pages dev` against a
  deliberately broken D1. The script calls the handler with a stub database, so
  what it writes is what a visitor receives.

## [1.7.3] - 2026-08-07

### Security

- `POST /api/shorten` now requires `Content-Type: application/json` and answers
  415 otherwise. `request.json()` ignored the header, leaving the endpoint open
  to a cross-site `<form enctype="text/plain">` — a CORS simple request with no
  preflight. The attacker never reads the response, so never learns the
  `delete_token`, but every row created that way is unremovable.

- `POST /api/shorten` now rejects a URL that carries userinfo (`user:pass@host`).
  Because `target_url` keeps the raw string, those credentials would otherwise
  reach `GET /:code`'s `Location` header, and from there logs and browser
  history. The host-based checks never saw the userinfo, which also let
  `https://trusted.example@evil.example` phishing forms through.

### Fixed

- `removeStaleLocalOnly` no longer drops a failed IndexedDB delete on the floor.
  It cleared the UI list synchronously but discarded the `deleteRecord` promise,
  so a rejection went unhandled and the record survived in storage — reappearing
  on the next unlock. The rejection is now caught and logged.

- Three places the 1.7.2 contrast pass left short of WCAG 2.2 AA.
  `--color-text-muted` and `--color-danger` were measured against
  `--color-background-soft`, the drawer's own background, but
  `.history-item-target`, `.history-empty` and `.history-item-error` render
  inside `.history-section`, which paints `--color-background-mute` over it.
  One shade lighter, one shade less contrast: they landed at 4.47:1 and 4.23:1.
  The muted alpha goes to `0.54` and the danger red to `#f16b68`, both now
  measured against mute. The two `--color-danger-wash` values follow its RGB so
  the hover wash and the icon on top of it stay one red.

## [1.7.2] - 2026-08-06

### Fixed

- Fifteen places failed WCAG 2.2 AA contrast against the dark background. The
  error text was `#c0392b`, a colour the buttons use as a *background*, which
  left it at 2.93:1 inside dialogs; secondary text stacked `opacity` on top of
  an already translucent `--color-text`, multiplying to 3.8:1; and both count
  badges put white on a green worth 2.10:1. Nothing on the page is large enough
  for the 3:1 exception, so all of it needed 4.5:1. The new
  `--color-text-muted` replaces the `opacity` pairs, and the input's focus ring
  moved off a green that sat at 2.75:1 on the field it outlines.

### Removed

- The global `a` rule inherited from the Vue starter. Every link in the app
  already set its own colour, so the rule's colour never rendered and `.green`
  was never used — but its `padding: 3px` and green hover wash still reached
  the short link in the history list, and the footer carried a
  `background-color: transparent` whose only job was to cancel that wash.

### Added

- The `GET /:code` 404 page sends `X-Content-Type-Options: nosniff` and
  `X-Frame-Options: DENY`. `public/_headers` applies to static responses only, so
  a page built inside a Function inherits nothing from it and was serving no
  security headers at all.

### Changed

- The app is dark-only. `base.css` had kept the Vue starter's second set of
  light-mode variables, which no component was ever designed or tested against —
  `HomeView.vue`'s hard-coded `#3a3a3a` input background left the typed URL at
  1.04:1 against `--color-text`. The light values, the unused palette entries and
  `--section-gap` are gone, `color-scheme: dark` covers the native controls, and
  the 404 page in `functions/[code].ts` follows.

- README documents `onRequestHead`: the export table lists it, the frontend-call
  table carries the probe, and the "visiting a short link" flowchart shows the
  `HEAD` branch. It also records why the probe exists — the earlier `GET` probe
  counted every click twice.

## [1.7.1] - 2026-08-05

### Fixed

- `POST /api/shorten` rejects a URL containing `\0`, `\n` or `\r`. `new URL()`
  strips line breaks before parsing, so these passed validation, but `target_url`
  keeps the raw string and a header value cannot hold them. The link was created
  and then threw while building its redirect, on every visit.

- `DELETE /:code` no longer accepts `{"delete_token": null}` as authorization for
  a link whose stored token is NULL. `delete_token` was added by `ALTER TABLE` and
  has no `NOT NULL` constraint, so rows created before it hold NULL, and the plain
  `!==` comparison read both sides as null and soft-deleted the link. The handler
  now requires the submitted token to be a string before comparing.

### Added

- CI verifies that `worker-configuration.d.ts` still matches `wrangler.toml`
  before type-checking. A stale copy passes the type check by design, so this
  is the only step that catches a binding change, or a `wrangler` upgrade, that
  was made without regenerating the file.

## [1.7.0] - 2026-08-05

### Changed

- The Pages Functions in `functions/` are now TypeScript and are covered by
  `npm run type-check`, which previously looked at `src/` only. Workers types
  come from `worker-configuration.d.ts`, generated by `npm run wrangler:types`
  from the bindings in `wrangler.toml`. No runtime behaviour changed: the handlers keep
  the same responses, statuses, headers, and SQL.

## [1.6.0] - 2026-08-03

### Added

- A `robots.txt` that blocks crawlers from every path except the homepage, to
  keep short links out of search results. It also stops automated fetches of a
  short code from inflating its click count.

### Changed

- The redirect from `GET /:code` now sends `Referrer-Policy: no-referrer`, so the
  target site is no longer told which shortener the visitor came from.

- PBKDF2 now derives keys with 600,000 iterations instead of 100,000, matching
  the current OWASP recommendation. Identities created before this change keep
  the iteration count they were stored with, so existing history stays
  decryptable with the same password.

## [1.5.0] - 2026-08-02

### Added

- A page footer showing the app version, a link to the GitHub repository, and
  the deployment platform. The commit the build came from fades in next to the
  repository link on hover, and links to that commit. Version and commit are
  injected at build time, so bumping `package.json` needs no frontend edit. The
  commit falls back to the local git checkout when `CF_PAGES_COMMIT_SHA` is
  absent, and its segment is dropped entirely when neither is available.

### Changed

- `#app` is now a full-height flex column, so the footer sits at the bottom of
  the viewport instead of directly under the form on short pages.

- `useHistory()` now resolves its store through Vue's `inject`, falling back to
  the existing module singleton when nothing provides one. Components are
  unchanged and production behaviour is identical; the seam exists so a test can
  hand a mounted component its own store instead of the shared one.

## [1.4.1] - 2026-08-02

### Security

- Static responses now carry `X-Content-Type-Options: nosniff`, so a browser
  reads them as the `Content-Type` they declare instead of sniffing the body.
  Function responses are unaffected — `public/_headers` covers static responses
  only.

### Fixed

- Clicking a short link in the history list no longer depends on the stale-link
  probe succeeding. An ad blocker or a dropped connection made the probe fail,
  which showed `Failed to fetch` and left the link unopened even though the link
  itself was fine. A failed probe now navigates anyway and lets the browser
  report, and the remaining error message is a sentence instead of the raw
  browser one.

## [1.4.0] - 2026-08-02

### Changed

- Following a short link that was deleted or never existed now shows a page
  saying so, with a link back to the site. It used to answer with the raw JSON
  `{"error":"Short link not found"}`, which no caller ever read — the frontend
  probes a link with HEAD and reads only the status. The page is not cacheable,
  so an unused code that 404s today still works once it is handed out.

### Fixed

- Local history operations no longer leave their IndexedDB connection open.
  Each read and write opened one and never closed it, so connections
  accumulated for as long as the page stayed loaded. Nothing broke today, but
  the next time the database schema changes, the upgrade needs exclusive
  access: a leftover connection in another tab would have stalled it
  indefinitely, with no error and no timeout.

## [1.3.3] - 2026-08-02

### Security

- `POST /api/shorten` rejects URLs whose hostname is a private, loopback, or
  link-local address — including octal, hex, integer, and IPv4-mapped IPv6
  forms of those addresses, and names ending in `.internal`, `.local`, or
  `.home.arpa`. These were previously accepted and now return 400. The check
  is a string comparison against the hostname as written; a domain name that
  only resolves to a private address via DNS is not caught.

## [1.3.2] - 2026-08-01

### Added

- A GitHub Actions workflow that type-checks and runs the test suite on every
  push to `main` and every pull request.

### Changed

- Loading a page no longer wakes a Function. The routing file Cloudflare Pages
  generates sends every request through the Functions runtime, because the
  short-link handler sits at the root and its route widens to `/*`; the home
  page and each asset were waking a Function only to fall through to the static
  file. A hand-written `public/_routes.json` now excludes them, leaving
  `POST /api/shorten` and the short links themselves as the only routes that
  reach a Function. Nothing about the site behaves differently.

### Security

- Static responses now carry a Content Security Policy, `X-Frame-Options` and
  `Permissions-Policy`, set from a hand-written `public/_headers` file. The
  policy allows only same-origin scripts, styles and connections, and forbids
  framing the site at all. `Strict-Transport-Security` is deliberately left out:
  browsers remember it for the whole `max-age`, so removing the header later
  does not undo it.

## [1.3.1] - 2026-07-29

### Added

- Tests for the local history store: the version 1 to 2 upgrade that deletes
  saved records, the encrypt-store-load-decrypt round trip, and a contract that
  both the real store and its test double must satisfy.
- Tests for the copy button reporting a failure when the clipboard is
  unavailable.

### Changed

- The copy button's clipboard logic moved into a composable so it could be
  tested. The button itself behaves the same.

## [1.3.0] - 2026-07-28

### Changed

- **Saved local history from earlier versions is deleted when you upgrade, and
  cannot be recovered.** The browser store moves to version 2, and version 1
  records cannot be carried over: each one carried its own salt and belonged to
  no identity, and grouping them into one would require the password, which is
  never stored anywhere. After upgrading, the history drawer will be empty and
  links saved under a password are gone for good — the short links themselves
  keep working, but the local record of which ones are yours does not.
- Unlocking the history derives one key per password instead of one per saved
  record. A password now resolves to an identity holding the salt, the
  iteration count and a verifier, so checking it no longer means attempting to
  decrypt every stored record in turn.
- The iteration count is stored with each identity rather than read from a
  constant, so raising it later leaves already-saved records readable instead of
  silently making them look like they were saved under a different password.
- Short codes are 8 characters instead of 6, widening the space from 5.7e10 to
  2.2e14. Existing 6-character links are unaffected and keep resolving.

### Fixed

- Short codes are generated with a cryptographic random source. A short code is
  the only thing guarding a link, and `Math.random()`'s internal state can be
  recovered from its output, making subsequent codes predictable.
- Claiming a short code is a single insert guarded by the unique constraint. The
  previous check-then-insert left a window in which a concurrent request could
  take the same code in between.

### Added

- Test files are type-checked through their own TypeScript project; they were
  excluded from type-checking entirely before.

## [1.2.0] - 2026-07-28

### Added

- Test suite covering `functions/` and `src/`: 60 tests on Node's built-in
  runner, with Miniflare-backed D1 helpers so the Pages Functions run against a
  real (in-memory) database.
- README diagrams for Pages Functions routing and the redirect flow.

### Fixed

- Malformed JSON request bodies return 400 instead of failing as a 500.
- Exhausting every short-code collision retry returns a retryable 503; the
  previous code went on to insert a candidate it already knew collided and
  reported the resulting constraint violation as a 500.
- Clearing the history no longer aborts on the first failed deletion. One link
  whose delete token no longer matches used to reject the whole batch while the
  other deletions had already gone through server-side, leaving the drawer out
  of sync with the server. It now reports how many failed.
- Both Copy buttons report clipboard failures instead of sitting visibly inert
  and escaping as an unhandled rejection.
- Redirects send `Cache-Control: no-store`. A cached 302 could outlive an edit
  or a delete, sending visitors to the old target and skipping the click count.
- Every error response from `/:code` is JSON. `GET` 404, `DELETE` 404 and
  `DELETE` 403 returned plain text, so reading an error body with `res.json()`
  would have thrown.

### Changed

- The click counter increments in the background via `waitUntil`, so it no
  longer delays the redirect.

### Security

- Server error messages no longer carry internal database details; the full
  error goes to the Workers log instead.
- `POST /api/shorten` rejects non-string URLs, URLs over 2048 characters, and
  URLs whose hostname matches the one the request arrived on. Inputs in those
  three categories were previously accepted and now return 400. The hostname
  check only sees the hostname in flight, so a deployment reachable under
  several hostnames can still shorten a link aimed at one of its others.

## [1.1.1] - 2026-07-26

### Fixed

- Copy button text no longer wraps mid-word.

### Changed

- Translated remaining Traditional Chinese comments and error strings in
  `functions/` to English; updated CLAUDE.md's language convention note
  and trimmed a few Architecture bullets to focus on non-obvious details.

## [1.1.0] - 2026-07-26

### Added

- Client-side link history: session list and password-encrypted saved list
  (PBKDF2 + AES-GCM, stored in IndexedDB), with save / save-as / load / delete
  flows in a new history drawer.
- Soft-delete support: `DELETE /:code` removes a link via its `delete_token`,
  marking it `deleted_at` instead of removing the row; redirect lookups now
  exclude deleted links.

## [1.0.0] - 2026-07-25

### Added

- Initial URL shortener: Vue 3 SPA frontend with a Cloudflare Pages Functions
  backend, backed by a D1 database.
- Public domain LICENSE file.
- `.gitignore` excludes the `.agent_plans` directory.

[Unreleased]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.7.3...HEAD
[1.7.3]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.7.2...v1.7.3
[1.7.2]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.3.3...v1.4.0
[1.3.3]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Ming-Hao/PracticeCloudflareService/tree/v1.0.0
