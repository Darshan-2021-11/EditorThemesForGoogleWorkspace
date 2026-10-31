# Design decisions

Why Workspace Dark works the way it does. Each entry gives the decision, the reason, and what was rejected.

## Privacy and storage

**Nothing is written to Google.**
- No Drive files, doc metadata, temporary copies, or edits to documents.
- The theme only changes how pages look in this browser. Collaborators and other devices see the normal document.
- The extension *reads* from Google in three ways, all read-only GETs:
  - a document's HTML export, to learn its paragraph styles;
  - Google's stylesheets;
  - images, to recolor drawings and thumbnails.
- *Rejected:* storing settings in Drive (appData) or in document properties. That would write to the user's account.

**Settings live in IndexedDB in the extension's own origin, with JSON export/import for backups.**
- The user preferred a browser database. It holds imported schemes, presets, the theme scope, and per-document style data, and it survives restarts.
- *Rejected:* `storage.sync`, which has size quotas, and Google-side storage.

**No themes are bundled.**
- The panel suggests GitHub links (tinted-theming Base16/Base24, Catppuccin, …) and accepts any pasted GitHub file, folder or repo URL. Only what the user picks is downloaded.
- This keeps the extension small.

## What a theme covers

**One theme for the interface and the document.**
- The first design had separate UI and document themes. The user rejected it as "too much freedom".
- One choice is simpler, and the two halves always match.

