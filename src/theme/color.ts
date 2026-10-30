// Color parsing/formatting, OKLab/OKLCH conversion, WCAG contrast.

/** r,g,b in 0..255 (may be fractional), a in 0..1. */
export interface RGBA { r: number; g: number; b: number; a: number }
export type Lab = [L: number, a: number, b: number];
export type LCH = [L: number, C: number, H: number];

const NAMED: Record<string, string> = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00',
  gray: '808080', grey: '808080', silver: 'c0c0c0', orange: 'ffa500', purple: '800080', navy: '000080',
  teal: '008080', maroon: '800000', lime: '00ff00', aqua: '00ffff', cyan: '00ffff', fuchsia: 'ff00ff',
  magenta: 'ff00ff', olive: '808000', whitesmoke: 'f5f5f5', gainsboro: 'dcdcdc', lightgray: 'd3d3d3',
  lightgrey: 'd3d3d3', darkgray: 'a9a9a9', darkgrey: 'a9a9a9', dimgray: '696969', dimgrey: '696969',
  ghostwhite: 'f8f8ff', snow: 'fffafa', ivory: 'fffff0', linen: 'faf0e6', aliceblue: 'f0f8ff',
  // CSS system colors (light-scheme values; we map them like any other color)
  graytext: '6d6d6d', canvas: 'ffffff', canvastext: '000000', buttonface: 'efefef', buttontext: '000000',
  field: 'ffffff', fieldtext: '000000', linktext: '0000ee', highlight: '3584e4', highlighttext: 'ffffff',
};

export const NAMED_COLOR_WORDS = Object.keys(NAMED);

export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s[0] === '#') return parseHex(s.slice(1));
  if (NAMED[s]) return parseHex(NAMED[s]);
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const alpha = parts.length > 3 ? parseNum(parts[3], 1) : 1;
  if (fn[1].startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => parseNum(p, 255));
    if ([r, g, b, alpha].some(Number.isNaN)) return null;
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(alpha, 0, 1) };
  }
  const h = parseFloat(parts[0]);
  const sat = parseNum(parts[1], 1);
  const l = parseNum(parts[2], 1);
  if ([h, sat, l, alpha].some(Number.isNaN)) return null;
  return { ...hslToRgb(h, sat, l), a: clamp(alpha, 0, 1) };
}

function parseNum(p: string, scale: number): number {
  if (p.endsWith('%')) return (parseFloat(p) / 100) * scale;
  const n = parseFloat(p);
  // hsl saturation/lightness written without % in some legacy code
  return scale === 1 && n > 1 ? n / 100 : n;
}

function parseHex(h: string): RGBA | null {
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
}

function hslToRgb(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function formatColor(c: RGBA): string {
  const r = Math.round(clamp(c.r, 0, 255));
  const g = Math.round(clamp(c.g, 0, 255));
  const b = Math.round(clamp(c.b, 0, 255));
  if (c.a >= 0.999) return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  return `rgba(${r}, ${g}, ${b}, ${+c.a.toFixed(3)})`;
}

/** #rrggbbaa without the hash; used for compact attribute values. */
export function hex8(c: RGBA): string {
  const a = Math.round(clamp(c.a, 0, 1) * 255);
  return formatColor({ ...c, a: 1 }).slice(1) + (a | 256).toString(16).slice(1);
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

const toLinear = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

export function toOklab(c: RGBA): Lab {
  const r = toLinear(c.r), g = toLinear(c.g), b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function fromOklab(lab: Lab, a = 1): RGBA {
  const [r, g, b] = oklabToLinear(lab);
  return { r: fromLinear(r), g: fromLinear(g), b: fromLinear(b), a };
}

export function toOklch(c: RGBA): LCH {
  const [L, a, b] = toOklab(c);
  const C = Math.hypot(a, b);
  const H = C < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

/** OKLCH → sRGB, reducing chroma until the color fits the sRGB gamut. */
export function fromOklch([L, C, H]: LCH, a = 1): RGBA {
  L = clamp(L, 0, 1);
  const rad = (H * Math.PI) / 180;
  const inGamut = (c: number) => oklabToLinear([L, c * Math.cos(rad), c * Math.sin(rad)]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (!inGamut(C)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(mid)) lo = mid; else hi = mid;
    }
    C = lo;
  }
  return fromOklab([L, C * Math.cos(rad), C * Math.sin(rad)], a);
}

export function mixOklab(x: RGBA, y: RGBA, t: number, a = x.a + (y.a - x.a) * t): RGBA {
  const p = toOklab(x), q = toOklab(y);
  return fromOklab([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t], a);
}

export function luminance(c: RGBA): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

export function contrast(x: RGBA, y: RGBA): number {
  const a = luminance(x), b = luminance(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Moves lightness away from `bg` (keeping hue) until contrast ≥ target. */
export function ensureContrast(c: RGBA, bg: RGBA, target: number): RGBA {
  if (contrast(c, bg) >= target) return c;
  const [L, C, H] = toOklch(c);
  const up = luminance(bg) < 0.18;
  let best = c;
  for (let i = 1; i <= 40; i++) {
    const nl = clamp(L + (up ? 1 : -1) * i * 0.02, 0, 1);
    best = fromOklch([nl, C, H], c.a);
    if (contrast(best, bg) >= target || nl === 0 || nl === 1) break;
  }
  return best;
}

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
