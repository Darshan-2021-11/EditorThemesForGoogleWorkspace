// Runs in the page's own JS world at document_start, before Google's scripts.
// Docs/Sheets paint document content on <canvas>; we remap colors at draw time so the canvas
// shows theme colors directly (no inversion filters). While inactive every call passes through.
import { formatColor, parseColor } from '../theme/color';
import { createMapper, type Mapper } from '../theme/map';
import { schemeToRoles } from '../theme/roles';
import { styleColors as computeStyleColors } from '../theme/style-colors';
import type { ColorKind, StyleKey, ThemeSpec } from '../theme/types';
import { ANSWER_EVENT, CONFIG_EVENT, DOC_STYLES_EVENT, QUERY_EVENT, READY_EVENT, type TextColorQuery } from '../shared/hook-protocol';
import { buildIndex, parseExportHtml, parseStyleColors, StyleLearner, styleFromName } from './styles';

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
/** Theme color per paragraph style, when "color by paragraph style" is on. */
let styleColors: Record<StyleKey, string> | null = null;
let learner: StyleLearner | null = null;
const states = new WeakMap<object, CtxState>();
const debug = {
  active: false, configs: 0, calls: {} as Record<string, number>,
  fonts: {} as Record<string, number>, samples: {} as Record<string, string>,
};
if (__WD_DEV__) (window as unknown as { __wdHookDebug: typeof debug }).__wdHookDebug = debug;

// ------------------------------------------------------------------------------------------
// Paragraph-style colors

const MONO_RE = /mono|courier|consolas|menlo|inconsolata|source code|fira code|cascadia|jetbrains/i;
const LINK_COLORS = new Set(['#1155cc', '#0000ff', '#0000ee', '#1a0dab']);

/** The style color for a run, or null to fall back to plain color mapping. */
function styleColorFor(font: string, fill: string, text: string): string | null {
  if (!styleColors) return null;
  if (LINK_COLORS.has(fill)) return styleColors.link;
  if (MONO_RE.test(font)) return styleColors.code;
  // Redraws can mean restyled paragraphs (e.g. a changed Heading 2 color): re-check now and then.
  if (learner) scheduleIndexRefresh(20000);
  const s = learner?.classify(font, text);
  if (s) return styleColors[s];
  return isNormalInk(fill) ? styleColors.normal : null;
}

/** The document's Normal text color (raw), so colored Normal text matches the panel exactly. */
let docNormal: string | null = null;

/** Body text in the Normal style's color, or default ink → the "Normal text" style color. */
function isNormalInk(fill: string): boolean {
  return fill === docNormal || isInk(fill);
}

const inkCache = new Map<string, boolean>();
/** Default-looking text color (black / dark grey): body text that takes the "normal" color. */
function isInk(css: string): boolean {
  let v = inkCache.get(css);
  if (v === undefined) {
    const c = parseColor(css);
    const L = c ? 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b : 255;
    v = !!c && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 24 && L < 128;
    inkCache.set(css, v);
  }
  return v;
}

/** Reads paragraph styles from the document's HTML export (read-only; Docs editor pages only). */
let indexRequested = false;
let indexAvailable = true;
let lastIndexFetch = 0;
let refreshTimer = 0;
async function loadParagraphIndex() {
  if (indexRequested) return;
  indexRequested = true;
  await fetchParagraphIndex();
}

