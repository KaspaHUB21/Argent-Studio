'use strict';
// Local adapter for the pinned Argent scanner. No network or code execution.
const fs = require('fs');
const path = require('path');
const language = require('./argent-service');
const modules = require('./module-support');

function analyze(request) {
  const active = path.resolve(request.path);
  const buffers = new Map((request.documents || []).map(d => [path.resolve(d.path).toLowerCase(), d.text]));
  buffers.set(active.toLowerCase(), request.text);
  const scans = new Map();
  let total = 0;
  function visit(file) {
    file = path.resolve(file);
    const key = file.toLowerCase();
    if (scans.has(key) || scans.size >= 80) return;
    let text = buffers.get(key);
    if (text === undefined) {
      try { if (fs.statSync(file).size > 512000) return; text = fs.readFileSync(file, 'utf8'); } catch { return; }
    }
    if ((total += text.length) > 2000000) return;
    const scan = modules.scanDocument(text);
    scan.path = file;
    scans.set(key, scan);
    for (const imp of scan.imports) {
      const target = modules.importPath(scan, imp, request.standardLibrary);
      if (target) visit(target);
    }
  }
  visit(active);
  const scan = scans.get(active.toLowerCase());
  if (!scan) return { items: [] };
  const pos = Math.max(0, Math.min(request.position, request.text.length));
  const index = modules.moduleIndex(scans, request.standardLibrary);
  const declarations = [...(index.exports.get(active.toLowerCase()) || [])].flatMap(([name, targets]) => targets.size === 1 ? [{ ...[...targets][0], name }] : []);
  const actor = scan.declarations.find(d => d.kind === 'actor' && d.bodyStart <= pos && pos <= d.bodyEnd);
  const callables = scan.declarations.filter(d => ['function', 'entry', 'delegate'].includes(d.kind))
    .concat(actor ? actor.members || [] : []);
  const callable = callables.find(d => d.bodyStart <= pos && pos <= d.bodyEnd);
  const items = new Map();
  function add(d, file) {
    if (!d || !d.name) return;
    items.set(d.name, { name: d.name, kind: d.kind || 'builtin', detail: d.signature || d.name,
      documentation: d.documentation || '', path: d.path || file || '', position: d.start == null ? -1 : d.start });
  }
  function fields(name, scope = scan, seen = new Set()) {
    const state = index.resolve(name, scope);
    if (!state || state.kind !== 'state') return [];
    const key = state.moduleKey + ':' + state.name;
    if (seen.has(key)) return [];
    seen.add(key);
    const owner = scans.get(state.moduleKey);
    return [...(state.baseState ? fields(state.baseState, owner, seen) : []), ...(state.fields || []).map(f => ({ ...f, path: state.path }))];
  }
  const prefix = request.text.slice(0, pos);
  const member = /\b([A-Za-z_]\w*)\.\w*$/.exec(prefix);
  const namespace = /\b([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)::\w*$/.exec(prefix);
  if (namespace) {
    const target = index.resolve(namespace[1], scan);
    if (target?.kind === 'module') {
      for (const [name, entries] of index.exports.get(target.moduleKey) || []) if (entries.size === 1) add({ ...[...entries][0], name });
    } else if (target?.kind === 'app') {
      for (const name of target.actors || []) { const actor = index.resolve(name, scans.get(target.moduleKey)); if (actor) add(actor); }
    }
  } else if (member) {
    if (member[1] === 'self' && actor) {
      for (const f of fields(actor.ownedState)) add(f);
      add({ name: 'value', kind: 'property', signature: 'self.value — input amount' });
      add({ name: 'cov_id', kind: 'property', signature: 'self.cov_id — covenant identity' });
    }
  } else {
    for (const name of language.KEYWORDS) add({ name, kind: 'keyword', documentation: language.KEYWORD_DOCUMENTATION[name] });
    for (const name of language.PRIMITIVE_TYPES) add({ name, kind: 'type', documentation: language.PRIMITIVE_DOCUMENTATION[name] });
    for (const b of language.BUILTINS) add(b);
    for (const d of declarations) add(d);
    if (actor) {
      for (const d of actor.members || []) add(d, active);
      for (const f of fields(actor.ownedState)) add(f);
    }
    if (callable) {
      for (const d of [...(callable.parameters || []), ...(callable.clauseVariables || [])]) add(d, active);
      // Additional local declarations: retain lexical block scope and declaration order.
      const tokens = scan.tokens.filter(t => t.start >= callable.bodyStart && t.start < pos);
      const scopes = [[]];
      const types = new Set([...language.PRIMITIVE_TYPES, ...declarations.filter(d => d.kind === 'state').map(d => d.name)]);
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.value === '{') scopes.push([]);
        if (t.value === '}' && scopes.length > 1) scopes.pop();
        if (types.has(t.value) && tokens[i + 1]?.kind === 'ident' && ['=', ';'].includes(tokens[i + 2]?.value)) {
          const n = tokens[i + 1];
          scopes[scopes.length - 1].push({ name: n.value, kind: 'local', signature: t.value + ' ' + n.value, start: n.start });
        }
      }
      for (const scope of scopes) for (const d of scope) add(d, active);
    }
  }
  return { items: [...items.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
module.exports = { analyze };
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', part => { input += part; if (input.length > 4000000) process.exit(2); });
  process.stdin.on('end', () => {
    try { const request = JSON.parse(input); process.stdout.write(JSON.stringify(request.mode === 'structure' ? require('./structure-service').structure(request) : analyze(request))); }
    catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
  });
}
