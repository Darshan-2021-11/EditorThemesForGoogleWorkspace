// Pure migrations of stored records (no IndexedDB access, so they can be unit-tested).
import type { PageSetting } from '../shared/messages';
import { ALL_APPS, suiteOfPageKey } from '../shared/page';

const SCOPE_PREFIX = 'suite:';

/** The `pages` store key a scope's theme is kept under: ALL_APPS or a suite (see suiteKey). */
export function themeRecordKey(scope: string): string {
  return SCOPE_PREFIX + scope;
}

export function isThemeRecord(key: string): boolean {
  return key.startsWith(SCOPE_PREFIX);
}

/**
 * Themes used to be remembered per document (and per app home list). The all-apps theme adopts
 * the most recently updated such choice, and each suite adopts its own latest one (used once
 * "Separate theme per app" is on) — an explicit "off" counts too. Returns only the theme records
 * to write; per-document records (and their style colors) are left as they are.
 *
 * Idempotent: an adopted record carries the source's `updated`, so it is only replaced when a
 * newer per-document theme turns up (e.g. restored from an old backup).
 */
export function migrateThemes(pages: Iterable<PageSetting>): PageSetting[] {
  const all = [...pages];
  const latest = new Map<string, PageSetting>();
  const consider = (scope: string, p: PageSetting) => {
    const prev = latest.get(scope);
    if (!prev || p.updated > prev.updated) latest.set(scope, p);
  };
  for (const p of all) {
    if (isThemeRecord(p.key) || p.theme === undefined) continue;
    consider(ALL_APPS, p);
    consider(suiteOfPageKey(p.key), p);
  }
  const out: PageSetting[] = [];
  for (const [scope, p] of latest) {
    const key = themeRecordKey(scope);
    const existing = all.find((r) => r.key === key);
    if (existing && existing.updated >= p.updated) continue;
    out.push({ key, theme: p.theme ?? null, updated: p.updated });
  }
  return out;
}
