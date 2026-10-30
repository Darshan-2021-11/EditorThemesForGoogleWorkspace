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

export interface ParagraphIndex {
  full: Map<string, StyleKey>;
  prefix: Map<string, StyleKey>;
}

/** Paragraph styles from the export's markup: h1–h6, p.title, p.subtitle, everything else normal. */
export function buildIndex(paragraphs: { tag: string; className: string; text: string }[]): ParagraphIndex {
  const full = new Map<string, StyleKey>();
  const prefix = new Map<string, StyleKey>();
  for (const p of paragraphs) {
    const text = normText(p.text);
    if (!text) continue;
    const tag = p.tag.toLowerCase();
    const style: StyleKey = /^h[1-6]$/.test(tag)
      ? (tag as StyleKey)
      : /\btitle\b/.test(p.className) ? 'title' : /\bsubtitle\b/.test(p.className) ? 'subtitle' : 'normal';
    if (!full.has(text) || style !== 'normal') full.set(text, style);
    if (text.length >= PREFIX && (!prefix.has(text.slice(0, PREFIX)) || style !== 'normal')) prefix.set(text.slice(0, PREFIX), style);
  }
  return { full, prefix };
}

export function lookup(index: ParagraphIndex, run: string): StyleKey | null {
  const t = normText(run);
  if (t.length < 2) return null;
  return index.full.get(t) ?? (t.length >= PREFIX ? index.prefix.get(t.slice(0, PREFIX)) ?? null : null);
}

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

/** Learns font → style from matched runs; majority vote guards against shared fonts. */
export class StyleLearner {
  private votes = new Map<string, Map<StyleKey, number>>();
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
  constructor(private index: ParagraphIndex, private onChange?: () => void) {}

  /** Returns the heading/title style for a run in `font`, or null for body text. */
  classify(font: string, text: string): StyleKey | null {
    const learned = this.learned(font, text);
    if (learned) return learned;
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

  private learned(font: string, text: string): StyleKey | null {
    const s = lookup(this.index, text);
    if (s) {
      let v = this.votes.get(font);
      if (!v) this.votes.set(font, (v = new Map()));
      v.set(s, (v.get(s) ?? 0) + Math.max(1, normText(text).length));
      this.decided.delete(font);
    }
    let d = this.decided.get(font);
    if (d === undefined) {
      d = null;
      let best = 0;
      for (const [style, n] of this.votes.get(font) ?? []) if (n > best) { best = n; d = style; }
      if (d === 'normal') d = null;
      if (d !== (this.lastAnswer.get(font) ?? null)) this.onChange?.();
      this.lastAnswer.set(font, d);
      this.decided.set(font, d);
    }
    return d;
  }
}
