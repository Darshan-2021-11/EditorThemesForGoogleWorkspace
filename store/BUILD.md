# Building Editor Themes for Google Workspace from source

These steps reproduce the uploaded add-on package exactly.

## Requirements

- Node.js 20 or newer (developed with Node 26), with npm
- Any OS (Windows, macOS, Linux)

## Steps

```sh
npm ci            # installs the exact versions in package-lock.json
npm run build     # TypeScript → dist/ (Vite, not minified)
```

`dist/` is the add-on: `manifest.json`, `background.js`, `content.js`, `hook.js`, `icon.svg` and `LICENSE`.

Copyright (c) 2026 darsh. All rights reserved. This source is provided for add-on review only; see `LICENSE`.

To make the same zip that was uploaded:

```sh
npm run package   # → artifacts/editor_themes_for_google_workspace-<version>.zip
```

## Source layout

- `src/hook/`: page-world script that recolors canvas drawing (Docs/Sheets).
- `src/content/`: themes Google's interface, Slides and pictures; the in-page panel.
- `src/background/`: settings storage (IndexedDB) and scheme import from GitHub.
- `src/theme/`: color math and theme mapping.
- `scripts/build.mjs`: the build. Dev-only test hooks are compiled out unless `WD_DEV=1` or `--watch`.

Tests (optional): `npm test`.
