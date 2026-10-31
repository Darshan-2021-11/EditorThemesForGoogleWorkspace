// Recognises paragraph styles (Title, Heading 1…) in canvas-drawn text.
// Docs only gives us text runs and fonts, so we read which paragraph has which style from the
// document's HTML export, match drawn runs against those paragraphs, and learn which font each
// style uses in this document. After that, any run in a learned font gets the style's color.
import type { StyleKey } from '../theme/types';

/** Removes the bidi/zero-width controls Docs wraps runs in, and collapses whitespace. */
export function normText(s: string): string {
  return s.replace(/[​-‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim();
}

const PREFIX = 24;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Extracts paragraphs from Docs' HTML export. Uses string parsing: Docs' Trusted Types CSP
 * forbids DOMParser on raw strings, and the export markup is flat and regular.
 */
export function parseExportHtml(html: string): { tag: string; className: string; text: string }[] {
  const body = html.slice(Math.max(0, html.search(/<body/i)));
  const out: { tag: string; className: string; text: string }[] = [];
  const re = /<(h[1-6]|p|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const className = /\bclass="([^"]*)"/.exec(m[2])?.[1] ?? '';
    out.push({ tag: m[1], className, text: decodeEntities(m[3].replace(/<[^>]+>/g, '')) });
  }
  return out;
}

/**
 * The color of each named paragraph style (Format → Paragraph styles), from the export's CSS:
 * `.title{…color:#…}`, `.subtitle{…}`, `h1{…}`…`h6{…}` and `p{…}` for Normal text.
 */
export function parseStyleColors(html: string): Partial<Record<StyleKey, string>> {
  const css = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html)?.[1] ?? '';
  const out: Partial<Record<StyleKey, string>> = {};
  // lookbehind (not a consumed "}") so back-to-back rules are all seen
  const re = /(?<=^|[}\s])(\.title|\.subtitle|h[1-6]|p)\s*\{([^}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const color = /(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,8})/i.exec(m[2])?.[1];
    if (!color) continue;
    const key = (m[1] === 'p' ? 'normal' : m[1].replace('.', '')) as StyleKey;
    out[key] ??= color.toLowerCase();
  }
  return out;
}

/** Text → every style a paragraph with that text has (the same text can be a Heading 2 and a Heading 3). */
export interface ParagraphIndex {
  full: Map<string, StyleKey[]>;
  prefix: Map<string, StyleKey[]>;
}

function add(map: Map<string, StyleKey[]>, key: string, style: StyleKey) {
  const list = map.get(key);
  if (!list) map.set(key, [style]);
  else if (!list.includes(style)) list.push(style);
}

/** Paragraph styles from the export's markup: h1–h6, p.title, p.subtitle, everything else normal. */
export function buildIndex(paragraphs: { tag: string; className: string; text: string }[]): ParagraphIndex {
  const full = new Map<string, StyleKey[]>();
  const prefix = new Map<string, StyleKey[]>();
  for (const p of paragraphs) {
    const text = normText(p.text);
    if (!text) continue;
    const tag = p.tag.toLowerCase();
    const style: StyleKey = /^h[1-6]$/.test(tag)
      ? (tag as StyleKey)
      : /\btitle\b/.test(p.className) ? 'title' : /\bsubtitle\b/.test(p.className) ? 'subtitle' : 'normal';
    add(full, text, style);
    if (text.length >= PREFIX) add(prefix, text.slice(0, PREFIX), style);
  }
  return { full, prefix };
}

/** Candidate styles for a drawn run (several when the same text has different styles). */
export function lookup(index: ParagraphIndex, run: string): StyleKey[] | null {
  const t = normText(run);
  if (t.length < 2) return null;
  return index.full.get(t) ?? (t.length >= PREFIX ? index.prefix.get(t.slice(0, PREFIX)) ?? null : null);
}

/** Font families that mark code (painted with the "code" style color). */
export const MONO_RE = /mono|courier|consolas|menlo|inconsolata|source code|fira code|cascadia|jetbrains/i;

const pxOf = (font: string) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '0');

/**
 * Text much larger than body text reads as a heading even when the author only enlarged it
 * (common in templates): size tiers relative to the most common body size.
 */
export function sizeTier(px: number, bodyPx: number): StyleKey | null {
  if (!bodyPx || !px) return null;
  const r = px / bodyPx;
  return r >= 1.9 ? 'title' : r >= 1.45 ? 'h1' : r >= 1.22 ? 'h2' : null;
}

/** Maps the toolbar's paragraph style name to a style key (English UI names). */
export function styleFromName(name: string): StyleKey | null {
  const n = name.trim().toLowerCase();
  if (n === 'title') return 'title';
  if (n === 'subtitle') return 'subtitle';
  const h = /^heading ([1-6])$/.exec(n);
  return h ? (`h${h[1]}` as StyleKey) : null;
}

