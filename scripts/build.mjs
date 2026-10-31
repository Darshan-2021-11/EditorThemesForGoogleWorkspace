// Builds each extension entry as a classic (IIFE) script into dist/.
// Flags: --watch (rebuild on change), --run (also launch Firefox via web-ext with live reload).
import { build } from 'vite';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
const watch = process.argv.includes('--watch');
const run = process.argv.includes('--run');
// Dev builds include a postMessage test bridge used by scripts/visual-test.mjs.
const dev = watch || process.env.WD_DEV === '1';
const BANNER = '/*! Editor Themes for Google Workspace. Copyright (c) 2026 darsh. All rights reserved. See LICENSE. */';

const entries = {
  background: 'src/background/index.ts',
  content: 'src/content/index.ts',
  hook: 'src/hook/index.ts',
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

async function copyStatic() {
  await cp(`${root}src/manifest.json`, `${dist}/manifest.json`);
  await cp(`${root}src/icon.svg`, `${dist}/icon.svg`);
  await cp(`${root}LICENSE`, `${dist}/LICENSE`);
}
await copyStatic();

for (const [name, entry] of Object.entries(entries)) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    define: { __WD_DEV__: JSON.stringify(dev) },
    build: {
      outDir: dist,
      emptyOutDir: false,
      minify: false,
      sourcemap: watch ? 'inline' : false,
      target: 'firefox128',
      watch: watch ? {} : null,
      lib: { entry: `${root}${entry}`, formats: ['iife'], name: `wd_${name}`, fileName: () => `${name}.js` },
      // the copyright notice travels with every copy of the built files
      rollupOptions: { output: { inlineDynamicImports: true, banner: BANNER } },
    },
  });
}
console.log(`Built ${Object.keys(entries).join(', ')} → dist/`);

if (run) {
  const { default: webExt } = await import('web-ext');
  await webExt.cmd.run(
    {
      sourceDir: dist,
      firefoxProfile: `${root}.web-ext-profile`,
      profileCreateIfMissing: true,
      keepProfileChanges: true,
      startUrl: ['https://docs.google.com/document/u/0/'],
    },
    { shouldExitProgram: false },
  );
}
