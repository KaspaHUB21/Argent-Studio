'use strict';
// Several view nodes may point to one source definition. Only the source is editable.
function project(model) {
  const nodes = [], edges = [], byId = new Map(model.nodes.map(n => [n.id, n]));
  const children = id => model.nodes.filter(n => n.parent === id);
  const alpha = list => list.slice().sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'));
  const used = new Set();
  function copy(source, parent, role) {
    const n = { ...source, definitionId: source.id, parent: parent?.id || '', id: (parent?.id || 'root') + '/' + (role || source.kind) + ':' + source.id };
    if (source.kind === 'field') n.detail = (byId.get(source.parent)?.name || '') + '.' + source.name + ' · ' + source.detail;
    nodes.push(n); used.add(source.id);
    if (parent) edges.push({ from: parent.id, to: n.id, label: 'enthält' });
    return n;
  }
  function group(parent, name, order) {
    const n = { id: parent.id + '/group:' + order, parent: parent.id, kind: 'group', name, detail: name, path: parent.path, start: 0, end: 0, text: '', editable: false };
    nodes.push(n); edges.push({ from: parent.id, to: n.id, label: 'enthält' }); return n;
  }
  function subtree(source, parent) {
    const n = copy(source, parent); for (const c of children(source.id).sort((a, b) => a.start - b.start)) subtree(c, n); return n;
  }
  function action(source, parent) {
    const n = copy(source, parent), parts = children(source.id);
    const inputs = parts.filter(x => x.kind === 'parameter' || x.kind === 'output');
    if (inputs.length) { const g = group(n, 'Eingaben und Ausgaben', 0); for (const p of alpha(inputs)) copy(p, g); }
    const contained = new Set();
    function collect(id) { contained.add(id); children(id).forEach(x => collect(x.id)); }
    collect(source.id);
    const fields = alpha([...new Set(model.edges.filter(e => contained.has(e.from) && byId.get(e.to)?.kind === 'field').map(e => e.to))].map(id => byId.get(id)));
    const aliases = new Map();
    if (fields.length) { const g = group(n, 'Verwendete Felder', 1); for (const f of fields) aliases.set(f.id, copy(f, g)); }
    const steps = parts.filter(x => x.kind !== 'parameter' && x.kind !== 'output').sort((a, b) => a.start - b.start);
    if (steps.length) {
      const g = group(n, 'Ablauf und Regeln', 2);
      for (const step of steps) {
        const sn = subtree(step, g);
        for (const e of model.edges.filter(e => e.from === step.id && aliases.has(e.to))) edges.push({ from: sn.id, to: aliases.get(e.to).id, label: e.label });
      }
    }
  }
  function actor(source, parent) {
    const n = copy(source, parent);
    for (const a of alpha(children(source.id))) action(a, n);
    const state = model.edges.find(e => e.from === source.id && e.label === 'verwendet Zustand');
    if (state && byId.has(state.to)) {
      const s = copy(byId.get(state.to), n);
      edges[edges.length - 1].label = 'verwendet Zustand';
      for (const f of alpha(children(state.to))) copy(f, s);
    }
  }
  const apps = alpha(model.nodes.filter(n => n.kind === 'app'));
  for (const app of apps) {
    const root = copy(app, null);
    for (const a of alpha([...new Set(model.edges.filter(e => e.from === app.id && e.label === 'enthält Actor').map(e => e.to))].map(id => byId.get(id)).filter(Boolean))) actor(a, root);
  }
  const loose = alpha(model.nodes.filter(n => n.kind === 'actor' && !used.has(n.id)));
  if (loose.length) {
    const root = { id: 'implicit-app', parent: '', kind: 'app', name: apps.length ? 'Weitere Actors' : 'ArgentApp', detail: 'Actors ohne explizite App-Zuordnung', path: loose[0].path, start: 0, end: 0, text: '', editable: false };
    nodes.push(root); loose.forEach(n => actor(n, root));
  }
  const remaining = alpha(model.nodes.filter(n => !used.has(n.id) && ['state', 'function', 'const'].includes(n.kind)));
  if (remaining.length) {
    const root = group({ id: 'additional', path: remaining[0].path }, 'Weitere Definitionen', 0); root.parent = ''; edges.pop();
    for (const n of remaining) subtree(n, root);
  }
  // Preserve non-hierarchical relationships such as creates-Actor and owned state.
  const aliases = new Map();
  for (const n of nodes) if (n.definitionId) { if (!aliases.has(n.definitionId)) aliases.set(n.definitionId, []); aliases.get(n.definitionId).push(n); }
  const common = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
  for (const e of model.edges) {
    if (e.label.startsWith('enthält') || byId.get(e.to)?.kind === 'field') continue;
    for (const from of aliases.get(e.from) || []) {
      const targets = aliases.get(e.to) || [];
      const to = targets.slice().sort((a, b) => common(from.id, b.id) - common(from.id, a.id))[0];
      if (to) edges.push({ from: from.id, to: to.id, label: e.label });
    }
  }
  const unique = new Map(edges.map(e => [e.from + '\n' + e.to + '\n' + e.label, e]));
  return { nodes, edges: [...unique.values()] };
}
module.exports = { project };
