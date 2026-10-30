// Isolated-world content script: runs in every Google Docs/Drive frame at document_start.
import { send, type PageState, type Push } from '../shared/messages';
import { appOf } from '../shared/page';
import type { ThemeSpec } from '../theme/types';
import { Panel } from './panel';
import { profileFor } from './profiles';
import { PageThemer } from './themer';

const isTop = window === window.top;
const profile = profileFor(appOf(location.href));
const themer = new PageThemer(profile);

let state: PageState = { key: '', ui: null, doc: null, hasSchemes: false };
let previewing: { ui: ThemeSpec | null; doc: ThemeSpec | null } | null = null;

function apply() {
  const ui = previewing ? previewing.ui : state.ui;
  const doc = previewing ? previewing.doc : state.doc;
  themer.update(ui, doc);
}

const panel = isTop
  ? new Panel({
      getState: () => state,
      hasDocument: !!profile.docRegion,
      preview(ui, doc) {
        previewing = { ui: ui === undefined ? state.ui : ui, doc: doc === undefined ? state.doc : doc };
        apply();
      },
      endPreview() {
        if (!previewing) return;
        previewing = null;
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

send({ type: 'getPageState' })
  .then((s) => {
    state = s;
    if (s.ui || s.doc) apply();
  })
  .catch(() => {});
