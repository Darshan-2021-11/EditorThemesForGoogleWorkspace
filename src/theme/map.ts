// Maps an arbitrary page color onto a theme, depending on what the color is used for.
import {
  clamp, ensureContrast, formatColor, fromOklch, mixOklab, parseColor, toOklch, type RGBA,
} from './color';
import { nearestAccent, schemeToRoles, type AccentName, type Roles } from './roles';
import type { ColorKind, ThemeOptions, ThemeSpec } from './types';

/** Below this OKLCH chroma a color is treated as grey. */
const GREY_CHROMA = 0.02;

/**
 * Google's own UI/editor palette. These carry meaning (links, suggestions, comments, errors)
 * and always map to the matching theme role.
 */
const SEMANTIC: Record<string, AccentName | 'link'> = {
  '#1155cc': 'link',
  '#1a73e8': 'blue', '#4285f4': 'blue', '#1967d2': 'blue', '#0b57d0': 'blue', '#185abc': 'blue',
  '#8ab4f8': 'blue', '#d2e3fc': 'blue', '#e8f0fe': 'blue', '#d3e3fd': 'blue', '#c2e7ff': 'blue',
  '#d93025': 'red', '#ea4335': 'red', '#c5221f': 'red', '#b3261e': 'red', '#fce8e6': 'red',
  '#f9ab00': 'yellow', '#fbbc04': 'yellow', '#fdd663': 'yellow', '#fde293': 'yellow',
  '#fef7e0': 'yellow', '#feefc3': 'yellow', '#fce8b2': 'yellow',
  '#188038': 'green', '#1e8e3e': 'green', '#34a853': 'green', '#137333': 'green',
  '#ceead6': 'green', '#e6f4ea': 'green',
};

export interface Mapper {
  readonly roles: Roles;
  readonly options: ThemeOptions;
  /** Maps a CSS color string; returns the input unchanged if it isn't a parseable color. */
  map(css: string, kind: ColorKind): string;
  mapRGBA(c: RGBA, kind: ColorKind, hex?: string): RGBA;
}

export function rampAt(roles: Roles, t: number): RGBA {
  const r = roles.ramp;
  t = clamp(t, 0, 1);
  for (let i = 1; i < r.length; i++) {
    if (t <= r[i].t) {
      const span = r[i].t - r[i - 1].t;
      return mixOklab(r[i - 1].c, r[i].c, span ? (t - r[i - 1].t) / span : 0, 1);
    }
  }
  return r[r.length - 1].c;
}

/**
 * Text color readable (≥ target, WCAG) on every surface the theme paints UI and pages with —
 * background, panels, raised panels — plus `tint` (the pale fill of the text's own hue, as on a
 * selected item), so it can't fail when it lands on any of them.
 */
export function readableOnSurfaces(c: RGBA, roles: Roles, target: number, tint?: RGBA): RGBA {
  let out = c;
  // the surfaces sit on one side of the text's lightness: a couple of passes settle on all of them
  for (let pass = 0; pass < 2; pass++) {
    for (const s of [roles.bg, roles.surface, roles.surfaceAlt, ...(tint ? [tint] : [])]) out = ensureContrast(out, s, target);
  }
  return out;
}

/** WCAG AA for body text. */
const TEXT_CONTRAST = 4.5;

