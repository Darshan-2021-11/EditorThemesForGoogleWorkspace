// Applies one theme to the current frame: Google's interface and the document content.
import { send } from '../shared/messages';
import { ANSWER_EVENT, CONFIG_EVENT, QUERY_EVENT, READY_EVENT, type TextColorQuery } from '../shared/hook-protocol';
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
  // Docs' toolbar color indicators are a colored bottom border
  ['border-bottom-color', 'data-wd-bbc', 'line', 'border-bottom-color'],
  ['fill', 'data-wd-fill', 'text', 'fill'],
  ['stroke', 'data-wd-stroke', 'text', 'stroke'],
];
const INLINE_ATTRS = INLINE.map((i) => i[1]);

const hex = (c: RGBA) => formatColor({ ...c, a: 1 });

/**
 * SVG paint: glyph-like shapes (text, UI icon paths) are foreground; areas (rects, and every
 * non-text shape inside the document, like the page background Docs draws as a <rect>) are fills.
 */
function svgKind(el: Element, inDoc: boolean, base: ColorKind): ColorKind {
  const tag = el.tagName.toLowerCase();
  if (tag === 'text' || tag === 'tspan') return 'text';
  if (inDoc || tag === 'rect') return base === 'text' ? 'fill' : base;
  return base;
}

interface SheetSource {
  rules: ColorRule[];
  override: HTMLStyleElement;
}

export class PageThemer {
  private mapper: Mapper | null = null;
  private roles: Roles | null = null;
  private spec: ThemeSpec | null = null;
  private sources = new Map<Element, SheetSource>();
  private pending = new Set<Element>();
  private crossOriginCache = new Map<string, Promise<string | null>>();
  private base: HTMLStyleElement | null = null;
  private inlineSheet: HTMLStyleElement | null = null;
  private inlineRules = new Set<string>();
  private observer: MutationObserver | null = null;

  /** Whether the open color palette belongs to the text-color or the highlight button. */
  private paletteKind: ColorKind = 'text';

  constructor(private profile: AppProfile) {
    // The hook may load after our first config; re-send when it announces itself.
    window.addEventListener(READY_EVENT, () => this.sendHookConfig());
    if (profile.docColorControls) {
      const note = (e: Event) => this.noteColorButton(e.target);
      document.addEventListener('pointerdown', note, true);
      document.addEventListener('keydown', note, true);
    }
  }

  private noteColorButton(target: EventTarget | null) {
    const c = this.profile.docColorControls!;
    const el = target instanceof Element ? target : null;
    const kind: ColorKind | null = el?.closest(c.text) ? 'text' : el?.closest(c.fill) ? 'fill' : null;
    if (!kind || !this.active) return;
    this.paletteKind = kind;
    // Palettes are built or re-shown right after the click; re-evaluate their swatches.
    const rescan = () => {
      document.querySelectorAll(c.palettes).forEach((p) => {
        p.querySelectorAll('[style], [fill]').forEach((s) => this.pending.add(s));
      });
      this.flushInline();
    };
    setTimeout(rescan, 0);
    setTimeout(rescan, 200);
  }

  /** Kind to use for an element that displays a document color, or null for ordinary UI. */
  private colorControlKind(el: Element): ColorKind | null {
    const c = this.profile.docColorControls;
    if (!c) return null;
    if (el.closest(c.text)) return 'text';
    if (el.closest(c.fill)) return 'fill';
    if (el.closest(c.palettes)) return this.paletteKind;
    return null;
  }

  get active() {
    return !!this.mapper;
  }

  update(spec: ThemeSpec | null) {
    this.spec = spec;
    this.roles = spec ? schemeToRoles(spec.scheme) : null;
    this.mapper = spec && this.roles ? createMapper(this.roles, spec.options) : null;
    this.sendHookConfig();
    if (!this.active) return this.teardown();
    this.writeBase();
    this.ensureObserving();
    for (const [node, src] of this.sources) this.writeOverride(node, src);
    this.rescanInline();
  }

