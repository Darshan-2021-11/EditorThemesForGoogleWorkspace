// Runs in the page's own JS world at document_start, before Google's scripts.
// Docs/Sheets paint document content on <canvas>; we remap colors at draw time so the canvas
// shows theme colors directly (no inversion filters). While inactive every call passes through.
import { formatColor, parseColor } from '../theme/color';
import { createMapper, type Mapper } from '../theme/map';
import { schemeToRoles } from '../theme/roles';
import { styleColors as computeStyleColors } from '../theme/style-colors';
import type { ColorKind, StyleKey, ThemeSpec } from '../theme/types';
import { ANSWER_EVENT, CONFIG_EVENT, DOC_STYLES_EVENT, QUERY_EVENT, READY_EVENT, type TextColorQuery } from '../shared/hook-protocol';
import { buildIndex, MONO_RE, parseExportHtml, parseStyleColors, StyleLearner, styleFromName } from './styles';
import { PairContrast, parseFont, RectStore, textTarget } from './contrast-pairs';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Style = string | CanvasGradient | CanvasPattern;

interface CtxState {
  fill: Style;
  stroke: Style;
  /** What the native context currently holds (string styles only). */
  appliedFill?: string;
  appliedStroke?: string;
  stack: [Style, Style, string | undefined, string | undefined][];
  /** Recent opaque fill rects (device px) with their painted color: what text lands on. */
  rects?: RectStore;
}

let mapper: Mapper | null = null;
/** Text-vs-background contrast for the active theme (null while inactive). */
let pairs: PairContrast | null = null;
/** Theme color per paragraph style, when "color by paragraph style" is on. */
let styleColors: Record<StyleKey, string> | null = null;
let learner: StyleLearner | null = null;
const states = new WeakMap<object, CtxState>();
const debug = {
  active: false, configs: 0, calls: {} as Record<string, number>,
  fonts: {} as Record<string, number>, samples: {} as Record<string, string>,
  trace: [] as unknown[],
};
if (__WD_DEV__) (window as unknown as { __wdHookDebug: typeof debug }).__wdHookDebug = debug;

// ------------------------------------------------------------------------------------------
// Paragraph-style colors

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

  function prepFill(c: Ctx2D, kind: ColorKind, text?: string, args?: unknown[]) {
    const s = st(c);
    if (typeof s.fill !== 'string') return;
    let want = s.fill;
    if (mapper) {
      want = (text !== undefined && styleColorFor(c.font, s.fill, text)) || mapper.map(s.fill, kind);
      if (args && pairs) want = pairText(c, s, want, args, pairs);
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
        if (__WD_DEV__ && name === 'fillText') auditText(this, args, getFill(this));
        if (__WD_DEV__) {
          const trace = (debug as { trace?: unknown[] }).trace;
          if (trace && trace.length < 4000) {
            const cv = (this as CanvasRenderingContext2D).canvas;
            trace.push([name, `${String(this.fillStyle)}>${String(getFill(this))}`, `${String(this.strokeStyle)}>${String(getStroke(this))}`, cv?.width, !!mapper, args.slice(0, 4).map((a) => (typeof a === 'number' ? Math.round(a) : String(a).slice(0, 20)))]);
          }
        }
        return orig.apply(this, args);
      },
    });
  };

  const thin = (w: unknown, h: unknown) => Math.abs(Number(w)) <= 2.5 || Math.abs(Number(h)) <= 2.5;
  wrap('fillRect', (c, a) => {
    const line = thin(a[2], a[3]);
    prepFill(c, line ? 'text' : 'fill');
    if (pairs && !line) rememberRect(c, a, pairs);
  });
  wrap('fill', (c) => prepFill(c, 'fill'));
  wrap('fillText', (c, a) => prepFill(c, 'text', String(a[0]), a));
  wrap('clearRect', (c, a) => {
    if (pairs) forgetArea(c, Number(a[0]), Number(a[1]), Number(a[2]), Number(a[3]));
  });
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
    if (__WD_DEV__) {
      const trace = (debug as { trace?: unknown[] }).trace;
      const src = args[0] as { constructor?: { name?: string }; width?: number };
      if (trace && trace.length < 4000) trace.push(['drawImage', src?.constructor?.name, src?.width, (this as CanvasRenderingContext2D).canvas?.width, args.slice(1, 5).map((a) => Math.round(Number(a)))]);
    }
    if (pairs) {
      // An image now covers its destination: fills remembered under it no longer show.
      const n = args.length >= 9 ? 5 : 1;
      const src = args[0] as { width?: unknown; height?: unknown };
      const w = args.length >= 5 ? args[n + 2] : src?.width, h = args.length >= 5 ? args[n + 3] : src?.height;
      forgetArea(this, Number(args[n]), Number(args[n + 1]), Number(w), Number(h));
    }
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

