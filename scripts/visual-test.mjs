// Loads the dev build into Firefox (via Selenium), opens a public Google Doc and screenshots it
// with several UI/document theme combinations.
// Usage: node scripts/visual-test.mjs [docUrl]   → screenshots in artifacts/visual/
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const DOC = process.argv[2] ?? 'https://docs.google.com/document/d/1hNOLvYKQunyFF6_AzefwtO7Si_8F0uLHOnL1yRL2fAY/edit';
const OUT = 'artifacts/visual';
const TT = 'https://github.com/tinted-theming/schemes/blob/spec-0.11';

execSync('node scripts/build.mjs', { stdio: 'inherit', env: { ...process.env, WD_DEV: '1' } });
execSync('npx web-ext build --source-dir dist --artifacts-dir artifacts --filename wd-dev.zip --overwrite-dest', { stdio: 'inherit' });
await mkdir(OUT, { recursive: true });

const opts = new firefox.Options().windowSize({ width: 1400, height: 950 });
if (!process.env.HEADED) opts.addArguments('-headless');
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();

let seq = 0;
async function bridge(cmd) {
  return driver.executeAsyncScript(
    (cmd, id, done) => {
      const on = (e) => {
        if (e.data?.wdTestResult !== id) return;
        window.removeEventListener('message', on);
        done(e.data.result);
      };
      window.addEventListener('message', on);
      window.postMessage({ ...cmd, id }, '*');
    },
    cmd,
    ++seq,
  );
}

async function shot(name, settle = 2500) {
  await driver.sleep(settle);
  await writeFile(`${OUT}/${name}.png`, await driver.takeScreenshot(), 'base64');
  console.log('screenshot', name);
}

try {
  await driver.installAddon('artifacts/wd-dev.zip', true);
  await driver.manage().setTimeouts({ script: 120000 });
  await driver.get(DOC);
  await driver.wait(until.elementLocated(By.css('.kix-appview-editor')), 30000);
  await shot('0-default', 4000);

  for (const f of ['base16/nord.yaml', 'base16/monokai.yaml', 'base16/solarized-light.yaml', 'base24/one-dark.yaml']) {
    console.log('import', f, JSON.stringify(await bridge({ wdTest: 'import', url: `${TT}/${f}` })));
  }
  console.log('import dracula', JSON.stringify(await bridge({ wdTest: 'import', url: 'https://github.com/dracula/base16-dracula-scheme/blob/master/dracula.yaml' })));

  const combos = [
    ['1-nord-nord', 'base16-nord', 'base16-nord'],
    ['2-nord-ui-default-doc', 'base16-nord', null],
    ['3-monokai-monokai', 'base16-monokai', 'base16-monokai'],
    ['4-onedark-ui-solarized-light-doc', 'base24-one-dark', 'base16-solarized-light'],
    ['5-dracula-dracula', 'base16-dracula', 'base16-dracula'],
  ];
  for (const [name, ui, doc] of combos) {
    await bridge({ wdTest: 'set', ui, doc });
    await shot(name);
  }

  await bridge({ wdTest: 'set', ui: 'base16-nord', doc: 'base16-nord' });
  await bridge({ wdTest: 'panel', tab: 'ui' });
  await shot('6-panel-ui', 1500);
  await bridge({ wdTest: 'panel', tab: 'library' });
  await shot('7-panel-library', 1000);

  // open a menu to check menus/dropdowns
  await driver.executeScript(() => document.querySelector('#wd-panel-host')?.remove());
  const fileMenu = await driver.findElements(By.css('#docs-file-menu'));
  if (fileMenu.length) {
    await fileMenu[0].click();
    await shot('8-file-menu', 1000);
  }

  // Print: let Docs run its own print preparation (window.print stubbed so no dialog opens),
  // then print the page to PDF with backgrounds OFF (the browser default) to prove the theme survives.
  await driver.executeScript(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await bridge({ wdTest: 'set', ui: 'base16-nord', doc: 'base16-solarized-light' });
  await driver.sleep(2000);
  await driver.executeAsyncScript((done) => {
    window.print = () => done(true);
    const t = document.querySelector('.docs-texteventtarget-iframe')?.contentDocument?.activeElement || document.body;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', keyCode: 80, which: 80, ctrlKey: true, bubbles: true, cancelable: true }));
    setTimeout(() => done(false), 20000);
  });
  const pdf = await driver.printPage({ background: false, pageRanges: ['1-2'] });
  await writeFile(`${OUT}/print-solarized-light-doc.pdf`, pdf, 'base64');
  console.log('printed', `${OUT}/print-solarized-light-doc.pdf`);

  await bridge({ wdTest: 'set', ui: null, doc: null });
  await shot('9-reverted');
  console.log('done →', OUT);
} finally {
  await driver.quit();
}