async function fetchParagraphIndex() {
  const id = /\/document\/(?:u\/\d+\/)?d\/([\w-]{10,})/.exec(location.pathname)?.[1];
  if (__WD_DEV__) (debug as Record<string, unknown>).indexStart = { id, top: window === window.top };
  if (!id || window !== window.top) return;
  lastIndexFetch = Date.now();
  try {
    const res = await fetch(`/document/d/${id}/export?format=html`, { credentials: 'include' });
    if (__WD_DEV__) (debug as Record<string, unknown>).indexStatus = res.status;
    if (!res.ok) {
      indexAvailable = false;
      return;
    }
    const html = await res.text();
    const index = buildIndex(parseExportHtml(html));
    // Named-style colors go to the extension, which notices when the user changes one.
    const docStyles = parseStyleColors(html);
    const normal = docStyles.normal ? parseColor(docStyles.normal) : null;
    docNormal = normal ? formatColor({ ...normal, a: 1 }) : null;
    window.dispatchEvent(new CustomEvent(DOC_STYLES_EVENT, { detail: JSON.stringify(docStyles) }));
    if (learner) learner.setIndex(index);
    else learner = new StyleLearner(index, scheduleRepaint, () => scheduleIndexRefresh());
    if (__WD_DEV__) (debug as Record<string, unknown>).learner = learner;
    learnedRepaints = 0;
    repaint();
  } catch (e) {
    // export unavailable (e.g. downloads disabled): headings keep plain mapping
    indexAvailable = false;
    if (__WD_DEV__) (debug as Record<string, unknown>).indexError = String(e);
  }
}

/**
 * Text the index doesn't know was drawn (the user typed or added a heading): re-read paragraph
 * styles once editing pauses, at most every 15 s.
 */
function scheduleIndexRefresh(minGap = 15000) {
  if (refreshTimer || !indexAvailable || document.visibilityState !== 'visible') return;
  const wait = Math.max(2500, minGap - (Date.now() - lastIndexFetch));
  refreshTimer = window.setTimeout(() => {
    refreshTimer = 0;
    fetchParagraphIndex();
  }, wait);
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
      want = (text !== undefined && styleColorFor(c.font, s.fill, text)) || mapper.map(s.fill, kind);
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
        if (__WD_DEV__) {
          debug.calls[name as string] = (debug.calls[name as string] ?? 0) + 1;
          if (name === 'fillText') {
            const k = `${this.font} | ${String(this.fillStyle)} | scale=${(this as CanvasRenderingContext2D).getTransform?.().a}`;
            debug.fonts[k] = (debug.fonts[k] ?? 0) + String(args[0]).length;
            if (!debug.samples[k]) debug.samples[k] = String(args[0]).slice(0, 40);
          }
        }
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
  mapper = null;
  styleColors = null;
  if (spec) {
    const roles = schemeToRoles(spec.scheme);
    mapper = createMapper(roles, spec.options);
    if (spec.options.styleColors) {
      styleColors = computeStyleColors(spec);
      loadParagraphIndex();
    }
  }
  debug.active = !!mapper;
  debug.configs++;
  repaint();
}

/**
 * Asks the app to repaint its canvases. Docs re-renders its visible tiles on visibilitychange
 * (resize/scroll/font events alone don't trigger a repaint).
 */
function repaint() {
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('resize'));
}

/** Debounced repaint for when style recognition improves; capped so it can't loop. */
let repaintTimer = 0;
let learnedRepaints = 0;
function scheduleRepaint() {
  if (learnedRepaints >= 8) return;
  clearTimeout(repaintTimer);
  repaintTimer = window.setTimeout(() => {
    learnedRepaints++;
    repaint();
  }, 250);
}

/** The color painted for text with this raw color, size and paragraph style (mirrors prepFill). */
function resolveTextColor(q: TextColorQuery): string | null {
  if (!mapper) return null;
  const fill = parseColor(q.color) ? formatColor(parseColor(q.color)!) : q.color;
  if (styleColors) {
    if (LINK_COLORS.has(fill)) return styleColors.link;
    const s = styleFromName(q.style) ?? learner?.tierFor(q.px);
    if (s) return styleColors[s];
    if (isNormalInk(fill)) return styleColors.normal;
  }
  return mapper.map(fill, 'text');
}

window.addEventListener(QUERY_EVENT, (e) => {
  const detail = (e as CustomEvent).detail;
  if (typeof detail !== 'string') return;
  try {
    const q = JSON.parse(detail) as TextColorQuery;
    window.dispatchEvent(new CustomEvent(ANSWER_EVENT, { detail: JSON.stringify({ id: q.id, color: resolveTextColor(q) }) }));
  } catch {
    // ignore malformed query
  }
});

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
