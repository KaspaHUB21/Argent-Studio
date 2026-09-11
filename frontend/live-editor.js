import {EditorState, StateEffect, StateField, Prec, RangeSet} from '@codemirror/state';
import {EditorView, ViewPlugin, Decoration, WidgetType, keymap, showTooltip, showPanel, gutter, GutterMarker} from '@codemirror/view';
import {completionStatus} from '@codemirror/autocomplete';
import {analyzeLive, liveContext} from './live-analysis.js';
import {analyzeSemantics} from './live-semantics.js';
import {analyzeCalls} from './live-call-checks.js';
export const liveRefreshEffect = StateEffect.define();

// All suggestions originate from the local source model. Effects never edit code.
export function liveEditorExtensions({getSettings = () => ({}), inspectProject, getProjectRevision = () => 0, onNavigate, semanticChecks = true} = {}) {
 const language = () => getSettings().language === 'en' ? 'en' : 'de';
 const translated = (item, key = 'message') => item[key + (language() === 'en' ? 'En' : 'De')] || item[key + 'En'] || '';
 const diagnosticsEffect = StateEffect.define(), dismissEffect = StateEffect.define(), popupEffect = StateEffect.define(), focusEffect = StateEffect.define(), compositionEffect = StateEffect.define();
 const field = StateField.define({
  create(state) {const analysis = analyzeLive(state.doc.toString()); return {analysis, context: liveContext(state.doc.toString(), state.selection.main.head, analysis), diagnostics: [], dismissed: false, popup: null, focused: false, composing: false};},
  update(value, tr) {
   let next = {...value};
   if (tr.docChanged || tr.selection) {
    const text = tr.state.doc.toString(), analysis = tr.docChanged ? analyzeLive(text) : value.analysis;
    next = {...value, analysis, context: liveContext(text, tr.state.selection.main.head, analysis), dismissed: false, popup: null, diagnostics: tr.docChanged ? [] : quietDiagnostics(tr.state, value.diagnostics)};
   }
   for (const effect of tr.effects) {
    if (effect.is(liveRefreshEffect)) next = {...next, diagnostics: [], popup: null};
    if (effect.is(diagnosticsEffect)) next = {...next, diagnostics: quietDiagnostics(tr.state, effect.value)};
    if (effect.is(compositionEffect)) next = {...next, composing: effect.value};
    if (effect.is(dismissEffect)) next = {...next, dismissed: true, popup: null};
    if (effect.is(focusEffect)) next = {...next, focused: effect.value};
    if (effect.is(popupEffect)) next = {...next, popup: effect.value};
   }
   return next;
  }
 });
 function quietDiagnostics(state, diagnostics) {
  const activeLines = new Set(state.selection.ranges.map(range => state.doc.lineAt(range.head).number));
  return diagnostics.filter(item => item.code !== 'unclosed' || !activeLines.has(state.doc.lineAt(item.from).number));
 }
 function ghost(state) {
  const value = state.field(field), c = value.context.completion, selection = state.selection;
  if (!value.focused || value.composing || completionStatus(state) === 'active' || value.dismissed || state.readOnly || !selection.main.empty || selection.ranges.length !== 1 || !c || c.to !== selection.main.head) return null;
  const prefix = state.sliceDoc(c.from, c.to);
  if (!prefix || !c.text.startsWith(prefix) || c.text.length <= prefix.length || /\w/.test(state.sliceDoc(c.to, c.to + 1))) return null;
  return {...c, suffix: c.text.slice(prefix.length)};
 }
 class GhostWidget extends WidgetType {
  constructor(text) {super(); this.text = text;}
  eq(other) {return other.text === this.text;}
  toDOM() {const span = document.createElement('span'); span.className = 'cm-live-ghost'; span.textContent = this.text; span.setAttribute('aria-hidden', 'true'); return span;}
  ignoreEvent() {return true;}
 }
 const decorations = ViewPlugin.fromClass(class {
  constructor(view) {this.view = view; this.decorations = this.build(view); this.schedule(view);}
  update(update) {this.decorations = this.build(update.view); if (update.docChanged || update.selectionSet || update.focusChanged || update.transactions.some(t=>t.effects.some(e=>e.is(liveRefreshEffect)))) this.schedule(update.view);}
  schedule(view) {
   clearTimeout(this.timer); const doc = view.state.doc, generation = this.generation = (this.generation || 0) + 1, revision = getProjectRevision();
   this.timer = setTimeout(async () => {
    const value = view.state.field(field), text = doc.toString();
    let diagnostics = value.context.diagnostics || [];
    if (semanticChecks && !view.state.readOnly) {
     let project = {symbols: [], complete: !/\bimport\b/.test(text), hasImports: /\bimport\b/.test(text)};
     try {if (inspectProject) project = await inspectProject(text);} catch {project = {symbols: [], complete: false, hasImports: true};}
     if (this.destroyed || this.generation !== generation || view.state.doc !== doc || getProjectRevision() !== revision) return;
     try {diagnostics = [...diagnostics, ...(project.diagnostics || []), ...analyzeSemantics(text, value.analysis, project), ...analyzeCalls(text, value.analysis, project)];} catch { /* Incomplete language constructs keep the safe lexical diagnostics. */ }
    }
    if (this.destroyed || this.generation !== generation || view.state.doc !== doc || getProjectRevision() !== revision) return;
    diagnostics = diagnostics.filter(d=>Number.isInteger(d.from)&&Number.isInteger(d.to)&&d.from>=0&&d.to>=d.from&&d.to<=doc.length);
    view.dispatch({effects: diagnosticsEffect.of(diagnostics)});
   }, 550);
  }
  build(view) {
   const value = view.state.field(field), ranges = [], suggestion = ghost(view.state);
   if (suggestion) ranges.push(Decoration.widget({widget: new GhostWidget(suggestion.suffix), side: 1}).range(suggestion.to));
   for (const range of value.context.occurrences || []) if (range.to > range.from) ranges.push(Decoration.mark({class: 'cm-live-occurrence'}).range(range.from, range.to));
   for (const diagnostic of value.diagnostics) if (diagnostic.to > diagnostic.from) ranges.push(Decoration.mark({class: 'cm-live-diagnostic'+(diagnostic.fade?' cm-live-faded':'')+(diagnostic.severity==='hint'?' cm-live-hint':''), attributes: {title: translated(diagnostic), 'data-live-code':diagnostic.code||'', 'data-live-from':String(diagnostic.from)}}).range(diagnostic.from, diagnostic.to));
   const block = value.context.blocks?.at(-1);
   if (block) for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(Math.max(block.from, visible.from));
    const end = Math.min(block.to, visible.to);
    while (line.from <= end) {ranges.push(Decoration.line({class: 'cm-live-block-guide'}).range(line.from)); if (line.number === view.state.doc.lines) break; line = view.state.doc.line(line.number + 1);}
   }
   return Decoration.set(ranges, true);
  }
  destroy() {this.destroyed=true; this.generation++; clearTimeout(this.timer);}
 }, {decorations: value => value.decorations});
 class DiagnosticMarker extends GutterMarker {
  constructor(diagnostic) {super(); this.diagnostic = diagnostic; this.locale = language();}
  eq(other) {return other.diagnostic === this.diagnostic && other.locale === this.locale;}
  toDOM(view) {
   const button = document.createElement('button'); button.className = 'cm-live-diagnostic-marker'; button.textContent = '·'; button.type = 'button'; button.title = translated(this.diagnostic); button.setAttribute('aria-label', translated(this.diagnostic));
   button.onclick = event => {event.preventDefault(); view.dispatch({effects: popupEffect.of(this.diagnostic)});}; return button;
  }
 }
 const diagnosticGutter = gutter({class: 'cm-live-gutter', markers: view => {
  const lines = new Set(), ranges = [];
  for (const diagnostic of view.state.field(field).diagnostics) {const start = view.state.doc.lineAt(diagnostic.from).from; if (!lines.has(start)) {lines.add(start); ranges.push(new DiagnosticMarker(diagnostic).range(start));}}
  return RangeSet.of(ranges, true);
 }});
 const signature = showTooltip.compute([field], state => {
  const parameter = state.field(field).context.parameter;
  if (!parameter || state.field(field).dismissed || state.field(field).composing || !state.field(field).focused || completionStatus(state) === 'active') return null;
  return {pos: state.selection.main.head, above: false, strictSide: false, create() {
   const dom = document.createElement('div'); dom.className = 'cm-live-signature';
   const range = parameter.ranges?.[parameter.active];
   if (range) {dom.append(document.createTextNode(parameter.text.slice(0, range.from))); const active = document.createElement('strong'); active.className = 'cm-live-active-parameter'; active.textContent = parameter.text.slice(range.from, range.to); dom.append(active, document.createTextNode(parameter.text.slice(range.to)));}
   else dom.textContent = parameter.text;
   return {dom};
  }};
 });
 const popup = showTooltip.compute([field, EditorState.readOnly], state => {
  const diagnostic = state.field(field).popup;
  if (!diagnostic) return null;
  return {pos: diagnostic.from, above: true, create(view) {
   const dom = document.createElement('div'); dom.className = 'cm-live-diagnostic-popup'; const message = document.createElement('div'); message.textContent = translated(diagnostic); dom.append(message);
   if (diagnostic.fix && !state.readOnly) {const fix = diagnostic.fix, button = document.createElement('button'); button.type = 'button'; button.className = 'cm-live-fix'; button.textContent = translated(fix, 'label') || (language() === 'en' ? 'Apply correction' : 'Korrektur übernehmen');
    button.onclick = () => {if (view.state.readOnly || view.state.field(field).popup !== diagnostic) return; view.dispatch({changes: {from: fix.from, to: fix.to, insert: fix.insert}, userEvent: 'input.live-fix'}); view.focus();}; dom.append(button);}
   for (const target of diagnostic.related || []) {
    const link = document.createElement('button'); link.type = 'button'; link.className = 'cm-live-related'; link.textContent = translated(target, 'label') || (language() === 'en' ? 'Go to related declaration' : 'Zur zugehörigen Definition');
    link.onclick = () => {if (view.state.field(field).popup !== diagnostic) return; if (target.path && onNavigate) {Promise.resolve(onNavigate(target)).catch(()=>{});return;} if (target.from>=0 && target.from<=view.state.doc.length) {view.dispatch({selection:{anchor:target.from,head:Math.min(target.to??target.from,view.state.doc.length)},effects:[popupEffect.of(null),EditorView.scrollIntoView(target.from,{y:'center'})]});view.focus();}};
    dom.append(link);
   }
   const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.className = 'cm-live-close'; close.setAttribute('aria-label', language() === 'en' ? 'Close' : 'Schließen'); close.onclick = () => view.dispatch({effects: popupEffect.of(null)}); dom.append(close);
   return {dom};
  }};
 });
 const sticky = showPanel.of(view => {
  const dom = document.createElement('div'); dom.className = 'cm-live-sticky';
  let destroyed = false;
  const measure = {key: dom, read() {
   const text = view.state.doc.toString(), analysis = view.state.field(field).analysis;
   const rect = view.scrollDOM.getBoundingClientRect();
   const position = view.posAtCoords({x: view.contentDOM.getBoundingClientRect().left + 8, y: rect.top + 2}) ?? view.viewport.from;
   const blocks = liveContext(text, position, analysis).blocks || [];
   const block = [...blocks].reverse().find(item => view.state.doc.lineAt(item.headerFrom ?? item.from).number < view.state.doc.lineAt(position).number);
   return block?.label || '';
  }, write(label) {if (!destroyed) {dom.textContent = label; dom.hidden = !label;}}};
  const render = () => {if (!destroyed) view.requestMeasure(measure);};
  dom.hidden = true;
  return {dom, top: true, mount() {render(); view.scrollDOM.addEventListener('scroll', render, {passive: true});}, update() {render();}, destroy() {destroyed = true; view.scrollDOM.removeEventListener('scroll', render);}};
 });
 const theme = EditorView.baseTheme({
  '.cm-live-ghost': {opacity: '.42', pointerEvents: 'none'},
  '.cm-live-occurrence': {backgroundColor: '#508dad18', borderBottom: '1px solid #508dad55'},
  '.cm-live-block-guide': {boxShadow: 'inset 1px 0 #7197ac55'},
  '.cm-live-diagnostic': {textDecoration: 'underline wavy #c09055', textUnderlineOffset: '3px'},
  '.cm-live-faded': {opacity: '.58'},
  '.cm-live-hint': {textDecoration: 'none'},
  '.cm-live-gutter': {width: '10px'},
  '.cm-live-diagnostic-marker': {padding: '0', border: '0', background: 'transparent', color: '#bd8442', cursor: 'pointer', font: 'bold 17px monospace', lineHeight: '1'},
  '.cm-live-signature, .cm-live-diagnostic-popup': {padding: '6px 9px', fontSize: '12px', fontFamily: 'Consolas, Menlo, monospace', maxWidth: 'min(520px, 80vw)', whiteSpace: 'pre-wrap', backgroundColor: '#f6f9fc', color: '#293d4d', border: '1px solid #d0dce6'},
  '&dark .cm-live-signature, &dark .cm-live-diagnostic-popup': {backgroundColor: '#252d38', color: '#dbe6ef', borderColor: '#465463'},
  '.cm-live-active-parameter': {color: '#087f8c'}, '&dark .cm-live-active-parameter': {color: '#67d4d2'},
  '.cm-live-fix, .cm-live-close, .cm-live-related': {font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid #8195a566', borderRadius: '3px', marginTop: '5px', cursor: 'pointer'},
  '.cm-live-close': {marginLeft: '8px'},
  '.cm-live-sticky': {padding: '3px 8px', fontSize: '12px', fontFamily: 'Consolas, Menlo, monospace', color: '#557183', backgroundColor: '#f5f8fb', borderBottom: '1px solid #8ca4b133', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'},
  '.cm-live-sticky[hidden]': {display: 'none'}, '&dark .cm-live-sticky': {backgroundColor: '#1d252e', color: '#9cb3c4'}
 });
 const focus = ViewPlugin.fromClass(class {
  constructor(view) {this.alive = true; this.sync(view);}
  update(update) {if (update.focusChanged) this.sync(update.view);}
  sync(view) {queueMicrotask(() => {if (this.alive && view.state.field(field).focused !== view.hasFocus) view.dispatch({effects: focusEffect.of(view.hasFocus)});});}
  composition(view, value) {queueMicrotask(() => {if (this.alive) view.dispatch({effects: compositionEffect.of(value)});});}
  destroy() {this.alive = false;}
 }, {eventHandlers: {
  compositionstart(_event, view) {this.composition(view, true);},
  compositionend(_event, view) {this.composition(view, false);}
 }});
 return [field, focus, Prec.highest(keymap.of([
  {key: 'Tab', run(view) {const suggestion = ghost(view.state); if (!suggestion) return false; view.dispatch({changes: {from: suggestion.from, to: suggestion.to, insert: suggestion.text}, selection: {anchor: suggestion.from + suggestion.text.length}, userEvent: 'input.complete'}); return true;}, preventDefault: false},
  {key: 'Escape', run(view) {const value = view.state.field(field); if (!ghost(view.state) && !value.popup && (!value.context.parameter || value.dismissed)) return false; view.dispatch({effects: dismissEffect.of(null)}); return true;}}
 ])), decorations, diagnosticGutter, signature, popup, sticky, theme, EditorView.domEventHandlers({click(event,view) {const mark=event.target.closest?.('[data-live-from]');if(!mark)return false;const diagnostic=view.state.field(field).diagnostics.find(d=>String(d.from)===mark.dataset.liveFrom&&d.code===mark.dataset.liveCode);if(!diagnostic)return false;view.dispatch({effects:popupEffect.of(diagnostic)});return true;}})];
}


