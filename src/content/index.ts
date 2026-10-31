// Isolated-world content script: runs in every Google Docs/Drive frame at document_start.
import { send, type PageState, type Push } from '../shared/messages';
import { ALL_APPS, appOf } from '../shared/page';
import { DOC_STYLES_EVENT } from '../shared/hook-protocol';
import type { ThemeSpec } from '../theme/types';
import { Panel } from './panel';
import { profileFor } from './profiles';
import { PageThemer } from './themer';

const isTop = window === window.top;
const profile = profileFor(appOf(location.href));
const themer = new PageThemer(profile);

let state: PageState = { key: '', scope: ALL_APPS, theme: null, styleOverrides: {}, hasSchemes: false };

// The hook read the document's paragraph-style colors: let the background notice user changes.
if (isTop) {
  window.addEventListener(DOC_STYLES_EVENT, (e) => {
    try {
      const colors = JSON.parse(String((e as CustomEvent).detail)) as Record<string, string>;
      send({ type: 'docStyleColors', colors }).catch(() => {});
    } catch {
      // ignore malformed event
    }
  });
}
/** A theme shown temporarily (hover preview, custom editor) without being saved. */
let previewing: ThemeSpec | null | undefined;

function apply() {
  themer.update(previewing !== undefined ? previewing : state.theme);
}

const panel = isTop
  ? new Panel({
      getState: () => state,
      preview(spec) {
        previewing = spec;
        apply();
      },
      endPreview() {
        if (previewing === undefined) return;
        previewing = undefined;
        apply();
      },
    })
  : null;

browser.runtime.onMessage.addListener((msg: Push) => {
  switch (msg.type) {
    case 'applyState':
      state = msg.state;
      apply();
      panel?.refresh();
      break;
    case 'togglePanel':
      panel?.toggle(msg.tab);
      break;
    case 'importProgress':
      panel?.importProgress(msg.done, msg.total);
      break;
    case 'schemesChanged':
      panel?.refresh(true);
      break;
  }
});

if (__WD_DEV__ && isTop) {
  // Test bridge for scripts/visual-test.mjs: window.postMessage({ wdTest: 'import' | 'set' | 'options' | 'panel', ... })
  window.addEventListener('message', async (e) => {
    const d = e.data as { wdTest?: string; id?: number; url?: string; theme?: string | null; scheme?: string; options?: never; tab?: never };
    if (e.source !== window || !d?.wdTest) return;
    let result: unknown;
    try {
      if (d.wdTest === 'import') result = await send({ type: 'importSchemes', url: d.url! });
      if (d.wdTest === 'set') result = await send({ type: 'setPageTheme', theme: d.theme ?? null });
      if (d.wdTest === 'options') result = await send({ type: 'setOptions', id: d.scheme!, options: d.options! });
      if (d.wdTest === 'panel') result = await panel?.show(d.tab);
      if (d.wdTest === 'state') result = state;
    } catch (err) {
      result = { error: String(err) };
    }
    window.postMessage({ wdTestResult: d.id, result: JSON.parse(JSON.stringify(result ?? null)) }, '*');
  });
}

send({ type: 'getPageState' })
  .then((s) => {
    state = s;
    if (s.theme) apply();
  })
  .catch(() => {});
