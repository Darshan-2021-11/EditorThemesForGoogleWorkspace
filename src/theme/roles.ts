// Turns a Base16/Base24 palette into semantic roles used by the mapper.
import { luminance, parseColor, type RGBA } from './color';
import type { Scheme } from './types';

export const ACCENT_NAMES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

/** Canonical OKLCH hues of each accent slot; input colors snap to the nearest slot. */
export const CANONICAL_HUES: Record<AccentName, number> = {
  red: 27, orange: 58, yellow: 100, green: 145, cyan: 200, blue: 262, purple: 315,
};

const ACCENT_SLOTS: Record<AccentName, string> = {
  red: 'base08', orange: 'base09', yellow: 'base0A', green: 'base0B', cyan: 'base0C', blue: 'base0D', purple: 'base0E',
};

export interface Roles {
  isDark: boolean;
  bg: RGBA;
  surface: RGBA;
  surfaceAlt: RGBA;
  muted: RGBA;
  fgMuted: RGBA;
  fg: RGBA;
  fgStrong: RGBA;
  selection: RGBA;
  accents: Record<AccentName, RGBA>;
  link: RGBA;
  heading: RGBA;
  code: RGBA;
  /** Grey ramp: position t (0 = page white, 1 = black ink) → theme color. */
  ramp: { t: number; c: RGBA }[];
}

function col(scheme: Scheme, key: string, fallback = '#808080'): RGBA {
  return parseColor(scheme.palette[key] ?? fallback) ?? parseColor(fallback)!;
}

export function schemeToRoles(scheme: Scheme): Roles {
  const c = (k: string, fb?: string) => col(scheme, k, fb);
  const bg = c('base00');
  const fg = c('base05');
  const accents = Object.fromEntries(ACCENT_NAMES.map((n) => [n, c(ACCENT_SLOTS[n])])) as Record<AccentName, RGBA>;
  return {
    isDark: luminance(bg) < luminance(fg),
    bg,
    surface: c('base01'),
    surfaceAlt: c('base02'),
    muted: c('base03'),
    fgMuted: c('base04'),
    fg,
    fgStrong: c('base06'),
    selection: c('base02'),
    accents,
    link: accents.cyan,
    heading: accents.blue,
    code: accents.green,
    ramp: [
      { t: 0, c: bg },
      { t: 0.04, c: c('base01') },
      { t: 0.1, c: c('base02') },
      { t: 0.3, c: c('base03') },
      { t: 0.55, c: c('base04') },
      { t: 0.8, c: fg },
      { t: 1, c: fg },
    ],
  };
}

export function nearestAccent(hue: number): AccentName {
  let best: AccentName = 'red';
  let bestD = Infinity;
  for (const n of ACCENT_NAMES) {
    const d = Math.abs(((hue - CANONICAL_HUES[n] + 540) % 360) - 180);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** CSS custom properties describing a theme, for the panel and generated stylesheets. */
export function rolesToCssVars(r: Roles, prefix: string): string {
  const hex = (x: RGBA) => '#' + [x.r, x.g, x.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const vars: Record<string, RGBA> = {
    bg: r.bg, surface: r.surface, 'surface-alt': r.surfaceAlt, muted: r.muted, 'fg-muted': r.fgMuted,
    fg: r.fg, 'fg-strong': r.fgStrong, selection: r.selection, ...r.accents,
  };
  return Object.entries(vars).map(([k, v]) => `--${prefix}-${k}:${hex(v)};`).join('');
}
