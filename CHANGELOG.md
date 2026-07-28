# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Ming-Hao/PracticeCloudflareService/tree/v1.0.0
