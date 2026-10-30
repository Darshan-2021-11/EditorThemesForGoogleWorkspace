// Applies a UI theme and a document theme to the current frame.
import { send } from '../shared/messages';
import { CONFIG_EVENT, READY_EVENT } from '../shared/hook-protocol';
import { formatColor, hex8, luminance, parseColor, type RGBA } from '../theme/color';
import { createMapper, type Mapper } from '../theme/map';
import { schemeToRoles, type Roles } from '../theme/roles';
import type { ColorKind, ThemeSpec } from '../theme/types';
import { extractColorRules, renderRules, type ColorRule } from './css-remap';
import type { AppProfile } from './profiles';

export const PANEL_HOST_ID = 'wd-panel-host';
const OWN_ATTR = 'data-wd-own';

/** Inline color sources: [read from, marker attribute, kind, CSS property to override]. */
const INLINE: [string, string, ColorKind, string][] = [
  ['background-color', 'data-wd-bg', 'fill', 'background-color'],
  ['color', 'data-wd-fg', 'text', 'color'],
  ['border-top-color', 'data-wd-bc', 'line', 'border-color'],
  ['fill', 'data-wd-fill', 'text', 'fill'],
  ['stroke', 'data-wd-stroke', 'text', 'stroke'],
];
const INLINE_ATTRS = INLINE.map((i) => i[1]);

const hex = (c: RGBA) => formatColor({ ...c, a: 1 });

interface SheetSource {
  rules: ColorRule[];
  override: HTMLStyleElement;
}

export class PageThemer {
  private ui: Mapper | null = null;
  private doc: Mapper | null = null;
  private uiRoles: Roles | null = null;
  private docSpec: ThemeSpec | null = null;
  private sources = new Map<Element, SheetSource>();
  private pending = new Set<Element>();
  private crossOriginCache = new Map<string, Promise<string | null>>();
  private base: HTMLStyleElement | null = null;
  private inlineSheet: HTMLStyleElement | null = null;
  private inlineRules = new Set<string>();
  private observer: MutationObserver | null = null;

  constructor(private profile: AppProfile) {
    // The hook may load after our first config; re-send when it announces itself.
    window.addEventListener(READY_EVENT, () => this.sendHookConfig());
  }

  get active() {
    return !!(this.ui || this.doc);
  }

  update(ui: ThemeSpec | null, doc: ThemeSpec | null) {
    if (!this.profile.docRegion) doc = null;
    this.uiRoles = ui ? schemeToRoles(ui.scheme) : null;
    this.ui = ui && this.uiRoles ? createMapper(this.uiRoles, ui.options) : null;
    this.doc = doc ? createMapper(schemeToRoles(doc.scheme), doc.options) : null;
    this.docSpec = doc;
    this.sendHookConfig();
    if (!this.active) return this.teardown();
    this.writeBase();
    this.ensureObserving();
    for (const [node, src] of this.sources) this.writeOverride(node, src);
    this.rescanInline();
  }

