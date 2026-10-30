// Per-app knowledge: where the "document" lives inside each Google app's page.
import { formatColor, type RGBA } from '../theme/color';
import type { Roles } from '../theme/roles';
import type { AppId } from '../shared/page';

export interface AppProfile {
  app: AppId;
  /** Elements belonging to the document (doc theme only). Empty = app has no document surface. */
  docRegion: string;
  /** Stylesheet selector fragments that style the document surface. */
  docRuleHints: string[];
  /** Whether document content is painted on <canvas> (handled by the hook). */
  canvasDoc: boolean;
  /** Elements whose inline colors must stay true (color pickers). */
  keepColors: string;
  /** CSS for the document surface while a document theme is on. */
  docCss(r: Roles): string;
  /** Extra UI CSS while a UI theme is on. */
  uiCss(r: Roles): string;
}

const hex = (c: RGBA) => formatColor({ ...c, a: 1 });

const KEEP_COLORS = '[class*="colorpalette"], [class*="color-palette"], [class*="colorswatch"], [class*="color-swatch"], .goog-palette-cell, .goog-palette-colorswatch';

const docs: AppProfile = {
  app: 'docs',
  docRegion: '.kix-page-paginated, .kix-page-compact, .kix-page, .kix-canvas-tile-content, .kix-lineview, .kix-page-content-wrapper',
  docRuleHints: ['kix-page', 'kix-lineview', 'kix-canvas-tile', 'kix-wordhtmlgenerator', 'kix-paginateddocumentplugin'],
  canvasDoc: true,
  keepColors: KEEP_COLORS,
  docCss: (r) => `
    .kix-page-paginated, .kix-page-compact, .kix-page, .kix-page-content-wrapper,
    .kix-paginateddocumentplugin .kix-page { background-color: ${hex(r.bg)} !important; }
    .kix-page-paginated { box-shadow: 0 0 0 1px ${hex(r.surfaceAlt)} !important; }`,
  uiCss: () => '',
};

const sheets: AppProfile = {
  app: 'sheets',
  docRegion: '#waffle-grid-container, .grid4-inner-container, .grid-container',
  docRuleHints: ['waffle', 'grid4-inner-container', 'grid-container'],
  canvasDoc: true,
  keepColors: KEEP_COLORS,
  docCss: (r) => `#waffle-grid-container, .grid4-inner-container { background-color: ${hex(r.bg)} !important; }`,
  uiCss: () => '',
};

const plain = (app: AppId): AppProfile => ({
  app,
  docRegion: '',
  docRuleHints: [],
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
