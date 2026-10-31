import { describe, expect, it } from 'vitest';
import {
  isFlatGraphic, lightOnDarkMask, pageContext, recolorPixels, ZONE_PHOTO, ZONE_PLAIN, ZONE_TEXT,
} from '../src/theme/graphic';

function image(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(px(x, y), (y * w + x) * 4);
  return d;
}

describe('isFlatGraphic', () => {
  it('accepts a drawing: white page, a colored rectangle, dark text strokes', () => {
    const d = image(200, 120, (x, y) =>
      x > 40 && x < 160 && y > 30 && y < 90 ? (y % 10 === 0 ? [20, 20, 20, 255] : [255, 230, 150, 255]) : [255, 255, 255, 255]);
    expect(isFlatGraphic(d, 200, 120)).toBe(true);
  });

  it('accepts a shape on a transparent background', () => {
    const d = image(100, 100, (x, y) => ((x - 50) ** 2 + (y - 50) ** 2 < 900 ? [66, 133, 244, 255] : [0, 0, 0, 0]));
    expect(isFlatGraphic(d, 100, 100)).toBe(true);
  });

  it('rejects photo-like content (smooth gradients plus noise)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 40;
    const d = image(160, 160, (x, y) => [(x * 1.6 + rnd()) | 0, (y * 1.5 + rnd()) | 0, ((x + y) * 0.7 + rnd()) | 0, 255]);
    expect(isFlatGraphic(d, 160, 160)).toBe(false);
  });

  it('rejects fully transparent images', () => {
    expect(isFlatGraphic(image(50, 50, () => [0, 0, 0, 0]), 50, 50)).toBe(false);
  });
});

describe('lightOnDarkMask', () => {
  // white page; a purple card (x 10..69, y 10..49) with white text (x 20..39, y 20..29);
  // black text on the page (x 75..84, y 20..24); a white card inside a thin dark frame (x 90..119)
  const W = 130, H = 60;
  const px = (x: number, y: number): [number, number, number, number] => {
    if (x >= 20 && x < 40 && y >= 20 && y < 30) return [255, 255, 255, 255];
    if (x >= 10 && x < 70 && y >= 10 && y < 50) return [90, 30, 110, 255];
    if (x >= 75 && x < 85 && y >= 20 && y < 25) return [0, 0, 0, 255];
    if (x >= 92 && x < 118 && y >= 12 && y < 48) return [255, 255, 255, 255];
    if (x >= 90 && x < 120 && y >= 10 && y < 50) return [40, 40, 40, 255];
    return [255, 255, 255, 255];
  };
  const { zone, pairs } = lightOnDarkMask(image(W, H, px), W, H);
  const at = (x: number, y: number) => (zone[y * W + x] >= 0 && zone[y * W + x] & 1 ? 1 : 0);

  it('records the mark and its shape color', () => {
    expect(pairs).toHaveLength(1);
    expect(pairs[0].mark).toBe(0xffffff);
    expect(pairs[0].shape).toBe(0x5a1e6e);
  });

  it('flips white text on a dark card', () => expect(at(25, 25)).toBe(1));
  it('keeps the page, the card itself and dark text on the page', () => {
    expect(at(2, 2)).toBe(0);
    expect(at(50, 40)).toBe(0);
    expect(at(80, 22)).toBe(0);
  });
  it('keeps a white card larger than its thin dark frame', () => expect(at(100, 30)).toBe(0));

  it('keeps the white hole of a dark letter on a white page', () => {
    // an "o": dark ring 9x9 with a 3x3 white hole, on a white page
    const o = image(30, 30, (x, y) => {
      const inRing = x >= 10 && x < 19 && y >= 10 && y < 19;
      const inHole = x >= 13 && x < 16 && y >= 13 && y < 16;
      return inRing && !inHole ? [20, 20, 20, 255] : [255, 255, 255, 255];
    });
    const r = lightOnDarkMask(o, 30, 30);
    expect(r.zone[14 * 30 + 14]).toBe(-1);
  });
});

describe('pageContext', () => {
  it('keeps photos, maps colored text on the page as text, shapes as plain', () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) % 256;
    // 96x32: left third page with thin blue text lines, middle a solid orange block, right a photo
    const d = image(96, 32, (x, y) => {
      if (x < 32) return y % 4 === 0 ? [30, 80, 200, 255] : [255, 255, 255, 255];
      if (x < 64) return [240, 120, 20, 255];
      return [rnd(), rnd(), rnd(), 255];
    });
    const z = pageContext(d, 96, 32);
    expect(z[16 * 96 + 8]).toBe(ZONE_TEXT);
    expect(z[16 * 96 + 44]).toBe(ZONE_PLAIN);
    expect(z[16 * 96 + 88]).toBe(ZONE_PHOTO);
  });

  it('anti-aliased colored text (tints between ink and white) is text, not photo', () => {
    // a heading: blue ink with every tint toward white, on the page
    const d = image(32, 16, (x) => {
      const t = (x % 16) / 15;
      return [Math.round(30 + t * 225), Math.round(80 + t * 175), Math.round(200 + t * 55), 255];
    });
    expect(pageContext(d, 32, 16)[8 * 32 + 4]).not.toBe(ZONE_PHOTO);
  });
});

describe('recolorPixels', () => {
  it('leaves photo pixels untouched', () => {
    const d = new Uint8ClampedArray([10, 20, 30, 255]);
    recolorPixels(d, () => 0xffffff, new Int32Array([ZONE_PHOTO]));
    expect([...d]).toEqual([10, 20, 30, 255]);
  });

  it('maps each color once, keeps alpha and skips transparent pixels', () => {
    const d = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 128, 9, 9, 9, 0]);
    let calls = 0;
    recolorPixels(d, (_r, _g, _b, z) => (calls++, expect(z).toBe(-1), 0x102030));
    expect(calls).toBe(1);
    expect([...d]).toEqual([16, 32, 48, 255, 16, 32, 48, 128, 9, 9, 9, 0]);
  });
});
