// Pair-aware text contrast for canvas drawing. Text color is mapped without knowing what it's
// drawn on, so the hook remembers recent opaque fill rectangles per context and, when text lands
// on one, nudges the text color until it reads against that fill. Pure (no DOM): unit-tested.
import { contrast, ensureContrast, formatColor, parseColor, type RGBA } from '../theme/color';

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };

/** WCAG AA: 4.5 for body text, 3 for large text (≥ 24px, or bold and ≥ 18.66px). */
export function textTarget(px: number, bold: boolean): number {
  return px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;
}

export interface FontInfo { px: number; bold: boolean }

const fontCache = new Map<string, FontInfo>();
/** Size (CSS px, user space) and weight from a canvas `font` string. */
export function parseFont(font: string): FontInfo {
  let f = fontCache.get(font);
  if (!f) {
    const m = /(\d+(?:\.\d+)?)(px|pt)\b/.exec(font);
    const n = m ? parseFloat(m[1]) : 10;
    f = { px: m?.[2] === 'pt' ? (n * 4) / 3 : n, bold: /\b(bold|bolder|[6-9]00)\b/.test(font) };
    if (fontCache.size > 500) fontCache.clear();
    fontCache.set(font, f);
  }
  return f;
}

/**
 * The last `size` opaque fill rectangles (device pixels) with the color actually painted.
 * A ring buffer over typed arrays: adding never allocates.
 */
export class RectStore {
  private readonly x0: Float64Array;
  private readonly y0: Float64Array;
  private readonly x1: Float64Array;
  private readonly y1: Float64Array;
  private readonly colors: (string | null)[];
  private head = 0;
  private count = 0;
  /** Canvas size the rects belong to; a resize clears the canvas, so they go too. */
  private w = -1;
  private h = -1;

  constructor(private readonly size = 32) {
    this.x0 = new Float64Array(size);
    this.y0 = new Float64Array(size);
    this.x1 = new Float64Array(size);
    this.y1 = new Float64Array(size);
    this.colors = new Array(size).fill(null);
  }

  get length() {
    return this.count;
  }

  private epoch = -1;

  /**
   * Forgets everything when the canvas size changed since the last call (resizing clears it), or
   * the epoch did (a new theme: remembered colors are stale).
   */
  checkSize(w: number, h: number, epoch = 0) {
    if (w !== this.w || h !== this.h || epoch !== this.epoch) {
      this.clear();
      this.w = w;
      this.h = h;
      this.epoch = epoch;
    }
  }

  add(x0: number, y0: number, x1: number, y1: number, color: string) {
    const i = this.head;
    this.x0[i] = Math.min(x0, x1);
    this.x1[i] = Math.max(x0, x1);
    this.y0[i] = Math.min(y0, y1);
    this.y1[i] = Math.max(y0, y1);
    this.colors[i] = color;
    this.head = (i + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  /** The color of the newest rect containing (x, y), or null. */
  find(x: number, y: number): string | null {
    for (let n = 0, i = this.head; n < this.count; n++) {
      i = (i + this.size - 1) % this.size;
      const c = this.colors[i];
      if (c !== null && x >= this.x0[i] && x < this.x1[i] && y >= this.y0[i] && y < this.y1[i]) return c;
    }
    return null;
  }

  /** Something other than a solid fill now covers this area (clearRect, an image): drop overlaps. */
  invalidate(x0: number, y0: number, x1: number, y1: number) {
    if (!this.count) return;
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    let live = 0;
    for (let n = 0, i = this.head; n < this.count; n++) {
      i = (i + this.size - 1) % this.size;
      if (this.colors[i] === null) continue;
      if (this.x0[i] < hx && this.x1[i] > lx && this.y0[i] < hy && this.y1[i] > ly) this.colors[i] = null;
      else live++;
    }
    if (!live) this.clear();
  }

  clear() {
    this.colors.fill(null);
    this.head = 0;
    this.count = 0;
  }
}

/**
 * Decides the text color to paint given the (mapped) text color and the color under it.
 * Results are cached by text|bg|target: fillText is a hot path.
 */
export class PairContrast {
  private readonly cache = new Map<string, string>();
  private readonly opaque = new Map<string, boolean>();
  readonly bgCss: string;

  constructor(private readonly fg: RGBA, private readonly bg: RGBA) {
    this.bgCss = formatColor({ ...bg, a: 1 });
  }

  /** Whether a CSS color paints fully opaque (only those count as backgrounds). */
  isOpaque(css: string): boolean {
    let v = this.opaque.get(css);
    if (v === undefined) {
      const c = parseColor(css);
      v = !!c && c.a >= 0.999;
      if (this.opaque.size > 4000) this.opaque.clear();
      this.opaque.set(css, v);
    }
    return v;
  }

  /** `text` adjusted to reach `target` against `under` (default: the theme background). */
  fix(text: string, under: string | null, target: number): string {
    const bgCss = under ?? this.bgCss;
    const key = `${text}|${bgCss}|${target}`;
    let out = this.cache.get(key);
    if (out === undefined) {
      out = this.compute(text, bgCss, target);
      if (this.cache.size >= 4000) this.cache.clear();
      this.cache.set(key, out);
    }
    return out;
  }

  private compute(text: string, bgCss: string, target: number): string {
    const t = parseColor(text);
    const b = bgCss === this.bgCss ? this.bg : parseColor(bgCss);
    if (!t || !b) return text;
    // Translucent text: judge what it actually looks like over the background.
    const seen = t.a >= 0.999 ? t : blend(t, b);
    if (contrast(seen, b) >= target) return text;
    // A little headroom: rounding to #rrggbb can otherwise land just under the target.
    const fixed = ensureContrast({ ...seen, a: 1 }, b, target + 0.05);
    const cf = contrast(fixed, b);
    if (cf >= target) return formatColor(fixed);
    // Mid-tone fill: no lightness of this hue gets there; take the better theme ink.
    const cfg = contrast(this.fg, b), cbg = contrast(this.bg, b);
    const best = cf >= cfg && cf >= cbg ? fixed : cfg >= cbg ? this.fg : this.bg;
    if (contrast(best, b) >= target) return formatColor({ ...best, a: 1 });
    // last resort for the most mid-tone fills: pure black or white, whichever reads
    return contrast(BLACK, b) >= contrast(WHITE, b) ? '#000000' : '#ffffff';
  }
}

function blend(t: RGBA, b: RGBA): RGBA {
  const k = t.a;
  return { r: t.r * k + b.r * (1 - k), g: t.g * k + b.g * (1 - k), b: t.b * k + b.b * (1 - k), a: 1 };
}
