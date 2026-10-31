// Store assets for addons.mozilla.org: icon PNGs (rendered from src/icon.svg by Firefox itself,
// with transparency) and 1280×800 screenshots of public sample pages with a few themes.
// Usage: node scripts/store-assets.mjs   → store/icons/, store/screenshots/
// Uses a dev build (for the test bridge); run `npm run package` afterwards for the release zip.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const TT = 'https://github.com/tinted-theming/schemes/blob/spec-0.11/base16';
const SHOTS = [
  { name: '1-docs-nord-panel', theme: 'nord', url: 'https://docs.google.com/document/d/1hNOLvYKQunyFF6_AzefwtO7Si_8F0uLHOnL1yRL2fAY/edit', panel: true },
  { name: '2-docs-solarized-light', theme: 'solarized-light', url: 'https://docs.google.com/document/d/1hNOLvYKQunyFF6_AzefwtO7Si_8F0uLHOnL1yRL2fAY/edit' },
  { name: '3-sheets-gruvbox', theme: 'gruvbox-dark', url: 'https://docs.google.com/spreadsheets/d/1hPlpOA8lh-lyDEeGZFMMtyO5wyJ6No-ZHcI11sdCo2Y/edit' },
  { name: '4-slides-catppuccin', theme: 'catppuccin-mocha', url: 'https://docs.google.com/presentation/d/14i-LT-dh-H1iA7wZqxISekdU8ftG2bB8hlu52fd2UpA/edit' },
  { name: '5-forms-tokyo-night', theme: 'tokyo-night-dark', url: 'https://docs.google.com/forms/d/e/1FAIpQLSe0CyA8X_wNkLGHZbWWwCA1HUVPSMONT6Bh531uaMuPJP_ojQ/viewform' },
];
const ICON_SIZES = [16, 32, 48, 64, 96, 128, 256];

execSync('node scripts/build.mjs', { stdio: 'inherit', env: { ...process.env, WD_DEV: '1' } });
execSync('npx web-ext build --source-dir dist --artifacts-dir artifacts --filename wd-dev.zip --overwrite-dest', { stdio: 'ignore' });
await mkdir('store/icons', { recursive: true });
await mkdir('store/screenshots', { recursive: true });

// 1280×800 viewport (the headless window adds no chrome to screenshots, but keep the size explicit)
const driver = await new Builder().forBrowser('firefox')
  .setFirefoxOptions(new firefox.Options().windowSize({ width: 1280, height: 885 }).addArguments('-headless')).build();
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
    await driver.get(s.url);
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
    await writeFile(`store/screenshots/${s.name}.png`, await driver.takeScreenshot(), 'base64');
    console.log('shot', s.name);
  }
} finally {
  await driver.quit();
}
