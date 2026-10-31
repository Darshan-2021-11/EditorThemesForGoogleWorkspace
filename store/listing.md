# addons.mozilla.org listing

Copy these fields into the AMO submission form.

## Name

Editor Themes for Google Workspace

## Summary (max 250 characters)

Use your favorite code-editor theme in Google Docs, Sheets, Slides, Forms and Drive. Nord, Dracula, Solarized, Gruvbox and hundreds more recolor the whole page, including the document itself, and printing matches the screen.

## Description

Most dark modes for Google Docs invert colors and call it done. This add-on applies a real color theme instead: the Base16 and Base24 palettes code editors use, so a Nord document looks like Nord in your editor, down to the link color.

What gets themed
• The Google interface: menus, toolbars, dialogs, sidebars and home screens.
• The document itself: the page, text, tables, highlights and comments in Docs, the grid in Sheets, every slide in Slides, and Forms.
• Headings, links and code each get their own accent, like Markdown in an editor. You pick the color for each style.
• Drawings and diagrams inside documents, and the previews of templates and recent files. Photos keep their real colors.

Readable in every theme
Text is checked against whatever it sits on and meets WCAG AA contrast. Only the lightness is adjusted, so colors stay true to the theme.

Prints the way it looks
File → Print gives you the themed document, exactly as on screen.

Your documents stay yours
Nothing is written to Google: no copies, no document settings, nothing in Drive. Collaborators and your other devices see the normal document. Settings are kept in your browser only.

Bring your own themes
Nothing is bundled, so the add-on stays small. Pick from suggested sources (Nord, Dracula, One Dark, Solarized, GitHub, Gruvbox, Tokyo Night, Catppuccin and the full tinted-theming collection) or paste any GitHub link to a Base16/Base24 scheme. You can also make your own with the color editor.

How to use
1. Open a Google Doc, Sheet, Slide deck, Form or Drive, and click the toolbar button (or press Alt+Shift+T).
2. Under Get themes, import a few themes.
3. Hover a theme to preview it, click to apply.

One theme applies to all Google apps by default. Turn on "Separate theme per app" in Settings to pick one per app. Alt+Shift+D turns the theme on and off.

## Categories

- Appearance
- Other (or Productivity, if offered)

## Tags

dark mode, google docs, google sheets, google slides, themes, nord, dracula, solarized, accessibility

## Support

- Support email: (your choice; required for a public listing)
- Support site / homepage: (optional)

## License

(Choose in the form: for example MIT, or All Rights Reserved.)

## Privacy policy

Paste the contents of `store/privacy-policy.md`.

## Release notes for 1.0.0

First public release: themes for Google Docs, Sheets, Slides, Forms, Drawings and Drive; paragraph-style colors; recolored drawings and thumbnails; WCAG AA contrast; themed printing; one theme for all apps or one per app.

## Notes to reviewer

- **Build:** the add-on is built with Vite from TypeScript. The code is not minified. Source and exact build steps are in the source package (`BUILD.md`).
- **Page script:** `hook.js` is a content script in the page's main world (`world: "MAIN"`, Firefox 128+). It wraps CanvasRenderingContext2D drawing calls and `CSSStyleSheet.insertRule` so that canvas-rendered documents can be recolored. It never sends data anywhere and doesn't change document content.
- **Host permissions:**
  - docs.google.com / drive.google.com: where the add-on runs.
  - *.gstatic.com, *.googleusercontent.com, lh3.google.com: read Google's stylesheets and images (to recolor drawings and thumbnails).
  - github.com, api.github.com, raw.githubusercontent.com: download the color schemes the user chooses to import.
- **What it reads, and what it writes:**
  - In Docs, it reads the document's HTML export (a GET request) to learn the names of paragraph styles.
  - All requests are read-only GETs. Nothing is written to Google, and there's no remote code, analytics or tracking.
- **Storage:** IndexedDB in the extension origin, plus `unlimitedStorage` for imported schemes.
- **How to test:**
  1. Open any Google Doc, for example a public one, and click the toolbar button.
  2. Under Get themes, import Nord.
  3. Under Theme, click Nord.
  4. Turn off resets the page.