  private sendHookConfig() {
    if (!this.profile.canvasDoc) return;
    window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: JSON.stringify(this.docSpec) }));
  }

  // ----------------------------------------------------------------------------------------
  // Base stylesheet: variables, page background, icons, document surface

  private writeBase() {
    const r = this.uiRoles;
    let css = '';
    if (r) {
      const fgL = luminance(r.fg);
      // Dark glyph icons → inverted, then scaled so white lands on the theme foreground.
      const bright = Math.min(1.4, Math.max(0.7, Math.pow(fgL, 1 / 2.2) / 0.9));
      css += `:root{color-scheme:${r.isDark ? 'dark' : 'light'};scrollbar-color:${hex(r.muted)} ${hex(r.bg)};` +
        `--wd-icon-filter:${r.isDark ? `invert(1) hue-rotate(180deg) brightness(${bright.toFixed(2)})` : 'none'};}` +
        `html,body{background-color:${hex(r.bg)};}` +
        `::selection{background-color:${formatColor({ ...r.selection, a: 0.85 })};}` +
        this.profile.uiCss(r);
    }
    if (this.docSpec && this.doc) css += this.profile.docCss(this.doc.roles);
    // Order doesn't matter for these: per-sheet overrides sit right after their source sheet and
    // inline/document rules are !important.
    this.base ??= this.ownStyle('base');
    this.base.textContent = css;
    this.appendOwn(this.base);
    this.inlineSheet ??= this.ownStyle('inline');
    this.appendOwn(this.inlineSheet);
  }

  private ownStyle(name: string): HTMLStyleElement {
    const s = document.createElement('style');
    s.setAttribute(OWN_ATTR, name);
    return s;
  }

  private appendOwn(el: HTMLStyleElement) {
    // Never re-insert: that would reset rules added with insertRule.
    if (el.isConnected) return;
    (document.head ?? document.documentElement)?.appendChild(el);
  }

  // ----------------------------------------------------------------------------------------
  // Google's stylesheets → override sheets placed right after each original

  private ensureObserving() {
    if (this.observer) return;
    this.observer = new MutationObserver((muts) => this.onMutations(muts));
    this.observer.observe(document, {
      childList: true, subtree: true, attributes: true, characterData: true,
      attributeFilter: ['style', 'fill', 'stroke'],
    });
    document.querySelectorAll('style, link[rel~="stylesheet"]').forEach((n) => this.addSheetNode(n));
  }

  private onMutations(muts: MutationRecord[]) {
    for (const m of muts) {
      if (m.type === 'attributes') {
        this.pending.add(m.target as Element);
        continue;
      }
      const target = m.target as Node;
      const parentStyle = target.nodeType === 1 ? (target as Element) : target.parentElement;
      if (parentStyle?.tagName === 'STYLE' && !parentStyle.hasAttribute(OWN_ATTR)) {
        this.addSheetNode(parentStyle, true);
        continue;
      }
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const el = n as Element;
        if (el.tagName === 'STYLE' || (el.tagName === 'LINK' && /stylesheet/i.test(el.getAttribute('rel') ?? ''))) {
          this.addSheetNode(el);
          return;
        }
        this.pending.add(el);
        el.querySelectorAll('[style], [fill], [stroke]').forEach((d) => this.pending.add(d));
        el.querySelectorAll('style, link[rel~="stylesheet"]').forEach((s) => this.addSheetNode(s));
      });
      m.removedNodes.forEach((n) => {
        const src = this.sources.get(n as Element);
        if (src) {
          src.override.remove();
          this.sources.delete(n as Element);
        }
      });
    }
    this.flushInline();
  }

  private async addSheetNode(node: Element, reparse = false) {
    if (node.hasAttribute(OWN_ATTR)) return;
    if (!reparse && this.sources.has(node)) return;
    const sheet = (node as HTMLStyleElement | HTMLLinkElement).sheet;
    if (!sheet) {
      if (node.tagName === 'LINK') node.addEventListener('load', () => this.addSheetNode(node, true), { once: true });
      return;
    }
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      const href = (node as HTMLLinkElement).href;
      if (!href || /fonts\.googleapis/.test(href)) return;
      let text = this.crossOriginCache.get(href);
      if (!text) {
        text = send({ type: 'fetchText', url: href }).catch(() => null);
        this.crossOriginCache.set(href, text);
      }
      const css = await text;
      if (!css) return;
      const parsed = new CSSStyleSheet();
      try {
        parsed.replaceSync(css.replace(/@import[^;]+;/g, ''));
      } catch {
        return;
      }
      rules = parsed.cssRules;
    }
    const extracted = extractColorRules(rules, this.profile.docRuleHints);
    const prev = this.sources.get(node);
    const src: SheetSource = { rules: extracted, override: prev?.override ?? this.ownStyle('sheet') };
    this.sources.set(node, src);
    if (this.active) this.writeOverride(node, src);
  }

  private writeOverride(node: Element, src: SheetSource) {
    src.override.textContent = renderRules(src.rules, this.ui, this.doc, !!this.uiRoles?.isDark);
    if (src.override.previousElementSibling !== node) node.after(src.override);
  }

  // ----------------------------------------------------------------------------------------
  // Inline colors (style="", fill="", stroke="") → shared attribute rules, never touching style

  private rescanInline() {
    document.querySelectorAll('[style], [fill], [stroke], [data-wd-bg], [data-wd-fg], [data-wd-bc], [data-wd-fill], [data-wd-stroke]')
      .forEach((el) => this.pending.add(el));
    this.flushInline();
  }

  private flushInline() {
    if (!this.pending.size) return;
    const els = [...this.pending];
    this.pending.clear();
    for (const el of els) this.applyInline(el);
  }

  private applyInline(el: Element) {
    if (!el.isConnected || el.id === PANEL_HOST_ID) return;
    const inDoc = !!this.profile.docRegion && !!el.closest(this.profile.docRegion);
    const m = inDoc ? this.doc : this.ui;
    const keep = !!el.closest(this.profile.keepColors);
    const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
    for (const [read, attr, kind, prop] of INLINE) {
      let v = style?.getPropertyValue(read) ?? '';
      if (!v && (read === 'fill' || read === 'stroke')) v = el.getAttribute(read) ?? '';
      const c = m && !keep && v ? parseColor(v) : null;
      if (!c || !m) {
        if (el.hasAttribute(attr)) el.removeAttribute(attr);
        continue;
      }
      const mapped = m.mapRGBA(c, kind);
      const key = hex8(mapped);
      const rule = `${attr}="${key}"`;
      if (!this.inlineRules.has(rule)) {
        this.inlineRules.add(rule);
        this.inlineSheet!.sheet?.insertRule(`[${rule}]{${prop}:${formatColor(mapped)} !important}`, this.inlineSheet!.sheet.cssRules.length);
      }
      if (el.getAttribute(attr) !== key) el.setAttribute(attr, key);
    }
  }

  // ----------------------------------------------------------------------------------------

  private teardown() {
    this.observer?.disconnect();
    this.observer = null;
    for (const src of this.sources.values()) src.override.textContent = '';
    this.base?.remove();
    this.base = null;
    this.inlineSheet?.remove();
    this.inlineSheet = null;
    this.inlineRules.clear();
    document.querySelectorAll(INLINE_ATTRS.map((a) => `[${a}]`).join(',')).forEach((el) => {
      for (const a of INLINE_ATTRS) el.removeAttribute(a);
    });
  }
}
