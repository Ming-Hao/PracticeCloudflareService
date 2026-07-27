---
name: mockup
description: Prototype a UI change as a local HTML file before touching source
---
- NEVER use the Artifact tool. Write a self-contained file to `mockups/<name>.html`.
- Reuse the project's real CSS variables/button classes so the preview matches production.
- Include 2-3 side-by-side variants of the change and a before/after column.
- Print the absolute file path and the `http://localhost:5173/mockups/<name>.html` URL.
- Do not edit any file under `src/` until I approve a variant.
