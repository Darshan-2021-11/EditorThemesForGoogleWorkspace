// Per-app knowledge: where the "document" lives inside each Google app's page.
import { formatColor, type RGBA } from '../theme/color';
import type { Roles } from '../theme/roles';
import type { StyleKey, ThemeOptions } from '../theme/types';
import type { AppId } from '../shared/page';
import { SlideTextStyles, type ElementTextStyles } from './slide-styles';

export interface AppProfile {
  app: AppId;
  /** Elements belonging to the document. Empty = app has no document surface. */
  docRegion: string;
  /** Whether document content is painted on <canvas> (handled by the hook). */
  canvasDoc: boolean;
  /** Elements whose inline colors must stay true (color pickers outside the document's controls). */
  keepColors: string;
  /**
   * Controls that show document colors (toolbar color indicators, color palettes). They are
   * mapped like document content so a swatch looks exactly like the result on the page.
   */
  docColorControls?: {
    text: string; fill: string; palettes: string;
    /** The text-color button's color bar, plus the toolbar boxes describing the cursor's text. */
    textIndicator: string; fontSize: string; zoom: string; paragraphStyle: string;
  };
  /**
   * CSS for the document surface (page background, image dimming). `styles` holds the
   * paragraph-style colors when "color by paragraph style" is on.
   */
  docCss(r: Roles, o: ThemeOptions, styles: Record<StyleKey, string> | null): string;
  /**
   * Paragraph styles of document text drawn as elements (Slides' SVG <text>), used for its fill
   * when "color by paragraph style" is on. `onChange`: earlier answers may be stale.
   */
  textStyles?(onChange: () => void): ElementTextStyles;
  /** Extra UI CSS. */
  uiCss(r: Roles): string;
}

const hex = (c: RGBA) => formatColor({ ...c, a: 1 });

const KEEP_COLORS = '[class*="colorpalette"], [class*="color-palette"], [class*="colorswatch"], [class*="color-swatch"], .goog-palette-cell, .goog-palette-colorswatch';

const docs: AppProfile = {
  app: 'docs',
  docRegion: '.kix-page-paginated, .kix-page-compact, .kix-page, .kix-canvas-tile-content, .kix-lineview, .kix-page-content-wrapper',
  canvasDoc: true,
  keepColors: KEEP_COLORS,
  docColorControls: {
    // both color buttons share .docs-textcolormenubutton, so match them by id/label
    text: '#textColorButton, [aria-label^="Text colo"]',
    fill: '#bgColorButton, [aria-label^="Highlight colo"]',
    palettes: '.docs-colormenuitems, .docs-material-colorpalette, .docs-customcolorpalette, .goog-palette, .jfk-palette',
    textIndicator: '#textColorButton .goog-color-menu-button-indicator',
    fontSize: 'input[aria-label="Font size"]',
    zoom: 'input[aria-label="Zoom"]',
    paragraphStyle: '#headingStyleSelect',
  },
  docCss: (r, o) => `
    .kix-page-paginated, .kix-page-compact, .kix-page, .kix-page-content-wrapper,
    .kix-paginateddocumentplugin .kix-page { background-color: ${hex(r.bg)} !important; }
    .kix-page-paginated { box-shadow: 0 0 0 1px ${hex(r.surfaceAlt)} !important; }` +
    // Docs draws pictures as SVG <image> over the text canvas, not on the canvas itself.
    (o.dimImages ? `.kix-canvas-tile-content image, .kix-page-paginated img { filter: brightness(${o.dimAmount}) !important; }` : ''),
  uiCss: () => '',
};

const sheets: AppProfile = {
  app: 'sheets',
  docRegion: '#waffle-grid-container, .grid4-inner-container, .grid-container',
  canvasDoc: true,
  keepColors: KEEP_COLORS,
  // Only layers *below* the grid canvas: .grid4-inner-container sits above it (z-index 3).
  docCss: (r, o) => `#waffle-grid-container, .grid-container { background-color: ${hex(r.bg)} !important; }` +
    (o.dimImages ? `#waffle-grid-container img { filter: brightness(${o.dimAmount}) !important; }` : ''),
  uiCss: () => '',
};

// Slides draw each slide as inline SVG (editor, filmstrip, speaker notes): recolored attribute
// by attribute, with shapes as fills and <text> as text.
const SLIDE_SVG = '#pages svg, .punch-filmstrip-thumbnails, #speakernotes-workspace svg';
const slides: AppProfile = {
  app: 'slides',
  docRegion: SLIDE_SVG,
  canvasDoc: false,
  keepColors: KEEP_COLORS,
  docCss: (_r, o) => (o.dimImages ? `:is(${SLIDE_SVG}) image { filter: brightness(${o.dimAmount}) !important; }` : ''),
  // Speaker notes have their own sizes: they never set or take heading tiers.
  textStyles: (onChange) => new SlideTextStyles('#pages svg, .punch-filmstrip-thumbnails', onChange),
  uiCss: () => '',
};

// Forms (editor and responder view): the form title and question titles take style colors.
const forms: AppProfile = {
  app: 'forms',
  docRegion: '',
  canvasDoc: false,
  keepColors: KEEP_COLORS,
  docCss: (_r, o, s) =>
    (s ? `[role="heading"][aria-level="1"]:not([role="dialog"] *) { color: ${s.title} !important; }
      [role="heading"][aria-level="2"]:not([role="dialog"] *) { color: ${s.h1} !important; }
      [role="listitem"] [role="heading"][aria-level="3"]:not([role="dialog"] *) { color: ${s.h2} !important; }` : '') +
    (o.dimImages ? `form img, [role="listitem"] img { filter: brightness(${o.dimAmount}) !important; }` : ''),
  uiCss: () => '',
};

const plain = (app: AppId): AppProfile => ({
  app,
  docRegion: '',
  canvasDoc: false,
  keepColors: KEEP_COLORS,
  docCss: () => '',
  uiCss: () => '',
});

export function profileFor(app: AppId): AppProfile {
  if (app === 'docs') return docs;
  if (app === 'sheets') return sheets;
  if (app === 'slides') return slides;
  if (app === 'forms') return forms;
  return plain(app);
}
