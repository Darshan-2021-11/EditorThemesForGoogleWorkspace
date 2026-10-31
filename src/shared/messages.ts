import type { Scheme, StyleKey, ThemeOptions, ThemeSpec } from '../theme/types';

export interface GlobalSettings {
  id: 'global';
  /** Apply the default theme to every Google page without a remembered choice. */
  autoApply: boolean;
  defaultTheme: string | null;
  /** Most recently picked theme; used by the on/off shortcut. */
  lastTheme: string | null;
  /** Each app (Docs, Sheets, …, Drive) keeps its own theme; otherwise one theme covers them all. */
  separateApps: boolean;
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  id: 'global', autoApply: false, defaultTheme: null, lastTheme: null, separateApps: false,
};

/**
 * A record in the `pages` store. Two kinds share it:
 * - `suite:*` (every Google app) or `suite:<suite>` (one app, see suiteKey; used when
 *   separateApps is on): a theme choice (null = theme off). One theme covers UI and document.
 * - a pageKey (`document:<id>`, …): that document's own data (style colors). Records written
 *   before themes were per suite also carry a `theme`; it was adopted by the suite and is ignored.
 */
export interface PageSetting {
  key: string;
  theme?: string | null;
  updated: number;
  /** The document's named-style colors when last seen (raw Docs colors). */
  docStyles?: Partial<Record<StyleKey, string>>;
  /** Style colors the user changed in Docs, as theme values (slot or "#rrggbb"). */
  styleOverrides?: Partial<Record<StyleKey, string>>;
}

export interface PageState {
  key: string;
  /** What a theme choice here applies to: '*' (every Google app) or a suite (see suiteKey). */
  scope: string;
  /** Theme with this page's style overrides already merged into options.styleSlots. */
  theme: ThemeSpec | null;
  /** Which styles follow a color the user picked in the document. */
  styleOverrides: Partial<Record<StyleKey, string>>;
  /** False until the user has imported at least one scheme. */
  hasSchemes: boolean;
}

export interface SchemeOptionsRecord extends ThemeOptions {
  id: string;
}

export interface BackupFile {
  format: 'workspace-dark-backup';
  version: 1;
  exportedAt: string;
  schemes: Scheme[];
  options: SchemeOptionsRecord[];
  pages: PageSetting[];
  settings: GlobalSettings;
}

/** content/panel → background */
export type Request =
  | { type: 'getPageState' }
  | { type: 'setPageTheme'; theme: string | null }
  | { type: 'togglePage' }
  | { type: 'listSchemes' }
  | { type: 'importSchemes'; url: string }
  | { type: 'deleteScheme'; id: string }
  | { type: 'saveCustomScheme'; scheme: Scheme }
  | { type: 'getOptions'; id: string }
  | { type: 'setOptions'; id: string; options: ThemeOptions }
  | { type: 'getSettings' }
  | { type: 'setSettings'; patch: Partial<Omit<GlobalSettings, 'id'>> }
  | { type: 'exportBackup' }
  | { type: 'importBackup'; data: BackupFile }
  | { type: 'fetchText'; url: string }
  | { type: 'fetchImage'; url: string }
  | { type: 'docStyleColors'; colors: Partial<Record<StyleKey, string>> }
  | { type: 'setStyleSlot'; style: StyleKey; value: string }
  | { type: 'resetStyleColors' }
  | { type: 'resetStyleOverrides' };

export interface ResponseMap {
  getPageState: PageState;
  setPageTheme: PageState;
  togglePage: PageState;
  listSchemes: Scheme[];
  importSchemes: { imported: number; names: string[] };
  deleteScheme: void;
  saveCustomScheme: Scheme;
  getOptions: ThemeOptions;
  setOptions: void;
  getSettings: GlobalSettings;
  setSettings: GlobalSettings;
  exportBackup: BackupFile;
  importBackup: { schemes: number; pages: number };
  fetchText: string | null;
  fetchImage: ArrayBuffer | null;
  docStyleColors: void;
  setStyleSlot: void;
  resetStyleColors: void;
  resetStyleOverrides: void;
}

/** background → content (all frames of a tab) */
export type Push =
  | { type: 'applyState'; state: PageState }
  | { type: 'togglePanel'; tab?: PanelTab }
  | { type: 'importProgress'; done: number; total: number }
  | { type: 'schemesChanged' };

export type PanelTab = 'theme' | 'library' | 'custom' | 'settings';

export async function send<T extends Request>(req: T): Promise<ResponseMap[T['type']]> {
  const res = await browser.runtime.sendMessage(req);
  if (res && typeof res === 'object' && '__error' in res) throw new Error(String((res as { __error: string }).__error));
  return res as ResponseMap[T['type']];
}
