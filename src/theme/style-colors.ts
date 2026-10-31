// The exact color each paragraph style is painted with. Shared by the canvas hook (painting) and
// the panel (showing it), so the two can never disagree.
import { ensureContrast, formatColor, parseColor, toOklab } from './color';
import { createMapper } from './map';
import { schemeToRoles } from './roles';
import { DEFAULT_STYLE_SLOTS, STYLE_KEYS, type StyleKey, type ThemeSpec } from './types';

/** Palette slots offered for paragraph-style colors: text shades plus every accent. */
export const STYLE_SLOT_CHOICES = [
  'base04', 'base05', 'base06', 'base08', 'base09', 'base0A', 'base0B', 'base0C', 'base0D', 'base0E', 'base0F',
  'base12', 'base13', 'base14', 'base15', 'base16', 'base17',
];

/** A style's value is a palette slot ("base0D") or, for colors outside the palette, "#rrggbb". */
export function resolveStyleValue(spec: ThemeSpec, value: string, key: StyleKey): string {
  const roles = schemeToRoles(spec.scheme);
  const c = parseColor(value.startsWith('#') ? value : spec.scheme.palette[value] ?? '') ?? roles.fg;
  // Only nudged when unreadable on the theme's background (3:1 for heading-sized text).
  const min = key === 'normal' || key === 'link' || key === 'code' ? 4.5 : 3;
  return formatColor({ ...ensureContrast(c, roles.bg, min), a: 1 });
}

/** Default ink (black / dark grey): text that keeps the theme's own colors. */
export function isInkColor(css: string): boolean {
  const c = parseColor(css);
  if (!c) return false;
  const L = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 24 && L < 128;
}

export function styleColors(spec: ThemeSpec): Record<StyleKey, string> {
  const slots = { ...DEFAULT_STYLE_SLOTS, ...spec.options.styleSlots };
  return Object.fromEntries(STYLE_KEYS.map((k) => [k, resolveStyleValue(spec, slots[k], k)])) as Record<StyleKey, string>;
}

/**
 * How a color the user gave a paragraph style in Docs looks in this theme: the palette slot it
 * lands on, or the themed color itself when it isn't one of the palette's.
 */
export function styleValueForDocColor(spec: ThemeSpec, raw: string, key: StyleKey): string {
  const themed = createMapper(schemeToRoles(spec.scheme), spec.options).map(raw, 'text');
  const target = parseColor(themed);
  if (!target) return DEFAULT_STYLE_SLOTS[key];
  const [L, a, b] = toOklab(target);
  let best: string | null = null;
  let bestD = Infinity;
  for (const slot of STYLE_SLOT_CHOICES) {
    if (!spec.scheme.palette[slot]) continue;
    // compare with the palette color as-is and as nudged for readability
    for (const hex of [spec.scheme.palette[slot], resolveStyleValue(spec, slot, key)]) {
      const [L2, a2, b2] = toOklab(parseColor(hex)!);
      const d = Math.hypot(L - L2, a - a2, b - b2);
      if (d < bestD) { bestD = d; best = slot; }
    }
  }
  // the same palette color (allowing for small readability nudges) → select that palette color
  if (best && bestD < 0.06) return best;
  return formatColor({ ...target, a: 1 });
}
