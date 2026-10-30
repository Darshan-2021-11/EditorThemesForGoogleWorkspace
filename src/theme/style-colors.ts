// The exact color each paragraph style is painted with. Shared by the canvas hook (painting) and
// the panel (showing it), so the two can never disagree.
import { ensureContrast, formatColor, parseColor } from './color';
import { schemeToRoles } from './roles';
import { DEFAULT_STYLE_SLOTS, STYLE_KEYS, type StyleKey, type ThemeSpec } from './types';

/**
 * Palette color for each style; only nudged when a theme's accent would be unreadable on its own
 * background (3:1 is enough for large heading text; body-sized text gets 4.5:1).
 */
export function styleColors(spec: ThemeSpec): Record<StyleKey, string> {
  const roles = schemeToRoles(spec.scheme);
  const slots = { ...DEFAULT_STYLE_SLOTS, ...spec.options.styleSlots };
  const pick = (k: StyleKey) => {
    const c = parseColor(spec.scheme.palette[slots[k]] ?? '') ?? roles.fg;
    const min = k === 'normal' || k === 'link' || k === 'code' ? 4.5 : 3;
    return formatColor({ ...ensureContrast(c, roles.bg, min), a: 1 });
  };
  return Object.fromEntries(STYLE_KEYS.map((k) => [k, pick(k)])) as Record<StyleKey, string>;
}
