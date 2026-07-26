# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Ming-Hao/PracticeCloudflareService/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Ming-Hao/PracticeCloudflareService/tree/v1.0.0
