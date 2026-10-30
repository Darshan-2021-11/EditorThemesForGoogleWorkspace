import { extractStyleRule, kindForVariable, remapValue, renderRules } from '../src/content/css-remap';
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

  it('remaps var() fallbacks', () => {
    expect(remapValue('var(--gm3-sys-color-surface,#ffffff)', 'fill', m)).toBe(`var(--gm3-sys-color-surface,${nord.palette.base00})`);
  });

  it('keeps non-color declarations so later rules keep winning (cascade order)', () => {
    const early = extractStyleRule('#c.docs', style({ 'background-color': 'rgb(66, 133, 244)' }), [], [])!;
    const late = extractStyleRule('.m #c', style({ 'background-color': 'inherit' }), [], [])!;
    const css = renderRules([early, late], m, null, true);
    expect(css.indexOf('.m #c{background-color:inherit;}')).toBeGreaterThan(css.indexOf('#c.docs{'));
  });

  it('captures var() shorthands whose longhands read back empty', () => {
    const r = extractStyleRule('.nav', style({ 'background-color': '' }, { background: 'var(--x,#f8fafd)' }), [], [])!;
    expect(r.decls).toEqual([{ prop: 'background', value: 'var(--x,#f8fafd)', kind: 'fill', important: false }]);
  });

  it('white text on solid accent buttons becomes onAccent', () => {
    const r = extractStyleRule('.btn', style({ color: '#fff', 'background-color': '#1a73e8' }), [], [])!;
    expect(r.decls.find((d) => d.prop === 'color')!.kind).toBe('onAccent');
    const v = extractStyleRule('.gb', style({ color: 'var(--gm3-sys-color-on-primary,#fff)' }), [], [])!;
    expect(v.decls[0].kind).toBe('onAccent');
  });

  it('marks grey sprite icons (also via ::before content) but not branding', () => {
    expect(extractStyleRule('.docs-icon-img::before', style({ content: 'url("x/material_sprite_grey_medium.svg")' }), [], [])!.icon).toBe(true);
    expect(extractStyleRule('.docs-branding-icon-img::before', style({ content: 'url("x/branding_sprite1.svg")' }), [], [])).toBeNull();
  });

  it('flags document-surface rules', () => {
    expect(extractStyleRule('.kix-page-paginated', style({ 'background-color': '#fff' }), ['kix-page'], [])!.doc).toBe(true);
  });

  it('renders wrappers and !important', () => {
    const r = extractStyleRule('.a', style({ color: '#000' }, {}, ['color']), [], ['@media print'])!;
    expect(renderRules([r], m, null, false)).toBe(`@media print{.a{color:${nord.palette.base05} !important;}}\n`);
  });

  it('remaps Material rgba(var(--x-rgb, r, g, b), a) colors', () => {
    const out = remapValue('rgba(var(--gm3-sys-color-on-surface-rgb,31,31,31),.38)', 'text', m);
    expect(out).toMatch(/^rgba\(var\(--gm3-sys-color-on-surface-rgb, \d+, \d+, \d+\), 0\.5\d*\)$/);
    expect(out).not.toContain('31, 31, 31');
  });

  it('remaps r,g,b triple variables', () => {
    const r = extractStyleRule(':root', style({ '--gm3-sys-color-on-surface-rgb': '31,31,31' }), [], [])!;
    expect(r.decls[0]).toMatchObject({ kind: 'text', triple: true });
    // near-black ink → a light Nord foreground triple
    const [, rr, gg, bb] = /rgb:(\d+),(\d+),(\d+);/.exec(renderRules([r], m, null, false))!.map(Number);
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
