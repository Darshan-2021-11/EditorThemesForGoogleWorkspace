# Editor Themes for Google Workspace

(Project codename: Workspace Dark.) A Firefox extension that applies code-editor themes (Base16/Base24: Nord, Monokai, Dracula, One Dark, Solarized, GitHub, Gruvbox, and others) to Google Docs, Sheets, Slides, Forms, Drawings and Drive. One theme covers both the **Google interface** and the **document itself**.

- **Real theme colors, not inversion.** The Docs/Sheets canvas is recolored as it is drawn, Slides are recolored shape by shape, and Google's own stylesheets are rewritten through the theme.
- **Editor-style text.** Title, headings, links and code each get their own palette accent, like Markdown in a code editor (Slides headings are recognized by size).
- **Drawings and thumbnails too.** Drawings, shapes and diagrams inside documents take theme colors; home-screen template and recent-file thumbnails show how the document looks when opened. Photos keep their real colors.
- **Readable by design.** Text meets WCAG AA contrast (4.5:1, 3:1 for large text) against what it is actually drawn on, while staying in the theme's own hues.
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

1. Open any Google Doc, Sheet, Slide deck, Form, Drawing, Drive or an app's home screen, and click the toolbar button (or press **Alt+Shift+T**) to open the panel.
2. **Get themes**: import a suggestion or paste a GitHub link.
3. **Theme**: hover a theme to preview it live, click to apply. Per-theme options:
   - *Snap to theme* (red text → the theme's red) or *Keep hue* (original hues, fixed for contrast)
   - *Color text by paragraph style*, with a palette color (or your own color) per style; colors you give a style in Docs are followed
   - *Recolor drawings* (drawings, shapes, diagrams and thumbnails; photos are left alone)
   - *Dim images*, with a strength slider
4. **Custom**: edit any palette color with color pickers and save it as a preset.
5. **Settings**: auto-apply, default theme, *Separate theme per app*, revert, backup/restore.

**Theme scope.** By default one theme applies to every Google app and home screen at once: change it anywhere and all open Google tabs follow. Turn on *Settings → Separate theme per app* to give Docs, Sheets, Slides, Forms, Drawings and Drive their own themes.

**Alt+Shift+D** turns the theme on or off (for all apps, or the current app when themes are separate). Change the shortcuts in *about:addons → ⚙ → Manage Extension Shortcuts*.

## Develop

| Command | What it does |
|---|---|
| `npm test` | Unit tests (color math, mapping and contrast, scheme parsing, CSS remapping, picture recoloring, storage migration) |
| `npm run typecheck` | TypeScript |
| `npm run lint:ext` | `web-ext lint` on `dist/` |
| `npm run visual-test` | Headless Firefox + a public Doc: screenshots of several themes, menus, panel, revert, and a themed print-to-PDF → `artifacts/visual/` |
| `node scripts/smoke-apps.mjs [sheets\|slides\|forms]` | Same for public Sheets/Slides/Forms pages |
| `node scripts/contrast-audit.mjs [public\|private]` | WCAG contrast audit of every visible text against what is behind it (DOM, Slides SVG, canvas), across several themes → `artifacts/audit/`. Env: `THEMES=`, `APPS=`, `NO_BUILD=1`; `private` needs `PROFILE=<signed-in profile copy>` |
| `node scripts/debug-page.mjs <probe.js> [theme] [url]` | Runs a probe script in a themed page and prints its result. Env: `RELOAD=1`, `SET_ON=<url>` (pick the theme on another page first), `PROFILE=` |

### How it works

- `src/hook/` runs in the page's JS world at `document_start`:
  - It wraps `CanvasRenderingContext2D` drawing calls. Colors are remapped at draw time depending on use (text, fill, line), and reads of `fillStyle` still return the original value.
  - Paragraph styles come from the document's read-only HTML export.
  - Text is checked against the fill rectangle it lands on.
  - Sheets is repainted with a momentary 1px viewport change.
  - It reports stylesheets that the page fills through the CSSOM.
- `src/content/css-remap.ts` extracts every color declaration from Google's stylesheets and emits an override sheet right after each source sheet, keeping the original cascade order.
  - It understands `var()` fallbacks, aliased component colors and Material `rgba(var(--x-rgb), a)` colors.
  - Text reads a text-mapped twin of each color variable.
  - Inline `style=""` and SVG `fill=""` colors are handled through shared attribute rules, without touching the element's style.
- `src/content/svg-contrast.ts` and `slide-styles.ts` handle Slides text: its style tier by size, and its contrast against the shape underneath.
- `src/content/graphics.ts` and `src/theme/graphic.ts` recolor pictures:
  - A flat-graphic classifier decides what counts as a drawing.
  - Per-pixel mapping maps each distinct color once.
  - Light-on-dark detection (union-find regions) and page-context zones keep the result readable, and photos are kept.
- `src/theme/` holds OKLab/OKLCH color math, Base16/24 → roles, and the mapper (grey ramp, accent snapping, Google's semantic colors → theme roles, WCAG contrast that only moves lightness).
- `src/background/` holds IndexedDB storage, the theme scope (global or per app), GitHub importing, and broadcasting changes to open tabs.

The reasoning behind the main design choices is in `DECISIONS.md`.
