// Screenshots public Sheets / Slides / Forms pages, default vs themed (dev build).
// Usage: node scripts/smoke-apps.mjs   → artifacts/visual/app-*.png
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const PAGES = {
  sheets: 'https://docs.google.com/spreadsheets/d/1hPlpOA8lh-lyDEeGZFMMtyO5wyJ6No-ZHcI11sdCo2Y/edit',
  slides: 'https://docs.google.com/presentation/d/14i-LT-dh-H1iA7wZqxISekdU8ftG2bB8hlu52fd2UpA/edit',
  forms: 'https://docs.google.com/forms/d/e/1FAIpQLSe0CyA8X_wNkLGHZbWWwCA1HUVPSMONT6Bh531uaMuPJP_ojQ/viewform',
};
const OUT = 'artifacts/visual';
const only = process.argv[2];

if (!process.env.NO_BUILD) {
  execSync('node scripts/build.mjs', { stdio: 'inherit', env: { ...process.env, WD_DEV: '1' } });
  execSync('npx web-ext build --source-dir dist --artifacts-dir artifacts --filename wd-dev.zip --overwrite-dest', { stdio: 'ignore' });
}
await mkdir(OUT, { recursive: true });
const driver = await new Builder()
  .forBrowser('firefox')
  .setFirefoxOptions(new firefox.Options().windowSize({ width: 1400, height: 950 }).addArguments('-headless'))
  .build();
let seq = 0;
const bridge = (cmd) =>
  driver.executeAsyncScript((cmd, id, done) => {
    const on = (e) => { if (e.data?.wdTestResult === id) { window.removeEventListener('message', on); done(e.data.result); } };
    window.addEventListener('message', on);
    window.postMessage({ ...cmd, id }, '*');
  }, cmd, ++seq);
const shot = async (name) => writeFile(`${OUT}/${name}.png`, await driver.takeScreenshot(), 'base64');

try {
  await driver.installAddon('artifacts/wd-dev.zip', true);
  await driver.manage().setTimeouts({ script: 120000 });
  let imported = false;
  for (const [app, url] of Object.entries(PAGES)) {
    if (only && only !== app) continue;
    await driver.get(url);
    await driver.sleep(7000);
    await shot(`app-${app}-0-default`);
    if (!imported) {
      await bridge({ wdTest: 'import', url: 'https://github.com/tinted-theming/schemes/blob/spec-0.11/base16/gruvbox-dark.yaml' });
      imported = true;
    }
    await bridge({ wdTest: 'set', theme: 'base16-gruvbox-dark' });
    await driver.sleep(3000);
    await shot(`app-${app}-1-gruvbox`);
    // the choice is remembered for this page: reload to see first-paint theming
    await driver.navigate().refresh();
    await driver.sleep(8000);
    await shot(`app-${app}-2-reloaded`);
    console.log('done', app);
  }
} finally {
  await driver.quit();
}
