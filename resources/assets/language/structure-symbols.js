'use strict';
function indexFields({ files, callables, fields, resolve, ownedFields, nodes, edge }) {
  const seen = new Map();
  for (const list of fields.values()) for (const f of list) { f.references = []; f.renameSafe = true; seen.set(f, new Set()); }
  function ref(field, scan, token, owner, label = 'liest Feld') {
    if (!field || !seen.has(field)) return;
    const key = scan.path + ':' + token.start;
    if (!seen.get(field).has(key)) { seen.get(field).add(key); field.references.push({ path: scan.path, start: token.start, end: token.end }); }
    if (owner) edge(owner, field, label);
  }
  for (const list of fields.values()) for (const f of list) ref(f, { path: f.path }, { start: f.symbolStart, end: f.symbolStart + f.name.length });
  for (const { scan, d, n, actor } of callables) {
    const actorFields = actor ? ownedFields(actor.ownedState, scan) : [];
    const scope = [new Map(actorFields.map(f => [f.name, { field: f }]))];
    const lookup = name => { for (let i = scope.length - 1; i >= 0; i--) if (scope[i].has(name)) return scope[i].get(name); return null; };
    for (const p of [...(d.parameters || []), ...(d.clauseVariables || [])]) scope[0].set(p.name, { type: p.type });
    const ts = scan.tokens.filter(t => t.start >= d.bodyStart && t.start < d.bodyEnd);
    if (ts.some(t => t.kind === 'ident' && ['for', 'foreach'].includes(t.value))) for (const f of actorFields) f.renameSafe = false;
    const braces = []; let pendingRecord = null;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i], prev = ts[i - 1], next = ts[i + 1];
      if (t.value === ';' && t.localsAfter) for (const [name, symbol] of t.localsAfter) scope[scope.length - 1].set(name, symbol);
      if (t.value === '{') { braces.push(pendingRecord); pendingRecord = null; scope.push(new Map()); continue; }
      if (t.value === '}') { braces.pop(); if (scope.length > 1) scope.pop(); continue; }
      if (t.kind !== 'ident') continue;
      // Typed declarations, including arrays. Introduce the local only after its initializer.
      let j = i + 1;
      while (ts[j]?.value === '[') { while (j < ts.length && ts[j].value !== ']') j++; j++; }
      if (ts[j]?.kind === 'ident' && ['=', ';'].includes(ts[j + 1]?.value) && (i === 0 || [';', '{', '}'].includes(prev?.value))) {
        const localToken = ts[j], type = t.value;
        localToken.localDefinition = { type };
        if (ts[j + 2]?.value === '{') pendingRecord = resolve(type, scan, ['state']);
      }
      if (t.localDefinition) {
        // Field references in an initializer resolve before this new local shadows them.
        let depth = 0, end = i + 1;
        for (; end < ts.length; end++) { if (ts[end].value === '{') depth++; if (ts[end].value === '}') depth--; if (ts[end].value === ';' && depth === 0) break; }
        if (ts[end]) { if (!ts[end].localsAfter) ts[end].localsAfter = []; ts[end].localsAfter.push([t.value, t.localDefinition]); }
        continue;
      }
      let field;
      if (next?.value === ':') {
        const record = braces[braces.length - 1]; if (record) field = ownedFields(record.d.name, record.scan).find(f => f.name === t.value);
      } else if (prev?.value === '.') {
        const receiver = ts[i - 2]?.value;
        if (receiver === 'self') field = actorFields.find(f => f.name === t.value);
        else { const type = lookup(receiver)?.type; if (type) field = ownedFields(type, scan).find(f => f.name === t.value); }
      } else field = lookup(t.value)?.field;
      const owner = nodes.find(x => x.parent === n.id && x.start <= t.start && t.end <= x.end && ['statement', 'check', 'transition', 'branch'].includes(x.kind)) || n;
      ref(field, scan, t, owner, next?.value === ':' ? 'setzt Feld' : 'liest Feld');
      if (!field && (prev?.value === '.' || next?.value === ':')) {
        // Unresolved member/record references must never be silently renamed.
        for (const list of fields.values()) for (const f of list) if (f.name === t.value) f.renameSafe = false;
      }
    }
  }
  // References outside the supported callable grammar (e.g. constant record
  // literals) keep visualization useful but make automatic renaming unavailable.
  const known = new Set([...seen.values()].flatMap(s => [...s]));
  for (const scan of files.values()) for (let i = 0; i < scan.tokens.length; i++) {
    const t = scan.tokens[i];
    if (t.kind !== 'ident' || known.has(scan.path + ':' + t.start)) continue;
    if (scan.tokens[i - 1]?.value === '.' || scan.tokens[i + 1]?.value === ':')
      for (const list of fields.values()) for (const f of list) if (f.name === t.value) f.renameSafe = false;
  }
}
module.exports = { indexFields };
