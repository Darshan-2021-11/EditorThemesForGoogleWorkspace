// Source package for AMO review: every committed file at HEAD (git archive), plus BUILD.md at the
// top level. Usage: node scripts/source-package.mjs   → artifacts/source-<version>.zip
// Commit first: uncommitted changes are not included.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const dirty = execSync('git status --porcelain -- src scripts package.json package-lock.json store').toString().trim();
if (dirty) console.warn(`warning: uncommitted changes are not in the package:\n${dirty}`);
const out = `artifacts/source-${version}.zip`;
execSync(`git archive --format=zip --add-file=store/BUILD.md -o ${out} HEAD`, { stdio: 'inherit' });
console.log(`source package: ${out}`);
