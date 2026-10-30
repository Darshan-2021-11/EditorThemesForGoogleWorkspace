import { db, requestPersistence } from '../storage/db';
import {
  DEFAULT_SETTINGS, type BackupFile, type GlobalSettings, type PageSetting, type PageState, type Push,
  type Request, type ResponseMap, type SchemeOptionsRecord,
} from '../shared/messages';
import { GOOGLE_TAB_PATTERNS, pageKey } from '../shared/page';
import { importFromUrl, slugify } from '../theme/scheme-import';
import { DEFAULT_OPTIONS, type Scheme, type ThemeOptions, type ThemeSpec } from '../theme/types';

// ------------------------------------------------------------------------------------------
// In-memory cache over IndexedDB (rebuilt whenever the event page wakes up)

interface Cache {
  schemes: Map<string, Scheme>;
  options: Map<string, ThemeOptions>;
  pages: Map<string, PageSetting>;
  settings: GlobalSettings;
}

let cachePromise: Promise<Cache> | null = null;

function cache(): Promise<Cache> {
  cachePromise ??= (async () => {
    const [schemes, options, pages, settings] = await Promise.all([
      db.getAll<Scheme>('schemes'),
      db.getAll<SchemeOptionsRecord>('options'),
      db.getAll<PageSetting>('pages'),
      db.get<GlobalSettings>('settings', 'global'),
    ]);
    return {
      schemes: new Map(schemes.map((s) => [s.id, s])),
      options: new Map(options.map(({ id, ...o }) => [id, o])),
      pages: new Map(pages.map((p) => [p.key, p])),
      settings: { ...DEFAULT_SETTINGS, ...settings },
    };
  })();
  return cachePromise;
}

requestPersistence();

// ------------------------------------------------------------------------------------------
// Resolving what a page should show

function spec(c: Cache, id: string | null): ThemeSpec | null {
  const scheme = id ? c.schemes.get(id) : undefined;
  if (!scheme) return null;
  return { scheme, options: { ...DEFAULT_OPTIONS, ...c.options.get(scheme.id) } };
}

/** The scheme ids in effect for a page: remembered choice, else defaults when auto-apply is on. */
function effective(c: Cache, key: string): { ui: string | null; doc: string | null } {
  const p = c.pages.get(key);
  if (p) return { ui: p.ui, doc: p.doc };
  if (c.settings.autoApply) return { ui: c.settings.defaultUi, doc: c.settings.defaultDoc };
  return { ui: null, doc: null };
}

export async function resolvePage(url: string): Promise<PageState> {
  const c = await cache();
  const key = pageKey(url);
  const e = effective(c, key);
  return { key, ui: spec(c, e.ui), doc: spec(c, e.doc), hasSchemes: c.schemes.size > 0 };
}

async function savePage(key: string, ui: string | null, doc: string | null) {
  const c = await cache();
  const rec: PageSetting = { key, ui, doc, updated: Date.now() };
  c.pages.set(key, rec);
  await db.put('pages', rec);
}

async function saveSettings(patch: Partial<GlobalSettings>) {
  const c = await cache();
  c.settings = { ...c.settings, ...patch, id: 'global' };
  await db.put('settings', c.settings);
  return c.settings;
}

// ------------------------------------------------------------------------------------------
// Pushing state to tabs

async function googleTabs() {
  return browser.tabs.query({ url: GOOGLE_TAB_PATTERNS });
}

function push(tabId: number, msg: Push, frameId?: number) {
  return browser.tabs.sendMessage(tabId, msg, frameId === undefined ? undefined : { frameId }).catch(() => {});
}

/** Re-sends the resolved state to every open Google tab (optionally only those showing `key`). */
async function broadcastState(onlyKey?: string) {
  for (const tab of await googleTabs()) {
    if (tab.id === undefined || !tab.url) continue;
    if (onlyKey && pageKey(tab.url) !== onlyKey) continue;
    push(tab.id, { type: 'applyState', state: await resolvePage(tab.url) });
  }
}

async function broadcast(msg: Push) {
  for (const tab of await googleTabs()) if (tab.id !== undefined) push(tab.id, msg);
}

// ------------------------------------------------------------------------------------------
// Message handlers

type Sender = browser.runtime.MessageSender;

function firstScheme(c: Cache): string | null {
  const dark = [...c.schemes.values()].find((s) => s.variant === 'dark');
  return (dark ?? c.schemes.values().next().value)?.id ?? null;
}

