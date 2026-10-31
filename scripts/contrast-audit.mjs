// Dev tool: WCAG contrast audit of themed Google apps (DOM text, Slides SVG text, canvas text).
// Usage: node scripts/contrast-audit.mjs [set]   set = public (default) | private (needs PROFILE=<dir>)
// Env: NO_BUILD=1 to reuse the last dev build, THEMES=base16-nord,... to override the theme list.
// Writes artifacts/audit/<set>.json and prints a summary.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const SETS = {
  public: {
    docs: 'https://docs.google.com/document/d/1hNOLvYKQunyFF6_AzefwtO7Si_8F0uLHOnL1yRL2fAY/edit',
    sheets: 'https://docs.google.com/spreadsheets/d/1hPlpOA8lh-lyDEeGZFMMtyO5wyJ6No-ZHcI11sdCo2Y/edit',
    slides: 'https://docs.google.com/presentation/d/14i-LT-dh-H1iA7wZqxISekdU8ftG2bB8hlu52fd2UpA/edit',
    forms: 'https://docs.google.com/forms/d/e/1FAIpQLSe0CyA8X_wNkLGHZbWWwCA1HUVPSMONT6Bh531uaMuPJP_ojQ/viewform',
  },
  private: {
    drive: 'https://drive.google.com/drive/my-drive',
    'docs-home': 'https://docs.google.com/document/u/0/',
    'sheets-home': 'https://docs.google.com/spreadsheets/u/0/',
    'docs-edit': 'https://docs.google.com/document/d/1QADf-XWCy1MjDGcK20oxPnK1Y6wvtpQntjybXBg4nSk/edit',
    'sheets-edit': 'https://docs.google.com/spreadsheets/d/1zJBmoxE33SaEGSu2uQzrcAHAH7go_tyjeldGhGRyT5I/edit',
  },
};
const THEMES = (process.env.THEMES ?? 'base16-gruvbox-dark,base16-nord,base16-dracula,base16-solarized-light,base16-github').split(',');
const TT = 'https://github.com/tinted-theming/schemes/blob/spec-0.11';
const set = process.argv[2] ?? 'public';

// Runs in the page: collects text whose contrast is below WCAG AA.
const PAGE_AUDIT = String.raw`
const done = arguments[arguments.length - 1];
(async () => {
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const root = parse(getComputedStyle(document.body).backgroundColor);
  const pageBg = root && root.a > 0 ? root : { r: 255, g: 255, b: 255, a: 1 };
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const fails = [];
  const record = (el, kind, fg, bg, text, px, bold) => {
    const r = ratio(fg, bg);
    const large = px >= 24 || (bold && px >= 18.66);
    const need = large ? 3 : 4.5;
    if (r < need) fails.push({ kind, sel: desc(el), path: [el.parentElement, el.parentElement?.parentElement].filter(Boolean).map(desc).join(' < '), text: text.slice(0, 40), fg: hex(fg), bg: hex(bg), ratio: Math.round(r * 100) / 100, need, px: Math.round(px) });
  };
  // effective background: composite ancestor backgrounds; unknown when an image/gradient is in between
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let bg = pageBg;
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  };
  const host = document.getElementById('wd-panel-host');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim() || (host && host.contains(el))) continue;
    seen.add(el);
    if (el.closest('svg')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    let hidden = false;
    for (let e = el; e; e = e.parentElement) if (+getComputedStyle(e).opacity === 0) { hidden = true; break; }
    if (hidden) continue;
    // WCAG exempts disabled controls
    if (el.closest('[aria-disabled="true"], [disabled], .goog-control-disabled, .goog-menuitem-disabled')) continue;
    const fg = parse(cs.color);
    const bg = bgOf(el);
    if (!fg || !bg) continue;
    record(el, 'dom', over(fg, bg), bg, n.textContent.trim(), parseFloat(cs.fontSize), +cs.fontWeight >= 600);
  }
  // SVG text (Slides): the shape right under the text's centre
  for (const t of document.querySelectorAll('svg text')) {
    const r = t.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const fg = parse(getComputedStyle(t).fill);
    if (!fg) continue;
    const stack = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    let bg = null;
    for (const e of stack) {
      if (e === t || t.contains(e) || e.closest('text')) continue;
      if (e.tagName === 'image') { bg = null; break; }
      if (e instanceof SVGGeometryElement) { const f = parse(getComputedStyle(e).fill); if (f && f.a > 0) { bg = over(f, pageBg); break; } }
      if (!(e instanceof SVGElement)) { bg = bgOf(e); break; }
    }
    if (!bg) continue;
    record(t, 'svg', fg, bg, t.textContent.trim(), r.height * 0.75, +getComputedStyle(t).fontWeight >= 600);
  }
  // canvas text recorded by the hook
  const d = window.__wdHookDebug;
  const canvasBg = (() => { const p = document.querySelector('.kix-page-paginated, #waffle-grid-container'); const c = p && parse(getComputedStyle(p).backgroundColor); return c && c.a > 0 ? c : pageBg; })();
  for (const a of d?.audit ?? []) {
    const fg = parse(a.fg.startsWith('#') ? 'rgb(' + [1, 3, 5].map((i) => parseInt(a.fg.slice(i, i + 2), 16)).join(',') + ')' : a.fg);
    const bg = a.bg === 'transparent' ? canvasBg : parse('rgb(' + [1, 3, 5].map((i) => parseInt(a.bg.slice(i, i + 2), 16)).join(',') + ')');
    if (!fg || !bg) continue;
    const el = { tagName: 'CANVAS', id: '', className: '', parentElement: null };
    record(el, 'canvas', over(fg, bg), bg, a.text, a.px, a.bold);
  }
  return { fails, checked: seen.size, canvas: d?.audit?.length ?? 0 };
})().then(done, (e) => done({ error: String(e) }));
`;

