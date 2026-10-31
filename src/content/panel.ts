// The in-page theme panel (closed Shadow DOM, so Google's CSS can't reach it).
import { send, type GlobalSettings, type PageState, type PanelTab } from '../shared/messages';
import { scopeName } from '../shared/page';
import { formatColor, type RGBA } from '../theme/color';
import { schemeToRoles } from '../theme/roles';
import { SUGGESTED_SOURCES } from '../theme/scheme-import';
import { STYLE_SLOT_CHOICES, styleColors } from '../theme/style-colors';
import {
  BASE16_KEYS, BASE24_EXTRA_KEYS, DEFAULT_OPTIONS, DEFAULT_STYLE_SLOTS, STYLE_KEYS, STYLE_LABELS,
  type Scheme, type StyleKey, type ThemeOptions, type ThemeSpec,
} from '../theme/types';
import { PANEL_HOST_ID } from './themer';
import { PANEL_CSS } from './panel-css';

export interface PanelHost {
  getState(): PageState;
  /** Temporarily show a theme without saving it. */
  preview(spec: ThemeSpec | null): void;
  endPreview(): void;
}

const SLOT_LABELS: Record<string, string> = {
  base00: 'Background', base01: 'Surface', base02: 'Selection', base03: 'Muted / comments',
  base04: 'Dim text', base05: 'Text', base06: 'Bright text', base07: 'Brightest',
  base08: 'Red', base09: 'Orange', base0A: 'Yellow', base0B: 'Green', base0C: 'Cyan',
  base0D: 'Blue', base0E: 'Purple', base0F: 'Brown', base10: 'Darker bg', base11: 'Darkest bg',
  base12: 'Bright red', base13: 'Bright yellow', base14: 'Bright green', base15: 'Bright cyan',
  base16: 'Bright blue', base17: 'Bright magenta',
};

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const hex = (c: RGBA) => formatColor({ ...c, a: 1 });

export class Panel {
  private hostEl: HTMLElement | null = null;
  private root!: ShadowRoot;
  private body!: HTMLElement;
  private tab: PanelTab = 'theme';
  private schemes: Scheme[] = [];
  private settings: GlobalSettings | null = null;
  private query = '';
  private filter: 'all' | 'dark' | 'light' = 'all';
  private status = '';
  private importing = false;
  private draft: Scheme | null = null;
  private optionsCache = new Map<string, ThemeOptions>();
  private previewTimer = 0;
  private previewGen = 0;

  constructor(private host: PanelHost) {}

  get open() {
    return !!this.hostEl?.isConnected;
  }

  async toggle(tab?: PanelTab) {
    if (this.open && !tab) return this.close();
    await this.show(tab);
  }

