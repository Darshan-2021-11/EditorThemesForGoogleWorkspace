// Shape-aware contrast for document text drawn as SVG (Slides, Drawings). Text colors come from
// the theme without knowing what is painted behind them, so text over a recolored shape can end
// up unreadable. Here each text run finds its backdrop, the shapes painted beneath its centre,
// and its color is pushed until it meets WCAG contrast against that.
import { contrast, ensureContrast, hex8, parseColor, type RGBA } from '../theme/color';
import type { Mapper } from '../theme/map';
import { fontProp } from './slide-styles';

/** Screen-space rectangle. */
export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * A painted shape: its box, effective fill (null: unknown paint, like a picture), and paint order.
 * `hit`: exact test for points inside the box (hollow frames, circles), asked only after the box.
 */
export interface Layer { box: Box; color: RGBA | null; order: number; hit?: (x: number, y: number) => boolean }

/** WCAG large text: ≥ 24px, or bold ≥ 18.66px (18pt / 14pt). */
export const LARGE_PX = 24;
export const LARGE_BOLD_PX = 18.66;

export function contrastTarget(px: number, bold: boolean): number {
  return px >= LARGE_PX || (bold && px >= LARGE_BOLD_PX) ? 3 : 4.5;
}

const contains = (b: Box, x: number, y: number) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;

/** `top` painted over `below` (sRGB source-over). */
function over(top: RGBA, below: RGBA): RGBA {
  const a = top.a;
  return { r: top.r * a + below.r * (1 - a), g: top.g * a + below.g * (1 - a), b: top.b * a + below.b * (1 - a), a: 1 };
}

/**
 * Color painted at (x, y) beneath something drawn at paint order `below`: the topmost opaque layer
 * containing the point, with translucent layers above it composited on top, over `base` when no
 * opaque layer is there. Null when a layer of unknown paint (a picture) shows through.
 */
export function backdropAt(layers: readonly Layer[], x: number, y: number, below: number, base: RGBA): RGBA | null {
  const hits = layers.filter((l) => l.order < below && contains(l.box, x, y) && (!l.hit || l.hit(x, y))).sort((p, q) => q.order - p.order);
  const stack: RGBA[] = [];
  let bottom = base;
  for (const l of hits) {
    if (!l.color) return null;
    if (l.color.a <= 0.004) continue;
    if (l.color.a >= 0.996) {
      bottom = l.color;
      break;
    }
    stack.push(l.color);
  }
  let c: RGBA = { ...bottom, a: 1 };
  for (let i = stack.length - 1; i >= 0; i--) c = over(stack[i], c);
  return c;
}

/**
 * `fg` adjusted to reach `target` against `bg`: lightness pushed away from the backdrop, or, when
 * that can't get there (mid-tone backdrops), whichever theme color reads best. Keeps fg's alpha.
 */
export function fitContrast(fg: RGBA, bg: RGBA, target: number, themeFg: RGBA, themeBg: RGBA): RGBA {
  if (contrast(fg, bg) >= target) return fg;
  // a little headroom: rounding to #rrggbb can land just under the target
  const pushed = ensureContrast({ ...fg, a: 1 }, bg, target + 0.05);
  let best = pushed;
  if (contrast(pushed, bg) < target) {
    for (const c of [themeFg, themeBg]) if (contrast(c, bg) > contrast(best, bg)) best = c;
  }
  return { ...best, a: fg.a };
}

/** fitContrast with the theme's colors, remembered by (fg, bg, target). */
export class ContrastFitter {
  private cache = new Map<string, RGBA>();

  constructor(private themeFg: RGBA, private themeBg: RGBA) {}

  fit(fg: RGBA, bg: RGBA, target: number): RGBA {
    const key = `${hex8(fg)}|${hex8(bg)}|${target}`;
    let c = this.cache.get(key);
    if (!c) {
      if (this.cache.size > 4096) this.cache.clear();
      c = fitContrast(fg, bg, target, this.themeFg, this.themeBg);
      this.cache.set(key, c);
    }
    return c;
  }
}