export function createMapper(roles: Roles, options: ThemeOptions): Mapper {
  const cache = new Map<string, string>();

  function withAlpha(c: RGBA, a: number): RGBA {
    return { r: c.r, g: c.g, b: c.b, a };
  }

  function mapGrey(L: number, c: RGBA, kind: ColorKind): RGBA {
    let t = 1 - L;
    if (kind === 'text') {
      if (t < 0.12) t = 1 - t; // light text sits on dark/colored surfaces: keep it readable
      const out = rampAt(roles, t);
      return withAlpha(t >= 0.12 ? readableOnSurfaces(out, roles, TEXT_CONTRAST) : out, c.a);
    }
    if (kind === 'graphic') return withAlpha(rampAt(roles, t), c.a);
    if (kind === 'fill' && t > 0.6) t = 0.1 + (1 - t) * 0.25; // dark surfaces (tooltips) stay dark-ish
    return withAlpha(rampAt(roles, t), c.a);
  }

  /** A solid accent surface that text in the theme's background color stays readable on. */
  function solid(c: RGBA): RGBA {
    return ensureContrast(c, roles.bg, TEXT_CONTRAST);
  }

  /** The pale fill of a text color's own hue (selected items, chips): text must read on it too. */
  function tintOf(c: RGBA): RGBA {
    return mixOklab(roles.bg, c, 0.3, 1);
  }

  function accentFill(accent: RGBA, L: number, C: number): RGBA {
    // solid buttons/badges, and mid-tone shapes in slides (a frame mustn't melt into its background)
    if ((C > 0.1 && L < 0.75) || (C > 0.07 && L < 0.65)) return solid(accent);
    const k = clamp(0.18 + C * 1.2 + (1 - L) * 0.5, 0.18, 0.6);
    return mixOklab(roles.bg, accent, k, 1);
  }

  function mapChromatic(c: RGBA, [L, C, H]: [number, number, number], kind: ColorKind, forced?: AccentName | 'link'): RGBA {
    const name = forced === 'link' ? (options.styleColors ? null : 'blue') : forced ?? nearestAccent(H);
    const accent = name ? roles.accents[name] : roles.link;
    if (forced || options.mapping === 'snap') {
      if (kind === 'text') return withAlpha(readableOnSurfaces(accent, roles, TEXT_CONTRAST, tintOf(accent)), c.a);
      if (kind === 'line') return withAlpha(accent, c.a);
      return withAlpha(accentFill(accent, L, C), c.a);
    }
    // keep-hue: preserve the hue, re-pick lightness for the theme
    const chroma = Math.min(C, 0.2);
    if (kind === 'text' || kind === 'line') {
      const L0 = roles.isDark ? Math.max(L, 0.72) : Math.min(L, 0.55);
      const out = fromOklch([L0, chroma, H]);
      return withAlpha(kind === 'text' ? readableOnSurfaces(out, roles, TEXT_CONTRAST, tintOf(out)) : out, c.a);
    }
    if (C > 0.1 && L < 0.75) return withAlpha(solid(fromOklch([roles.isDark ? 0.62 : 0.55, Math.min(C, 0.17), H])), c.a);
    const k = clamp(0.18 + C * 1.2 + (1 - L) * 0.5, 0.18, 0.6);
    return withAlpha(mixOklab(roles.bg, fromOklch([0.65, Math.min(C * 1.5, 0.15), H]), k, 1), c.a);
  }

  function mapRGBA(c: RGBA, kind: ColorKind, hex?: string): RGBA {
    if (c.a === 0) return c;
    if (kind === 'onAccent') return withAlpha(roles.bg, c.a);
    const lch = toOklch(c);
    const forced = SEMANTIC[hex ?? formatColor({ ...c, a: 1 })];
    const out = forced ? mapChromatic(c, lch, kind, forced) : lch[1] < GREY_CHROMA ? mapGrey(lch[0], c, kind) : mapChromatic(c, lch, kind);
    if (kind === 'text' && out.a < 1) {
      // Secondary text drawn translucent loses contrast once blended: settle it as a solid,
      // readable color. Fainter ink (≤ 0.5: disabled items) just fades less on dark themes.
      if (c.a >= 0.5) return { ...readableOnSurfaces(mixOklab(roles.bg, out, out.a, 1), roles, TEXT_CONTRAST), a: 1 };
      if (roles.isDark) out.a = 0.3 + out.a * 0.6;
    }
    return out;
  }

  function map(css: string, kind: ColorKind): string {
    const key = kind + css;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const c = parseColor(css);
    const out = c ? formatColor(mapRGBA(c, kind)) : css;
    if (cache.size > 8000) cache.clear();
    cache.set(key, out);
    return out;
  }

  return { roles, options, map, mapRGBA };
}

export function mapperFor(spec: ThemeSpec): Mapper {
  return createMapper(schemeToRoles(spec.scheme), spec.options);
}
