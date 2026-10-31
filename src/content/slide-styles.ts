// Paragraph styles for Slides' SVG text. The SVG says nothing about placeholders (title, body…),
// so, as Docs does for enlarged text, styles come from size: text much larger than the deck's
// body size is a heading.
import { MONO_RE, sizeTier } from '../hook/styles';
import type { StyleKey } from '../theme/types';

/** Font size in px from a CSS length ("20px", "52.67px"); 0 when missing or not px. */
export function pxOf(v: string | null | undefined): number {
  const m = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(v ?? '');
  return m ? Math.round(parseFloat(m[1]) * 100) / 100 : 0;
}

/** The deck's body size: the font size carrying the most characters. */
export function bodySize(samples: Iterable<[px: number, chars: number]>): number {
  const chars = new Map<number, number>();
  for (const [px, n] of samples) if (px && n) chars.set(px, (chars.get(px) ?? 0) + n);
  let body = 0;
  let best = 0;
  for (const [px, n] of chars) if (n > best || (n === best && px < body)) { best = n; body = px; }
  return body;
}

/** Style of a text run from its font: code, a heading tier by size, or null for body text. */
export function slideTextStyle(px: number, bodyPx: number, family: string): StyleKey | null {
  if (MONO_RE.test(family)) return 'code';
  return sizeTier(px, bodyPx);
}

/** Text styles for a document drawn as elements; one instance per themed page. */
export interface ElementTextStyles {
  /** The document may have changed: the next styleOf re-measures it. */
  invalidate(): void;
  /** Heading tier or code for a text element, or null for body text. */
  styleOf(el: Element): StyleKey | null;
}

/** Reads a font property from the element or, for a <tspan>, its <text>. */
export function fontProp(el: Element, prop: 'font-size' | 'font-family' | 'font-weight'): string {
  for (let e: Element | null = el; e; e = e.tagName.toLowerCase() === 'tspan' ? e.parentElement : null) {
    const v = (e as SVGElement).style?.getPropertyValue(prop) || e.getAttribute(prop);
    if (v) return v;
  }
  return '';
}

/**
 * Slides' text styles. `scope` selects the slide drawings that share one scale (editor and
 * filmstrip; speaker notes use their own sizes and stay body text). The body size is measured
 * lazily, at most once per invalidate(); `onChange` hears when it moved, since text styled
 * before then may now have the wrong tier.
 */
export class SlideTextStyles implements ElementTextStyles {
  private bodyPx = 0;
  private dirty = true;

  constructor(private scope: string, private onChange: () => void) {}

  invalidate() {
    this.dirty = true;
  }

  styleOf(el: Element): StyleKey | null {
    const family = fontProp(el, 'font-family');
    if (MONO_RE.test(family)) return 'code';
    if (!el.closest(this.scope)) return null;
    if (this.dirty) this.measure();
    return slideTextStyle(pxOf(fontProp(el, 'font-size')), this.bodyPx, family);
  }

  private measure() {
    this.dirty = false;
    const prev = this.bodyPx;
    const texts = document.querySelectorAll(`:is(${this.scope}) text`);
    this.bodyPx = bodySize([...texts].map((t) => [pxOf(fontProp(t, 'font-size')), t.textContent?.trim().length ?? 0]));
    // The first measurement comes before anything was styled: nothing to redo.
    if (prev && this.bodyPx !== prev) this.onChange();
  }
}