  async show(tab?: PanelTab) {
    if (!this.hostEl) {
      this.hostEl = h('div', { id: PANEL_HOST_ID });
      this.root = this.hostEl.attachShadow({ mode: 'closed' });
      this.root.append(h('style', {}, PANEL_CSS));
      this.body = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Editor Themes for Google Workspace' });
      this.root.append(this.body);
      this.root.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Escape') this.close();
        e.stopPropagation(); // keep Docs from treating panel typing as document input
      });
      for (const t of ['keypress', 'keyup', 'input', 'paste', 'copy', 'cut']) this.root.addEventListener(t, (e) => e.stopPropagation());
    }
    if (!this.hostEl.isConnected) document.documentElement.append(this.hostEl);
    await this.reload();
    if (tab) this.tab = tab;
    else if (!this.schemes.length) this.tab = 'library';
    this.render();
  }

  close() {
    this.cancelPreview();
    this.hostEl?.remove();
  }

  /** Called when the background pushes new state or scheme lists. */
  async refresh(schemesChanged = false) {
    if (!this.open) return;
    if (schemesChanged) await this.reload();
    this.render();
  }

  importProgress(done: number, total: number) {
    if (!this.importing) return;
    this.status = `Downloading ${done}/${total}…`;
    if (this.open) this.renderStatus();
  }

  private async reload() {
    [this.schemes, this.settings] = await Promise.all([send({ type: 'listSchemes' }), send({ type: 'getSettings' })]);
  }

  private async options(id: string): Promise<ThemeOptions> {
    let o = this.optionsCache.get(id);
    if (!o) {
      o = await send({ type: 'getOptions', id });
      this.optionsCache.set(id, o);
    }
    return o;
  }

  // ----------------------------------------------------------------------------------------

  private render() {
    const state = this.host.getState();
    const roles = schemeToRoles(state.theme?.scheme ?? FALLBACK_SCHEME);
    this.body.setAttribute(
      'style',
      `--bg:${hex(roles.bg)};--surface:${hex(roles.surface)};--surface2:${hex(roles.surfaceAlt)};--muted:${hex(roles.muted)};` +
        `--dim:${hex(roles.fgMuted)};--fg:${hex(roles.fg)};--accent:${hex(roles.accents.blue)};--danger:${hex(roles.accents.red)};` +
        `--ok:${hex(roles.accents.green)};color-scheme:${roles.isDark ? 'dark' : 'light'}`,
    );
    const tabs: [PanelTab, string][] = [
      ['theme', 'Theme'], ['library', 'Get themes'], ['custom', 'Custom'], ['settings', 'Settings'],
    ];
    this.body.replaceChildren(
      h('header', {},
        h('div', { class: 'title' }, 'Editor Themes'),
        h('button', { class: 'icon-btn', title: 'Close (Esc)', onclick: () => this.close() }, '✕'),
      ),
      h('nav', { role: 'tablist' },
        tabs.map(([id, label]) =>
          h('button', {
            role: 'tab', class: id === this.tab ? 'tab on' : 'tab', 'aria-selected': String(id === this.tab),
            onclick: () => { this.tab = id; this.status = ''; this.render(); },
          }, label),
        ),
      ),
      h('main', {}, this.renderTab(state)),
      h('footer', { class: 'status' }, this.status),
    );
  }

  private renderStatus() {
    const f = this.body.querySelector('footer.status');
    if (f) f.textContent = this.status;
  }

  private renderTab(state: PageState): Node {
    switch (this.tab) {
      case 'theme': return this.renderPicker(state.theme, state.scope);
      case 'library': return this.renderLibrary();
      case 'custom': return this.renderCustom(state);
      case 'settings': return this.renderSettings(state);
    }
  }

  // ---- Theme picker -----------------------------------------------------------------------

  private renderPicker(current: ThemeSpec | null, scope: string): Node {
    const wrap = h('div', { class: 'picker' });
    if (!this.schemes.length) {
      wrap.append(
        h('p', { class: 'empty' }, 'No themes yet. Import a few from GitHub first — only what you pick is downloaded.'),
        h('button', { class: 'btn primary', onclick: () => { this.tab = 'library'; this.render(); } }, 'Get themes'),
      );
      return wrap;
    }
    wrap.append(
      h('div', { class: 'current' },
        h('div', {},
          h('div', { class: 'label', title: 'One theme covers the interface and the document' }, scopeName(scope)),
          h('div', { class: 'name' }, current ? current.scheme.name : 'Off — Google default'),
        ),
        current && h('button', { class: 'btn', onclick: () => this.choose(null) }, 'Turn off'),
      ),
    );
    if (current) wrap.append(this.renderOptions(current));
    const list = h('div', { class: 'list', role: 'listbox', onmouseleave: () => this.cancelPreview() });
    const fill = () => {
      const q = this.query.toLowerCase();
      list.replaceChildren(
        ...this.schemes
          .filter((s) => (this.filter === 'all' || s.variant === this.filter) && (!q || s.name.toLowerCase().includes(q) || s.author.toLowerCase().includes(q)))
          .map((s) => this.renderRow(s, current?.scheme.id === s.id)),
      );
      if (!list.childElementCount) list.append(h('p', { class: 'empty' }, 'No matches.'));
    };
    wrap.append(
      h('div', { class: 'search-row' },
        h('input', {
          type: 'search', placeholder: `Search ${this.schemes.length} themes`, value: this.query,
          oninput: (e: Event) => { this.query = (e.target as HTMLInputElement).value; fill(); },
        }),
        h('div', { class: 'seg' },
          (['all', 'dark', 'light'] as const).map((f) =>
            h('button', { class: f === this.filter ? 'on' : '', onclick: () => { this.filter = f; this.render(); } }, f[0].toUpperCase() + f.slice(1)),
          ),
        ),
      ),
      list,
    );
    fill();
    return wrap;
  }

  private renderRow(s: Scheme, selected: boolean): Node {
    const p = s.palette;
    return h('button', {
      class: selected ? 'row on' : 'row', role: 'option', 'aria-selected': String(selected), title: s.author,
      onmouseenter: () => this.schedulePreview(s),
      onfocus: () => this.schedulePreview(s),
      onclick: () => this.choose(s.id),
    },
      h('span', { class: 'swatch', style: `background:${p.base00};color:${p.base05};border-color:${p.base02}` },
        h('span', { class: 'aa' }, 'Aa'),
        ['base08', 'base09', 'base0A', 'base0B', 'base0C', 'base0D', 'base0E'].map((k) => h('i', { style: `background:${p[k]}` })),
      ),
      h('span', { class: 'row-name' }, s.name),
      s.system === 'base24' && h('span', { class: 'badge' }, 'B24'),
      s.source === 'custom' && h('span', { class: 'badge' }, 'custom'),
    );
  }

  private schedulePreview(s: Scheme) {
    clearTimeout(this.previewTimer);
    const gen = ++this.previewGen;
    this.previewTimer = window.setTimeout(async () => {
      const options = await this.options(s.id);
      // The pointer left (or a theme was chosen) while options loaded: don't resurrect the preview.
      if (gen === this.previewGen) this.host.preview({ scheme: s, options });
    }, 90);
  }

  private cancelPreview() {
    clearTimeout(this.previewTimer);
    this.previewGen++;
    this.host.endPreview();
  }

  private async choose(id: string | null) {
    this.cancelPreview();
    await send({ type: 'setPageTheme', theme: id });
  }

  private renderOptions(current: ThemeSpec): Node {
    const o = current.options;
    const set = async (patch: Partial<ThemeOptions>) => {
      const next = { ...o, ...patch };
      this.optionsCache.set(current.scheme.id, next);
      await send({ type: 'setOptions', id: current.scheme.id, options: next });
    };
    return h('div', { class: 'options' },
      h('div', { class: 'opt-row' },
        h('span', { class: 'label' }, 'Colors'),
        h('div', { class: 'seg' },
          h('button', { class: o.mapping === 'snap' ? 'on' : '', title: 'Red text uses the theme red, blue its blue…', onclick: () => set({ mapping: 'snap' }) }, 'Snap to theme'),
          h('button', { class: o.mapping === 'keep-hue' ? 'on' : '', title: 'Keep original hues, fix lightness for contrast', onclick: () => set({ mapping: 'keep-hue' }) }, 'Keep hue'),
        ),
      ),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: o.styleColors, onchange: (e: Event) => set({ styleColors: (e.target as HTMLInputElement).checked }) }),
        'Color text by paragraph style',
      ),
      o.styleColors && this.renderStyleSlots(current),
      h('label', { class: 'check', title: 'Drawings, shapes and diagrams take theme colors; photos are left alone' },
        h('input', { type: 'checkbox', checked: o.recolorGraphics, onchange: (e: Event) => set({ recolorGraphics: (e.target as HTMLInputElement).checked }) }),
        'Recolor drawings',
      ),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: o.dimImages, onchange: (e: Event) => set({ dimImages: (e.target as HTMLInputElement).checked }) }),
        'Dim images',
        // The slider is dimming strength (right = dimmer); stored as the brightness multiplier.
        o.dimImages && h('input', {
          type: 'range', min: '0', max: '0.5', step: '0.05', value: String(+(1 - o.dimAmount).toFixed(2)),
          title: `Dimmed by ${Math.round((1 - o.dimAmount) * 100)}%`,
          onchange: (e: Event) => set({ dimAmount: +(1 - Number((e.target as HTMLInputElement).value)).toFixed(2) }),
        }),
        o.dimImages && h('span', { class: 'hint' }, `${Math.round((1 - o.dimAmount) * 100)}%`),
      ),
      h('div', { class: 'hint' }, 'Options are saved per theme.'),
    );
  }

  /**
   * One row per paragraph style: click a palette dot to choose that style's color. A color you
   * gave the style in Docs shows as its palette dot, or as an extra dot when it isn't a palette color.
   */
  private renderStyleSlots(current: ThemeSpec): Node {
    const p = current.scheme.palette;
    const overrides = this.host.getState().styleOverrides;
    const slots = { ...DEFAULT_STYLE_SLOTS, ...current.options.styleSlots };
    // the exact colors the page paints with (same function as the canvas hook)
    const shown = styleColors({ ...current, options: { ...current.options, styleSlots: slots } });
    const pick = (k: StyleKey, value: string) => send({ type: 'setStyleSlot', style: k, value });
    const nameInput = h('input', {
      type: 'text',
      placeholder: current.scheme.source === 'custom' ? current.scheme.name : `${current.scheme.name} (my colors)`,
    });
    return h('div', { class: 'styles' },
      STYLE_KEYS.map((k) => {
        const fromDoc = k in overrides;
        const custom = slots[k].startsWith('#') ? slots[k] : null;
        return h('div', { class: 'style-row' },
          h('span', { class: 'style-name', style: `color:${shown[k]}` }, STYLE_LABELS[k]),
          h('span', { class: 'dots' },
            STYLE_SLOT_CHOICES.filter((s) => p[s]).map((s) =>
              h('button', {
                class: s === slots[k] ? 'dot on' : 'dot', style: `background:${p[s]}`,
                title: `${s} · ${SLOT_LABELS[s]}`, 'aria-label': `${STYLE_LABELS[k]}: ${SLOT_LABELS[s]}`,
                onclick: () => pick(k, s),
              }),
            ),
            custom && h('button', {
              class: 'dot on custom', style: `background:${custom}`,
              title: `${custom} · ${fromDoc ? 'the color you gave this style in Docs' : 'custom color'}`,
              onclick: () => pick(k, custom),
            }),
          ),
          fromDoc && h('span', { class: 'badge', title: 'Follows the color you set for this style in the document' }, 'from doc'),
        );
      }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn small', onclick: () => send({ type: 'resetStyleColors' }) }, 'Reset style colors'),
      ),
      h('div', { class: 'save-preset' },
        nameInput,
        h('button', {
          class: 'btn small primary',
          title: 'Save this theme with these style colors as your own preset',
          onclick: () => this.saveStylePreset(current, nameInput.value.trim() || nameInput.placeholder),
        }, 'Save as preset'),
      ),
    );
  }

  /** Saves the current theme plus its effective style colors as a new custom preset and applies it. */
  private async saveStylePreset(current: ThemeSpec, name: string) {
    const saved = await send({
      type: 'saveCustomScheme',
      scheme: { ...current.scheme, id: 'custom-new', name, source: 'custom', origin: current.scheme.id, palette: { ...current.scheme.palette } },
    });
    await send({ type: 'setOptions', id: saved.id, options: { ...current.options } });
    await send({ type: 'setPageTheme', theme: saved.id });
    await send({ type: 'resetStyleOverrides' });
    await this.reload();
    this.status = `Saved preset “${saved.name}” and applied it.`;
    this.render();
  }

  // ---- Library ----------------------------------------------------------------------------

  private renderLibrary(): Node {
    const origins = new Set(this.schemes.map((s) => s.origin));
    const urlInput = h('input', { type: 'url', placeholder: 'https://github.com/…/scheme.yaml or a folder / repo' });
    const doImport = async (url: string) => {
      if (this.importing || !url.trim()) return;
      this.importing = true;
      this.status = 'Downloading…';
      this.renderStatus();
      try {
        const r = await send({ type: 'importSchemes', url: url.trim() });
        this.status = r.imported === 1 ? `Imported ${r.names[0]}.` : `Imported ${r.imported} themes.`;
        await this.reload();
      } catch (e) {
        this.status = `Import failed: ${(e as Error).message}`;
      } finally {
        this.importing = false;
        this.render();
      }
    };
    return h('div', { class: 'library' },
      h('p', { class: 'hint' }, 'Themes are downloaded from GitHub only when you import them, and stored in this browser.'),
      h('div', { class: 'import-row' },
        urlInput,
        h('button', { class: 'btn primary', onclick: () => doImport(urlInput.value) }, 'Import'),
      ),
      h('h3', {}, 'Suggestions'),
      h('div', { class: 'sources' },
        SUGGESTED_SOURCES.map((src) => {
          const have = origins.has(src.url);
          return h('div', { class: 'source' },
            h('div', {},
              h('div', { class: 'name' }, src.label),
              h('a', { class: 'hint', href: src.url, target: '_blank', rel: 'noopener' }, src.description),
            ),
            h('button', { class: have ? 'btn' : 'btn primary', onclick: () => doImport(src.url) }, have ? 'Update' : 'Import'),
          );
        }),
      ),
      this.schemes.length > 0 && h('details', {},
        h('summary', {}, `Installed (${this.schemes.length})`),
        h('div', { class: 'installed' },
          this.schemes.map((s) =>
            h('div', { class: 'source' },
              h('span', {}, s.name, s.system === 'base24' ? ' · B24' : '', s.source === 'custom' ? ' · custom' : ''),
              h('button', {
                class: 'btn small danger', title: 'Delete from this browser',
                onclick: async () => { await send({ type: 'deleteScheme', id: s.id }); await this.reload(); this.render(); },
              }, 'Delete'),
            ),
          ),
        ),
      ),
    );
  }

  // ---- Custom editor ----------------------------------------------------------------------

  private renderCustom(state: PageState): Node {
    if (!this.schemes.length) return h('p', { class: 'empty' }, 'Import a theme first, then customise it here.');
    if (!this.draft) {
      const base = state.theme?.scheme ?? this.schemes[0];
      this.startDraft(base);
    }
    const d = this.draft!;
    const keys = [...BASE16_KEYS, ...(d.system === 'base24' ? BASE24_EXTRA_KEYS : [])];
    const live = () => {
      clearTimeout(this.previewTimer);
      this.previewTimer = window.setTimeout(() => {
        this.host.preview({ scheme: { ...d, palette: { ...d.palette } }, options: DEFAULT_OPTIONS });
      }, 60);
    };
    return h('div', { class: 'custom' },
      h('div', { class: 'opt-row' },
        h('span', { class: 'label' }, 'Start from'),
        h('select', {
          onchange: (e: Event) => {
            const s = this.schemes.find((x) => x.id === (e.target as HTMLSelectElement).value);
            if (s) { this.startDraft(s); this.render(); live(); }
          },
        }, this.schemes.map((s) => h('option', { value: s.id, selected: s.id === d.id || s.id === d.origin }, s.name))),
      ),
      h('div', { class: 'opt-row' },
        h('span', { class: 'label' }, 'Name'),
        h('input', { type: 'text', value: d.name, oninput: (e: Event) => (d.name = (e.target as HTMLInputElement).value) }),
      ),
      h('div', { class: 'colors' },
        keys.map((k) =>
          h('label', { class: 'color' },
            h('input', {
              type: 'color', value: d.palette[k] ?? '#808080',
              oninput: (e: Event) => { d.palette[k] = (e.target as HTMLInputElement).value; live(); },
            }),
            h('span', {}, h('b', {}, k.slice(4)), ' ', SLOT_LABELS[k]),
          ),
        ),
      ),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => { this.host.endPreview(); live(); } }, 'Preview'),
        h('button', { class: 'btn', onclick: () => { this.draft = null; this.host.endPreview(); this.render(); } }, 'Reset'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            const saved = await send({ type: 'saveCustomScheme', scheme: { ...d, variant: schemeToRoles(d).isDark ? 'dark' : 'light' } });
            this.draft = { ...saved, palette: { ...saved.palette } };
            await this.reload();
            this.host.endPreview();
            await send({ type: 'setPageTheme', theme: saved.id });
            this.status = `Saved “${saved.name}” and applied it.`;
            this.render();
          },
        }, 'Save preset & apply'),
      ),
    );
  }

  private startDraft(base: Scheme) {
    this.draft = {
      ...base,
      id: base.source === 'custom' ? base.id : 'custom-new',
      name: base.source === 'custom' ? base.name : `${base.name} (custom)`,
      source: 'custom',
      origin: base.id,
      palette: { ...base.palette },
    };
  }

  // ---- Settings ---------------------------------------------------------------------------

  private renderSettings(state: PageState): Node {
    const s = this.settings!;
    const nameOf = (id: string | null) => (id && this.schemes.find((x) => x.id === id)?.name) || 'none';
    const patch = async (p: Partial<GlobalSettings>) => {
      this.settings = await send({ type: 'setSettings', patch: p });
      this.render();
    };
    const fileInput = h('input', {
      type: 'file', accept: 'application/json,.json', style: 'display:none',
      onchange: async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        try {
          const r = await send({ type: 'importBackup', data: JSON.parse(await file.text()) });
          this.status = `Restored ${r.schemes} themes and ${r.pages} page settings.`;
          await this.reload();
        } catch (err) {
          this.status = `Restore failed: ${(err as Error).message}`;
        }
        this.render();
      },
    });
    return h('div', { class: 'settings' },
      h('label', { class: 'check big' },
        h('input', { type: 'checkbox', checked: s.autoApply, onchange: (e: Event) => patch({ autoApply: (e.target as HTMLInputElement).checked }) }),
        h('span', {}, h('b', {}, 'Auto-apply everywhere'), h('br'), h('span', { class: 'hint' }, 'Use the default theme wherever you haven’t picked one yet.')),
      ),
      h('label', { class: 'check big' },
        h('input', { type: 'checkbox', checked: s.separateApps, onchange: (e: Event) => patch({ separateApps: (e.target as HTMLInputElement).checked }) }),
        h('span', {}, h('b', {}, 'Separate theme per app'), h('br'), h('span', { class: 'hint' }, 'Docs, Sheets, Slides, Forms, Drawings and Drive each keep their own theme; off = one theme for all.')),
      ),
      h('div', { class: 'card' },
        h('div', {}, 'Default theme: ', h('b', {}, nameOf(s.defaultTheme))),
        h('div', { class: 'actions' },
          h('button', {
            class: 'btn', disabled: !state.theme,
            onclick: () => patch({ defaultTheme: state.theme?.scheme.id ?? s.defaultTheme }),
          }, 'Use the current theme as default'),
          h('button', { class: 'btn', disabled: !state.theme, onclick: () => send({ type: 'setPageTheme', theme: null }) }, `Revert ${scopeName(state.scope).replace(/^All/, 'all')} to Google’s look`),
        ),
      ),
      h('div', { class: 'card' },
        h('div', { class: 'label' }, 'Backup'),
        h('div', { class: 'actions' },
          h('button', {
            class: 'btn',
            onclick: async () => {
              const data = await send({ type: 'exportBackup' });
              const a = h('a', {
                href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })),
                download: `workspace-dark-backup-${data.exportedAt.slice(0, 10)}.json`,
              });
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            },
          }, 'Export'),
          h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Restore…'),
          fileInput,
        ),
      ),
      h('div', { class: 'card hint' },
        h('div', {}, h('kbd', {}, 'Alt+Shift+D'), ' theme on/off (' + scopeName(state.scope).replace(/^All/, 'all') + ')'),
        h('div', {}, h('kbd', {}, 'Alt+Shift+T'), ' open this panel'),
        h('div', {}, 'Change shortcuts in about:addons → ⚙ → Manage Extension Shortcuts.'),
        h('div', {}, 'Everything is stored locally in this browser. Nothing is saved to Google.'),
      ),
    );
  }
}

/** Panel colors before any theme is installed. */
const FALLBACK_SCHEME: Scheme = {
  id: 'fallback', name: 'Fallback', author: '', system: 'base16', variant: 'dark', source: 'custom',
  palette: {
    base00: '#1f2329', base01: '#282c34', base02: '#3a3f4b', base03: '#5c6370', base04: '#9da5b4', base05: '#d7dae0',
    base06: '#e6e8ec', base07: '#ffffff', base08: '#e06c75', base09: '#d19a66', base0A: '#e5c07b', base0B: '#98c379',
    base0C: '#56b6c2', base0D: '#61afef', base0E: '#c678dd', base0F: '#be5046',
  },
};
