import { PairContrast, parseFont, RectStore, textTarget } from '../src/hook/contrast-pairs';
import { contrast, parseColor } from '../src/theme/color';
import { schemeToRoles } from '../src/theme/roles';
import { nord, solarizedLight } from './fixtures';

const ratio = (a: string, b: string) => contrast(parseColor(a)!, parseColor(b)!);

describe('rect store', () => {
  it('finds the newest rect containing a point', () => {
    const r = new RectStore(4);
    r.add(0, 0, 100, 100, '#111111');
    r.add(10, 10, 50, 50, '#222222');
    expect(r.find(20, 20)).toBe('#222222');
    expect(r.find(80, 80)).toBe('#111111');
    expect(r.find(150, 20)).toBeNull();
  });

  it('normalizes rects drawn with negative width/height', () => {
    const r = new RectStore(4);
    r.add(50, 50, 10, 10, '#333333');
    expect(r.find(20, 20)).toBe('#333333');
  });

  it('keeps only the last N rects', () => {
    const r = new RectStore(2);
    r.add(0, 0, 10, 10, '#000001');
    r.add(20, 0, 30, 10, '#000002');
    r.add(40, 0, 50, 10, '#000003');
    expect(r.find(5, 5)).toBeNull();
    expect(r.find(25, 5)).toBe('#000002');
    expect(r.find(45, 5)).toBe('#000003');
  });

  it('clearRect over an area drops overlapping rects only', () => {
    const r = new RectStore(4);
    r.add(0, 0, 10, 10, '#000001');
    r.add(20, 0, 30, 10, '#000002');
    r.invalidate(5, 5, 15, 15);
    expect(r.find(5, 5)).toBeNull();
    expect(r.find(25, 5)).toBe('#000002');
    r.invalidate(0, 0, 100, 100);
    expect(r.length).toBe(0);
  });

  it('forgets everything when the canvas is resized or a new theme applies', () => {
    const r = new RectStore(4);
    r.checkSize(100, 100, 1);
    r.add(0, 0, 10, 10, '#000001');
    r.checkSize(100, 100, 1);
    expect(r.find(5, 5)).toBe('#000001');
    r.checkSize(200, 100, 1);
    expect(r.find(5, 5)).toBeNull();
    r.add(0, 0, 10, 10, '#000001');
    r.checkSize(200, 100, 2);
    expect(r.find(5, 5)).toBeNull();
  });
});

describe('text targets and fonts', () => {
  it('uses 3:1 for large text and 4.5:1 otherwise', () => {
    expect(textTarget(13, false)).toBe(4.5);
    expect(textTarget(24, false)).toBe(3);
    expect(textTarget(19, true)).toBe(3);
    expect(textTarget(19, false)).toBe(4.5);
  });

  it('parses size and weight from canvas font strings', () => {
    expect(parseFont('bold 14.6667px Arial')).toEqual({ px: 14.6667, bold: true });
    expect(parseFont('italic 400 12pt "Roboto Mono"')).toEqual({ px: 16, bold: false });
    expect(parseFont('700 10px Arial').bold).toBe(true);
  });
});

describe('pair contrast', () => {
  const roles = schemeToRoles(nord);
  const p = new PairContrast(roles.fg, roles.bg);

  it('leaves readable pairs alone', () => {
    expect(p.fix('#eceff4', '#2e3440', 4.5)).toBe('#eceff4');
  });

  it('fixes the audited failures', () => {
    for (const [fg, bg] of [['#4b8b8e', '#324040'], ['#e5e9f0', '#81a1c1'], ['#f8f8f2', '#ffb86c']]) {
      const out = p.fix(fg, bg, 4.5);
      expect(ratio(out, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses the large-text target', () => {
    const out = p.fix('#4b8b8e', '#324040', 3);
    const r = ratio(out, '#324040');
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeLessThan(4.5); // moved no further than needed
  });

  it('text with no fill under it is checked against the theme background', () => {
    const out = p.fix('#4c566a', null, 4.5);
    expect(ratio(out, p.bgCss)).toBeGreaterThanOrEqual(4.5);
  });

  it('judges translucent text by how it blends', () => {
    const out = p.fix('rgba(236, 239, 244, 0.3)', null, 4.5);
    expect(ratio(out, p.bgCss)).toBeGreaterThanOrEqual(4.5);
    expect(p.fix('rgba(236, 239, 244, 0.95)', null, 4.5)).toBe('rgba(236, 239, 244, 0.95)');
  });

  it('falls back to the better theme ink on mid-tone fills', () => {
    const light = schemeToRoles(solarizedLight);
    const q = new PairContrast(light.fg, light.bg);
    const mid = '#767676'; // ~4.5 against both black and white: the hue walk may stall
    const out = q.fix('#7a7a7a', mid, 4.5);
    const best = Math.max(contrast(light.fg, parseColor(mid)!), contrast(light.bg, parseColor(mid)!));
    expect(ratio(out, mid)).toBeGreaterThanOrEqual(Math.min(4.5, best) - 0.01);
  });

  it('caches results', () => {
    const a = p.fix('#4b8b8e', '#324040', 4.5);
    expect(p.fix('#4b8b8e', '#324040', 4.5)).toBe(a);
  });

  it('only opaque colors count as backgrounds', () => {
    expect(p.isOpaque('#81a1c1')).toBe(true);
    expect(p.isOpaque('rgba(129, 161, 193, 0.4)')).toBe(false);
    expect(p.isOpaque('not a color')).toBe(false);
  });
});