if (!process.env.NO_BUILD) {
  execSync('node scripts/build.mjs', { stdio: 'inherit', env: { ...process.env, WD_DEV: '1' } });
  execSync('npx web-ext build --source-dir dist --artifacts-dir artifacts --filename wd-dev.zip --overwrite-dest', { stdio: 'ignore' });
}
const opts = new firefox.Options().windowSize({ width: 1400, height: 950 }).addArguments('-headless');
if (process.env.PROFILE) opts.setProfile(process.env.PROFILE);
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();
let seq = 0;
const bridge = (cmd) =>
  driver.executeAsyncScript((cmd, id, done) => {
    const on = (e) => { if (e.data?.wdTestResult === id) { window.removeEventListener('message', on); done(e.data.result); } };
    window.addEventListener('message', on);
    window.postMessage({ ...cmd, id }, '*');
  }, cmd, ++seq);

const results = {};
try {
  await driver.installAddon('artifacts/wd-dev.zip', true);
  await driver.manage().setTimeouts({ script: 120000 });
  let imported = false;
  for (const [app, url] of Object.entries(SETS[set])) {
    await driver.get(url);
    await driver.sleep(7000);
    if (!imported) {
      for (const t of THEMES) {
        const [sys, ...name] = t.split('-');
        await bridge({ wdTest: 'import', url: `${TT}/${sys}/${name.join('-')}.yaml` });
      }
      imported = true;
    }
    for (const theme of THEMES) {
      await bridge({ wdTest: 'set', theme });
      await driver.sleep(2500);
      // canvas audit: record while the app repaints with this theme
      await driver.executeScript('const d = window.__wdHookDebug; if (d) { d.audit = []; d.repaint(); }');
      await driver.sleep(2500);
      const r = await driver.executeAsyncScript(PAGE_AUDIT);
      results[`${app}/${theme}`] = r;
      const byPair = {};
      for (const f of r.fails ?? []) {
        const k = `${f.kind} ${f.fg} on ${f.bg} (${f.ratio}<${f.need})`;
        (byPair[k] ??= { n: 0, ex: `${f.sel} "${f.text}"` }).n++;
      }
      const top = Object.entries(byPair).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
      console.log(`\n${app} / ${theme}: ${r.fails?.length ?? r.error} failing of ${r.checked} DOM + ${r.canvas} canvas`);
      for (const [k, v] of top) console.log(`  ${v.n}× ${k}  e.g. ${v.ex}`);
    }
    await bridge({ wdTest: 'set', theme: null });
  }
} finally {
  await mkdir('artifacts/audit', { recursive: true });
  await writeFile(`artifacts/audit/${set}.json`, JSON.stringify(results, null, 1));
  await driver.quit();
}