/**
 * Dev-only contrast audit (scripts/contrast-audit.mjs): before a run of text is drawn, reads the
 * pixels under it and records the contrast of the painted text color against the dominant one.
 */
function auditText(c: Ctx2D, args: unknown[], fill: Style) {
  const audit = (debug as { audit?: unknown[] }).audit;
  if (!audit || audit.length >= 3000 || typeof fill !== 'string') return;
  const text = String(args[0]);
  if (!text.trim()) return;
  try {
    const m = c.measureText(text);
    const t = c.getTransform();
    const x = Number(args[1]), y = Number(args[2]);
    const x0 = Math.floor(t.a * x + t.e), x1 = Math.ceil(t.a * (x + m.width) + t.e);
    const y0 = Math.floor(t.d * (y - m.actualBoundingBoxAscent) + t.f), y1 = Math.ceil(t.d * (y + m.actualBoundingBoxDescent) + t.f);
    const w = Math.min(x1 - x0, 400), h = y1 - y0;
    if (w < 1 || h < 1 || x0 < 0 || y0 < 0) return;
    const d = c.getImageData(x0, y0, w, h).data;
    const counts = new Map<number, number>();
    for (let i = 0; i < d.length; i += 16) {
      const k = d[i + 3] < 128 ? -1 : (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let bg = -1, best = 0;
    for (const [k, n] of counts) if (n > best) { bg = k; best = n; }
    const px = Math.abs(t.d) * parseFloat(/(\d+(?:\.\d+)?)px/.exec(c.font)?.[1] ?? '0');
    audit.push({
      text: text.slice(0, 40), fg: fill, bg: bg < 0 ? 'transparent' : '#' + bg.toString(16).padStart(6, '0'),
      px: Math.round(px * 10) / 10, bold: /\b(bold|[6-9]00)\b/.test(c.font),
    });
  } catch {
    // tainted or unmeasurable: skip
  }
}

// ------------------------------------------------------------------------------------------
// Text contrast against what it's drawn on

/** Vertical middle of the text relative to y, in font sizes, per textBaseline. */
const BASELINE_MID: Record<string, number> = { top: 0.5, hanging: 0.45, middle: 0, ideographic: -0.5, bottom: -0.5 };

/** Remembers an opaque fillRect (device px) with the color prepFill just applied. */
function rememberRect(c: Ctx2D, a: unknown[], p: PairContrast) {
  const s = states.get(c);
  if (!s) return;
  const x = Number(a[0]), y = Number(a[1]), w = Number(a[2]), h = Number(a[3]);
  if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h))) return;
  if (c.globalCompositeOperation !== 'source-over') {
    forgetArea(c, x, y, w, h);
    return;
  }
  // Translucent fills (selection tints, hover) don't replace what's under them: ignore.
  const color = s.appliedFill;
  if (color === undefined || c.globalAlpha < 0.999 || !p.isOpaque(color)) return;
  const t = c.getTransform();
  const rects = (s.rects ??= new RectStore());
  rects.checkSize(c.canvas.width, c.canvas.height, debug.configs);
  if (t.b !== 0 || t.c !== 0) {
    rects.clear(); // rotated/skewed: can't place it, so don't trust older rects either
    return;
  }
  rects.add(t.a * x + t.e, t.d * y + t.f, t.a * (x + w) + t.e, t.d * (y + h) + t.f, color);
}

