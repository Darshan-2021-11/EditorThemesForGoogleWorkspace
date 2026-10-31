// Dev helper: opens a public Doc with the dev build, applies a theme, then evaluates a JS file
// in the page and prints the JSON result.
// Usage: node scripts/debug-page.mjs <probe.js> [theme] [docUrl]
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const [probeFile, theme = 'base16-nord', DOC ='https://docs.google.com/document/d/1hNOLvYKQunyFF6_AzefwtO7Si_8F0uLHOnL1yRL2fAY/edit'] = process.argv.slice(2);
const probe = await readFile(probeFile, 'utf8');

if (!process.env.NO_BUILD) {
  execSync('node scripts/build.mjs', { stdio: 'inherit', env: { ...process.env, WD_DEV: '1' } });
  execSync('npx web-ext build --source-dir dist --artifacts-dir artifacts --filename wd-dev.zip --overwrite-dest', { stdio: 'ignore' });
}
const opts = new firefox.Options().windowSize({ width: 1400, height: 950 }).addArguments('-headless');
// PROFILE=<dir>: run with a copy of a signed-in profile (e.g. the dev profile) to inspect edit mode.
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
  await driver.installAddon('artifacts/wd-dev.zip', true);
  await driver.manage().setTimeouts({ script: 120000 });
  await driver.get(process.env.SET_ON || DOC);
  const editor = /\/document\/(u\/\d+\/)?d\//.test(DOC);
  if (editor) await driver.wait(until.elementLocated(By.css('.kix-appview-editor')), 30000);
  await driver.sleep(editor ? 3000 : 8000);
  const TT = 'https://github.com/tinted-theming/schemes/blob/spec-0.11';
  if (theme !== 'null') {
    const [sys, ...name] = theme.split('-');
    await bridge({ wdTest: 'import', url: `${TT}/${sys}/${name.join('-')}.yaml` });
  }
  await bridge({ wdTest: 'set', theme: theme === 'null' ? null : theme });
  await driver.sleep(2500);
  // SET_ON=<url>: the theme was picked on another page; open DOC without picking (shared theme check).
  if (process.env.SET_ON) {
    await driver.get(DOC);
    await driver.sleep(8000);
  }
  // RELOAD=1: reload so the remembered theme applies from first paint.
  if (process.env.RELOAD) {
    await driver.navigate().refresh();
    await driver.sleep(8000);
  }
  // The probe may be async: it runs as `async () => { ... }` and its return value is printed.
  const result = await driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1]; (async () => { ${probe} })().then(done, (e) => done({ probeError: String(e) }));`,
  );
  console.log(JSON.stringify(result, null, 1));
  await mkdir('artifacts/visual', { recursive: true });
  await writeFile('artifacts/visual/debug.png', await driver.takeScreenshot(), 'base64');
} finally {
  await driver.quit();
}
