// Recolors flat graphics inside the document (drawings, shapes, diagrams) with theme colors.
// Photos are detected and left alone. Only the page's local copy changes: the recolored picture
// is a data: URL swapped into the element, and the original comes back when the theme is off.
import { send } from '../shared/messages';
import type { Mapper } from '../theme/map';
import type { RGBA } from '../theme/color';
import { isFlatGraphic, lightOnDarkMask, recolorPixels, type LightOnDark } from '../theme/graphic';

const XLINK = 'http://www.w3.org/1999/xlink';
/** Larger pictures are skipped: recoloring them would stall the page. */
const MAX_PIXELS = 8_000_000;
/** Above this, light-on-dark detection runs on a downscaled copy to bound memory and time. */
const MAX_LABEL_PIXELS = 2_000_000;

interface Swapped {
  /** Attribute holding the picture: "src" (<img>) or "href" (SVG <image>, maybe xlink). */
  attr: string;
  ns: string | null;
  original: string;
  applied: string;
}

export class GraphicRecolorer {
  private mapper: Mapper | null = null;
  private themeKey = '';
  /** Recolored data: URL per original source, for the current theme (null = leave as is). */
  private results = new Map<string, Promise<string | null>>();
  /** Sources known not to be flat graphics (or unreadable): never decoded again. */
  private skip = new Set<string>();
  private swapped = new Map<Element, Swapped>();

  constructor(private selector: string) {}

  update(mapper: Mapper | null, themeKey: string) {
    const on = !!mapper && !!this.selector && mapper.options.recolorGraphics;
    this.mapper = on ? mapper : null;
    if (!on) return this.restoreAll();
    if (themeKey !== this.themeKey) {
      this.themeKey = themeKey;
      this.results.clear();
    }
    document.querySelectorAll(this.selector).forEach((el) => this.check(el));
  }

  /** An element was added or its picture changed. */
  check(el: Element) {
    if (!this.mapper || !this.selector || !el.matches(this.selector)) return;
    const { attr, ns } = pictureAttr(el);
    const current = (ns ? el.getAttributeNS(ns, attr) : el.getAttribute(attr)) ?? '';
    const prev = this.swapped.get(el);
    const original = prev && current === prev.applied ? prev.original : current;
    if (!original || this.skip.has(original)) return;
    const key = this.themeKey;
    this.recolor(original).then((url) => {
      if (!url || key !== this.themeKey || !this.mapper || !el.isConnected) return;
      const now = (ns ? el.getAttributeNS(ns, attr) : el.getAttribute(attr)) ?? '';
      if (now !== original && now !== this.swapped.get(el)?.applied) return; // replaced meanwhile
      this.swapped.set(el, { attr, ns, original, applied: url });
      if (now !== url) ns ? el.setAttributeNS(ns, attr, url) : el.setAttribute(attr, url);
    });
  }

  private recolor(src: string): Promise<string | null> {
    let p = this.results.get(src);
    if (!p) {
      const mapper = this.mapper!;
      p = recolorSource(src, mapper).then((url) => {
        if (url === undefined) this.skip.add(src);
        return url ?? null;
      });
      this.results.set(src, p);
    }
    return p;
  }

  private restoreAll() {
    for (const [el, s] of this.swapped) {
      const now = s.ns ? el.getAttributeNS(s.ns, s.attr) : el.getAttribute(s.attr);
      if (now === s.applied) s.ns ? el.setAttributeNS(s.ns, s.attr, s.original) : el.setAttribute(s.attr, s.original);
    }
    this.swapped.clear();
    this.results.clear();
    this.themeKey = '';
  }
}

function pictureAttr(el: Element): { attr: string; ns: string | null } {
  if (el.tagName.toLowerCase() === 'img') return { attr: 'src', ns: null };
  return el.hasAttribute('href') || !el.hasAttributeNS(XLINK, 'href') ? { attr: 'href', ns: null } : { attr: 'href', ns: XLINK };
}

/** The recolored picture as a data: URL; undefined when it isn't a (readable) flat graphic. */
async function recolorSource(src: string, mapper: Mapper): Promise<string | undefined> {
  try {
    const bitmap = await decode(src);
    if (!bitmap || bitmap.width * bitmap.height > MAX_PIXELS) return undefined;
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    if (!isFlatGraphic(img.data, img.width, img.height)) return undefined;
    // White marks inside dark shapes stay light-on-dark: their grey is pre-inverted before mapping,
    // and their anti-aliased edges blend the two mapped colors in the original proportion.
    const { zone, pairs } = scaledLightOnDarkMask(img.data, img.width, img.height);
    const plain = (rgb: number) => pack(mapper.mapRGBA(unpack(rgb), 'graphic'));
    const flipped = (rgb: number) => plain(0xffffff - rgb);
    recolorPixels(img.data, (r, g, b, z) => {
      const rgb = (r << 16) | (g << 8) | b;
      if (z < 0) return plain(rgb);
      if (z & 1) return flipped(rgb);
      const { mark, shape } = pairs[z >> 1];
      const lm = lum(mark), ls = lum(shape);
      const t = lm === ls ? 0 : Math.min(1, Math.max(0, (lum(rgb) - ls) / (lm - ls)));
      return mixPacked(plain(shape), flipped(mark), t);
    }, zone);
    ctx.putImageData(img, 0, 0);
    return await blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
  } catch {
    return undefined; // tainted, undecodable or unsupported: leave it
  }
}

const unpack = (v: number): RGBA => ({ r: v >> 16, g: (v >> 8) & 255, b: v & 255, a: 1 });
const pack = (c: RGBA) => (Math.round(c.r) << 16) | (Math.round(c.g) << 8) | Math.round(c.b);
const lum = (v: number) => 0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
function mixPacked(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** lightOnDarkMask, computed on a nearest-neighbor downscale for big pictures (bounded memory/time). */
function scaledLightOnDarkMask(data: Uint8ClampedArray, w: number, h: number): LightOnDark {
  const s = Math.ceil(Math.sqrt((w * h) / MAX_LABEL_PIXELS));
  if (s <= 1) return lightOnDarkMask(data, w, h);
  const sw = Math.ceil(w / s), sh = Math.ceil(h / s);
  const small = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (Math.min(h - 1, y * s) * w + Math.min(w - 1, x * s)) * 4;
      small.set(data.subarray(i, i + 4), (y * sw + x) * 4);
    }
  }
  const m = lightOnDarkMask(small, sw, sh);
  const zone = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = ((y / s) | 0) * sw;
    for (let x = 0; x < w; x++) {
      const z = m.zone[row + ((x / s) | 0)];
      // block edges are coarse at this scale: let every touched pixel blend by its own color
      zone[y * w + x] = z >= 0 ? z & ~1 : -1;
    }
  }
  return { zone, pairs: m.pairs };
}

async function decode(src: string): Promise<ImageBitmap | null> {
  if (/^(blob|data):/.test(src)) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return createImageBitmap(img);
  }
  if (!/^https:/.test(src)) return null;
  const bytes = await send({ type: 'fetchImage', url: src });
  return bytes ? createImageBitmap(new Blob([bytes])) : null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