**One theme for all Google apps by default, with an optional theme per app.**
- Changing the theme anywhere updates every open Google tab, including the home screens. *Settings → Separate theme per app* gives Docs, Sheets, Slides, Forms, Drawings and Drive their own themes.
- Theme choices are never stored per document.
- *Rejected:* a theme remembered per document. The user wants to change everything at once.
- Per-document *style* data (the document's own paragraph-style colors) stays per document, because it describes that document.

**Themes must feel like editor themes, not two-tone dark mode.**
- Title, subtitle, H1–H6, normal text, links and code each get a palette accent, mapped like Markdown syntax highlighting. The user can pick any palette color, or their own color, per style.
- Docs styles are read from the read-only HTML export, with a font-size fallback. Slides has no named styles, so its headings are tiered by size against the deck's most common body size.
- *Rejected:* a plain grey/foreground scheme. The user compared it to a basic dark-mode add-on and found it lacking.

**Colors the user sets in Docs are respected.**
- When a document's Normal or heading style color changes, that style follows it: the matching palette color, or the exact color if it isn't one.

## How colors are produced

**Remap colors, never invert.**
- Earlier attempts inverted the canvas and produced solid icon squares, which the user called "ugly".
- Canvas drawing calls are wrapped so they paint theme colors directly. Stylesheets are rewritten through the theme. SVG and inline colors go through marker attributes and shared rules.
- *Rejected:* CSS `filter: invert()` and inverting the whole page.

**Colors are classified by role.**
- Text, fill, line and on-accent each map differently: a white page becomes the theme background, black ink becomes theme text, greys follow a ramp, and colors snap to the nearest theme accent (or keep their hue if the user prefers).
- Google's semantic colors (links, suggestions, errors, selections) map to the matching theme role.

**WCAG AA contrast, but the theme must stay recognizable.**
- Text reaches 4.5:1 (3:1 for large text) against what it is actually on:
  - the page background, panels and its own tint;
  - the fill rectangle beneath canvas text;
  - the shape beneath Slides text.
- Only lightness moves, in small OKLCH steps that stop at the first passing value. Hue and chroma are kept, and a test enforces this.
- Very bright accents (Solarized's yellow-green on cream) lose some chroma at the sRGB gamut edge. That is a physical limit.
- Disabled-level text keeps fading, as WCAG allows.
- *Rejected:* snapping failing text to plain black or white everywhere. It would erase the theme. Black or white is only a last resort on mid-tone fills.

**Measure, don't eyeball.**
- `scripts/contrast-audit.mjs` checks every visible text against its real backdrop, across 15 themes (dark and light), in Docs, Sheets, Slides, Forms, Drive and the home screens.
- It took the project from about 760 AA failures to essentially none. One tiny Slides thumbnail label is known.

## Pictures

**Recolor flat graphics, never photos.**
- Drawings and shapes are bitmaps. Left alone, a light box behind now-light text becomes unreadable.
- A classifier treats an image as a graphic when a few flat colors cover most of it. Each distinct color is mapped once.
- White text on dark shapes stays light: union-find regions are checked by container, size and thickness, so letter holes don't flip. Anti-aliased edges are blended.
- The result is swapped in as a `data:` URL and restored on Turn off. It is a `data:` URL because Firefox pages can't load `blob:` URLs created by a content script.
- A *Recolor drawings* option turns this off.

**Home-screen thumbnails show the themed document (WYSIWYG).**
- A thumbnail previews what opening the file will look like.
- 8×8 blocks decide how each part is mapped:
  - colored text on page white is mapped like text;
  - colored art is mapped like a drawing;
  - photos are kept: their pixels scatter off the white-to-ink line that text and flat art follow.
- Drive's file thumbnails are left alone.

## Rendering mechanics

**Printing uses Docs' own print.**
- Docs prints its live editor with `print-color-adjust: exact`. The themed canvas and page CSS therefore print as shown, and nothing needs to be intercepted.
- *Rejected:* intercepting and recoloring the print PDF with pdf-lib and webRequest. It was unnecessary, heavy, and needed more permissions.

**Repainting after a theme change.**
- Docs repaints its canvas on a synthetic `visibilitychange` event.
- Sheets ignores synthetic events and reuses its old pixels when scrolling. It is repainted by reporting a viewport 1px smaller for a moment, and the original window properties are restored exactly.
- *Rejected:* scrolling a screen away and back. Small sheets have no room to scroll.

**Following Google's dynamic styles.**
- Google's top bar fills its stylesheet through `insertRule`, which causes no DOM mutation. The page-world hook reports these changes.
- A cheap rule-count recheck at DOMContentLoaded and load catches sheets that were half-parsed when the extension started.
- Color words inside variable names (`--…-grey-fill`) are never treated as colors.

## Performance

**No per-frame or per-keystroke heavy work.**
- Mapped colors are cached per theme, and contrast fixes are cached per color pair.
- Canvas backdrops come from a 32-slot ring buffer of recent fill rectangles, with no pixel reads.
- Slides backdrops are measured once per mutation batch.
- Pictures are decoded once per source; photos are skipped permanently after one check, and region analysis of big images runs on a downscaled copy.
- A dedicated performance pass is planned (for example, moving picture analysis off the main thread).

## Scope

- Firefox only, Manifest V3, minimum Firefox 128 (needed for `world: "MAIN"` content scripts).
- Chrome and Brave would need:
  - a service-worker background, which has to reload the settings cache when it wakes up;
  - a `chrome.*` namespace or polyfill;
  - re-testing of the Sheets repaint trick;
  - possibly a separate print path, because Docs in Chrome may print through a PDF Google generates.

  Not planned yet.

## Distribution and ownership

**Public listing on addons.mozilla.org, named "Editor Themes for Google Workspace".**
- The name says which suite it works with, in the "X for Google Workspace" form AMO allows, without implying it's a Google product.
- The add-on ID `google-workspace-editor-themes@gamer247` is permanent: a new ID would be a different add-on, and existing users would lose updates.
- Every release bumps the version in both `src/manifest.json` and `package.json`. AMO never accepts the same version twice.

**All rights reserved.**
- The code can be read (any add-on can be unzipped, and AMO forbids obfuscation), but it may not be copied or republished without permission.
- `LICENSE` ships inside the add-on, and every built script starts with a copyright banner, so the notice travels with each copy.
- Contributors grant the maintainer a license to ship their work (`CONTRIBUTING.md`).
- *Rejected:* an open-source license. The maintainer wants to keep control of the code.

**Reproducible source package for review.**
- AMO reviewers rebuild bundled code. `scripts/source-package.mjs` archives the committed source with `BUILD.md`, and a clean `npm ci && npm run build` reproduces the uploaded files byte for byte.
- The build isn't minified, which keeps review simple.

**Store screenshots use only neutral content:** the maintainer's own copies of Google templates, and a generic public form. The signed-in account is hidden. Public sample documents used in testing belong to other people and are never published.