  private sendHookConfig() {
    if (!this.profile.canvasDoc) return;
    window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: JSON.stringify(this.spec) }));
  }

  // ----------------------------------------------------------------------------------------
  // Base stylesheet: variables, page background, icons, document surface

  private writeBase() {
    const r = this.roles;
    let css = '';
    if (r) {
      const fgL = luminance(r.fg);
      // Dark glyph icons → inverted, then scaled so white lands on the theme foreground.
      const bright = Math.min(1.4, Math.max(0.7, Math.pow(fgL, 1 / 2.2) / 0.9));
      css += `:root{color-scheme:${r.isDark ? 'dark' : 'light'};scrollbar-color:${hex(r.muted)} ${hex(r.bg)};` +
        `--wd-icon-filter:${r.isDark ? `invert(1) hue-rotate(180deg) brightness(${bright.toFixed(2)})` : 'none'};}` +
        `html,body{background-color:${hex(r.bg)};}` +
        `::selection{background-color:${formatColor({ ...r.selection, a: 0.85 })};}` +
        this.profile.uiCss(r) +
        this.profile.docCss(r, this.spec!.options);
    }
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
    // The cursor moving between styles changes the page color without touching the indicator.
    const ind = this.profile.docColorControls && document.querySelector(this.profile.docColorControls.textIndicator);
    if (ind) this.pending.add(ind);
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
    const extracted = extractColorRules(rules);
    const prev = this.sources.get(node);
    const src: SheetSource = { rules: extracted, override: prev?.override ?? this.ownStyle('sheet') };
    this.sources.set(node, src);
    if (this.active) this.writeOverride(node, src);
  }

  private writeOverride(node: Element, src: SheetSource) {
    src.override.textContent = this.mapper ? renderRules(src.rules, this.mapper, !!this.roles?.isDark) : '';
    if (src.override.previousElementSibling !== node) node.after(src.override);
  }

  // ----------------------------------------------------------------------------------------
  // Inline colors (style="", fill="", stroke="") → shared attribute rules, never touching style

  private rescanInline() {
    document.querySelectorAll(['[style]', '[fill]', '[stroke]', ...INLINE_ATTRS.map((a) => `[${a}]`)].join(','))
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
    const m = this.mapper;
    const inDoc = !!this.profile.docRegion && !!el.closest(this.profile.docRegion);
    // Swatches and color indicators preview document colors, mapped like the page would map them.
    const control = this.colorControlKind(el);
    const keep = !control && !!el.closest(this.profile.keepColors);
    const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
    for (const [read, attr, baseKind, prop] of INLINE) {
      const useControl = control && read !== 'color';
      const kind = useControl ? control : read === 'fill' || read === 'stroke' ? svgKind(el, inDoc, baseKind) : baseKind;
      let v = style?.getPropertyValue(read) ?? '';
      if (!v && (read === 'fill' || read === 'stroke')) v = el.getAttribute(read) ?? '';
      const c = m && !keep && v ? parseColor(v) : null;
      if (!c || !m) {
        if (el.hasAttribute(attr)) el.removeAttribute(attr);
        continue;
      }
      if (useControl && kind === 'text' && el.matches(this.profile.docColorControls!.textIndicator)) {
        // The page may color this text by paragraph style or size: ask the hook what it paints.
        this.queryIndicator(el, attr, prop, v);
        continue;
      }
      this.setInline(el, attr, prop, m.mapRGBA(c, kind));
    }
  }

  private setInline(el: Element, attr: string, prop: string, color: RGBA) {
    const key = hex8(color);
    const rule = `${attr}="${key}"`;
    if (!this.inlineRules.has(rule)) {
      this.inlineRules.add(rule);
      this.inlineSheet!.sheet?.insertRule(`[${rule}]{${prop}:${formatColor(color)} !important}`, this.inlineSheet!.sheet.cssRules.length);
    }
    if (el.getAttribute(attr) !== key) el.setAttribute(attr, key);
  }

  private querySeq = 0;

  /** Text-color indicator: same color the canvas hook paints for the text under the cursor. */
  private queryIndicator(el: Element, attr: string, prop: string, raw: string) {
    const c = this.profile.docColorControls!;
    const pt = parseFloat((document.querySelector(c.fontSize) as HTMLInputElement | null)?.value ?? '') || 11;
    const zoom = (parseFloat((document.querySelector(c.zoom) as HTMLInputElement | null)?.value ?? '') || 100) / 100;
    const q: TextColorQuery = {
      id: ++this.querySeq, color: raw, px: (pt * 4) / 3 * zoom,
      style: document.querySelector(c.paragraphStyle)?.textContent ?? '',
    };
    const onAnswer = (e: Event) => {
      const a = JSON.parse(String((e as CustomEvent).detail)) as { id: number; color: string | null };
      if (a.id !== q.id) return;
      window.removeEventListener(ANSWER_EVENT, onAnswer);
      const color = a.color ? parseColor(a.color) : null;
      if (color && this.mapper) this.setInline(el, attr, prop, color);
    };
    window.addEventListener(ANSWER_EVENT, onAnswer);
    window.dispatchEvent(new CustomEvent(QUERY_EVENT, { detail: JSON.stringify(q) }));
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
