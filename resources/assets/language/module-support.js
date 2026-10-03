'use strict';
// Studio adapter for Argent b312deda6fe10f6493c8d49eb748e3f61860458a.
// Legacy actor imports remain indexable in the editor; the compiler decides validity.
const path = require('path');
const language = require('./argent-service');
function scanDocument(source) {
  const scan = language.scanDocument(source), ts = scan.tokens;
  let depth = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (depth === 0 && t.value === 'import' && ts[i + 1]?.value === 'actor' && ts[i + 2]?.kind === 'ident' && ts[i + 3]?.value === 'from' && ts[i + 4]?.kind === 'string') {
      const name = ts[i + 2], literal = ts[i + 4];
      scan.declarations = scan.declarations.filter(d => d.start !== name.start);
      scan.imports.push({ kind: 'actor', name: name.value, path: literal.value, start: name.start, end: name.end, pathStart: literal.start + 1, pathEnd: literal.end - 1 });
    }
    if (t.value === '{') depth++; else if (t.value === '}') depth--;
  }
  return scan;
}
function importPath(scan, imported, standardLibrary) {
  if (imported.path === 'std::core') return standardLibrary ? path.resolve(standardLibrary) : undefined;
  if (imported.path && !path.isAbsolute(imported.path) && !imported.path.includes('::')) return path.resolve(path.dirname(scan.path), imported.path);
}
function moduleIndex(scans, standardLibrary) {
  const modules = [...scans.values()].map(scan => ({ key: scan.path.toLowerCase(), declarations: scan.declarations.map(d => ({ ...d, path: scan.path, moduleKey: scan.path.toLowerCase() })), imports: scan.imports.map(imp => ({ ...imp, targetKey: importPath(scan, imp, standardLibrary)?.toLowerCase() })) }));
  const exports = language.buildModuleExports(modules);
  return { exports, resolve(name, scan) { return name ? language.resolveSymbolPath(exports, scan.path.toLowerCase(), name.split('::')) : undefined; } };
}
function qualifiedAt(tokens, start) {
  if (tokens[start]?.kind !== 'ident') return '';
  let name = tokens[start].value;
  for (let i = start + 1; tokens[i]?.value === ':' && tokens[i + 1]?.value === ':' && tokens[i + 2]?.kind === 'ident'; i += 3) name += '::' + tokens[i + 2].value;
  return name;
}
module.exports = { scanDocument, importPath, moduleIndex, qualifiedAt };
