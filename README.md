# Workspace Dark

A Firefox extension that applies code-editor themes (Base16/Base24: Nord, Monokai, Dracula, One Dark, Solarized, GitHub, Gruvbox, and others) to Google Docs, Sheets, Slides, Forms and Drive. One theme covers both the **Google interface** and the **document itself**, across every app.

- **Real theme colors, not inversion.** The document canvas is recolored as Docs draws it, and Google's own stylesheets are rewritten through the theme. Images keep their real colors.
- **WYSIWYG printing.** Ctrl+P / File → Print prints the themed document exactly as it looks on screen.
- **Local only.** Nothing is written to Google. Themes and settings live in this browser's IndexedDB. Collaborators and other devices see the normal document.
- **Nothing bundled.** You import only the themes you want from GitHub (suggested links included, or paste any GitHub scheme file, folder or repo URL).

## Install (personal use)

```powershell
npm install
npm run build          # → dist/
```

Then use one of these:
- **Temporary:** open `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → pick `dist/manifest.json`. It stays loaded until Firefox restarts.
- **Dev loop:** `npm run dev` rebuilds on change and launches Firefox with the extension. It uses a persistent profile in `.web-ext-profile/`, so you only sign in to Google once.
- **Permanent (unsigned):** in Firefox Developer Edition or Nightly, set `xpinstall.signatures.required` to `false` in `about:config`. Then run `npm run package` and install `artifacts/workspace_dark-*.zip` from *about:addons → ⚙ → Install Add-on From File*.

## Use

1. Open any Google Doc and click the toolbar button (or press **Alt+Shift+T**) to open the panel.
2. **Get themes**: import a suggestion or paste a GitHub link.
3. **Theme**: hover a theme to preview it live on the interface and the document, and click to apply. Per-theme options:
   - *Snap to theme* (red text → the theme's red) or *Keep hue* (original hues, fixed for contrast)
   - *Editor-style accents* (headings, links and code in theme accents)
   - *Dim images*
4. **Custom**: edit any palette color with color pickers and save it as a preset.
5. **Settings**: auto-apply everywhere, defaults, revert this page, backup/restore.

**Alt+Shift+D** turns themes on or off for the current page. Each page remembers its own choice. Change the shortcuts in *about:addons → ⚙ → Manage Extension Shortcuts*.

## Develop

| Command | What it does |
|---|---|
| `npm test` | Unit tests (color math, theme mapping, scheme parsing, CSS remapping) |
| `npm run typecheck` | TypeScript |
| `npm run lint:ext` | `web-ext lint` on `dist/` |
| `npm run visual-test` | Headless Firefox + a public Doc: screenshots of several theme combos, menus, panel, revert, and a themed print-to-PDF → `artifacts/visual/` |
| `node scripts/smoke-apps.mjs [sheets\|slides\|forms]` | Same for public Sheets/Slides/Forms pages |

### How it works

- `src/hook/`: runs in the page's JS world at `document_start` and wraps `CanvasRenderingContext2D` drawing calls. Colors are remapped at draw time depending on use (text, fill, line); reads of `fillStyle` still return the original value.
- `src/content/css-remap.ts`: extracts every color declaration from Google's stylesheets (including `var()` fallbacks and Material `rgba(var(--x-rgb), a)` colors) and emits an override sheet right after each source sheet. The override keeps the original cascade order. Inline `style=""`/SVG `fill=""` colors are handled through shared attribute rules, without touching the element's style.
- `src/theme/`: OKLab/OKLCH color math, Base16/24 → roles, and the mapper (grey ramp, accent snapping, contrast floors, Google's semantic colors → theme roles).
- `src/background/`: IndexedDB storage, per-page memory, GitHub importing, and broadcasting changes to open tabs.