/** Learns font → style from matched runs; majority vote guards against shared fonts. */
export class StyleLearner {
  readonly votes = new Map<string, Map<StyleKey, number>>();
  private decided = new Map<string, StyleKey | null>();
  private lastAnswer = new Map<string, StyleKey | null>();
  private bodyChars = new Map<number, number>();
  private totalBody = 0;
  private bodyPx = 0;
  private sinceBody = 0;

  /**
   * @param onChange called when earlier answers may have been wrong (a font's style was learned
   *   or the body size became known), so already-painted text should be repainted.
   */
  constructor(
    private index: ParagraphIndex,
    private onChange?: () => void,
    /** Called when a run's text isn't in the index (likely new or edited text). */
    private onMiss?: () => void,
  ) {}

  /** Texts that stayed unknown after a refresh (e.g. lines of a multi-line paragraph). */
  private knownMisses = new Set<string>();
  private newMisses = new Set<string>();

  /** Replaces the paragraph index after the document changed; learned fonts are kept. */
  setIndex(index: ParagraphIndex) {
    this.index = index;
    for (const t of this.newMisses) if (this.knownMisses.size < 5000) this.knownMisses.add(t);
    this.newMisses.clear();
    this.decided.clear();
  }

  /** Returns the heading/title style for a run in `font`, or null for body text. */
  classify(font: string, text: string): StyleKey | null {
    const cands = lookup(this.index, text);
    if (cands) this.vote(font, cands, normText(text).length);
    else this.noteMiss(text);
    // A run that is exactly one styled paragraph: that's its style, whatever its font.
    if (cands?.length === 1 && cands[0] !== 'normal') return cands[0];
    // Otherwise: what this font is used for in this document…
    const learned = cands?.length === 1 ? null : this.decide(font);
    if (learned) return learned;
    // …or, for body-styled / unknown text, how big it is.
    const px = pxOf(font);
    this.bodyChars.set(px, (this.bodyChars.get(px) ?? 0) + text.length);
    this.totalBody += text.length;
    // Wait for enough text before trusting the body size (titles are often drawn first).
    if (this.totalBody < 300) return null;
    if (++this.sinceBody >= 50 || !this.bodyPx) {
      this.sinceBody = 0;
      const prev = this.bodyPx;
      let best = 0;
      for (const [size, n] of this.bodyChars) if (n > best) { best = n; this.bodyPx = size; }
      if (this.bodyPx !== prev) this.onChange?.();
    }
    return sizeTier(px, this.bodyPx);
  }

  /** Size-based style for text of `px` that has no recognised paragraph style. */
  tierFor(px: number): StyleKey | null {
    return this.totalBody < 300 ? null : sizeTier(px, this.bodyPx);
  }

  private noteMiss(text: string) {
    const t = normText(text);
    if (t.length < 3 || this.knownMisses.has(t) || this.newMisses.has(t)) return;
    this.newMisses.add(t);
    this.onMiss?.();
  }

  /** Ambiguous matches split their weight between the candidate styles. */
  private vote(font: string, cands: StyleKey[], len: number) {
    let v = this.votes.get(font);
    if (!v) this.votes.set(font, (v = new Map()));
    const w = Math.max(1, len) / cands.length;
    for (const s of cands) v.set(s, (v.get(s) ?? 0) + w);
    this.decided.clear(); // one font's winner can settle another font's tie
  }

  /** The style a font clearly stands for (top vote well ahead of the next), if any. */
  private static clearWinner(v: Map<StyleKey, number>): StyleKey | null {
    const [a, b] = [...v].sort((x, y) => y[1] - x[1]);
    return a && (!b || a[1] > b[1] * 1.15) ? a[0] : null;
  }

  private decide(font: string): StyleKey | null {
    let d = this.decided.get(font);
    if (d !== undefined) return d;
    d = null;
    const v = this.votes.get(font);
    if (v?.size) {
      const sorted = [...v].sort((x, y) => y[1] - x[1]);
      let tied = sorted.filter(([, n]) => n >= sorted[0][1] * 0.87).map(([s]) => s);
      if (tied.length > 1) {
        // e.g. "Lorem ipsum" is both a Heading 2 and a Heading 3: if another font clearly is the
        // Heading 2, this one is the Heading 3.
        const owned = new Set<StyleKey>();
        for (const [f, other] of this.votes) {
          const w = f !== font ? StyleLearner.clearWinner(other) : null;
          if (w) owned.add(w);
        }
        const rest = tied.filter((s) => !owned.has(s));
        if (rest.length) tied = rest;
      }
      d = tied[0] === 'normal' ? null : tied[0];
    }
    if (d !== (this.lastAnswer.get(font) ?? null)) this.onChange?.();
    this.lastAnswer.set(font, d);
    this.decided.set(font, d);
    return d;
  }
}
