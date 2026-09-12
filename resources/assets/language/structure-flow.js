'use strict';

// A source projection, not an interpreter. Edges distinguish execution order
// from value dependencies; neither asserts that a transaction is valid.
function projectFlow(model, scans) {
  const nodes = [], edges = [], keys = new Set(), canonical = new Map(model.nodes.map(n => [n.id, n]));
  const warnings = new Set(), warningsEn = new Set();
  const language = require('./argent-service');
  const knownCalls = new Set([...language.BUILTINS.map(n => n.name), ...language.PRIMITIVE_TYPES, ...model.nodes.filter(n => ['actor', 'state', 'function'].includes(n.kind)).map(n => n.name), 'require', 'if', 'while', 'for', 'foreach']);
  const authoredCalls = new Set(model.nodes.filter(n => n.kind === 'function').map(n => n.name));
  const warn = (de, en) => { warnings.add(de); warningsEn.add(en); };
  for (const scan of scans) {
    const stack = [], pairs = { '}': '{', ')': '(', ']': '[' }; let unbalanced = false;
    for (const token of scan.tokens) {
      if (['{', '(', '['].includes(token.value)) stack.push(token.value);
      else if (pairs[token.value] && stack.pop() !== pairs[token.value]) unbalanced = true;
    }
    if (unbalanced || stack.length) warn('Unvollständige Klammerstruktur: Die Darstellung kann unvollständig sein.', 'Incomplete delimiter structure: the diagram may be incomplete.');
  }
  const added = [];
  const children = id => model.nodes.filter(n => n.parent === id);
  const byId = new Map();
  const typeOf = n => (n.detail || '').replace(new RegExp('\\s+' + n.name + '[;\\s]*$'), '').trim();
  function copy(n, parent, role, suffix = '') {
    const c = { ...n, id: suffix ? n.id + suffix : n.id, definitionId: n.id, parent: parent || '', role, order: n.start, valueType: ['input', 'value'].includes(role) ? typeOf(n) : '' };
    if (byId.has(c.id)) return byId.get(c.id);
    nodes.push(c); byId.set(c.id, c); return c;
  }
  function link(from, to, kind, valueName = '', valueType = '', label = '', labelEn = '') {
    if (!from || !to || from.id === to.id) return;
    const key = [from.id, to.id, kind, valueName, kind === 'control' ? label : ''].join('|'); if (keys.has(key)) return; keys.add(key);
    edges.push({ from: from.id, to: to.id, kind, flowKind: kind, valueName, valueType, label: label || (kind === 'control' ? 'danach' : 'verwendet'), labelEn: labelEn || (kind === 'control' ? 'then' : 'uses') });
  }
  function sourceNode(scan, parent, kind, name, ts, role = 'rule') {
    if (!ts.length) return null;
    const start = ts[0].start, end = ts[ts.length - 1].end;
    // Use existing identities when the span is already represented.
    const existing = model.nodes.find(n => n.path === scan.path && n.start === start && n.end === end && n.kind === kind);
    const ordinal = nodes.filter(n => n.parent === parent && n.role === 'rule').length;
    const n = existing || { id: parent + '/flow:' + kind + ':' + ordinal, parent, kind, name, path: scan.path, start, end, text: scan.source.slice(start, end), detail: scan.source.slice(start, end).replace(/\s+/g, ' '), editable: true };
    if (!existing) added.push(n);
    return copy(n, parent, role);
  }
  function matching(ts, i, open = '{', close = '}') {
    let depth = 0; for (let j = i; j < ts.length; j++) { if (ts[j].value === open) depth++; if (ts[j].value === close && --depth === 0) return j; } return ts.length - 1;
  }
  function branchEnd(ts, begin) {
    let open = begin; while (open < ts.length && ts[open].value !== '{') open++;
    if (open === ts.length) return ts.length - 1;
    const end = matching(ts, open);
    if (ts[end + 1]?.value === 'else') {
      if (ts[end + 2]?.value === 'if') return branchEnd(ts, end + 2);
      if (ts[end + 2]?.value === '{') return matching(ts, end + 2);
    }
    return end;
  }
  function pieces(ts, delimiter) {
    const result = []; let begin = 0, depth = 0;
    for (let i = 0; i < ts.length; i++) {
      if (['{', '(', '['].includes(ts[i].value)) depth++;
      if (['}', ')', ']'].includes(ts[i].value)) depth--;
      if (ts[i].value === delimiter && depth === 0) { if (i > begin) result.push(ts.slice(begin, i)); begin = i + 1; }
    }
    if (begin < ts.length) result.push(ts.slice(begin)); return result;
  }
  for (const n of model.nodes.filter(n => ['app', 'actor'].includes(n.kind))) copy(n, canonical.get(n.parent)?.kind === 'file' ? '' : n.parent, 'scope');
  for (const actor of nodes.filter(n => n.kind === 'actor' && !n.parent)) {
    const app = model.edges.find(e => e.to === actor.definitionId && e.label === 'enthält Actor');
    if (app && byId.has(app.from)) actor.parent = app.from;
  }
  // Keep state declarations accessible for editing, including their shared
  // field identities. They are separate from each action's input aliases.
  for (const actor of nodes.filter(n => n.kind === 'actor')) {
    const own = model.edges.find(e => e.from === actor.definitionId && e.label === 'verwendet Zustand');
    if (own && canonical.has(own.to)) {
      const state = copy(canonical.get(own.to), actor.id, 'scope', '/state:' + actor.id);
      for (const field of children(own.to).filter(n => n.kind === 'field')) copy(field, state.id, 'input', '/state:' + actor.id);
    }
  }
  const looseActors = nodes.filter(n => n.kind === 'actor' && !n.parent);
  const implicit = looseActors.length ? { id: 'implicit-app', parent: '', kind: 'app', name: 'ArgentApp', detail: 'ArgentApp', path: looseActors[0].path, start: 0, end: 0, text: '', editable: false } : null;
  if (implicit) { const app = copy(implicit, '', 'scope'); for (const actor of nodes.filter(n => n.kind === 'actor' && !n.parent)) actor.parent = app.id; }
  for (const scan of scans) for (const d of scan.declarations) {
    const calls = d.kind === 'actor' ? d.members || [] : d.kind === 'function' ? [d] : [];
    for (const call of calls) {
      const original = model.nodes.find(n => n.path === scan.path && n.name === call.name && ['entry', 'delegate', 'function'].includes(n.kind) && n.start <= call.start && n.end >= call.end);
      if (!original) continue;
      const action = copy(original, byId.has(original.parent) ? original.parent : '', 'scope');
      const symbols = new Map(), outputs = new Map();
      const continuation = new Map();
      const continues = n => !n || (continuation.get(n.id) !== false && n.kind !== 'transition' && !/^(return|abort|break|continue)\b/.test(n.text.trim()));
      const own = model.edges.find(e => e.from === original.parent && e.label === 'verwendet Zustand');
      function stateFields(id, seen = new Set()) {
        if (!id || seen.has(id)) return []; seen.add(id);
        const base = model.edges.find(e => e.from === id && e.label === 'erweitert');
        return [...stateFields(base?.to, seen), ...children(id).filter(n => n.kind === 'field')];
      }
      const fieldSymbols = new Map();
      for (const f of stateFields(own?.to)) { const n = copy(f, action.id, 'input', '/in:' + action.id); symbols.set(f.name, n); fieldSymbols.set(f.name, n); }
      for (const p of children(original.id).filter(n => n.kind === 'parameter')) symbols.set(p.name, copy(p, action.id, 'input'));
      for (const p of call.clauseVariables || []) {
        const existing = children(original.id).find(n => n.name === p.name && n.kind === 'output'); if (!existing) continue;
        const role = ['emit', 'spawn'].includes(p.clause) ? 'output' : 'input';
        const n = copy(existing, action.id, role); const i = scan.tokens.findIndex(t => t.start === p.start);
        n.valueType = scan.tokens[i + 1]?.value === ':' ? scan.tokens[i + 2]?.value || '' : '';
        n.detail = p.clause + ' ' + n.name + (n.valueType ? ': ' + n.valueType : '');
        if (role === 'output') outputs.set(p.name, n); else symbols.set(p.name, n);
      }
      function context(name, type, token) {
        if (symbols.has(name)) return symbols.get(name);
        const n = { id: action.id + '/context:' + name, definitionId: '', parent: action.id, role: 'input', kind: 'parameter', name, valueType: type, detail: name, path: scan.path, start: token.start, end: token.end, order: token.start, text: scan.source.slice(token.start, token.end), editable: false };
        nodes.push(n); byId.set(n.id, n); symbols.set(name, n); return n;
      }
      function reads(ts, consumer, scope) {
        for (let i = 0; i < ts.length; i++) {
          const t = ts[i]; if (t.kind !== 'ident' || ts[i + 1]?.value === ':') continue;
          if (ts[i + 1]?.value === '(' && !knownCalls.has(t.value)) warn('Unbekannte Aufrufe bleiben unaufgelöst: ' + t.value, 'Unknown calls remain opaque: ' + t.value);
          if (ts[i + 1]?.value === '(' && authoredCalls.has(t.value)) warn('Funktionsaufrufe zeigen ihre Argumente; Parameterbindungen und Rückgabewerte im Funktionsrumpf werden nicht über Aufrufgrenzen verfolgt.', 'Function calls show arguments; parameter bindings and return values are not traced across call boundaries.');
          if (ts[i - 1]?.value === '.') continue;
          let provider = scope.get(t.value), name = t.value;
          if (!provider && !outputs.has(t.value)) {
            const candidates = model.nodes.filter(n => n.kind === 'const' && n.name === t.value);
            const local = candidates.filter(n => n.path === scan.path);
            const declaration = local.length === 1 ? local[0] : candidates.length === 1 ? candidates[0] : null;
            if (declaration) {
              provider = copy(declaration, action.id, 'input', '/in:' + action.id);
              provider.valueType = declaration.text.replace(/^const\s+/, '').split(declaration.name)[0].trim();
              scope.set(t.value, provider);
            }
          }
          if (ts[i + 1]?.value === '.' && ts[i + 2]?.kind === 'ident') {
            name += '.' + ts[i + 2].value;
            if (t.value === 'self') provider = fieldSymbols.get(ts[i + 2].value) || context(name, '', t);
            else if (outputs.has(t.value)) provider = context(name, '', t);
          }
          if (provider) {
            let valueType = provider.valueType;
            if (name.includes('.') && !name.startsWith('self.') && !outputs.has(t.value)) {
              const states = model.nodes.filter(n => n.kind === 'state' && n.name === provider.valueType);
              const field = states.length === 1 ? children(states[0].id).find(n => n.kind === 'field' && n.name === ts[i + 2]?.value) : null;
              valueType = field ? typeOf(field) : '';
            }
            link(provider, consumer, 'value', name, valueType);
          }
        }
      }
      function recordMembers(ts, parent, scope, prefix) {
        const open = ts.findIndex(t => t.value === '{');
        if (open < 0) { reads(ts, parent, scope); return; }
        for (const item of pieces(ts.slice(open + 1, matching(ts, open)), ',')) {
          const member = sourceNode(scan, parent.id, 'statement', scan.source.slice(item[0].start, item[item.length - 1].end).replace(/\s+/g, ' '), item);
          const name = prefix + '.' + item[0].value;
          recordMembers(item, member, scope, name);
          link(member, parent, 'value', name, '', 'setzt Zustandsfeld', 'sets state field');
        }
      }
      function sequence(ts, parent, scope, declared = new Set()) {
        const list = []; let i = 0;
        while (i < ts.length) {
          if ([';', '}'].includes(ts[i].value)) { i++; continue; }
          const begin = i;
          // Control blocks terminate at their closing brace, independently of
          // a following statement. Record literal braces do not.
          if (['if', 'for', 'while', 'foreach'].includes(ts[i].value)) {
            let open = i; while (open < ts.length && ts[open].value !== '{') open++;
            if (open < ts.length) {
              let end = matching(ts, open), elseOpen = -1, elseEnd = -1;
              if (ts[end + 1]?.value === 'else' && ts[end + 2]?.value === '{') { elseOpen = end + 2; elseEnd = matching(ts, elseOpen); }
              if (ts[end + 1]?.value === 'else' && ts[end + 2]?.value === 'if') { elseOpen = end + 2; elseEnd = branchEnd(ts, elseOpen); }
              const stop = elseEnd >= 0 ? elseEnd : end;
              const group = sourceNode(scan, parent, 'branch', ts[begin].value, ts.slice(begin, stop + 1)); list.push(group);
              const condition = sourceNode(scan, group.id, 'check', ts[begin].value, ts.slice(begin, open)); reads(ts.slice(begin, open), condition, scope);
              const yesScope = new Map(scope), noScope = new Map(scope), yesDeclared = new Set(), noDeclared = new Set();
              const yes = sequence(ts.slice(open + 1, end), group.id, yesScope, yesDeclared);
              if (yes.length) link(condition, yes[0], 'control', '', '', ts[begin].value === 'if' ? 'wenn wahr' : 'Schleifenrumpf', ts[begin].value === 'if' ? 'if true' : 'loop body');
              let no = [];
              if (elseOpen >= 0) { no = sequence(ts[elseOpen].value === 'if' ? ts.slice(elseOpen, elseEnd + 1) : ts.slice(elseOpen + 1, elseEnd), group.id, noScope, noDeclared); if (no.length) link(condition, no[0], 'control', '', '', 'sonst', 'otherwise'); }
              if (ts[begin].value === 'if') {
                const yesEnd = yes[yes.length - 1], noEnd = no[no.length - 1];
                if (continues(yesEnd)) link(yesEnd || condition, group, 'control', '', '', yesEnd ? 'Zweig abgeschlossen' : 'wenn wahr', yesEnd ? 'branch completes' : 'if true');
                if (continues(noEnd)) link(noEnd || condition, group, 'control', '', '', noEnd ? 'Zweig abgeschlossen' : 'sonst', noEnd ? 'branch completes' : 'otherwise');
                continuation.set(group.id, continues(yesEnd) || continues(noEnd));
              }
              if (ts[begin].value !== 'if') warn('Schleifen werden als Quellstruktur gezeigt; Wiederholungen sind nicht ausgewertet.', 'Loops show source structure; iterations are not evaluated.');
              // A value assigned in a branch is produced by that whole branch,
              // not unconditionally by either of its alternative assignments.
              for (const [name, previous] of scope) {
                const yesValue = yesDeclared.has(name) ? previous : yesScope.get(name), noValue = noDeclared.has(name) ? previous : noScope.get(name);
                if (yesValue !== previous || noValue !== previous) {
                  link(yesValue, group, 'value', name, previous.valueType);
                  link(noValue, group, 'value', name, previous.valueType);
                  scope.set(name, { ...group, valueType: previous.valueType });
                }
              }
              i = stop + 1; continue;
            }
          }
          let depth = 0;
          for (; i < ts.length; i++) { const v = ts[i].value; if (['{', '(', '['].includes(v)) depth++; if (['}', ')', ']'].includes(v)) depth--; if (v === ';' && depth === 0) { i++; break; } }
          const part = ts.slice(begin, i); if (!part.length) break;
          const kind = part[0].value === 'require' ? 'check' : part[0].value === 'become' ? 'transition' : 'statement';
          const title = scan.source.slice(part[0].start, part[part.length - 1].end).replace(/\s+/g, ' ').slice(0, 64);
          const rule = sourceNode(scan, parent, kind, title, part); list.push(rule);
          const eq = part.findIndex(t => t.value === '='), local = eq > 1 && part[eq - 1].kind === 'ident' && part[eq - 2].value !== '.' && !part.slice(0, eq).some(t => t.value === '(') ? part[eq - 1] : null;
          const rhs = eq >= 0 ? part.slice(eq + 1) : part;
          const open = rhs.findIndex(t => t.value === '{');
          const transitionBlock = kind === 'transition' && part[1]?.value === '{';
          if (open >= 0 && (local || transitionBlock)) {
            const close = matching(rhs, open);
            for (const item of pieces(rhs.slice(open + 1, close), ',')) {
              const child = sourceNode(scan, rule.id, 'statement', scan.source.slice(item[0].start, item[item.length - 1].end).replace(/\s+/g, ' '), item);
              if (local) recordMembers(item, child, scope, local.value + '.' + item[0].value);
              else reads(item, child, scope);
              if (local) link(child, rule, 'value', local.value + '.' + item[0].value, '', 'setzt Zustandsfeld', 'sets state field');
              if (kind === 'transition') { const output = outputs.get(item[0]?.value); if (output) link(child, output, 'value', output.name, output.valueType, 'Nachfolger', 'successor'); }
            }
          } else reads(rhs, rule, scope);
          if (kind === 'transition' && !transitionBlock) { const output = outputs.get(part[1]?.value); if (output) link(rule, output, 'value', output.name, output.valueType, 'Nachfolger', 'successor'); }
          if (local) { rule.valueType = scan.source.slice(part[0].start, local.start).trim(); rule.valueName = local.value; scope.set(local.value, rule); declared.add(local.value); }
          else if (eq === 1 && scope.has(part[0].value)) { rule.valueType = scope.get(part[0].value).valueType; rule.valueName = part[0].value; scope.set(part[0].value, rule); }
          else if (eq >= 0) {
            reads(part.slice(0, eq), rule, scope);
            warn('Komplexe Zuweisungen bleiben als Quellblock sichtbar; Teilwert-Versionen werden nicht aufgelöst.', 'Complex assignments remain source blocks; member value versions are not resolved.');
            if (scope.has(part[0].value)) { rule.valueType = scope.get(part[0].value).valueType; scope.set(part[0].value, rule); }
          }
        }
        for (let j = 1; j < list.length; j++) if (continues(list[j - 1])) link(list[j - 1], list[j], 'control');
        return list;
      }
      sequence(scan.tokens.filter(t => t.start >= call.bodyStart && t.start < call.bodyEnd), action.id, new Map(symbols));
    }
  }
  for (const n of nodes) if (byId.has(n.parent)) link(byId.get(n.parent), n, 'contains', '', '', 'enthält', 'contains');
  model.nodes.push(...added.filter(n => !canonical.has(n.id)));
  // App/actor/action navigation is alphabetical, independent of declaration
  // placement. Only executable contents use source order.
  const ordered = [], visited = new Set();
  const roleRank = n => n.role === 'input' ? 0 : n.role === 'output' ? 2 : 1;
  function emit(list, alphabetical) {
    const sorted = list.slice().sort((a, b) => alphabetical
      ? (a.kind === 'app' ? 0 : 1) - (b.kind === 'app' ? 0 : 1) || a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en')
      : roleRank(a) - roleRank(b) || (a.role === 'input' || a.role === 'output' ? a.name.localeCompare(b.name, 'en') : a.order - b.order) || a.id.localeCompare(b.id, 'en'));
    for (const n of sorted) {
      if (visited.has(n.id)) continue;
      visited.add(n.id); ordered.push(n);
      emit(nodes.filter(c => c.parent === n.id), ['app', 'actor', 'state'].includes(n.kind));
    }
  }
  emit(nodes.filter(n => !byId.has(n.parent)), true);
  emit(nodes.filter(n => !visited.has(n.id)), true);
  return { nodes: ordered, edges, warning: [...warnings].join(' · '), warningEn: [...warningsEn].join(' · ') };
}
module.exports = { projectFlow };
