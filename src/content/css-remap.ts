// Extracts color declarations from Google's stylesheets once, then re-renders them for any theme.
import { NAMED_COLOR_WORDS, parseColor, toOklch } from '../theme/color';
import type { Mapper } from '../theme/map';
import type { ColorKind } from '../theme/types';

export interface ColorDecl {
  prop: string;
  value: string;
  kind: ColorKind;
  important: boolean;
  /** Custom property holding a bare "r,g,b" triple (used as rgba(var(--x-rgb), a)). */
  triple?: boolean;
}

const TRIPLE_RE = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/;
/** rgba(var(--name, r, g, b), alpha) — Material 3's way of applying alpha to a theme color. */
const VAR_RGB_RE = /\brgba?\(\s*var\(\s*(--[\w-]+)\s*(?:,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*)?\)\s*(?:,\s*([\d.]+%?)\s*)?\)/gi;

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
  // on-primary sits on a solid accent; on-primary-container/-fixed sit on pale tints (normal text)
  if (/(^|-)on-(primary|secondary|tertiary|error|accent)(-rgb)?$/.test(n)) return 'onAccent';
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
    .map((part, i) => (i % 2 ? part : remapPart(part, kind, mapper)))
    .join('');
}

function remapPart(part: string, kind: ColorKind, mapper: Mapper): string {
  // First rgba(var(--x-rgb, r, g, b), a): map the fallback triple and alpha, keep the var name
  // (its definition is remapped separately as a triple).
  const vars: string[] = [];
  part = part.replace(VAR_RGB_RE, (m, name: string, r?: string, g?: string, b?: string, a?: string) => {
    const alpha = a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
    let out = m;
    if (r !== undefined) {
      const c = parseColor(`rgba(${r}, ${g}, ${b}, ${alpha})`);
      if (c) {
        const mc = mapper.mapRGBA(c, kind);
        out = `rgba(var(${name}, ${Math.round(mc.r)}, ${Math.round(mc.g)}, ${Math.round(mc.b)}), ${+mc.a.toFixed(3)})`;
      }
    } else if (kind === 'text' && alpha < 1) {
      out = m.replace(/,\s*[\d.]+%?\s*\)$/, `, ${+mapper.mapRGBA({ r: 0, g: 0, b: 0, a: alpha }, kind).a.toFixed(3)})`);
    }
    vars.push(out);
    return `\u0000${vars.length - 1}\u0000`;
  });
  part = part.replace(COLOR_TOKEN, (tok) => mapper.map(tok, kind));
  return part.replace(/\u0000(\d+)\u0000/g, (_, i: string) => vars[+i]);
}

/** Maps a custom property holding "r,g,b". */
export function remapTriple(value: string, kind: ColorKind, mapper: Mapper): string {
  const m = TRIPLE_RE.exec(value);
  if (!m) return value;
  const c = mapper.mapRGBA({ r: +m[1], g: +m[2], b: +m[3], a: 1 }, kind);
  return `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)}`;
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

/**
 * Shorthands whose longhands read back empty when the value contains var() ("pending
 * substitution"); for those we must remap the shorthand text itself.
 */
const SHORTHANDS: [string, ColorKind][] = [
  ['background', 'fill'], ['border', 'line'], ['border-top', 'line'], ['border-right', 'line'],
  ['border-bottom', 'line'], ['border-left', 'line'], ['border-color', 'line'], ['outline', 'line'],
  ['border-block', 'line'], ['border-inline', 'line'], ['border-block-start', 'line'],
  ['border-block-end', 'line'], ['border-inline-start', 'line'], ['border-inline-end', 'line'],
];

const urlOf = (v: string) => /url\(\s*["']?([^"')]+)/i.exec(v)?.[1];

/**
 * Whether an image URL on this rule is a monochrome UI glyph that should be inverted on dark
 * themes. Colored artwork (logos, branding, photos, "color" sprites) is left alone.
 */
function isGlyphIcon(selector: string, url: string): boolean {
  if (NOT_ICON_SEL.test(selector) || /colou?r|logo|branding|avatar|photo|emoji/i.test(url)) return false;
  return /grey|gray|black|dark|mono/i.test(url) || ICON_SEL.test(selector) || /sprite|icon/i.test(url);
}

/**
 * Every declaration of a color property is kept, even non-color values like `inherit`,
 * `transparent` or `var(--x)`: the override sheet must reproduce the source's cascade order,
 * otherwise a remapped early rule would beat a later `background: inherit` in the same sheet.
 */
export function extractStyleRule(selector: string, style: CSSStyleDeclaration, docHints: string[], wrappers: string[]): ColorRule | null {
  const decls: ColorDecl[] = [];
  let imageUrl: string | undefined;
  let strongBg = false;
  for (const [prop, kind] of SHORTHANDS) {
    const value = style.getPropertyValue(prop);
    if (!value || !value.includes('var(')) continue;
    decls.push({ prop, value, kind, important: style.getPropertyPriority(prop) === 'important' });
    if (prop === 'background') imageUrl ??= urlOf(value);
  }
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    const value = style.getPropertyValue(prop);
    if (!value) continue;
    if (prop === 'background-image' || prop === 'content') imageUrl ??= urlOf(value);
    let kind: ColorKind | null;
    let triple = false;
    if (prop.startsWith('--')) {
      const t = TRIPLE_RE.exec(value);
      triple = !!t;
      kind = kindForVariable(prop, t ? `rgb(${t[1]},${t[2]},${t[3]})` : value);
    } else kind = kindForProperty(prop);
    if (!kind) continue;
    if (triple) {
      decls.push({ prop, value, kind, important: style.getPropertyPriority(prop) === 'important', triple });
      continue;
    }
    const varName = /^var\(\s*(--[\w-]+)/.exec(value)?.[1];
    if (kind === 'text' && varName) {
      const vk = kindForVariable(varName, '#ffffff');
      // Text painted in a surface color is deliberately invisible (e.g. Docs' title <input>,
      // whose visible text is a separate label): keep it matching the surface.
      if (vk === 'onAccent' || vk === 'fill') kind = vk;
    }
    if (prop === 'background-color' && isStrongChromatic(value)) strongBg = true;
    decls.push({ prop, value, kind, important: style.getPropertyPriority(prop) === 'important' });
  }
  // White text on a solid accent background (buttons): text becomes the theme background color.
  if (strongBg) for (const d of decls) if (d.prop === 'color' && isLight(d.value)) d.kind = 'onAccent';
  const icon = !!imageUrl && isGlyphIcon(selector, imageUrl);
  if (!icon && !decls.length) return null;
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
      const v = d.triple ? remapTriple(d.value, d.kind, m) : remapValue(d.value, d.kind, m);
      body += `${d.prop}:${v}${d.important ? ' !important' : ''};`;
    }
    if (r.icon && iconFilter && !r.doc) body += 'filter:var(--wd-icon-filter) !important;';
    if (!body) continue;
    let text = `${r.selector}{${body}}`;
    for (let i = r.wrappers.length - 1; i >= 0; i--) text = `${r.wrappers[i]}{${text}}`;
    css += text + '\n';
  }
  return css;
}
