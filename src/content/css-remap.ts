// Extracts color declarations from Google's stylesheets once, then re-renders them for any theme.
import { NAMED_COLOR_WORDS, parseColor, toOklch } from '../theme/color';
import type { Mapper } from '../theme/map';
import type { ColorKind } from '../theme/types';

export interface ColorDecl {
  prop: string;
  value: string;
  kind: ColorKind;
  important: boolean;
}

export interface ColorRule {
  /** Wrapping at-rule preludes, e.g. ["@media (max-width: 600px)"]. */
  wrappers: string[];
  selector: string;
  decls: ColorDecl[];
  /** Background-image icon that needs the icon filter on dark UI themes. */
  icon: boolean;
  /** Styles the document surface (themed by the document theme, never the UI theme). */
  doc: boolean;
}

const TEXT_PROPS = new Set([
  'color', 'fill', 'stroke', 'caret-color', 'text-decoration-color', '-webkit-text-fill-color',
  '-webkit-text-stroke-color', 'text-emphasis-color',
]);
const FILL_PROPS = new Set(['background-color', 'background-image']);

export function kindForProperty(prop: string): ColorKind | null {
  if (TEXT_PROPS.has(prop)) return 'text';
  if (FILL_PROPS.has(prop)) return 'fill';
  if (/^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?-color$/.test(prop)) return 'line';
  if (prop === 'outline-color' || prop === 'column-rule-color') return 'line';
  return null;
}

/** Guesses how a CSS custom property holding a color is used, from its name and value. */
export function kindForVariable(name: string, value: string): ColorKind | null {
  const v = value.trim();
  const c = parseColor(v);
  if (!c) return null;
  const n = name.toLowerCase();
  if (/(^|-)on-(primary|secondary|tertiary|error|accent)/.test(n)) return 'onAccent';
  if (/(^|-)on-|text|foreground|(^|-)fg(-|$)|font|ink|icon|label|title|caption/.test(n)) return 'text';
  if (/outline|border|divider|stroke|separator|(^|-)line(-|$)|rule/.test(n)) return 'line';
  if (/surface|background|(^|-)bg(-|$)|container|fill|scrim|overlay|highlight|hover|state|tint|shadow|backdrop/.test(n)) return 'fill';
  return toOklch(c)[0] > 0.6 ? 'fill' : 'text';
}

const COLOR_TOKEN = new RegExp(
  `#[0-9a-fA-F]{3,8}\\b|\\b(?:rgba?|hsla?)\\([^()]*\\)|\\b(?:${NAMED_COLOR_WORDS.join('|')})\\b`,
  'gi',
);

/** Replaces every color token in a CSS value, leaving url(...) contents untouched. */
export function remapValue(value: string, kind: ColorKind, mapper: Mapper): string {
  return value
    .split(/(url\([^)]*\))/i)
    .map((part, i) => (i % 2 ? part : part.replace(COLOR_TOKEN, (tok) => mapper.map(tok, kind))))
    .join('');
}

function hasColorToken(value: string): boolean {
  COLOR_TOKEN.lastIndex = 0;
  const parts = value.split(/url\([^)]*\)/i);
  return parts.some((p) => {
    COLOR_TOKEN.lastIndex = 0;
    return COLOR_TOKEN.test(p);
  });
}

const ICON_SEL = /icon/i;
const NOT_ICON_SEL = /avatar|logo|photo|profile|favicon|thumbnail|emoji|branding|product/i;

function isStrongChromatic(value: string): boolean {
  const c = parseColor(value.trim());
  if (!c || c.a < 0.5) return false;
  const [L, C] = toOklch(c);
  return C > 0.1 && L < 0.75;
}

function isLight(value: string): boolean {
  const c = parseColor(value.trim());
  return !!c && toOklch(c)[0] > 0.9 && toOklch(c)[1] < 0.02;
}

type RuleLike = CSSRule & {
  selectorText?: string;
  style?: CSSStyleDeclaration;
  cssRules?: CSSRuleList;
  conditionText?: string;
  media?: MediaList;
  name?: string;
  styleSheet?: CSSStyleSheet | null;
};

/** Walks a rule list and returns only the rules that set colors. */
export function extractColorRules(rules: CSSRuleList, docHints: string[], wrappers: string[] = []): ColorRule[] {
  const out: ColorRule[] = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as RuleLike;
    if (rule.selectorText !== undefined && rule.style) {
      const r = extractStyleRule(rule.selectorText, rule.style, docHints, wrappers);
      if (r) out.push(r);
      // CSS nesting: nested rules inherit the selector context, which we can't replicate simply.
    } else if (rule.cssRules) {
      let prelude: string | null = null;
      if (rule.media) prelude = `@media ${rule.media.mediaText}`;
      else if (rule.conditionText !== undefined) prelude = `@supports ${rule.conditionText}`;
      else if (rule.name !== undefined && rule.constructor?.name?.includes('Layer')) prelude = `@layer ${rule.name}`;
      if (prelude) out.push(...extractColorRules(rule.cssRules, docHints, [...wrappers, prelude]));
    } else if (rule.styleSheet) {
      try {
        out.push(...extractColorRules(rule.styleSheet.cssRules, docHints, wrappers));
      } catch {
        // cross-origin @import: skipped
      }
    }
  }
  return out;
}

export function extractStyleRule(selector: string, style: CSSStyleDeclaration, docHints: string[], wrappers: string[]): ColorRule | null {
  const decls: ColorDecl[] = [];
  let bgImageUrl = false;
  let strongBg = false;
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    const value = style.getPropertyValue(prop);
    if (!value) continue;
    if (prop === 'background-image' && /url\(/i.test(value)) bgImageUrl = true;
    let kind: ColorKind | null;
    if (prop.startsWith('--')) kind = kindForVariable(prop, value);
    else kind = hasColorToken(value) ? kindForProperty(prop) : null;
    if (!kind) continue;
    if (prop === 'background-color' && isStrongChromatic(value)) strongBg = true;
    decls.push({ prop, value, kind, important: style.getPropertyPriority(prop) === 'important' });
  }
  // White text on a solid accent background (buttons): text becomes the theme background color.
  if (strongBg) for (const d of decls) if (d.prop === 'color' && isLight(d.value)) d.kind = 'onAccent';
  const icon = bgImageUrl && ICON_SEL.test(selector) && !NOT_ICON_SEL.test(selector);
  if (!decls.length && !icon) return null;
  return { wrappers, selector, decls, icon, doc: docHints.some((h) => selector.includes(h)) };
}

/** Renders override CSS for extracted rules. Rules for the document surface use `doc`. */
export function renderRules(rules: ColorRule[], ui: Mapper | null, doc: Mapper | null, iconFilter: boolean): string {
  let css = '';
  for (const r of rules) {
    const m = r.doc ? doc : ui;
    if (!m) continue;
    let body = '';
    for (const d of r.decls) {
      const v = remapValue(d.value, d.kind, m);
      if (v !== d.value) body += `${d.prop}:${v}${d.important ? ' !important' : ''};`;
    }
    if (r.icon && iconFilter && !r.doc) body += 'filter:var(--wd-icon-filter) !important;';
    if (!body) continue;
    let text = `${r.selector}{${body}}`;
    for (let i = r.wrappers.length - 1; i >= 0; i--) text = `${r.wrappers[i]}{${text}}`;
    css += text + '\n';
  }
  return css;
}
