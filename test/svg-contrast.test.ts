import { contrast, parseColor, type RGBA } from '../src/theme/color';
import { backdropAt, ContrastFitter, contrastTarget, fitContrast, type Layer } from '../src/content/svg-contrast';

const c = (s: string) => parseColor(s)!;
const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const near = (x: RGBA, y: RGBA) => Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b) < 1.5;

describe('svg text backdrop', () => {
  const bg = c('#002b36');
  const slide: Layer = { box: box(0, 0, 100, 100), color: c('#fdf6e3'), order: 0 };
  const card: Layer = { box: box(10, 10, 60, 60), color: c('#e2dece'), order: 1 };

  it('takes the topmost shape under the point that is painted before the text', () => {
    expect(backdropAt([slide, card], 30, 30, 5, bg)).toEqual({ ...c('#e2dece'), a: 1 });
    // outside the card: the slide background
    expect(backdropAt([slide, card], 80, 80, 5, bg)).toEqual({ ...c('#fdf6e3'), a: 1 });
    // order, not list position, decides what is on top
    expect(backdropAt([card, slide], 30, 30, 5, bg)).toEqual({ ...c('#e2dece'), a: 1 });
  });

  it('ignores shapes painted after the text', () => {
    const later: Layer = { box: box(0, 0, 100, 100), color: c('#ff0000'), order: 9 };
    expect(backdropAt([slide, card, later], 30, 30, 5, bg)).toEqual({ ...c('#e2dece'), a: 1 });
  });

  it('falls back to the theme background when nothing is beneath', () => {
    expect(backdropAt([card], 80, 80, 5, bg)).toEqual({ ...bg, a: 1 });
    expect(backdropAt([], 1, 1, 0, bg)).toEqual({ ...bg, a: 1 });
  });

  it('gives up over pictures', () => {
    const image: Layer = { box: box(0, 0, 50, 50), color: null, order: 2 };
    expect(backdropAt([slide, card, image], 30, 30, 5, bg)).toBeNull();
    // a picture covered by an opaque shape doesn't matter
    const cover: Layer = { box: box(0, 0, 50, 50), color: c('#073642'), order: 3 };
    expect(backdropAt([slide, image, cover], 30, 30, 5, bg)).toEqual({ ...c('#073642'), a: 1 });
  });

  it('skips transparent shapes and composites translucent ones', () => {
    const clear: Layer = { box: box(0, 0, 100, 100), color: { r: 255, g: 0, b: 0, a: 0 }, order: 2 };
    expect(backdropAt([slide, card, clear], 30, 30, 5, bg)).toEqual({ ...c('#e2dece'), a: 1 });
    const black: Layer = { box: box(0, 0, 100, 100), color: c('#000000'), order: 0 };
    const half: Layer = { box: box(0, 0, 100, 100), color: { r: 255, g: 255, b: 255, a: 0.5 }, order: 1 };
    const out = backdropAt([black, half], 50, 50, 5, bg)!;
    expect(near(out, { r: 127.5, g: 127.5, b: 127.5, a: 1 })).toBe(true);
  });
});

describe('svg text contrast', () => {
  it('uses the WCAG large-text threshold', () => {
    expect(contrastTarget(16, false)).toBe(4.5);
    expect(contrastTarget(24, false)).toBe(3);
    expect(contrastTarget(20, false)).toBe(4.5);
    expect(contrastTarget(20, true)).toBe(3);
    expect(contrastTarget(18, true)).toBe(4.5);
  });

  const fg = c('#586e75');
  const themeFg = c('#657b83');
  const themeBg = c('#fdf6e3');

  it('leaves readable text alone', () => {
    expect(fitContrast(fg, c('#fdf6e3'), 4.5, themeFg, themeBg)).toEqual(fg);
  });

  it('pushes text until it reads on the backdrop (audit cases)', () => {
    const cases: [string, string][] = [
      ['#586e75', '#e2dece'], // Solarized Light body on a mapped card
      ['#008e86', '#93a1a1'],
      ['#b16286', '#3f3a38'], // Gruvbox
      ['#f8f8f2', '#458e5d'], // Dracula
    ];
    for (const [f, b] of cases) {
      const out = fitContrast(c(f), c(b), 4.5, themeFg, themeBg);
      expect(contrast(out, c(b))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back to the better theme color on mid-tone backdrops', () => {
    // nothing reaches 7:1 on mid gray; pick whichever theme color contrasts more
    const mid = c('#777777');
    const out = fitContrast(c('#888888'), mid, 7, c('#ffffff'), c('#000000'));
    expect(contrast(out, mid)).toBeGreaterThanOrEqual(Math.max(contrast(c('#ffffff'), mid), contrast(c('#000000'), mid)) - 1e-9);
  });

  it('keeps the text alpha', () => {
    const out = fitContrast({ ...fg, a: 0.8 }, c('#e2dece'), 4.5, themeFg, themeBg);
    expect(out.a).toBe(0.8);
  });

  it('caches results by colors and target', () => {
    const f = new ContrastFitter(themeFg, themeBg);
    const a = f.fit(fg, c('#e2dece'), 4.5);
    expect(f.fit(fg, c('#e2dece'), 4.5)).toBe(a);
    expect(f.fit(fg, c('#e2dece'), 3)).not.toBe(a);
  });
});
