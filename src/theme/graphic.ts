// Flat graphics (drawings, shapes, diagrams, UI screenshots) vs photos, and per-pixel recoloring.
// Works on raw RGBA pixel data so it can be unit-tested without a DOM.

/** Up to this many flat colors must cover most of the visible pixels for an image to count as a graphic. */
const TOP_COLORS = 8;
const MIN_COVERAGE = 0.9;
/** Samples taken for classification (a grid over the image). */
const SAMPLES = 4096;

/**
 * Whether the image is made of a few flat colors. Colors are bucketed at 4 bits per channel so
 * anti-aliased edges and compression noise don't count as separate colors; photos and shaded
 * illustrations spread over many buckets and fail.
 */
export function isFlatGraphic(data: Uint8ClampedArray, width: number, height: number): boolean {
  const total = width * height;
  if (!total) return false;
  const step = Math.max(1, Math.floor(Math.sqrt(total / SAMPLES)));
  const counts = new Map<number, number>();
  let seen = 0;
  let visible = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      seen++;
      if (data[i + 3] < 16) continue;
      visible++;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  // nearly invisible images (spacers) aren't worth touching
  if (visible < seen * 0.01) return false;
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, TOP_COLORS);
  return top.reduce((s, n) => s + n, 0) / visible >= MIN_COVERAGE;
}

const bucketOf = (d: Uint8ClampedArray, i: number) =>
  d[i + 3] < 16 ? -1 : ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
/** Bucket centre → relative luminance (sRGB weights are enough for a light/dark split). */
function bucketLuminance(b: number): number {
  const ch = (v: number) => ((v << 4) + 8) / 255;
  return 0.2126 * ch(b >> 8) + 0.7152 * ch((b >> 4) & 15) + 0.0722 * ch(b & 15);
}
const bucketIsGrey = (b: number) => Math.max(b >> 8, (b >> 4) & 15, b & 15) - Math.min(b >> 8, (b >> 4) & 15, b & 15) <= 1;

/**
 * Marks the grey marks that sit inside a dark shape (white text on a purple card): those keep
 * their lightness instead of being swapped, so light-on-dark stays light-on-dark. Linear time:
 * one union-find pass labels flat-color regions; each grey region's container is its largest
 * neighbor. Regions touching the image edge (the page), bigger than their container, or about as
 * thick as it (a letter's hole inside the letter) never flip.
 */
export function lightOnDarkMask(data: Uint8ClampedArray, width: number, height: number): LightOnDark {
  const n = width * height;
  const bucket = new Int32Array(n);
  for (let p = 0; p < n; p++) bucket[p] = bucketOf(data, p * 4);
  const parent = new Int32Array(n);
  for (let p = 0; p < n; p++) parent[p] = p;
  const find = (p: number) => {
    while (parent[p] !== p) p = parent[p] = parent[parent[p]];
    return p;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (bucket[p] < 0) continue;
      if (x + 1 < width && bucket[p + 1] === bucket[p]) union(p, p + 1);
      if (y + 1 < height && bucket[p + width] === bucket[p]) union(p, p + width);
    }
  }
  const root = new Int32Array(n);
  const area = new Int32Array(n);
  const edge = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const r = (root[p] = find(p));
    area[r]++;
    const x = p % width;
    if (x === 0 || x === width - 1 || p < width || p >= n - width) edge[r] = 1;
  }
  // boundary pixels per region → thickness = area / boundary (thin strokes vs solid shapes)
  const boundary = new Int32Array(n);
  for (let p = 0; p < n; p++) {
    const x = p % width, r = root[p];
    if ((x > 0 && root[p - 1] !== r) || (x < width - 1 && root[p + 1] !== r) ||
      (p >= width && root[p - width] !== r) || (p < n - width && root[p + width] !== r)) boundary[r]++;
  }
  const thickness = (r: number) => area[r] / Math.max(1, boundary[r]);
  // largest neighboring region of each region
  const container = new Int32Array(n).fill(-1);
  const consider = (a: number, b: number) => {
    if (container[a] < 0 || area[b] > area[container[a]]) container[a] = b;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (bucket[p] < 0) continue;
      for (const q of [x + 1 < width ? p + 1 : -1, y + 1 < height ? p + width : -1]) {
        if (q < 0 || bucket[q] < 0 || root[q] === root[p]) continue;
        consider(root[p], root[q]);
        consider(root[q], root[p]);
      }
    }
  }
  // flipped region root → index into pairs
  const pairOf = new Int32Array(n).fill(-1);
  const pairs: LightOnDark['pairs'] = [];
  const rgbAt = (p: number) => (data[p * 4] << 16) | (data[p * 4 + 1] << 8) | data[p * 4 + 2];
  for (let r = 0; r < n; r++) {
    if (root[r] !== r || bucket[r] < 0 || edge[r] || !bucketIsGrey(bucket[r])) continue;
    // anti-aliasing rings letters with small in-between regions: climb past them to the real shape
    let c = container[r];
    for (let hops = 0; c >= 0 && area[c] <= area[r] && hops < 4; hops++) c = container[c];
    // a card is bigger and much thicker than the text on it; a letter is about as thick as its holes
    if (c >= 0 && area[r] < area[c] && thickness(c) >= 2 * thickness(r) && bucketLuminance(bucket[c]) < 0.45) {
      pairOf[r] = pairs.length;
      pairs.push({ mark: rgbAt(r), shape: rgbAt(c), shapeBucket: bucket[c] });
    }
  }
  const zone = new Int32Array(n).fill(-1);
  for (let p = 0; p < n; p++) {
    const k = pairOf[root[p]];
    if (k >= 0) zone[p] = k * 2 + 1;
  }
  // edge pixels next to a mark (not the shape itself): blends of mark and shape
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (zone[p] < 0 || !(zone[p] & 1)) continue;
      const k = zone[p] >> 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = x + dx, qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
          const q = qy * width + qx;
          if (zone[q] < 0 && bucket[q] >= 0 && bucket[q] !== pairs[k].shapeBucket) zone[q] = k * 2;
        }
      }
    }
  }
  return { zone, pairs };
}

/**
 * Light marks on dark shapes. `zone[p]`: -1 = ordinary pixel; `k*2+1` = inside mark k;
 * `k*2` = anti-aliased edge between mark k and its shape. Colors are packed 0xRRGGBB.
 */
export interface LightOnDark {
  zone: Int32Array;
  pairs: { mark: number; shape: number; shapeBucket: number }[];
}

/**
 * Recolors pixels in place. `map` gets each distinct opaque-ish color once per zone (see
 * LightOnDark; -1 without one) and returns the replacement as a packed 0xRRGGBB; alpha is kept so
 * edges stay smooth.
 */
export function recolorPixels(
  data: Uint8ClampedArray,
  map: (r: number, g: number, b: number, zone: number) => number,
  zone?: Int32Array,
): void {
  const cache = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const z = zone ? zone[i >> 2] : -1;
    const key = (z + 1) * 0x1000000 + ((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    let out = cache.get(key);
    if (out === undefined) {
      out = map(data[i], data[i + 1], data[i + 2], z);
      cache.set(key, out);
    }
    data[i] = out >> 16;
    data[i + 1] = (out >> 8) & 255;
    data[i + 2] = out & 255;
  }
}
