'use strict';
const fs = require('fs');
const path = require('path');
const language = require('./argent-service');

function structure(request) {
  const active = path.resolve(request.path);
  const buffers = new Map((request.documents || []).map(d => [path.resolve(d.path).toLowerCase(), d.text]));
  buffers.set(active.toLowerCase(), request.text);
  const files = new Map(), nodes = [], edges = [], warnings = [], warningsEn = [];
  function warn(de, en) { warnings.push(de); warningsEn.push(en); }
  let size = 0;
  function visit(file) {
    file = path.resolve(file); const key = file.toLowerCase();
    if (files.has(key)) return;
    if (files.size >= 60) { warn('Dateigrenze erreicht', 'File limit reached'); return; }
    let text = buffers.get(key);
    if (text === undefined) {
      try { if (fs.statSync(file).size > 512000) { warn('Große Importdatei ausgelassen', 'Large import file skipped'); return; } text = fs.readFileSync(file, 'utf8'); }
      catch { warn('Import nicht lesbar: ' + path.basename(file), 'Cannot read import: ' + path.basename(file)); return; }
    }
    if ((size += text.length) > 2000000) { warn('Projektgrenze erreicht', 'Project size limit reached'); return; }
    const scan = language.scanDocument(text); scan.path = file; files.set(key, scan);
    for (const imp of scan.imports) {
      if (imp.path.startsWith('.')) visit(path.resolve(path.dirname(file), imp.path));
      else if (imp.path === 'std::core' && request.standardLibrary) visit(request.standardLibrary);
    }
  }
  visit(active);
  for (const doc of request.documents || []) if (path.extname(doc.path).toLowerCase() === '.ag') visit(doc.path);
  const nodeMap = new Map(), declarations = [], edgeKeys = new Set();
  function add(scan, kind, name, start, end, parent, detail) {
    start = Math.max(0, start); end = Math.min(scan.source.length, Math.max(start, end));
    const id = scan.path.toLowerCase() + ':' + kind + ':' + start;
    if (nodeMap.has(id)) return nodeMap.get(id);
    const n = { id, parent: parent || '', kind, name, path: scan.path, start, end, detail: detail || name,
      text: scan.source.slice(start, end), editable: end > start };
    nodes.push(n); nodeMap.set(id, n); return n;
  }
  function edge(from, to, label) {
    if (!from || !to || from.id === to.id) return;
    const key = from.id + '\n' + to.id + '\n' + label;
    if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push({ from: from.id, to: to.id, label }); }
  }
  function close(tokens, index, open = '{', shut = '}') {
    let depth = 0;
    for (let i = index; i < tokens.length; i++) { if (tokens[i].value === open) depth++; if (tokens[i].value === shut && --depth === 0) return i; }
    return -1;
  }
  function declarationRange(scan, d) {
    const ts = scan.tokens; const ni = ts.findIndex(t => t.start === d.start);
    let i = ni;
    const keywords = new Set(['actor', 'state', 'app', 'fn', 'entry', 'delegate', 'const']);
    while (i > 0 && !keywords.has(ts[i].value) && ![';', '{', '}'].includes(ts[i - 1].value)) i--;
    let end = scan.source.length;
    if (d.bodyEnd != null) end = scan.source[d.bodyEnd] === '}' ? d.bodyEnd + 1 : d.bodyEnd;
    else {
      for (let j = ni + 1; j < ts.length; j++) {
        if (ts[j].value === ';') { end = ts[j].end; break; }
        if (ts[j].value === '{') { const c = close(ts, j); end = c >= 0 ? ts[c].end : scan.source.length; break; }
      }
    }
    return [ts[Math.max(0, i)]?.start ?? d.start, end];
  }
  function smallRange(scan, d, kind) {
    const ts = scan.tokens; let i = ts.findIndex(t => t.start === d.start), a = i, b = i;
    if (kind === 'field' || kind === 'parameter') {
      while (a > 0 && ![';', '{', '}', ',', '('].includes(ts[a - 1].value)) a--;
      while (b + 1 < ts.length && ![';', ',', ')', '}'].includes(ts[b + 1].value)) b++;
      if (kind === 'field' && ts[b + 1]?.value === ';') b++;
    }
    return [ts[Math.max(0, a)]?.start ?? d.start, ts[Math.max(0, b)]?.end ?? d.end];
  }
  for (const scan of files.values()) {
    const fileNode = add(scan, 'file', path.basename(scan.path), 0, scan.source.length, '', scan.path); fileNode.editable = false;
    for (const d of scan.declarations) {
      const r = declarationRange(scan, d); const n = add(scan, d.kind, d.name, r[0], r[1], fileNode.id, d.signature);
      n.symbolStart = d.start; declarations.push({ scan, d, n });
    }
  }
  function resolve(name, scan, kinds) {
    const candidates = declarations.filter(x => x.d.name === name && (!kinds || kinds.includes(x.d.kind)));
    const local = candidates.filter(x => x.scan === scan);
    return local.length === 1 ? local[0] : candidates.length === 1 ? candidates[0] : null;
  }
  const fields = new Map(), callables = [];
  for (const { scan, d, n } of declarations) {
    if (d.kind === 'state') {
      const list = [];
      for (const f of d.fields || []) { const r = smallRange(scan, f, 'field'); const fn = add(scan, 'field', f.name, ...r, n.id, f.signature); fn.symbolStart = f.start; list.push(fn); }
      fields.set(n.id, list);
      if (d.baseState) edge(n, resolve(d.baseState, scan, ['state'])?.n, 'erweitert');
    }
    if (d.kind === 'actor') {
      edge(n, resolve(d.ownedState, scan, ['state'])?.n, 'verwendet Zustand');
      for (const m of d.members || []) {
        const r = declarationRange(scan, m); const mn = add(scan, m.kind, m.name, ...r, n.id, m.signature);
        callables.push({ scan, d: m, n: mn, actor: d });
      }
    }
    if (d.kind === 'function') callables.push({ scan, d, n });
    if (d.kind === 'app') {
      const ts = scan.tokens.filter(t => t.start >= n.start && t.end <= n.end);
      for (let i = 0; i < ts.length - 1; i++) if (ts[i].value === 'actor') {
        const target = resolve(ts[i + 1].value, scan, ['actor']);
        if (target) { edge(n, target.n, 'enthält Actor'); if (target.scan === scan && target.n.parent.endsWith(':file:0')) target.n.parent = n.id; }
      }
    }
  }
  function ownedFields(name, scan, seen = new Set()) {
    const state = resolve(name, scan, ['state']); if (!state || seen.has(state.n.id)) return [];
    seen.add(state.n.id);
    return [...(state.d.baseState ? ownedFields(state.d.baseState, state.scan, seen) : []), ...(fields.get(state.n.id) || [])];
  }
  for (const { scan, d, n, actor } of callables) {
    const symbols = new Map();
    for (const f of actor ? ownedFields(actor.ownedState, scan) : []) symbols.set(f.name, f);
    for (const p of d.parameters || []) { const r = smallRange(scan, p, 'parameter'); const pn = add(scan, 'parameter', p.name, ...r, n.id, p.signature); pn.symbolStart = p.start; symbols.set(p.name, pn); }
    for (const p of d.clauseVariables || []) {
      const pn = add(scan, 'output', p.name, p.start, p.end, n.id, p.signature); symbols.set(p.name, pn);
      const ts = scan.tokens; const i = ts.findIndex(t => t.start === p.start);
      const type = ts[i + 1]?.value === ':' ? ts[i + 2]?.value : null;
      const target = resolve(type, scan, ['actor']); if (target) { edge(pn, target.n, 'Actor-Typ'); edge(n, target.n, p.clause === 'emit' ? 'erzeugt' : p.clause); }
    }
    const ts = scan.tokens.filter(t => t.start >= d.bodyStart && t.start < d.bodyEnd);
    // Split at top-level semicolons; nested expressions remain intact and editable.
    let start = 0, depth = 0, round = 0, statement = 0;
    const statements = [];
    for (let i = 0; i < ts.length; i++) {
      const v = ts[i].value;
      if (v === '{') depth++; if (v === '}') depth--;
      if (v === '(') round++; if (v === ')') round--;
      if ((v === ';' && depth === 0 && round === 0) || i === ts.length - 1) {
        const part = ts.slice(start, i + 1); start = i + 1; if (!part.length) continue;
        let kind = part[0].value === 'require' ? 'check' : part[0].value === 'become' ? 'transition' : ['if', 'else'].includes(part[0].value) ? 'branch' : 'statement';
        const name = kind === 'check' ? 'Prüfung ' + (++statement) : kind === 'transition' ? 'Nachfolger festlegen' : scan.source.slice(part[0].start, Math.min(part[part.length - 1].end, part[0].start + 58)).replace(/\s+/g, ' ');
        const sn = add(scan, kind, name, part[0].start, part[part.length - 1].end, n.id, scan.source.slice(part[0].start, part[part.length - 1].end).replace(/\s+/g, ' '));
        let local;
        const eq = part.findIndex(t => t.value === '=');
        if (kind === 'statement' && eq > 1 && part[eq - 1].kind === 'ident') {
          const token = part[eq - 1]; local = add(scan, 'local', token.value, token.start, token.end, sn.id, scan.source.slice(part[0].start, token.end)); local.symbolStart = token.start;
        }
        statements.push(sn);
        for (let j = 0; j < part.length; j++) {
          const token = part[j];
          if (token.kind !== 'ident' || (local && token.start === local.symbolStart)) continue;
          let target;
          if (part[j - 1]?.value === '.') {
            if (part[j - 2]?.value === 'self' && actor) target = ownedFields(actor.ownedState, scan).find(x => x.name === token.value);
          } else if (part[j + 1]?.value !== ':') target = symbols.get(token.value) || resolve(token.value, scan)?.n;
          if (target) edge(sn, target, target.kind === 'field' ? 'liest Feld' : 'verwendet');
        }
        if (local) symbols.set(local.name, local);
      }
    }
  }
  for (const n of nodes) if (n.parent) edge(nodeMap.get(n.parent), n, 'enthält');
  for (let i = edges.length - 1; i >= 0; i--) if (edges[i].label === 'liest Feld') { const e = edges[i]; edgeKeys.delete(e.from + '\n' + e.to + '\n' + e.label); edges.splice(i, 1); }
  require('./structure-symbols').indexFields({ files, declarations, callables, fields, resolve, ownedFields, nodes, edge });
  // Declaration identity is semantic, not its byte offset in the file.
  const stable = new Map();
  function stableId(n) {
    if (stable.has(n.id)) return stable.get(n.id);
    const p = nodeMap.get(n.parent);
    const prefix = ['app', 'actor', 'state', 'function', 'const'].includes(n.kind) ? n.path.toLowerCase() : p ? stableId(p) : n.path.toLowerCase();
    const ordered = ['check', 'statement', 'transition', 'branch'].includes(n.kind);
    const suffix = ordered ? nodes.filter(x => x.parent === n.parent && x.start < n.start).length : n.name;
    const value = prefix + '/' + n.kind + ':' + suffix;
    stable.set(n.id, value); return value;
  }
  nodes.forEach(stableId);
  edges.forEach(e => { e.from = stable.get(e.from); e.to = stable.get(e.to); });
  nodes.forEach(n => { const id = stable.get(n.id); n.parent = stable.get(n.parent) || ''; n.id = id; });
  const result = { nodes, edges, sources: [...files.values()].map(s => ({ path: s.path, text: s.source })), warning: [...new Set(warnings)].join(' · '), warningEn: [...new Set(warningsEn)].join(' · ') };
  result.flow = require('./structure-flow').projectFlow(result, [...files.values()]);
  result.warning = [result.warning, result.flow.warning].filter(Boolean).join(' · ');
  result.warningEn = [result.warningEn, result.flow.warningEn].filter(Boolean).join(' · ');
  return result;
}
module.exports = { structure };
