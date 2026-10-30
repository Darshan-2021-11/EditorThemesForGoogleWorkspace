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

/** Per-scheme rendering options (stored per scheme id). */
export interface ThemeOptions {
  mapping: MappingMode;
  /** Color headings / code / links with theme accents (document only). */
  semantic: boolean;
  /** Dim images drawn in the document. */
  dimImages: boolean;
  /** Brightness multiplier when dimming, 0.5..1. */
  dimAmount: number;
}

export const DEFAULT_OPTIONS: ThemeOptions = {
  mapping: 'snap',
  semantic: false,
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
