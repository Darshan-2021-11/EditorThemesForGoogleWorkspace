// Runs in the page's own JS world at document_start, before Google's scripts.
// Docs/Sheets paint document content on <canvas>; we remap colors at draw time so the canvas
// shows theme colors directly (no inversion filters). While inactive every call passes through.
import { ensureContrast, parseColor, toOklch } from '../theme/color';
import { createMapper, type Mapper } from '../theme/map';
import { schemeToRoles } from '../theme/roles';
import type { ColorKind, ThemeSpec } from '../theme/types';
import { CONFIG_EVENT, READY_EVENT } from '../shared/hook-protocol';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Style = string | CanvasGradient | CanvasPattern;

interface CtxState {
  fill: Style;
  stroke: Style;
  /** What the native context currently holds (string styles only). */
  appliedFill?: string;
  appliedStroke?: string;
  stack: [Style, Style, string | undefined, string | undefined][];
}

let mapper: Mapper | null = null;
let semanticColors: { heading: string; code: string } | null = null;
const states = new WeakMap<object, CtxState>();

// ------------------------------------------------------------------------------------------
// Semantic accents: classify text by font (headings by size relative to body text, code by family)

const MONO_RE = /mono|courier|consolas|menlo|inconsolata|source code|fira code|cascadia|jetbrains/i;
const sizeCounts = new Map<number, number>();
let bodySize = 0;
let sampleCount = 0;

function classifyText(font: string, text: string): 'heading' | 'code' | null {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  if (!m) return null;
  if (MONO_RE.test(font.slice(m.index))) return 'code';
  const size = Math.round(parseFloat(m[1]) * 2) / 2;
  sizeCounts.set(size, (sizeCounts.get(size) ?? 0) + text.length);
  if (++sampleCount % 200 === 1) {
    let best = 0;
    for (const [s, n] of sizeCounts) if (n > (sizeCounts.get(best) ?? 0)) best = s;
    bodySize = best;
  }
  if (!bodySize) return null;
  const bold = /\b(bold|bolder|[6-9]00)\b/.test(font.slice(0, m.index));
  return size >= bodySize * 1.25 || (bold && size >= bodySize * 1.1) ? 'heading' : null;
}

function isDefaultInk(css: string): boolean {
  const c = parseColor(css);
  if (!c) return false;
  const [L, C] = toOklch(c);
  return C < 0.02 && L < 0.5;
}

// ------------------------------------------------------------------------------------------
// Patching

function state(ctx: Ctx2D, get: (c: Ctx2D) => Style, getStroke: (c: Ctx2D) => Style): CtxState {
  let st = states.get(ctx);
  if (!st) {
    const fill = get(ctx);
    const stroke = getStroke(ctx);
    st = {
      fill, stroke, stack: [],
      appliedFill: typeof fill === 'string' ? fill : undefined,
      appliedStroke: typeof stroke === 'string' ? stroke : undefined,
    };
    states.set(ctx, st);
  }
  return st;
}