// ------------------------------------------------------------------------------------------
// DOM side

/** Filled geometry that can sit behind text. */
const GEOMETRY = 'path, rect, ellipse, circle, polygon, image';
/** Containers whose shapes are never painted where they stand. */
const UNPAINTED = 'defs, clipPath, mask, pattern, marker, symbol';
/** Slides' filmstrip thumbnails and the main editor: thumbnails take the editor's text-size decisions. */
const THUMBNAILS = '.punch-filmstrip-thumbnails';
const EDITOR_SVG = '#pages svg';

interface SvgInfo {
  layers: Layer[];
  /** Paint order of shapes and <text> elements. */
  order: Map<Element, number>;
  /** Screen pixels per user unit of the root svg. */
  scale: number;
}

interface TextInfo { backdrop: RGBA; target: number }

const isText = (el: Element) => {
  const tag = el.tagName.toLowerCase();
  return tag === 'text' || tag === 'tspan';
};

const ctmScale = (el: Element) => {
  const m = (el as SVGGraphicsElement).getScreenCTM?.();
  return m ? Math.hypot(m.a, m.b) : 0;
};

function paintProp(el: Element, prop: string): string {
  return (el as SVGElement).style?.getPropertyValue(prop) || el.getAttribute(prop) || '';
}

/** An opacity value ("0.5", "50%"); 1 when missing or unreadable. */
function opacityOf(v: string): number {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, v.trim().endsWith('%') ? n / 100 : n));
}

/** Exact inside-the-fill test in screen coordinates (frames have hollow middles). */
function fillHit(el: Element): Layer['hit'] {
  if (!(el instanceof SVGGeometryElement)) return undefined;
  return (x, y) => {
    try {
      const m = el.getScreenCTM();
      if (!m) return true;
      return el.isPointInFill(new DOMPoint(x, y).matrixTransform(m.inverse()));
    } catch {
      return true; // keep the box answer
    }
  };
}

function rootSvg(el: Element): SVGSVGElement | null {
  let svg = (el as SVGElement).ownerSVGElement ?? null;
  while (svg?.ownerSVGElement) svg = svg.ownerSVGElement;
  return svg;
}

/** Font size in px from an SVG font-size ("20px", "20", "15pt"); 0 when unknown. */
function fontPx(v: string): number {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return /pt\s*$/.test(v) ? (n * 4) / 3 : n;
}

/**
 * Per page, one batch at a time: `prepare` does all layout reads for a batch before any
 * recoloring writes (so the browser lays out once), then `fit` adjusts each text color, then
 * `end` drops the batch's measurements.
 */
export class SvgTextContrast {
  private mapper: Mapper | null = null;
  private fitter: ContrastFitter | null = null;
  private texts = new Map<Element, TextInfo | null>();
  private svgs = new Map<SVGSVGElement, SvgInfo>();
  private fills = new Map<string, RGBA | null>();
  private editorScale: number | undefined;

  constructor(private region: string) {}

  setMapper(m: Mapper | null) {
    this.mapper = m;
    this.fitter = m ? new ContrastFitter(m.roles.fg, m.roles.bg) : null;
  }

  /**
   * Measures the backdrops of the batch's document text. Returns the batch plus the text of any
   * slide whose shapes changed color, since its backdrops moved.
   */
  prepare(els: Element[]): Element[] {
    if (!this.mapper || !this.region) return els;
    const batch = new Set(els);
    const touched = new Set<SVGSVGElement>();
    for (const el of els) {
      if (!el.isConnected || isText(el) || !el.matches(GEOMETRY)) continue;
      const svg = el.closest(this.region) && rootSvg(el);
      if (svg && !touched.has(svg)) {
        touched.add(svg);
        svg.querySelectorAll('text, tspan').forEach((t) => batch.add(t));
      }
    }
    for (const el of batch) {
      if (isText(el) && el.isConnected && !this.texts.has(el) && el.closest(this.region)) this.texts.set(el, this.measure(el));
    }
    return touched.size ? [...batch] : els;
  }

