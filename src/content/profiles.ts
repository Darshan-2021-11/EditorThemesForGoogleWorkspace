// Per-app knowledge: where the "document" lives inside each Google app's page.
import { formatColor, type RGBA } from '../theme/color';
import type { Roles } from '../theme/roles';
import type { AppId } from '../shared/page';

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
  /** CSS for the document surface. */
  docCss(r: Roles): string;
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
  docCss: (r) => `
    .kix-page-paginated, .kix-page-compact, .kix-page, .kix-page-content-wrapper,
    .kix-paginateddocumentplugin .kix-page { background-color: ${hex(r.bg)} !important; }
    .kix-page-paginated { box-shadow: 0 0 0 1px ${hex(r.surfaceAlt)} !important; }`,
  uiCss: () => '',
};

const sheets: AppProfile = {
  app: 'sheets',
  docRegion: '#waffle-grid-container, .grid4-inner-container, .grid-container',
  canvasDoc: true,
  keepColors: KEEP_COLORS,
  // Only layers *below* the grid canvas: .grid4-inner-container sits above it (z-index 3).
  docCss: (r) => `#waffle-grid-container, .grid-container { background-color: ${hex(r.bg)} !important; }`,
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
  return plain(app);
}
