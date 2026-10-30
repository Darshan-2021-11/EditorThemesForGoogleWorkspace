import { contrast, formatColor, fromOklch, parseColor, toOklch } from '../src/theme/color';
import { createMapper } from '../src/theme/map';
import { nearestAccent, schemeToRoles } from '../src/theme/roles';
import { parseSchemeYaml, resolveSource } from '../src/theme/scheme-import';
import { DEFAULT_OPTIONS } from '../src/theme/types';
import { nord, solarizedLight } from './fixtures';

describe('color parsing', () => {
  it.each([
    ['#fff', '#ffffff'],
    ['#1155CC', '#1155cc'],
    ['rgb(17, 85, 204)', '#1155cc'],
    ['rgb(17 85 204 / 50%)', 'rgba(17, 85, 204, 0.5)'],
    ['rgba(0,0,0,.12)', 'rgba(0, 0, 0, 0.12)'],
    ['hsl(0, 100%, 50%)', '#ff0000'],
    ['white', '#ffffff'],
    ['#00000080', 'rgba(0, 0, 0, 0.502)'],
  ])('%s → %s', (input, out) => {
    expect(formatColor(parseColor(input)!)).toBe(out);
  });

  it('rejects non-colors', () => {
    expect(parseColor('var(--x)')).toBeNull();
    expect(parseColor('currentcolor')).toBeNull();
    expect(parseColor('#zzz')).toBeNull();
  });

  it('round-trips OKLCH', () => {
    const c = parseColor('#81a1c1')!;
    expect(formatColor(fromOklch(toOklch(c)))).toBe('#81a1c1');
  });
});

describe('scheme parsing', () => {
  it('parses current spec yaml', () => {
    const s = parseSchemeYaml(
      'system: "base16"\nname: "Nord"\nauthor: "x"\nvariant: "dark"\npalette:\n' +
        Array.from({ length: 16 }, (_, i) => `  base0${i.toString(16).toUpperCase()}: "#2E3440"`).join('\n'),
      'nord.yaml',
    )!;
    expect(s.id).toBe('base16-nord');
    expect(s.palette.base0F).toBe('#2e3440');
  });

  it('parses legacy flat yaml', () => {
    const s = parseSchemeYaml(
      'scheme: "Old"\nauthor: "y"\n' + Array.from({ length: 16 }, (_, i) => `base0${i.toString(16).toUpperCase()}: "ffffff"`).join('\n'),
      'old.yaml',
    )!;
    expect(s.name).toBe('Old');
    expect(s.variant).toBe('light');
  });

  it('parses legacy yaml with trailing comments (official Dracula file)', () => {
    const s = parseSchemeYaml(
      'scheme: "Dracula"\nauthor: "Mike Barkmin"\nbase00: "282936" #background\n' +
        Array.from({ length: 15 }, (_, i) => `base0${(i + 1).toString(16).toUpperCase()}: "e9e9f4"`).join('\n'),
      'dracula.yaml',
    )!;
    expect(s.id).toBe('base16-dracula');
    expect(s.palette.base00).toBe('#282936');
    expect(s.variant).toBe('dark');
  });

  it('rejects files without a full palette', () => {
    expect(parseSchemeYaml('name: x\npalette:\n  base00: "#000000"', 'x.yaml')).toBeNull();
  });
});

describe('GitHub source URLs', () => {
  it('blob → raw file', () => {
    expect(resolveSource('https://github.com/dracula/base16-dracula-scheme/blob/master/dracula.yaml')).toEqual({
      type: 'file',
      rawUrl: 'https://raw.githubusercontent.com/dracula/base16-dracula-scheme/master/dracula.yaml',
      fileName: 'dracula.yaml',
    });
  });

  it('tree → folder', () => {
    expect(resolveSource('https://github.com/tinted-theming/schemes/tree/spec-0.11/base16')).toEqual({
      type: 'dir', owner: 'tinted-theming', repo: 'schemes', ref: 'spec-0.11', path: 'base16',
    });
  });

  it('repo root → root folder', () => {
    expect(resolveSource('https://github.com/dracula/base16-dracula-scheme')).toMatchObject({ type: 'dir', path: '' });
  });

  it('raw file passes through', () => {
    expect(resolveSource('https://raw.githubusercontent.com/a/b/main/x.yaml')).toMatchObject({ type: 'file', fileName: 'x.yaml' });
  });

  it('rejects other hosts', () => {
    expect(() => resolveSource('https://example.com/x.yaml')).toThrow();
  });
});

