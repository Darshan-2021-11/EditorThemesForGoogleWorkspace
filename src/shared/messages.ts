import type { Scheme, ThemeOptions, ThemeSpec } from '../theme/types';

export interface GlobalSettings {
  id: 'global';
  /** Apply the default theme to every Google page without a remembered choice. */
  autoApply: boolean;
  defaultTheme: string | null;
  /** Most recently picked theme; used by the on/off shortcut. */
  lastTheme: string | null;
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  id: 'global', autoApply: false, defaultTheme: null, lastTheme: null,
};

/** Remembered theme choice for one page (null = theme off). One theme covers UI and document. */
export interface PageSetting {
  key: string;
  theme: string | null;
  updated: number;
}

export interface PageState {
  key: string;
  theme: ThemeSpec | null;
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
  | { type: 'fetchText'; url: string };

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