function patch(proto: typeof CanvasRenderingContext2D.prototype | typeof OffscreenCanvasRenderingContext2D.prototype) {
  const fillD = Object.getOwnPropertyDescriptor(proto, 'fillStyle')!;
  const strokeD = Object.getOwnPropertyDescriptor(proto, 'strokeStyle')!;
  const getFill = (c: Ctx2D) => fillD.get!.call(c) as Style;
  const getStroke = (c: Ctx2D) => strokeD.get!.call(c) as Style;
  const st = (c: Ctx2D) => state(c, getFill, getStroke);

  Object.defineProperty(proto, 'fillStyle', {
    configurable: true,
    enumerable: true,
    get(this: Ctx2D) {
      return states.get(this)?.fill ?? getFill(this);
    },
    set(this: Ctx2D, v: Style) {
      fillD.set!.call(this, v);
      const s = st(this);
      s.fill = getFill(this);
      s.appliedFill = typeof s.fill === 'string' ? s.fill : undefined;
    },
  });
  Object.defineProperty(proto, 'strokeStyle', {
    configurable: true,
    enumerable: true,
    get(this: Ctx2D) {
      return states.get(this)?.stroke ?? getStroke(this);
    },
    set(this: Ctx2D, v: Style) {
      strokeD.set!.call(this, v);
      const s = st(this);
      s.stroke = getStroke(this);
      s.appliedStroke = typeof s.stroke === 'string' ? s.stroke : undefined;
    },
  });

  function prepFill(c: Ctx2D, kind: ColorKind, text?: string) {
    const s = st(c);
    if (typeof s.fill !== 'string') return;
    let want = s.fill;
    if (mapper) {
      want = mapper.map(s.fill, kind);
      if (text !== undefined && semanticColors && isDefaultInk(s.fill)) {
        const cls = classifyText(c.font, text);
        if (cls) want = semanticColors[cls];
      }
    }
    if (want !== s.appliedFill) {
      fillD.set!.call(c, want);
      s.appliedFill = want;
    }
  }

  function prepStroke(c: Ctx2D, kind: ColorKind) {
    const s = st(c);
    if (typeof s.stroke !== 'string') return;
    const want = mapper ? mapper.map(s.stroke, kind) : s.stroke;
    if (want !== s.appliedStroke) {
      strokeD.set!.call(c, want);
      s.appliedStroke = want;
    }
  }

  const wrap = <K extends keyof typeof proto>(name: K, before: (c: Ctx2D, args: unknown[]) => void) => {
    const orig = proto[name] as unknown as (...a: unknown[]) => unknown;
    if (typeof orig !== 'function') return;
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value: function (this: Ctx2D, ...args: unknown[]) {
        before(this, args);
        return orig.apply(this, args);
      },
    });
  };

  const thin = (w: unknown, h: unknown) => Math.abs(Number(w)) <= 2.5 || Math.abs(Number(h)) <= 2.5;
  wrap('fillRect', (c, a) => prepFill(c, thin(a[2], a[3]) ? 'text' : 'fill'));
  wrap('fill', (c) => prepFill(c, 'fill'));
  wrap('fillText', (c, a) => prepFill(c, 'text', String(a[0])));
  wrap('strokeText', (c) => prepStroke(c, 'text'));
  wrap('stroke', (c) => prepStroke(c, 'line'));
  wrap('strokeRect', (c) => prepStroke(c, 'line'));

  const save = proto.save;
  const restore = proto.restore;
  proto.save = function (this: Ctx2D) {
    const s = st(this);
    s.stack.push([s.fill, s.stroke, s.appliedFill, s.appliedStroke]);
    return save.call(this);
  };
  proto.restore = function (this: Ctx2D) {
    const r = restore.call(this);
    const s = states.get(this);
    const top = s?.stack.pop();
    if (s && top) [s.fill, s.stroke, s.appliedFill, s.appliedStroke] = top;
    return r;
  };
  if ('reset' in proto && typeof proto.reset === 'function') {
    const reset = proto.reset;
    proto.reset = function (this: Ctx2D) {
      states.delete(this);
      return reset.call(this);
    };
  }

  const drawImage = proto.drawImage as (...a: unknown[]) => void;
  proto.drawImage = function (this: Ctx2D, ...args: unknown[]) {
    if (mapper?.options.dimImages && isPicture(args[0])) {
      const prev = this.filter;
      this.filter = `brightness(${mapper.options.dimAmount})`;
      try {
        return drawImage.apply(this, args);
      } finally {
        this.filter = prev;
      }
    }
    return drawImage.apply(this, args);
  } as typeof proto.drawImage;
}

function isPicture(src: unknown): boolean {
  return (
    src instanceof HTMLImageElement ||
    src instanceof SVGImageElement ||
    src instanceof HTMLVideoElement ||
    (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap)
  );
}

patch(CanvasRenderingContext2D.prototype);
if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') patch(OffscreenCanvasRenderingContext2D.prototype);

const addColorStop = CanvasGradient.prototype.addColorStop;
CanvasGradient.prototype.addColorStop = function (offset: number, color: string) {
  return addColorStop.call(this, offset, mapper ? mapper.map(color, 'fill') : color);
};

// ------------------------------------------------------------------------------------------
// Configuration from the content script (JSON string: Xray-safe across worlds)

function configure(spec: ThemeSpec | null) {
  if (!spec) {
    mapper = null;
    semanticColors = null;
  } else {
    const roles = schemeToRoles(spec.scheme);
    mapper = createMapper(roles, spec.options);
    const hex = (c: { r: number; g: number; b: number }) =>
      '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    semanticColors = spec.options.semantic
      ? { heading: hex(ensureContrast(roles.heading, roles.bg, 4.5)), code: hex(ensureContrast(roles.code, roles.bg, 4.5)) }
      : null;
  }
  // Ask the app to repaint its canvases with the new colors.
  window.dispatchEvent(new Event('resize'));
}

window.addEventListener(CONFIG_EVENT, (e) => {
  const detail = (e as CustomEvent).detail;
  if (typeof detail !== 'string') return;
  try {
    configure(JSON.parse(detail) as ThemeSpec | null);
  } catch {
    // ignore malformed config
  }
});
window.dispatchEvent(new Event(READY_EVENT));