/** Drops remembered fills overlapping a user-space rect (cleared, or painted over by an image). */
function forgetArea(c: Ctx2D, x: number, y: number, w: number, h: number) {
  const rects = states.get(c)?.rects;
  if (!rects?.length) return;
  const t = c.getTransform();
  if (t.b !== 0 || t.c !== 0 || !(Number.isFinite(x + y + w + h))) {
    rects.clear();
    return;
  }
  rects.invalidate(t.a * x + t.e, t.d * y + t.f, t.a * (x + w) + t.e, t.d * (y + h) + t.f);
}

/** The text color to paint: `color` raised to WCAG AA against the fill under the text anchor. */
function pairText(c: Ctx2D, s: CtxState, color: string, args: unknown[], p: PairContrast): string {
  const f = parseFont(c.font);
  const t = c.getTransform();
  let under: string | null = null;
  const rects = s.rects;
  if (rects?.length && t.b === 0 && t.c === 0) {
    rects.checkSize(c.canvas.width, c.canvas.height, debug.configs);
    const x = Number(args[1]), y = Number(args[2]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      // Step 1px into the run (x is its start, end or middle) and to the glyphs' vertical middle.
      const align = c.textAlign;
      const ux = x + (align === 'right' || align === 'end' ? -1 : align === 'center' ? 0 : 1);
      const uy = y + f.px * (BASELINE_MID[c.textBaseline] ?? -0.35);
      under = rects.find(t.a * ux + t.e, t.d * uy + t.f);
    }
  }
  // No fill under it: the text sits on the page Docs paints (theme bg) behind the canvas.
  return p.fix(color, under, textTarget(f.px * Math.abs(t.d), f.bold));
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
  pairs = null;
  styleColors = null;
  if (spec) {
    const roles = schemeToRoles(spec.scheme);
    mapper = createMapper(roles, spec.options);
    pairs = new PairContrast(roles.fg, roles.bg);
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
if (__WD_DEV__) (debug as Record<string, unknown>).repaint = () => repaint();
function repaint() {
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('resize'));
  repaintSheetsGrid();
}

/**
 * Sheets ignores a resize event when the viewport size is unchanged, so report a viewport 1px
 * smaller for a moment: it re-lays out and redraws the whole visible grid, whatever its size.
 */
async function fakeViewportResize() {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const de = document.documentElement;
  const fakes: [object, string, number][] = [
    [window, 'innerWidth', window.innerWidth], [window, 'innerHeight', window.innerHeight],
    [de, 'clientWidth', de.clientWidth], [de, 'clientHeight', de.clientHeight],
  ];
  // Some of these are own properties (Firefox keeps Window attributes on the instance): restore exactly.
  const saved = fakes.map(([o, p]) => Object.getOwnPropertyDescriptor(o, p));
  for (const [o, p, v] of fakes) Object.defineProperty(o, p, { configurable: true, get: () => v - 1 });
  try {
    window.dispatchEvent(new Event('resize'));
    await frame(); await frame();
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    fakes.forEach(([o, p], i) => {
      delete (o as Record<string, unknown>)[p];
      if (saved[i]) Object.defineProperty(o, p, saved[i]!);
    });
  }
  window.dispatchEvent(new Event('resize'));
  await frame(); await frame();
}

let sheetsBusy = false;
let sheetsAgain = false;
async function repaintSheetsGrid() {
  if (!location.pathname.startsWith('/spreadsheets/') || window !== window.top) return;
  if (sheetsBusy) {
    // a newer config arrived mid-repaint: repaint once more afterwards
    sheetsAgain = true;
    return;
  }
  sheetsBusy = true;
  try {
    await fakeViewportResize();
  } finally {
    sheetsBusy = false;
  }
  if (sheetsAgain) {
    sheetsAgain = false;
    repaintSheetsGrid();
  }
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
