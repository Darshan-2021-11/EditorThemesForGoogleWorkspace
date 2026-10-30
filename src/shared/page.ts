export type AppId = 'docs' | 'sheets' | 'slides' | 'forms' | 'drive' | 'other';

const APP_BY_PATH: Record<string, AppId> = {
  document: 'docs', spreadsheets: 'sheets', presentation: 'slides', forms: 'forms',
};

/** Which Google app a URL belongs to. */
export function appOf(url: string): AppId {
  const u = new URL(url);
  if (u.hostname === 'drive.google.com') return 'drive';
  const seg = /^\/(document|spreadsheets|presentation|forms)\b/.exec(u.pathname)?.[1];
  return seg ? APP_BY_PATH[seg] : 'other';
}

/**
 * The key per-page theme choices are remembered under: one per document/sheet/deck/form,
 * one per app home list, one for Drive.
 */
export function pageKey(url: string): string {
  const u = new URL(url);
  const m = /\/(document|spreadsheets|presentation|forms|drawings)\/(?:u\/\d+\/)?d\/(?:e\/)?([\w-]{10,})/.exec(u.pathname);
  if (m) return `${m[1]}:${m[2]}`;
  if (u.hostname === 'drive.google.com') return 'drive';
  const app = /^\/(document|spreadsheets|presentation|forms)\b/.exec(u.pathname)?.[1];
  return app ? `${app}:home` : u.hostname;
}

export const GOOGLE_TAB_PATTERNS = ['https://docs.google.com/*', 'https://drive.google.com/*'];
