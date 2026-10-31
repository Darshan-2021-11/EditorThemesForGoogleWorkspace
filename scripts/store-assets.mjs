// Store assets for addons.mozilla.org: icon PNGs (rendered from src/icon.svg by Firefox itself,
// with transparency) and 1280×800 screenshots, one per suite, each in a different theme.
// Usage: PROFILE=<copy of a signed-in profile> node scripts/store-assets.mjs
//   → store/icons/, store/screenshots/
// The signed-in pages are the user's own copies of Google templates (no personal content); the
// account avatar is hidden. Uses a dev build (test bridge); run `npm run package` afterwards.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const TT = 'https://github.com/tinted-theming/schemes/blob/spec-0.11/base16';
// `url`, or `home`: the app's home list, opening its first recent file (the user's template copy).
const SHOTS = [
  { name: '1-sheets-nord-panel', theme: 'nord', url: 'https://docs.google.com/spreadsheets/d/1zJBmoxE33SaEGSu2uQzrcAHAH7go_tyjeldGhGRyT5I/edit', panel: true },
  { name: '3-slides-catppuccin', theme: 'catppuccin-mocha', home: 'https://docs.google.com/presentation/u/0/' },
  { name: '4-docs-home-gruvbox', theme: 'gruvbox-dark', url: 'https://docs.google.com/document/u/0/' },
  { name: '5-forms-tokyo-night', theme: 'tokyo-night-dark', url: 'https://docs.google.com/forms/d/e/1FAIpQLSe0CyA8X_wNkLGHZbWWwCA1HUVPSMONT6Bh531uaMuPJP_ojQ/viewform' },
];
// Keep the user's account out of the shots (avatar, Forms' "signed in as" row), and hide clutter:
// dialogs such as "File is in the bin" and the Docs outline (test headings).
const TIDY = `
  const s = document.createElement('style');
  s.textContent = '[aria-label^="Google Account"], a[href*="accounts.google.com/SignOutOptions"] { visibility: hidden !important; }' +
    '';
  document.documentElement.append(s);
  for (const a of document.querySelectorAll('a, span, div')) {
    if (a.childElementCount || !/^Switch accounts?$/.test(a.textContent.trim())) continue;
    let row = a;
    for (let i = 0; i < 6 && row && !/Not shared|@/.test(row.textContent.replace(a.textContent, '')); i++) row = row.parentElement;
    for (let i = 0; i < 6 && row && !row.textContent.includes('Not shared'); i++) row = row.parentElement;
    if (row) row.style.display = 'none';
  }
`;
const ICON_SIZES = [16, 32, 48, 64, 96, 128, 256];

execSync('node scripts/build.mjs', { stdio: 'inherit', env: { ...process.env, WD_DEV: '1' } });
execSync('npx web-ext build --source-dir dist --artifacts-dir artifacts --filename wd-dev.zip --overwrite-dest', { stdio: 'ignore' });
await mkdir('store/icons', { recursive: true });
await mkdir('store/screenshots', { recursive: true });

// 1280×800 viewport (the headless window adds no chrome to screenshots, but keep the size explicit)
const opts = new firefox.Options().windowSize({ width: 1280, height: 885 }).addArguments('-headless');
if (process.env.PROFILE) opts.setProfile(process.env.PROFILE);
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();
let seq = 0;
const bridge = (cmd) =>
  driver.executeAsyncScript((cmd, id, done) => {
    const on = (e) => { if (e.data?.wdTestResult === id) { window.removeEventListener('message', on); done(e.data.result); } };
    window.addEventListener('message', on);
    window.postMessage({ ...cmd, id }, '*');
  }, cmd, ++seq);

try {
  // Icons: Firefox rasterizes the SVG onto a canvas at each size (keeps the transparent corners).
  const svg = await readFile('src/icon.svg', 'utf8');
  await driver.get('about:blank');
  const pngs = await driver.executeAsyncScript((svg, sizes, done) => {
    const img = new Image();
    img.onload = () => done(sizes.map((s) => {
      const c = document.createElement('canvas');
      c.width = c.height = s;
      c.getContext('2d').drawImage(img, 0, 0, s, s);
      return c.toDataURL('image/png');
    }));
    img.src = 'data:image/svg+xml;base64,' + btoa(svg);
  }, svg, ICON_SIZES);
  for (const [i, s] of ICON_SIZES.entries()) await writeFile(`store/icons/icon-${s}.png`, pngs[i].split(',')[1], 'base64');

  await driver.installAddon('artifacts/wd-dev.zip', true);
  await driver.manage().setTimeouts({ script: 120000 });
  let imported = false;
  for (const s of SHOTS) {
    if (process.env.ONLY && !process.env.ONLY.split(',').some((o) => s.name.includes(o))) continue;
    let url = s.url;
    if (s.home) {
      await driver.get(s.home);
      await driver.sleep(6000);
      // open the first recent file the way a user would; its URL is the editor
      const opened = await driver.executeScript(`const c = document.querySelector('.docs-homescreen-grid-item'); if (c) c.click(); return !!c;`);
      if (!opened) { console.log('skip', s.name, '(no recent file)'); continue; }
      await driver.sleep(4000);
      url = (await driver.getCurrentUrl()).replace(/[?#].*$/, '');
    }
    await driver.get(url);
    await driver.sleep(8000);
    if (!imported) {
      for (const t of new Set(SHOTS.map((x) => x.theme))) await bridge({ wdTest: 'import', url: `${TT}/${t}.yaml` });
      imported = true;
    }
    await bridge({ wdTest: 'set', theme: `base16-${s.theme}` });
    await driver.sleep(3500);
    if (s.panel) {
      await bridge({ wdTest: 'panel', tab: 'theme' });
      await driver.sleep(1500);
    }
    await driver.executeScript(TIDY);
    await driver.sleep(800);
    await writeFile(`store/screenshots/${s.name}.png`, await driver.takeScreenshot(), 'base64');
    console.log('shot', s.name);
  }
} finally {
  await driver.quit();
}
