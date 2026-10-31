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

/** How a custom property is used, judging by its name alone; null when the name doesn't say. */
export function kindFromVariableName(name: string): ColorKind | null {
  const n = name.toLowerCase();
  // on-primary sits on a solid accent; on-primary-container/-fixed sit on pale tints (normal text)
  if (/(^|-)on-(primary|secondary|tertiary|error|accent)(-rgb)?$/.test(n)) return 'onAccent';
  if (/(^|-)on-|text|foreground|(^|-)fg(-|$)|font|ink|icon|label|title|caption/.test(n)) return 'text';
  if (/outline|border|divider|stroke|separator|(^|-)line(-|$)|rule/.test(n)) return 'line';
  if (/surface|background|(^|-)bg(-|$)|container|fill|scrim|overlay|highlight|hover|state|tint|shadow|backdrop/.test(n)) return 'fill';
  return null;
}

/** Guesses how a CSS custom property holding a color is used, from its name and value. */
export function kindForVariable(name: string, value: string): ColorKind | null {
  const c = parseColor(value.trim());
  if (!c) return null;
  return kindFromVariableName(name) ?? (toOklch(c)[0] > 0.6 ? 'fill' : 'text');
}

/**
 * Every color variable also gets a text twin (`--wd-t--name`, mapped as text), and text
 * properties read the twin first: a variable shared by filled buttons and labels (Material's
 * `primary`) is then readable as text and solid as a fill. Variables we never saw defined
 * fall back to the original.
 */
const twinName = (name: string) => `--wd-t${name}`;

/** Refers to an on-primary-style color: text that sits on a solid accent (filled button labels). */
const ON_ACCENT_REF = /var\(\s*--[\w-]*?(?:^|-)on-(?:primary|secondary|tertiary|error|accent)(?:-rgb)?\s*[,)]/;

export function withTextTwins(value: string): string {
  let out = '';
  const closers: number[] = []; // paren depths at which a twin's extra ")" is due
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const m = value.startsWith('var(', i) ? /^var\(\s*(--[\w-]+)/.exec(value.slice(i)) : null;
    if (m && !m[1].startsWith('--wd-t')) {
      out += `var(${twinName(m[1])}, var(`;
      closers.push(depth);
      depth++;
      i += 3;
      continue;
    }
    const ch = value[i];
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      out += ')';
      if (closers.length && closers[closers.length - 1] === depth) {
        closers.pop();
        out += ')';
      }
      continue;
    }
    out += ch;
  }
  return out;
}

// Named colors only as whole words: "grey" inside --ws-sys-color-extended-grey-fill is a name part.
const COLOR_TOKEN = new RegExp(
  `#[0-9a-fA-F]{3,8}\\b|\\b(?:rgba?|hsla?)\\([^()]*\\)|(?<![\\w-])(?:${NAMED_COLOR_WORDS.join('|')})(?![\\w-])`,
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
export function extractColorRules(rules: CSSRuleList, wrappers: string[] = []): ColorRule[] {
  const out: ColorRule[] = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as RuleLike;
    if (rule.selectorText !== undefined && rule.style) {
      const r = extractStyleRule(rule.selectorText, rule.style, wrappers);
      if (r) out.push(r);
      // CSS nesting: nested rules inherit the selector context, which we can't replicate simply.
    } else if (rule.cssRules) {
      let prelude: string | null = null;
      if (rule.media) prelude = `@media ${rule.media.mediaText}`;
      else if (rule.conditionText !== undefined) prelude = `@supports ${rule.conditionText}`;
      else if (rule.name !== undefined && rule.constructor?.name?.includes('Layer')) prelude = `@layer ${rule.name}`;
      if (prelude) out.push(...extractColorRules(rule.cssRules, [...wrappers, prelude]));
    } else if (rule.styleSheet) {
      try {
        out.push(...extractColorRules(rule.styleSheet.cssRules, wrappers));
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
export function extractStyleRule(selector: string, style: CSSStyleDeclaration, wrappers: string[] = []): ColorRule | null {
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
    // An alias (--a: var(--b, #fallback)): Material components define their colors this way, and the
    // fallback is what shows when --b is undefined. Remap it (kind from the name, else the
    // fallback color), and keep the text chain: its twin reads the twin of what it points to.
    if (!kind && prop.startsWith('--') && value.includes('var(')) {
      const important = style.getPropertyPriority(prop) === 'important';
      if (ON_ACCENT_REF.test(value)) {
        decls.push({ prop: twinName(prop), value, kind: 'onAccent', important }, { prop, value, kind: 'onAccent', important });
        continue;
      }
      decls.push({ prop: twinName(prop), value: withTextTwins(value), kind: 'text', important });
      const fallback = value.match(COLOR_TOKEN)?.pop();
      const ak = kindFromVariableName(prop) ?? (fallback ? kindForVariable(prop, fallback) : null);
      if (ak) decls.push({ prop, value, kind: ak, important });
      continue;
    }
    if (!kind) continue;
    const important = style.getPropertyPriority(prop) === 'important';
    if (triple) {
      decls.push({ prop, value, kind, important, triple });
      continue;
    }
    let v = value;
    if (prop.startsWith('--')) {
      decls.push({ prop: twinName(prop), value, kind: 'text', important });
    } else if (kind === 'text' && value.includes('var(')) {
      const ref = /^var\(\s*(--[\w-]+)/.exec(value)?.[1] ?? '';
      const vk = kindFromVariableName(ref);
      // Text painted in the page surface color is deliberately invisible (e.g. Docs' title <input>,
      // whose visible text is a separate label): keep it matching the surface. Other "fill" names
      // (Google's extended-grey-fill) are ordinary text colors.
      if (vk === 'onAccent' || (vk === 'fill' && /surface|background|(^|-)bg(-|$)/i.test(ref))) kind = vk;
      else if (ON_ACCENT_REF.test(value)) kind = 'onAccent';
      else v = withTextTwins(value);
    }
    if (prop === 'background-color' && isStrongChromatic(value)) strongBg = true;
    decls.push({ prop, value: v, kind, important });
  }
  // White text on a solid accent background (buttons): text becomes the theme background color.
  if (strongBg) for (const d of decls) if (d.prop === 'color' && isLight(d.value)) d.kind = 'onAccent';
  const icon = !!imageUrl && isGlyphIcon(selector, imageUrl);
  if (!icon && !decls.length) return null;
  return { wrappers, selector, decls, icon };
}

/** Renders override CSS for extracted rules. */
export function renderRules(rules: ColorRule[], m: Mapper, iconFilter: boolean): string {
  let css = '';
  for (const r of rules) {
    let body = '';
    for (const d of r.decls) {
      const v = d.triple ? remapTriple(d.value, d.kind, m) : remapValue(d.value, d.kind, m);
      body += `${d.prop}:${v}${d.important ? ' !important' : ''};`;
    }
    if (r.icon && iconFilter) body += 'filter:var(--wd-icon-filter) !important;';
    if (!body) continue;
    let text = `${r.selector}{${body}}`;
    for (let i = r.wrappers.length - 1; i >= 0; i--) text = `${r.wrappers[i]}{${text}}`;
    css += text + '\n';
  }
  return css;
}
