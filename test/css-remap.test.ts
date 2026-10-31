import { extractStyleRule, kindForVariable, remapValue, renderRules, withTextTwins } from '../src/content/css-remap';
import { createMapper } from '../src/theme/map';
import { schemeToRoles } from '../src/theme/roles';
import { DEFAULT_OPTIONS } from '../src/theme/types';
import { nord } from './fixtures';

/** Minimal stand-in for CSSStyleDeclaration: longhands listed, shorthands readable by name. */
function style(decls: Record<string, string>, shorthands: Record<string, string> = {}, important: string[] = []): CSSStyleDeclaration {
  const props = Object.keys(decls);
  const s: Record<string | number, unknown> = {
    length: props.length,
    getPropertyValue: (p: string) => decls[p] ?? shorthands[p] ?? '',
    getPropertyPriority: (p: string) => (important.includes(p) ? 'important' : ''),
  };
  props.forEach((p, i) => (s[i] = p));
  return s as unknown as CSSStyleDeclaration;
}

const m = createMapper(schemeToRoles(nord), DEFAULT_OPTIONS);

describe('css remapping', () => {
  it('remaps colors but not url() contents', () => {
    expect(remapValue('url(white.png) #ffffff', 'fill', m)).toBe(`url(white.png) ${nord.palette.base00}`);
  });

  it('never rewrites color words inside variable names', () => {
    const v = remapValue('var(--ws-sys-color-extended-grey-fill,#5e5e5e)', 'text', m);
    expect(v.startsWith('var(--ws-sys-color-extended-grey-fill,')).toBe(true);
    expect(remapValue('var(--x-white-y) red', 'text', m)).toMatch(/^var\(--x-white-y\) #/);
  });

  it('remaps var() fallbacks', () => {
    expect(remapValue('var(--gm3-sys-color-surface,#ffffff)', 'fill', m)).toBe(`var(--gm3-sys-color-surface,${nord.palette.base00})`);
  });

  it('keeps non-color declarations so later rules keep winning (cascade order)', () => {
    const early = extractStyleRule('#c.docs', style({ 'background-color': 'rgb(66, 133, 244)' }))!;
    const late = extractStyleRule('.m #c', style({ 'background-color': 'inherit' }))!;
    const css = renderRules([early, late], m,true);
    expect(css.indexOf('.m #c{background-color:inherit;}')).toBeGreaterThan(css.indexOf('#c.docs{'));
  });

  it('text reads a text twin of shared color variables (labels stay readable)', () => {
    expect(withTextTwins('var(--gm3-sys-color-primary,#0b57d0)')).toBe('var(--wd-t--gm3-sys-color-primary, var(--gm3-sys-color-primary,#0b57d0))');
    expect(withTextTwins('var(--a, var(--b, red))')).toBe('var(--wd-t--a, var(--a, var(--wd-t--b, var(--b, red))))');
    const def = extractStyleRule(':root', style({ '--gm3-sys-color-primary': '#0b57d0' }))!;
    expect(def.decls.map((d) => [d.prop, d.kind])).toEqual([['--wd-t--gm3-sys-color-primary', 'text'], ['--gm3-sys-color-primary', 'text']]);
    const use = extractStyleRule('.tab', style({ color: 'var(--gm3-sys-color-primary,#0b57d0)' }))!;
    expect(use.decls[0].value).toContain('var(--wd-t--gm3-sys-color-primary');
    expect(use.decls[0].kind).toBe('text');
    // surface-colored text stays matched to the surface (deliberately invisible input text)
    expect(extractStyleRule('.t', style({ color: 'var(--gm3-sys-color-surface)' }))!.decls[0].kind).toBe('fill');
    // …but a "fill"-named grey used as text is ordinary text
    expect(extractStyleRule('.t', style({ color: 'var(--ws-sys-color-extended-grey-fill,#5e5e5e)' }))!.decls[0].kind).toBe('text');
  });

  it('remaps the fallback of aliased component colors (Material buttons, dialogs)', () => {
    const r = extractStyleRule('.btn', style({ '--gm3-button-filled-tonal-container-color': 'var(--gm3-sys-color-primary-container,#d3e3fd)' }))!;
    const css = renderRules([r], m, true);
    expect(css).toContain('--gm3-button-filled-tonal-container-color:var(--gm3-sys-color-primary-container,');
    expect(css).not.toContain('#d3e3fd');
  });

  it('filled-button labels aliased to on-primary sit on the accent', () => {
    const r = extractStyleRule('.b', style({ '--gm3-button-filled-label-text-color': 'var(--gm3-sys-color-on-primary,#fff)' }))!;
    expect(r.decls.every((d) => d.kind === 'onAccent')).toBe(true);
    expect(renderRules([r], m, true)).toContain(nord.palette.base00);
  });

  it('captures var() shorthands whose longhands read back empty', () => {
    const r = extractStyleRule('.nav', style({ 'background-color': '' }, { background: 'var(--x,#f8fafd)' }))!;
    expect(r.decls).toEqual([{ prop: 'background', value: 'var(--x,#f8fafd)', kind: 'fill', important: false }]);
  });

  it('white text on solid accent buttons becomes onAccent', () => {
    const r = extractStyleRule('.btn', style({ color: '#fff', 'background-color': '#1a73e8' }))!;
    expect(r.decls.find((d) => d.prop === 'color')!.kind).toBe('onAccent');
    const v = extractStyleRule('.gb', style({ color: 'var(--gm3-sys-color-on-primary,#fff)' }))!;
    expect(v.decls[0].kind).toBe('onAccent');
  });

  it('text painted in a surface variable stays matched to the surface (Docs title input)', () => {
    const r = extractStyleRule('.docs-title-input', style({ color: 'var(--gm3-sys-color-surface-container-low,#f8fafd)' }))!;
    expect(r.decls[0].kind).toBe('fill');
    expect(renderRules([r], m,false)).not.toContain(nord.palette.base05);
  });

  it('marks grey sprite icons (also via ::before content) but not branding', () => {
    expect(extractStyleRule('.docs-icon-img::before', style({ content: 'url("x/material_sprite_grey_medium.svg")' }))!.icon).toBe(true);
    expect(extractStyleRule('.docs-branding-icon-img::before', style({ content: 'url("x/branding_sprite1.svg")' }))).toBeNull();
  });


  it('renders wrappers and !important', () => {
    const r = extractStyleRule('.a', style({ color: '#000' }, {}, ['color']), ['@media print'])!;
    expect(renderRules([r], m,false)).toBe(`@media print{.a{color:${nord.palette.base05} !important;}}\n`);
  });

  it('remaps Material rgba(var(--x-rgb, r, g, b), a) colors', () => {
    const out = remapValue('rgba(var(--gm3-sys-color-on-surface-rgb,31,31,31),.38)', 'text', m);
    expect(out).toMatch(/^rgba\(var\(--gm3-sys-color-on-surface-rgb, \d+, \d+, \d+\), 0\.5\d*\)$/);
    expect(out).not.toContain('31, 31, 31');
  });

  it('remaps r,g,b triple variables', () => {
    const r = extractStyleRule(':root', style({ '--gm3-sys-color-on-surface-rgb': '31,31,31' }))!;
    expect(r.decls[0]).toMatchObject({ kind: 'text', triple: true });
    // near-black ink → a light Nord foreground triple
    const [, rr, gg, bb] = /rgb:(\d+),(\d+),(\d+);/.exec(renderRules([r], m,false))!.map(Number);
    expect(Math.min(rr, gg, bb)).toBeGreaterThan(180);
  });

  it('maps system colors', () => {
    expect(remapValue('graytext', 'text', m)).not.toBe('graytext');
  });

  it('classifies variables by name', () => {
    expect(kindForVariable('--gm3-sys-color-on-surface', '#1f1f1f')).toBe('text');
    expect(kindForVariable('--gm3-sys-color-surface-container-low', '#f8fafd')).toBe('fill');
    expect(kindForVariable('--gm3-sys-color-outline-variant', '#c4c7c5')).toBe('line');
    expect(kindForVariable('--gm3-sys-color-on-primary', '#fff')).toBe('onAccent');
    expect(kindForVariable('--gm3-sys-color-on-secondary-container', '#004a77')).toBe('text');
    expect(kindForVariable('--some-size', '12px')).toBeNull();
  });
});
