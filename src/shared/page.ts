export type AppId = 'docs' | 'sheets' | 'slides' | 'forms' | 'drawings' | 'drive' | 'other';

const APP_BY_PATH: Record<string, AppId> = {
  document: 'docs', spreadsheets: 'sheets', presentation: 'slides', forms: 'forms', drawings: 'drawings',
};

/** Which Google app a URL belongs to. */
export function appOf(url: string): AppId {
  const u = new URL(url);
  if (u.hostname === 'drive.google.com') return 'drive';
  const seg = /^\/(document|spreadsheets|presentation|forms|drawings)\b/.exec(u.pathname)?.[1];
  return seg ? APP_BY_PATH[seg] : 'other';
}

const DOC_ID = /\/(document|spreadsheets|presentation|forms|drawings)\/(?:u\/\d+\/)?d\/(?:e\/)?([\w-]{10,})/;

/**
 * The key per-document data (the document's own style colors) is remembered under: one per
 * document/sheet/deck/form, one per app home list, one for Drive.
 */
export function pageKey(url: string): string {
  const u = new URL(url);
  const m = DOC_ID.exec(u.pathname);
  if (m) return `${m[1]}:${m[2]}`;
  if (u.hostname === 'drive.google.com') return 'drive';
  const app = /^\/(document|spreadsheets|presentation|forms|drawings)\b/.exec(u.pathname)?.[1];
  return app ? `${app}:home` : u.hostname;
}

/** Suites share one theme across their home list and every document; other hosts are keyed by hostname. */
export type SuiteKey = Exclude<AppId, 'other'> | (string & {});

/** The key the theme is remembered under: one per Google suite (Docs, Sheets, …, Drive). */
export function suiteKey(url: string): SuiteKey {
  const app = appOf(url);
  return app === 'other' ? new URL(url).hostname : app;
}

/** The suite a stored pageKey belongs to (for migrating per-document theme choices). */
export function suiteOfPageKey(key: string): SuiteKey {
  if (key === 'drive') return 'drive';
  const prefix = /^(document|spreadsheets|presentation|forms|drawings):/.exec(key)?.[1];
  return prefix ? APP_BY_PATH[prefix] : key;
}

/** True on an app's home list (e.g. /document/u/0/), false on a document itself or elsewhere. */
export function isHomePage(url: string): boolean {
  const u = new URL(url);
  if (u.hostname !== 'docs.google.com' || DOC_ID.test(u.pathname)) return false;
  return /^\/(document|spreadsheets|presentation|forms|drawings)(\/u\/\d+)?\/?$/.test(u.pathname);
}

export const SUITES = ['docs', 'sheets', 'slides', 'forms', 'drawings', 'drive'] as const;

const SUITE_NAMES: Record<string, string> = {
  docs: 'Docs', sheets: 'Sheets', slides: 'Slides', forms: 'Forms', drawings: 'Drawings', drive: 'Drive',
};

/** Display name for a suite key ("Docs"), or the hostname itself. */
export function suiteName(suite: SuiteKey): string {
  return SUITE_NAMES[suite] ?? suite;
}

/** Theme scope covering every Google app (when "Separate theme per app" is off). */
export const ALL_APPS = '*';

/** What a theme choice applies to, for the panel: "All Google apps" / "All of Docs". */
export function scopeName(scope: string): string {
  return scope === ALL_APPS ? 'All Google apps' : `All of ${suiteName(scope)}`;
}

export const GOOGLE_TAB_PATTERNS = ['https://docs.google.com/*', 'https://drive.google.com/*'];
