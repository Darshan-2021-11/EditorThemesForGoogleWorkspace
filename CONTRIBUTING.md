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

For changes that affect colors or contrast, also run the contrast audit (see Testing). It must not report new failures.

## Testing

There are three layers. Only the first is needed for most changes.

### 1. Unit tests (no browser)

```sh
npm test
```

Vitest runs the pure logic: color math, theme mapping and contrast, scheme parsing, CSS remapping, picture recoloring, Slides text styles, and storage migration. Tests live in `test/`. Add tests there for any new pure function.

### 2. Browser tests on public pages (headless Firefox)

These open real Google pages in a headless Firefox with a dev build of the add-on and write their results to `artifacts/`. You need:

- Firefox installed in its default location.
- Nothing else: `selenium-webdriver` downloads the matching geckodriver on first run (Selenium Manager). That needs internet access, as do the tests themselves.

| Command | What it checks | Output |
|---|---|---|
| `npm run visual-test` | A public Doc with several themes: menus, panel, revert, and a themed print-to-PDF | `artifacts/visual/` |
| `node scripts/smoke-apps.mjs [sheets\|slides\|forms]` | Public Sheets, Slides and Forms pages: default, themed, and after reload | `artifacts/visual/app-*.png` |
| `node scripts/contrast-audit.mjs public` | WCAG contrast of every visible text against its real backdrop, across several themes | console summary, `artifacts/audit/public.json` |
| `node scripts/debug-page.mjs <probe.js> [theme] [url]` | Runs your own probe script inside a themed page and prints what it returns | console, `artifacts/visual/debug.png` |

These scripts build the dev version first. Dev builds include a small test bridge, compiled out of release builds, that lets scripts import and apply themes. Useful environment variables:

- `NO_BUILD=1` reuses the last dev build. Make one with `WD_DEV=1 npm run build` (PowerShell: `$env:WD_DEV='1'; npm run build`).
- `THEMES=base16-nord,base16-github` sets the themes for the audit.
- `APPS=docs,slides` limits the audit to some pages.
- `RELOAD=1` (debug-page) reloads so the theme applies from first paint.
- `SET_ON=<url>` (debug-page) picks the theme on one page, then opens another. This checks that one theme is shared across apps.

The public sample pages belong to other people. Use them for testing only, and don't put their content in screenshots you publish.

### 3. Browser tests on signed-in pages (optional)

Home screens, Drive and editing mode need a signed-in Google account. The scripts take a Firefox profile through `PROFILE=<dir>`:

1. Use a **test Google account**, not your personal one.
2. Run `npm run dev` once, sign in to that account in the Firefox window it opens, then close it. The login is now saved in `.web-ext-profile/`.
3. Copy that profile somewhere under `artifacts/` (the scripts can't use it while Firefox is running), skipping caches:
   - PowerShell: `robocopy .web-ext-profile artifacts\profile-copy /E /XF parent.lock lock /XD cache2 startupCache storage extensions`
   - macOS/Linux: `rsync -a --exclude={parent.lock,lock,cache2,startupCache,storage,extensions} .web-ext-profile/ artifacts/profile-copy/`
4. Run, for example, `PROFILE=artifacts/profile-copy node scripts/contrast-audit.mjs private` (PowerShell: `$env:PROFILE="$PWD\artifacts\profile-copy"`).
5. **Delete the copy afterwards.** It contains that account's login cookies.

Signed-in pages only ever get read. Like the add-on, the tests never write to the Google account.

### Manual testing in your own Firefox

- `npm run dev` gives you a live-reloading Firefox with the add-on.
- To try a release build: run `npm run package`, then go to `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** and pick the zip in `artifacts/`.

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
