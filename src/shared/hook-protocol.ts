// Events between the isolated content script and the MAIN-world canvas hook.
// Payloads are JSON strings: objects don't cross Firefox's Xray boundary cleanly.

/** content → hook: detail = JSON ThemeSpec | null */
export const CONFIG_EVENT = 'wd-hook-config';
/** hook → content: the hook is installed (re-send config) */
export const READY_EVENT = 'wd-hook-ready';

/**
 * content → hook: "what color do you paint for this text?" so toolbar color indicators match the
 * page exactly. detail = JSON TextColorQuery; answered with ANSWER_EVENT detail = JSON
 * { id, color: string | null }.
 */
export const QUERY_EVENT = 'wd-hook-query';

/** hook → content: the document's named-style colors were read. detail = JSON Record<StyleKey, hex> */
export const DOC_STYLES_EVENT = 'wd-hook-doc-styles';
export const ANSWER_EVENT = 'wd-hook-answer';
/**
 * Fired (bubbling) on a <style>/<link> whose sheet the page changed through the CSSOM
 * (insertRule & co.): no DOM mutation tells the content script, which must re-read it.
 */
export const CSSOM_EVENT = 'wd-hook-cssom';

export interface TextColorQuery {
  id: number;
  /** Raw text color Docs reports for the selection. */
  color: string;
  /** Font size in canvas px (pt × 4/3 × zoom). */
  px: number;
  /** Paragraph style name from the toolbar ("Normal text", "Heading 1", "Title"…). */
  style: string;
}