const handlers: { [K in Request['type']]: (req: Extract<Request, { type: K }>, sender: Sender) => Promise<ResponseMap[K]> } = {
  async getPageState(_req, sender) {
    return resolvePage(sender.tab!.url!);
  },

  async setPageThemes(req, sender) {
    const c = await cache();
    const key = pageKey(sender.tab!.url!);
    const cur = effective(c, key);
    const ui = req.ui === undefined ? cur.ui : req.ui;
    const doc = req.doc === undefined ? cur.doc : req.doc;
    await savePage(key, ui, doc);
    const patch: Partial<GlobalSettings> = {};
    if (req.ui) {
      patch.lastUi = req.ui;
      if (!c.settings.defaultUi) patch.defaultUi = req.ui;
    }
    if (req.doc) {
      patch.lastDoc = req.doc;
      if (!c.settings.defaultDoc) patch.defaultDoc = req.doc;
    }
    if (Object.keys(patch).length) await saveSettings(patch);
    await broadcastState(key);
    return resolvePage(sender.tab!.url!);
  },

  async togglePage(_req, sender) {
    return togglePage(sender.tab!.url!, sender.tab!.id!);
  },

  async listSchemes() {
    const c = await cache();
    return [...c.schemes.values()].sort((a, b) => a.name.localeCompare(b.name) || a.system.localeCompare(b.system));
  },

  async importSchemes(req, sender) {
    const c = await cache();
    const tabId = sender.tab?.id;
    const schemes = await importFromUrl(req.url, (p) => {
      if (tabId !== undefined) push(tabId, { type: 'importProgress', ...p }, 0);
    });
    for (const s of schemes) c.schemes.set(s.id, s);
    await db.putMany('schemes', schemes);
    await broadcast({ type: 'schemesChanged' });
    await broadcastState();
    return { imported: schemes.length, names: schemes.map((s) => s.name) };
  },

  async deleteScheme(req) {
    const c = await cache();
    c.schemes.delete(req.id);
    c.options.delete(req.id);
    await db.delete('schemes', req.id);
    await db.delete('options', req.id);
    await broadcast({ type: 'schemesChanged' });
    await broadcastState();
  },

  async saveCustomScheme(req) {
    const c = await cache();
    const scheme: Scheme = {
      ...req.scheme,
      id: req.scheme.source === 'custom' && req.scheme.id.startsWith('custom-') ? req.scheme.id : `custom-${slugify(req.scheme.name) || Date.now()}`,
      source: 'custom',
      origin: undefined,
    };
    c.schemes.set(scheme.id, scheme);
    await db.put('schemes', scheme);
    await broadcast({ type: 'schemesChanged' });
    await broadcastState();
    return scheme;
  },

  async getOptions(req) {
    const c = await cache();
    return { ...DEFAULT_OPTIONS, ...c.options.get(req.id) };
  },

  async setOptions(req) {
    const c = await cache();
    c.options.set(req.id, req.options);
    await db.put('options', { id: req.id, ...req.options });
    await broadcastState();
  },

  async getSettings() {
    return (await cache()).settings;
  },

  async setSettings(req) {
    const s = await saveSettings(req.patch);
    await broadcastState();
    return s;
  },

  async exportBackup() {
    const c = await cache();
    return {
      format: 'workspace-dark-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      schemes: [...c.schemes.values()],
      options: [...c.options].map(([id, o]) => ({ id, ...o })),
      pages: [...c.pages.values()],
      settings: c.settings,
    } satisfies BackupFile;
  },

  async importBackup(req) {
    const d = req.data;
    if (d?.format !== 'workspace-dark-backup') throw new Error('Not a Workspace Dark backup file');
    await db.putMany('schemes', d.schemes ?? []);
    await db.putMany('options', d.options ?? []);
    await db.putMany('pages', d.pages ?? []);
    if (d.settings) await db.put('settings', { ...DEFAULT_SETTINGS, ...d.settings, id: 'global' });
    cachePromise = null;
    await broadcast({ type: 'schemesChanged' });
    await broadcastState();
    return { schemes: d.schemes?.length ?? 0, pages: d.pages?.length ?? 0 };
  },

  async fetchText(req) {
    const u = new URL(req.url);
    if (u.protocol !== 'https:' || !/(^|\.)(google\.com|gstatic\.com|googleusercontent\.com)$/.test(u.hostname)) return null;
    try {
      const res = await fetch(u.href, { credentials: 'omit' });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  },
};

async function togglePage(url: string, tabId: number): Promise<PageState> {
  const c = await cache();
  const key = pageKey(url);
  const cur = effective(c, key);
  if (!c.schemes.size) {
    push(tabId, { type: 'togglePanel', tab: 'library' }, 0);
  } else if (cur.ui || cur.doc) {
    await savePage(key, null, null);
  } else {
    const fallback = firstScheme(c);
    await savePage(key, c.settings.lastUi ?? c.settings.defaultUi ?? fallback, c.settings.lastDoc ?? c.settings.defaultDoc ?? fallback);
  }
  await broadcastState(key);
  return resolvePage(url);
}

browser.runtime.onMessage.addListener((req: Request, sender: Sender) => {
  const h = handlers[req?.type] as ((r: Request, s: Sender) => Promise<unknown>) | undefined;
  if (!h) return undefined;
  return h(req, sender).catch((e: unknown) => ({ __error: e instanceof Error ? e.message : String(e) }));
});

// ------------------------------------------------------------------------------------------
// Toolbar button and keyboard shortcuts

function isGoogle(url?: string) {
  return !!url && /^https:\/\/(docs|drive)\.google\.com\//.test(url);
}

browser.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined && isGoogle(tab.url)) push(tab.id, { type: 'togglePanel' }, 0);
});

browser.commands.onCommand.addListener(async (command) => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isGoogle(tab.url)) return;
  if (command === 'open-panel') push(tab.id, { type: 'togglePanel' }, 0);
  if (command === 'toggle-theme') togglePage(tab.url!, tab.id);
});

// Printing needs nothing here: in Firefox, Docs prints its live (themed) editor via
// window.print() with print-color-adjust: exact, so the printout matches the screen.