describe('accent snapping', () => {
  it.each([
    ['#ff0000', 'red'], ['#ea4335', 'red'], ['#ff9900', 'orange'], ['#ffff00', 'yellow'],
    ['#34a853', 'green'], ['#00ffff', 'cyan'], ['#1a73e8', 'blue'], ['#9900ff', 'purple'],
  ])('%s → %s', (hex, name) => {
    expect(nearestAccent(toOklch(parseColor(hex)!)[2])).toBe(name);
  });
});

describe('mapper (Nord, snap)', () => {
  const roles = schemeToRoles(nord);
  const m = createMapper(roles, DEFAULT_OPTIONS);

  it('page white → background, ink black → foreground', () => {
    expect(m.map('#ffffff', 'fill')).toBe(nord.palette.base00);
    expect(m.map('#000000', 'text')).toBe(nord.palette.base05);
  });

  it('keeps alpha', () => {
    expect(m.map('rgba(0,0,0,0.1)', 'fill')).toMatch(/^rgba\(.*0\.1\)$/);
    expect(m.map('transparent', 'fill')).toBe('rgba(0, 0, 0, 0)');
  });

  it('colored text snaps to theme accents with readable contrast', () => {
    const red = parseColor(m.map('#ff0000', 'text'))!;
    expect(contrast(red, roles.bg)).toBeGreaterThanOrEqual(3.5);
    expect(m.map('#3c78d8', 'text')).toBe(m.map('#4a86e8', 'text')); // both blue
    expect(m.map('#1155cc', 'text')).toBe(nord.palette.base0C); // Docs link color → theme link role
  });

  it('secondary grey text stays readable', () => {
    const c = parseColor(m.map('#9aa0a6', 'text'))!;
    expect(contrast(c, roles.bg)).toBeGreaterThanOrEqual(2.5);
  });

  it('white text on buttons stays light', () => {
    const c = parseColor(m.map('#ffffff', 'text'))!;
    expect(contrast(c, roles.bg)).toBeGreaterThan(7);
  });

  it('pale highlight fills stay close to background', () => {
    const hl = parseColor(m.map('#fff2cc', 'fill'))!;
    const ink = parseColor(m.map('#000000', 'text'))!;
    expect(contrast(ink, hl)).toBeGreaterThan(4.5);
  });

  it('dark tooltips stay dark', () => {
    const tip = parseColor(m.map('#3c4043', 'fill'))!;
    expect(contrast(tip, roles.bg)).toBeLessThan(2);
  });

  it('onAccent maps to background', () => {
    expect(m.map('#ffffff', 'onAccent')).toBe(nord.palette.base00);
  });

  it('returns non-colors untouched', () => {
    expect(m.map('var(--foo)', 'text')).toBe('var(--foo)');
  });
});

describe('mapper (keep-hue, light theme)', () => {
  const roles = schemeToRoles(solarizedLight);
  const m = createMapper(roles, { ...DEFAULT_OPTIONS, mapping: 'keep-hue' });

  it('maps page to the light background', () => {
    expect(roles.isDark).toBe(false);
    expect(m.map('#ffffff', 'fill')).toBe(solarizedLight.palette.base00);
  });

  it('keeps hue for arbitrary colors and ensures contrast', () => {
    const pink = parseColor('#ff00aa')!;
    const out = parseColor(m.map('#ff00aa', 'text'))!;
    expect(Math.abs(toOklch(out)[2] - toOklch(pink)[2])).toBeLessThan(12);
    expect(contrast(out, roles.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('Google semantic colors still use theme roles', () => {
    expect(m.map('#d93025', 'line')).toBe(solarizedLight.palette.base08);
  });
});
