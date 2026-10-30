/** Base16 slots base00..base0F; Base24 adds base10..base17. Values are "#rrggbb". */
export type Palette = Record<string, string>;

export interface Scheme {
  /** e.g. "base16-nord", "custom-my-nord" */
  id: string;
  name: string;
  author: string;
  system: 'base16' | 'base24';
  variant: 'dark' | 'light';
  palette: Palette;
  source: 'github' | 'custom';
  /** The URL it was imported from (so it can be re-imported/updated). */
  origin?: string;
}

export type ColorKind = 'text' | 'fill' | 'line' | 'onAccent';

export type MappingMode = 'snap' | 'keep-hue';

/** Paragraph styles (and inline roles) that can get their own theme color. */
export const STYLE_KEYS = ['title', 'subtitle', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'normal', 'link', 'code'] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

export const STYLE_LABELS: Record<StyleKey, string> = {
  title: 'Title', subtitle: 'Subtitle', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3',
  h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', normal: 'Normal text', link: 'Links', code: 'Code',
};

/** Palette slot used for each style, like an editor's syntax highlighting of Markdown. */
export const DEFAULT_STYLE_SLOTS: Record<StyleKey, string> = {
  title: 'base0E', subtitle: 'base0C', h1: 'base0D', h2: 'base0B', h3: 'base0A',
  h4: 'base09', h5: 'base08', h6: 'base0F', normal: 'base05', link: 'base0C', code: 'base0B',
};

/** Per-scheme rendering options (stored per scheme id). */
export interface ThemeOptions {
  mapping: MappingMode;
  /** Give titles, headings, links and code their own theme colors (document only). */
  styleColors: boolean;
  styleSlots: Record<StyleKey, string>;
  /** Dim images drawn in the document. */
  dimImages: boolean;
  /** Brightness multiplier when dimming, 0.5..1. */
  dimAmount: number;
}

export const DEFAULT_OPTIONS: ThemeOptions = {
  mapping: 'snap',
  styleColors: true,
  styleSlots: DEFAULT_STYLE_SLOTS,
  dimImages: false,
  dimAmount: 0.85,
};

/** A fully resolved theme ready to apply. */
export interface ThemeSpec {
  scheme: Scheme;
  options: ThemeOptions;
}

export const BASE16_KEYS = [
  'base00', 'base01', 'base02', 'base03', 'base04', 'base05', 'base06', 'base07',
  'base08', 'base09', 'base0A', 'base0B', 'base0C', 'base0D', 'base0E', 'base0F',
] as const;

export const BASE24_EXTRA_KEYS = [
  'base10', 'base11', 'base12', 'base13', 'base14', 'base15', 'base16', 'base17',
] as const;