  /** `color` for a text element measured in this batch, adjusted to read on its backdrop. */
  fit(el: Element, color: RGBA): RGBA {
    const t = this.texts.get(el);
    return t && this.fitter ? this.fitter.fit(color, t.backdrop, t.target) : color;
  }

  end() {
    this.texts.clear();
    this.svgs.clear();
    this.fills.clear();
    this.editorScale = undefined;
  }

  private measure(el: Element): TextInfo | null {
    const svg = rootSvg(el);
    const textEl = el.tagName.toLowerCase() === 'tspan' ? el.closest('text') : el;
    if (!svg || !textEl) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    const info = this.svgInfo(svg);
    const order = info.order.get(textEl);
    if (order === undefined) return null;
    const backdrop = backdropAt(info.layers, (r.left + r.right) / 2, (r.top + r.bottom) / 2, order, this.mapper!.roles.bg);
    if (!backdrop) return null;
    // Size as shown in the main editor: thumbnails decide like the slide they preview.
    let scale = ctmScale(el);
    if (el.closest(THUMBNAILS) && info.scale) {
      const editor = this.mainEditorScale();
      if (editor) scale *= editor / info.scale;
    }
    const weight = fontProp(el, 'font-weight');
    const bold = weight === 'bold' || weight === 'bolder' || parseInt(weight, 10) >= 600;
    return { backdrop, target: contrastTarget(fontPx(fontProp(el, 'font-size')) * scale, bold) };
  }

  private mainEditorScale(): number {
    if (this.editorScale === undefined) {
      this.editorScale = 0;
      for (const svg of document.querySelectorAll(EDITOR_SVG)) {
        if ((svg as SVGElement).ownerSVGElement) continue;
        const s = ctmScale(svg);
        if (s) {
          this.editorScale = s;
          break;
        }
      }
    }
    return this.editorScale;
  }

  private svgInfo(svg: SVGSVGElement): SvgInfo {
    let info = this.svgs.get(svg);
    if (info) return info;
    info = { layers: [], order: new Map(), scale: ctmScale(svg) };
    let i = 0;
    for (const el of svg.querySelectorAll(`${GEOMETRY}, text`)) {
      if (el.closest(UNPAINTED)) continue;
      const order = i++;
      info.order.set(el, order);
      if (el.tagName.toLowerCase() === 'text') continue;
      const color = this.shapeColor(el, svg);
      if (color && color.a <= 0.004) continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      info.layers.push({ box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, color, order, hit: fillHit(el) });
    }
    this.svgs.set(svg, info);
    return info;
  }

  /**
   * Fill a shape shows once recolored, mapped from its own or inherited fill exactly as the page
   * maps it; transparent for no fill, null for paint we can't know (pictures, gradients).
   */
  private shapeColor(el: Element, svg: SVGSVGElement): RGBA | null {
    if (el.tagName.toLowerCase() === 'image') return null;
    let raw = '';
    for (let e: Element | null = el; e && !raw; e = e === svg ? null : e.parentElement) raw = paintProp(e, 'fill');
    raw = raw.trim().toLowerCase() || 'black';
    if (raw === 'none') return { r: 0, g: 0, b: 0, a: 0 };
    let mapped = this.fills.get(raw);
    if (mapped === undefined) {
      const c = parseColor(raw);
      mapped = c ? this.mapper!.mapRGBA(c, 'fill') : null;
      this.fills.set(raw, mapped);
    }
    if (!mapped) return null;
    const opacity = opacityOf(paintProp(el, 'fill-opacity')) * opacityOf(paintProp(el, 'opacity'));
    return opacity >= 1 ? mapped : { ...mapped, a: mapped.a * opacity };
  }
}
