# Contributing

Thanks for helping improve Editor Themes for Google Workspace. Bug reports, theme requests and suggestions are all welcome.

## Before you start: licensing

This project is **not open source**. The code is copyright (c) 2026 darsh, all rights reserved (see [LICENSE](LICENSE)). You can read it, but you may not copy, redistribute or publish it, or work based on it, outside this repository.

If you open a pull request or otherwise submit code, text, images or other material ("your contribution"), you agree that:

- you wrote it yourself, or have the right to submit it;
- you grant darsh a perpetual, worldwide, royalty-free, irrevocable license to use, modify, distribute and relicense your contribution as part of this project or any product built from it, including the published add-on;
- your contribution is provided "as is", without warranty.

Without this, contributions can't be shipped in the add-on. If you don't agree, please open an issue describing the change instead.

## Reporting a bug

Open an issue and include:

- Firefox version and operating system;
- the add-on version (about:addons → Editor Themes for Google Workspace);
- the Google app and page (Docs, Sheets, Slides, Forms, Drive, or a home screen);
- the theme you used, and whether "Color text by paragraph style" or "Recolor drawings" was on;
- what you expected and what happened, ideally with a screenshot.

**Don't post private content.** Remove personal information and document text from screenshots, and never share links to private documents. A public sample document that shows the problem is the most useful thing you can provide.

## Requesting a theme or feature

Themes aren't bundled. Any Base16 or Base24 scheme on GitHub can be imported from the panel (Get themes → paste a link). If a scheme imports but looks wrong, open an issue with the link to the scheme.

For features, describe the problem you want solved before the solution you have in mind.

## Development

Requirements: Node.js 20 or newer, and Firefox 128 or newer.

```sh
npm ci
npm run dev        # rebuilds on change and opens Firefox with the add-on
```

`npm run dev` uses a persistent profile in `.web-ext-profile/`, so you only sign in to Google once. That folder holds your login cookies: it's ignored by git, and you should never commit or share it.

Before opening a pull request, run:

```sh
npm test           # unit tests
npm run typecheck  # TypeScript
npm run build && npm run lint:ext   # Mozilla's add-on linter on dist/
```

For changes that affect colors or contrast, also run the contrast audit. It must not report new failures:

```sh
node scripts/contrast-audit.mjs public
```

See the README for the other dev scripts (visual tests and the page probe).

### Ground rules for changes

- **Never write to Google.** The add-on may only read: pages, stylesheets, images, and a document's HTML export. No requests that modify documents, Drive or account settings.
- **Keep it local.** No analytics, tracking or remote code. Settings stay in the browser (IndexedDB).
- **Keep text readable.** Text must meet WCAG AA contrast (4.5:1, or 3:1 for large text). Fix contrast by changing lightness, not by dropping the theme's colors.
- **Keep it fast.** No heavy work per frame or per keystroke. Cache per color or per theme, and leave photos alone.
- **Match the existing code**: naming, comment style, and small focused functions with tests for pure logic.

### Commits and pull requests

- One topic per pull request, with a clear description of what changed and why.
- Write commit messages that say what changed and why; the history is used to explain design decisions.
- Include before/after screenshots for visual changes, using public or sample content only.

## Security

If you find a security or privacy problem, don't open a public issue. Contact the maintainer privately, using the support email on the add-on's page at addons.mozilla.org.
