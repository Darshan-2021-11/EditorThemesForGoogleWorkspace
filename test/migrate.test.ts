import { describe, expect, it } from 'vitest';
import type { PageSetting } from '../src/shared/messages';
import { migrateThemes, themeRecordKey } from '../src/storage/migrate';

const byKey = (recs: PageSetting[]) => Object.fromEntries(recs.map((r) => [r.key, r]));

describe('migrateThemes', () => {
  const legacy: PageSetting[] = [
    { key: 'document:aaaaaaaaaaaa', theme: 'dracula', updated: 10, docStyles: { title: '#000000' } },
    { key: 'document:home', theme: 'nord', updated: 30 },
    { key: 'document:bbbbbbbbbbbb', theme: null, updated: 40 },
    { key: 'spreadsheets:cccccccccccc', theme: 'gruvbox', updated: 20 },
    { key: 'drive', theme: 'nord', updated: 5 },
    // a document record with style data only (written after the change): not a theme choice
    { key: 'presentation:dddddddddddd', updated: 99, styleOverrides: { title: 'base08' } },
  ];

  it('adopts the latest choice for all apps and for each suite, including "off"', () => {
    const out = byKey(migrateThemes(legacy));
    expect(out[themeRecordKey('*')]).toEqual({ key: 'suite:*', theme: null, updated: 40 });
    expect(out['suite:docs']).toEqual({ key: 'suite:docs', theme: null, updated: 40 });
    expect(out['suite:sheets']).toEqual({ key: 'suite:sheets', theme: 'gruvbox', updated: 20 });
    expect(out['suite:drive']).toEqual({ key: 'suite:drive', theme: 'nord', updated: 5 });
    expect(out['suite:slides']).toBeUndefined();
    expect(Object.keys(out)).toHaveLength(4);
  });

  it('only returns theme records (document data stays where it is)', () => {
    for (const r of migrateThemes(legacy)) expect(r.key.startsWith('suite:')).toBe(true);
  });

  it('is idempotent', () => {
    const once = [...legacy, ...migrateThemes(legacy)];
    expect(migrateThemes(once)).toEqual([]);
  });

  it('keeps a newer stored choice, but adopts a newer legacy one (old backup restored)', () => {
    const newer: PageSetting[] = [...legacy, { key: 'suite:docs', theme: 'solarized', updated: 100 }];
    expect(byKey(migrateThemes(newer))['suite:docs']).toBeUndefined();
    const older: PageSetting[] = [...legacy, { key: 'suite:docs', theme: 'solarized', updated: 1 }];
    expect(byKey(migrateThemes(older))['suite:docs']?.theme).toBeNull();
  });

  it('does nothing without legacy choices', () => {
    expect(migrateThemes([])).toEqual([]);
    expect(migrateThemes([{ key: 'suite:*', theme: 'nord', updated: 1 }])).toEqual([]);
  });
});
