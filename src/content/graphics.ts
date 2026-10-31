// Recolors pictures with theme colors: flat graphics inside the document (drawings, shapes,
// diagrams), and thumbnails of documents (home screens), which are shown the way the document
// itself looks when opened. Photos are detected and left alone. Only the page's local copy
// changes: the recolored picture is a data: URL swapped in, and the original comes back when the
// theme is off.
import { send } from '../shared/messages';
import type { Mapper } from '../theme/map';
import type { RGBA } from '../theme/color';
import {
  isFlatGraphic, lightOnDarkMask, pageContext, recolorPixels, ZONE_TEXT, type LightOnDark,
} from '../theme/graphic';

const XLINK = 'http://www.w3.org/1999/xlink';
/** Larger pictures are skipped: recoloring them would stall the page. */
const MAX_PIXELS = 8_000_000;
/** Above this, light-on-dark detection runs on a downscaled copy to bound memory and time. */
const MAX_LABEL_PIXELS = 2_000_000;

/** `graphic`: only flat graphics are recolored. `page`: a picture of a document page. */
type Mode = 'graphic' | 'page';

/** Where an element's picture lives: an attribute (img src, SVG href) or its CSS background. */
type Slot = { attr: string; ns: string | null } | { background: true };

interface Swapped {
  slot: Slot;
  original: string;
  applied: string;
}

export class GraphicRecolorer {
  private mapper: Mapper | null = null;
  private themeKey = '';
  /** Recolored data: URL per mode + original source, for the current theme (null = leave as is). */
  private results = new Map<string, Promise<string | null>>();
  /** Sources known not to be recolorable (photos, unreadable): never decoded again. */
  private skip = new Set<string>();
  private swapped = new Map<Element, Swapped>();
  /** Re-checks of elements whose background picture hadn't arrived yet. */
  private waits = new WeakMap<Element, number>();
  private all: string;

  /** `graphics`: pictures in the document; `pages`: document thumbnails. Either may be empty. */
  constructor(graphics: string, private pages = '') {
    this.all = [graphics, pages].filter(Boolean).join(', ');
  }

  update(mapper: Mapper | null, themeKey: string) {
    const on = !!mapper && !!this.all && mapper.options.recolorGraphics;
    this.mapper = on ? mapper : null;
    if (!on) return this.restoreAll();
    if (themeKey !== this.themeKey) {
      this.themeKey = themeKey;
      this.results.clear();
    }
    document.querySelectorAll(this.all).forEach((el) => this.check(el));
  }

  /** An element was added or its picture changed. */
  check(el: Element) {
    if (!this.mapper || !this.all || !el.matches(this.all)) return;
    const mode: Mode = this.pages && el.matches(this.pages) ? 'page' : 'graphic';
    const slot = slotOf(el);
    const current = read(el, slot);
    const prev = this.swapped.get(el);
    const original = prev && current === prev.applied ? prev.original : current;
    if (!original && 'background' in slot) {
      // a card's thumbnail background often arrives later through a class: look again (bounded)
      const n = this.waits.get(el) ?? 0;
      if (n < 6) {
        this.waits.set(el, n + 1);
        setTimeout(() => this.check(el), 1000);
      }
      return;
    }
    if (!original || this.skip.has(mode + original)) return;
    const key = this.themeKey;
    this.recolor(original, mode).then((url) => {
      if (!url || key !== this.themeKey || !this.mapper || !el.isConnected) return;
      const now = read(el, slot);
      if (now !== original && now !== this.swapped.get(el)?.applied) return; // replaced meanwhile
      this.swapped.set(el, { slot, original, applied: url });
      if (now !== url) write(el, slot, url);
    });
  }

  private recolor(src: string, mode: Mode): Promise<string | null> {
    const k = mode + src;
    let p = this.results.get(k);
    if (!p) {
      p = recolorSource(src, this.mapper!, mode).then((url) => {
        if (url === undefined) this.skip.add(k);
        return url ?? null;
      });
      this.results.set(k, p);
    }
    return p;
  }

  private restoreAll() {
    for (const [el, s] of this.swapped) if (read(el, s.slot) === s.applied) restore(el, s);
    this.swapped.clear();
    this.results.clear();
    this.themeKey = '';
  }
}

function slotOf(el: Element): Slot {
  const tag = el.tagName.toLowerCase();
  if (tag === 'img') return { attr: 'src', ns: null };
  if (tag === 'image') return el.hasAttribute('href') || !el.hasAttributeNS(XLINK, 'href') ? { attr: 'href', ns: null } : { attr: 'href', ns: XLINK };
  return { background: true };
}

const urlOf = (css: string) => /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(css)?.[1] ?? '';

function read(el: Element, slot: Slot): string {
  if ('background' in slot) return urlOf(getComputedStyle(el).backgroundImage);
  return (slot.ns ? el.getAttributeNS(slot.ns, slot.attr) : el.getAttribute(slot.attr)) ?? '';
}

function write(el: Element, slot: Slot, url: string) {
  if ('background' in slot) (el as HTMLElement).style.setProperty('background-image', `url("${url}")`, 'important');
  else if (slot.ns) el.setAttributeNS(slot.ns, slot.attr, url);
  else el.setAttribute(slot.attr, url);
}

function restore(el: Element, s: Swapped) {
  if ('background' in s.slot) (el as HTMLElement).style.removeProperty('background-image');
  else write(el, s.slot, s.original);
}

/** The recolored picture as a data: URL; undefined when it can't or shouldn't be recolored. */
async function recolorSource(src: string, mapper: Mapper, mode: Mode): Promise<string | undefined> {
  try {
    const bitmap = await decode(src);
    if (!bitmap || bitmap.width * bitmap.height > MAX_PIXELS) return undefined;
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    if (mode === 'graphic' && !isFlatGraphic(img.data, img.width, img.height)) return undefined;
    // Drawings: white marks inside dark shapes stay light-on-dark (grey pre-inverted before mapping,
    // anti-aliased edges blended in proportion). Page pictures map like the page itself instead:
    // photos stay, colored text maps as text; at thumbnail scale letter counters would pass for
    // marks, and solid fills keep background-colored text readable anyway.
    const { zone, pairs } = mode === 'page'
      ? { zone: pageContext(img.data, img.width, img.height), pairs: [] as LightOnDark['pairs'] }
      : scaledLightOnDarkMask(img.data, img.width, img.height);
    const plain = (rgb: number) => pack(mapper.mapRGBA(unpack(rgb), 'graphic'));
    const asText = (rgb: number) => {
      const c = unpack(rgb);
      // greys keep the page ramp (black ink → the theme's text color); colors map like text
      return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 24 ? plain(rgb) : pack(mapper.mapRGBA(c, 'text'));
    };
    const flipped = (rgb: number) => plain(0xffffff - rgb);
    recolorPixels(img.data, (r, g, b, z) => {
      const rgb = (r << 16) | (g << 8) | b;
      if (z === ZONE_TEXT) return asText(rgb);
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
