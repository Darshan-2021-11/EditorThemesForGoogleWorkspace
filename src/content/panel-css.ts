export const PANEL_CSS = `
:host { all: initial; }
.panel {
  position: fixed; top: 12px; right: 12px; bottom: 12px; width: 372px; max-width: calc(100vw - 24px);
  z-index: 2147483647; display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg); color: var(--fg); border: 1px solid var(--surface2); border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.2);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
* { box-sizing: border-box; }
header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 6px; }
.title { font-weight: 650; font-size: 15px; letter-spacing: .2px; }
nav { display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--surface2); }
.tab { flex: 1; padding: 8px 4px; border: 0; background: none; color: var(--dim); font: inherit; cursor: pointer;
  border-bottom: 2px solid transparent; white-space: nowrap; }
.tab:hover { color: var(--fg); }
.tab.on { color: var(--fg); border-bottom-color: var(--accent); font-weight: 600; }
main { flex: 1; overflow: auto; padding: 12px 14px; scrollbar-color: var(--muted) transparent; }
footer.status { min-height: 0; padding: 0 14px; color: var(--dim); font-size: 12px; }
footer.status:not(:empty) { padding: 8px 14px; border-top: 1px solid var(--surface2); }
button { font: inherit; }
.btn { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--surface2); background: var(--surface); color: var(--fg); cursor: pointer; }
.btn:hover:not(:disabled) { border-color: var(--muted); }
.btn:disabled { opacity: .5; cursor: default; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
.btn.danger { color: var(--danger); }
.btn.small { padding: 2px 8px; font-size: 12px; }
.icon-btn { border: 0; background: none; color: var(--dim); cursor: pointer; font-size: 15px; padding: 4px 6px; border-radius: 6px; }
.icon-btn:hover { background: var(--surface); color: var(--fg); }
input[type=search], input[type=url], input[type=text], select {
  width: 100%; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--surface2);
  background: var(--surface); color: var(--fg); font: inherit; outline: none;
}
input:focus, select:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.label { color: var(--dim); font-size: 12px; }
.hint { color: var(--dim); font-size: 12px; }
a.hint { text-decoration: none; }
a.hint:hover { text-decoration: underline; }
.empty { color: var(--dim); text-align: center; padding: 16px 0; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--dim); margin: 16px 0 6px; }
.current { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 12px; border-radius: 10px; background: var(--surface); }
.current .name { font-weight: 600; font-size: 14px; }
.options { margin: 8px 0 4px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--surface2); display: grid; gap: 8px; }
.opt-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.opt-row > .label { min-width: 74px; }
.seg { display: inline-flex; border: 1px solid var(--surface2); border-radius: 8px; overflow: hidden; flex-shrink: 0; }
.seg button { border: 0; background: none; color: var(--dim); padding: 5px 9px; cursor: pointer; }
.seg button.on { background: var(--surface2); color: var(--fg); font-weight: 600; }
.check { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.check input[type=range] { flex: 1; accent-color: var(--accent); }
.check input[type=checkbox] { accent-color: var(--accent); }
.check.big { align-items: flex-start; padding: 10px 12px; background: var(--surface); border-radius: 10px; }
.search-row { display: flex; gap: 8px; margin: 12px 0 8px; position: sticky; top: -12px; background: var(--bg); padding: 4px 0; z-index: 1; }
.list { display: grid; gap: 4px; }
.row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 8px; border-radius: 9px;
  border: 1px solid transparent; background: none; color: var(--fg); text-align: left; cursor: pointer; }
.row:hover, .row:focus-visible { background: var(--surface); }
.row.on { border-color: var(--accent); background: var(--surface); }
.swatch { display: flex; align-items: center; gap: 3px; padding: 5px 7px; border-radius: 7px; border: 1px solid; flex-shrink: 0; }
.swatch .aa { font-weight: 700; font-size: 12px; margin-right: 3px; }
.swatch i { width: 7px; height: 14px; border-radius: 2px; display: block; }
.row-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { font-size: 10px; padding: 1px 5px; border-radius: 5px; background: var(--surface2); color: var(--dim); }
.import-row { display: flex; gap: 8px; margin: 8px 0; }
.sources, .installed { display: grid; gap: 4px; }
.source { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 8px; }
.source:hover { background: var(--surface); }
.source .name { font-weight: 550; }
details { margin-top: 16px; }
summary { cursor: pointer; color: var(--dim); }
.colors { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; margin: 10px 0; }
.color { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
.color input { width: 28px; height: 22px; padding: 0; border: 1px solid var(--surface2); border-radius: 5px; background: none; cursor: pointer; }
.color b { font-family: ui-monospace, monospace; color: var(--dim); font-weight: 500; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.settings { display: grid; gap: 12px; }
.card { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--surface2); display: grid; gap: 6px; }
.styles { display: grid; gap: 3px; padding: 6px 8px; border-radius: 8px; background: var(--surface); }
.style-row { display: flex; align-items: center; gap: 8px; }
.style-name { min-width: 84px; font-weight: 600; font-size: 12px; }
.dots { display: flex; flex-wrap: wrap; gap: 3px; }
.dot { width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--surface2); padding: 0; cursor: pointer; }
.dot.on { outline: 2px solid var(--fg); outline-offset: 1px; }
.styles .btn { justify-self: start; }
.styles .actions { margin-top: 4px; }
.style-row .badge { margin-left: auto; white-space: nowrap; }
.dot.custom { border-radius: 3px; }
.save-preset { display: flex; gap: 6px; margin-top: 6px; }
.save-preset input { flex: 1; min-width: 0; padding: 4px 8px; font-size: 12px; }
.save-preset .btn { white-space: nowrap; }
kbd { font-family: ui-monospace, monospace; font-size: 11px; padding: 1px 5px; border-radius: 4px; background: var(--surface2); color: var(--fg); }
`;
