// Events between the isolated content script and the MAIN-world canvas hook.
// Payloads are JSON strings: objects don't cross Firefox's Xray boundary cleanly.

/** content → hook: detail = JSON ThemeSpec | null */
export const CONFIG_EVENT = 'wd-hook-config';
/** hook → content: the hook is installed (re-send config) */
export const READY_EVENT = 'wd-hook-ready';
