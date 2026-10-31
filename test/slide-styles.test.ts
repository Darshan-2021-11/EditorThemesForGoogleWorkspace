import { bodySize, pxOf, slideTextStyle } from '../src/content/slide-styles';

describe('slide text styles', () => {
  it('reads px font sizes', () => {
    expect(pxOf('20px')).toBe(20);
    expect(pxOf(' 52.6667px ')).toBe(52.67);
    expect(pxOf('1.2em')).toBe(0);
    expect(pxOf('')).toBe(0);
    expect(pxOf(null)).toBe(0);
  });

  it('takes the size carrying the most characters as body size', () => {
    // three titles, one long body paragraph: the body wins on characters, not on count
    expect(bodySize([[52.67, 20], [52.67, 18], [52.67, 25], [20, 140]])).toBe(20);
    // characters of one size add up across runs
    expect(bodySize([[20, 40], [18, 60], [20, 30]])).toBe(20);
    // ties go to the smaller size; empty or unsized runs don't count
    expect(bodySize([[24, 50], [18, 50], [0, 500], [30, 0]])).toBe(18);
    expect(bodySize([])).toBe(0);
  });

  it('tiers text by size relative to the body, like Docs', () => {
    expect(slideTextStyle(52.67, 20, 'docs-Lato')).toBe('title');
    expect(slideTextStyle(30, 20, 'docs-Lato')).toBe('h1');
    expect(slideTextStyle(25, 20, 'docs-Lato')).toBe('h2');
    expect(slideTextStyle(20, 20, 'docs-Lato')).toBeNull();
    expect(slideTextStyle(14, 20, 'docs-Lato')).toBeNull();
    // unknown body size: no tiers
    expect(slideTextStyle(52.67, 0, 'docs-Lato')).toBeNull();
  });

  it('treats monospace text as code at any size', () => {
    expect(slideTextStyle(20, 20, 'docs-Roboto Mono')).toBe('code');
    expect(slideTextStyle(52, 20, '"Courier New"')).toBe('code');
  });
});
