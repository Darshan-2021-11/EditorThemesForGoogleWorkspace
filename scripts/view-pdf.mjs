// Dev helper: screenshots a PDF via Firefox's built-in PDF viewer.
// Usage: node scripts/view-pdf.mjs <file.pdf> <out.png>
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [file, out] = process.argv.slice(2);
const driver = await new Builder()
  .forBrowser('firefox')
  .setFirefoxOptions(new firefox.Options().windowSize({ width: 1100, height: 1300 }).addArguments('-headless'))
  .build();
try {
  await driver.get(pathToFileURL(resolve(file)).href + '#zoom=page-fit');
  await driver.sleep(3000);
  await writeFile(out, await driver.takeScreenshot(), 'base64');
} finally {
  await driver.quit();
}
