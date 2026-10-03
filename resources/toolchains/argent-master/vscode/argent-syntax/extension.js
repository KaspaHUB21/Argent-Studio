'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const {
  BUILTINS,
  KEYWORD_DOCUMENTATION,
  KEYWORDS,
  PRIMITIVE_DOCUMENTATION,
  PRIMITIVE_TYPES,
  builtinCall,
  buildModuleExports,
  resolveSymbolPath,
  scanDocument,
  standardModuleRelativePath,
} = require('./language-service');

const EXTENSION_DIRECTORY = fs.realpathSync(__dirname);

const semanticLegend = new vscode.SemanticTokensLegend(
  ['type', 'class', 'enum', 'function', 'variable', 'namespace', 'property', 'parameter'],
  ['declaration', 'readonly', 'defaultLibrary'],
);

const DECLARATION_COMPLETION_KIND = {
  actor: vscode.CompletionItemKind.Class,
  actorEnum: vscode.CompletionItemKind.Enum,
  app: vscode.CompletionItemKind.Module,
  constant: vscode.CompletionItemKind.Constant,
  delegate: vscode.CompletionItemKind.Method,
  entry: vscode.CompletionItemKind.Method,
  function: vscode.CompletionItemKind.Function,
  module: vscode.CompletionItemKind.Module,
  state: vscode.CompletionItemKind.Struct,
};

const DECLARATION_SEMANTIC_KIND = {
  actor: 'class',
  actorEnum: 'enum',
  app: 'namespace',
  constant: 'variable',
  delegate: 'function',
  entry: 'function',
  function: 'function',
  module: 'namespace',
  state: 'type',
};

class ArgentIndex {
  constructor() {
    this.fileCache = new Map();
  }

  invalidate(uri) {
    if (uri) {
      this.fileCache.delete(uri.toString());
    } else {
      this.fileCache.clear();
    }
  }

  async scanUri(uri, rootDocument) {
    if (rootDocument && uri.toString() === rootDocument.uri.toString()) {
      return scanDocument(rootDocument.getText());
    }

    const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    if (openDocument) {
      return scanDocument(openDocument.getText());
    }

    const key = uri.toString();
    if (this.fileCache.has(key)) {
      return this.fileCache.get(key);
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    const scan = scanDocument(Buffer.from(bytes).toString('utf8'));
    this.fileCache.set(key, scan);
    return scan;
  }

  resolveImport(from, importPath) {
    const standardPath = standardModuleRelativePath(importPath);
    if (standardPath) {
      return vscode.Uri.file(path.resolve(EXTENSION_DIRECTORY, standardPath));
    }
    if (importPath.startsWith('std::')) {
      return undefined;
    }
    if (from.scheme !== 'file') {
      return undefined;
    }
    if (importPath.startsWith('/')) {
      return vscode.Uri.file(importPath);
    }
    return vscode.Uri.joinPath(from, '..', importPath);
  }

  async collect(rootDocument) {
    const rootKey = rootDocument.uri.toString();
    const pending = [rootDocument.uri];
    const visited = new Set();
    const modules = [];

    while (pending.length > 0) {
      const uri = pending.shift();
      const key = uri.toString();
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);

      let scan;
      try {
        scan = await this.scanUri(uri, rootDocument);
      } catch {
        continue;
      }

      modules.push({ key, uri, scan, local: key === rootKey, declarations: [], imports: [] });
      for (const imported of scan.imports) {
        const importedUri = this.resolveImport(uri, imported.path);
        if (importedUri) {
          pending.push(importedUri);
        }
      }
    }

    const declarations = [];
    for (const module of modules) {
      module.imports = module.scan.imports.map((imported) => ({
        alias: imported.alias,
        targetKey: this.resolveImport(module.uri, imported.path)?.toString(),
      }));
      for (const scanned of module.scan.declarations) {
        const enrichParameters = (parameters, callable, actor) =>
          parameters?.map((parameter) => ({
            ...parameter,
            uri: module.uri,
            local: module.local,
            callable,
            actor,
          }));
        const members = scanned.members?.map((member) => ({
          ...member,
          uri: module.uri,
          local: module.local,
          actor: scanned.name,
          parameters: enrichParameters(member.parameters, member.name, scanned.name),
        }));
        const item = {
          ...scanned,
          uri: module.uri,
          moduleKey: module.key,
          local: module.local,
          parameters: enrichParameters(scanned.parameters, scanned.name),
          members,
          fields: scanned.fields?.map((field) => ({
            ...field,
            uri: module.uri,
            local: module.local,
            state: scanned.name,
          })),
        };
        module.declarations.push(item);
        declarations.push(item);
        for (const member of members ?? []) {
          declarations.push(member);
        }
      }
    }

    return { rootDocument, modules, declarations, exports: buildModuleExports(modules) };
  }
}

function fieldsForState(catalog, stateName, fromUri, visiting = new Set()) {
  const state = stateName && resolveSymbolPath(catalog.exports, fromUri.toString(), stateName.split('::'));
  if (state?.kind !== 'state' || visiting.has(state)) {
    return [];
  }
  visiting.add(state);

  const fields = fieldsForState(catalog, state.baseState, state.uri, visiting);
  const byName = new Map(fields.map((field) => [field.name, field]));
  for (const field of state.fields ?? []) {
    byName.set(field.name, field);
  }
  return [...byName.values()];
}

function enclosingActor(catalog, uri, offset) {
  const key = uri.toString();
  return catalog.declarations
    .filter(
      (candidate) =>
        candidate.kind === 'actor' &&
        candidate.uri.toString() === key &&
        candidate.bodyStart <= offset &&
        offset <= candidate.bodyEnd,
    )
    .sort((left, right) => left.bodyEnd - left.bodyStart - (right.bodyEnd - right.bodyStart))[0];
}

function selfField(catalog, uri, offset, name) {
  const actor = enclosingActor(catalog, uri, offset);
  return actor ? fieldsForState(catalog, actor.ownedState, actor.uri).find((field) => field.name === name) : undefined;
}

function isCallable(declaration) {
  return ['function', 'entry', 'delegate'].includes(declaration.kind);
}

function enclosingCallable(catalog, uri, offset) {
  const key = uri.toString();
  return catalog.declarations
    .filter(
      (candidate) =>
        isCallable(candidate) &&
        candidate.uri.toString() === key &&
        candidate.bodyStart <= offset &&
        offset <= candidate.bodyEnd,
    )
    .sort((left, right) => left.bodyEnd - left.bodyStart - (right.bodyEnd - right.bodyStart))[0];
}

function parameterAt(catalog, uri, offset, name) {
  const key = uri.toString();
  for (const declaration of catalog.declarations) {
    if (!isCallable(declaration) || declaration.uri.toString() !== key) {
      continue;
    }
    const parameter = declaration.parameters?.find(
      (candidate) => candidate.name === name && candidate.start <= offset && offset <= candidate.end,
    );
    if (parameter) {
      return parameter;
    }
  }
  return undefined;
}

function parameterInScope(catalog, uri, offset, name) {
  return enclosingCallable(catalog, uri, offset)?.parameters?.find((parameter) => parameter.name === name);
}

function visibleParameter(catalog, uri, offset, name) {
  return parameterAt(catalog, uri, offset, name) ?? parameterInScope(catalog, uri, offset, name);
}

function followsSelfDot(source, offset) {
  return /\bself\s*\.\s*$/.test(source.slice(0, offset));
}

function isSelfCompletion(document, position) {
  const line = document.lineAt(position.line).text.slice(0, position.character);
  return /\bself\s*\.\s*[A-Za-z0-9_]*$/.test(line);
}

function referenceAt(catalog, uri, offset, tokenIndex) {
  const key = uri.toString();
  const current = catalog.modules.find((module) => module.key === key);
  const tokens = current?.scan.tokens ?? [];
  let index = tokenIndex ?? tokens.findIndex((token) => token.start === offset && token.kind === 'ident');
  if (index < 0) {
    return undefined;
  }
  const origin = index;
  const name = tokens[index].value;
  const segments = [name];
  while (index >= 3 && tokens[index - 1].value === ':' && tokens[index - 2].value === ':' && tokens[index - 3].kind === 'ident') {
    index -= 3;
    segments.unshift(tokens[index].value);
  }
  const qualified = segments.length > 1 || (tokens[origin + 1]?.value === ':' && tokens[origin + 2]?.value === ':');
  if (segments.length === 1) {
    const declaration = current.declarations.find((item) => item.start === offset)
      ?? current.declarations.flatMap((item) => item.members ?? []).find((item) => item.start === offset);
    if (declaration) {
      return { target: declaration, qualified };
    }
    const actor = enclosingActor(catalog, uri, offset);
    const member = actor?.members?.find((item) => item.name === name && item.kind === 'function');
    if (member) {
      return { target: member, qualified };
    }
  }
  return { target: resolveSymbolPath(catalog.exports, key, segments), qualified };
}

function namespaceSymbols(catalog, uri, source, offset) {
  const prefix = source.slice(0, offset).match(/((?:[A-Za-z_][A-Za-z0-9_]*\s*::\s*)+)[A-Za-z0-9_]*$/);
  if (!prefix) {
    return undefined;
  }
  const segments = prefix[1].split(/\s*::\s*/).filter(Boolean);
  const namespace = resolveSymbolPath(catalog.exports, uri.toString(), segments);
  if (namespace?.kind === 'module') {
    return catalog.exports.get(namespace.moduleKey) ?? new Map();
  }
  const symbols = new Map();
  if (namespace?.kind === 'app') {
    for (const actorPath of namespace.actors ?? []) {
      const actor = resolveSymbolPath(catalog.exports, namespace.moduleKey, actorPath.split('::'));
      if (actor?.kind === 'actor') {
        const name = actorPath.split('::').at(-1);
        const targets = symbols.get(name) ?? new Set();
        targets.add(actor);
        symbols.set(name, targets);
      }
    }
  }
  return symbols;
}

function relativePath(uri) {
  return vscode.workspace.asRelativePath(uri, false);
}

function positionAt(source, offset) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);
  return new vscode.Position(lines.length - 1, lines.at(-1).length);
}

function functionSnippet(name, params) {
  if (!params || params.length === 0) {
    return new vscode.SnippetString(`${name}()`);
  }
  const args = params.map((param, index) => `\${${index + 1}:${param}}`).join(', ');
  return new vscode.SnippetString(`${name}(${args})`);
}

function completionItems(catalog, actor, symbols, qualified = false) {
  const items = [];

  for (const keyword of qualified ? [] : KEYWORDS) {
    const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
    item.detail = 'Argent keyword';
    if (KEYWORD_DOCUMENTATION[keyword]) {
      item.documentation = new vscode.MarkdownString(KEYWORD_DOCUMENTATION[keyword]);
    }
    item.sortText = `3-${keyword}`;
    items.push(item);
  }

  for (const type of qualified ? [] : PRIMITIVE_TYPES) {
    const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.TypeParameter);
    item.detail = 'Argent primitive type';
    if (PRIMITIVE_DOCUMENTATION[type]) {
      item.documentation = new vscode.MarkdownString(PRIMITIVE_DOCUMENTATION[type]);
    }
    item.sortText = `2-${type}`;
    items.push(item);
  }

  for (const builtin of qualified ? [] : BUILTINS) {
    const item = new vscode.CompletionItem(builtin.name, vscode.CompletionItemKind.Function);
    item.detail = builtin.signature;
    item.insertText = functionSnippet(builtin.name, builtin.params);
    if (builtin.documentation) {
      item.documentation = new vscode.MarkdownString(builtin.documentation);
    }
    item.sortText = `2-${builtin.name}`;
    items.push(item);
  }

  const visible = new Map(symbols);
  if (!qualified) {
    for (const member of actor?.members ?? []) {
      visible.set(member.name, new Set([member]));
    }
  }
  for (const [name, targets] of visible) {
    if (targets.size !== 1) {
      continue;
    }
    const [declaration] = targets;

    const item = new vscode.CompletionItem(name, DECLARATION_COMPLETION_KIND[declaration.kind]);
    item.detail = declaration.kind === 'module' ? 'module namespace' : `${declaration.signature} — ${relativePath(declaration.uri)}`;
    if (declaration.documentation) {
      item.documentation = new vscode.MarkdownString(declaration.documentation);
    }
    item.sortText = `${declaration.local ? '0' : '1'}-${name}`;
    if (isCallable(declaration)) {
      item.insertText = functionSnippet(declaration.name, declaration.params);
    }
    items.push(item);
  }

  return items;
}

function fieldCompletionItems(fields) {
  return fields.map((field) => {
    const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
    item.detail = `${field.signature} — ${field.state}`;
    if (field.documentation) {
      item.documentation = new vscode.MarkdownString(field.documentation);
    }
    item.sortText = `0-${field.name}`;
    return item;
  });
}

function parameterCompletionItems(parameters) {
  return parameters.map((parameter) => {
    const item = new vscode.CompletionItem(parameter.name, vscode.CompletionItemKind.Variable);
    item.detail = `${parameter.signature} — parameter of ${parameter.callable}`;
    item.sortText = `0-${parameter.name}`;
    return item;
  });
}

function clauseVariableCompletionItems(variables, callable) {
  return variables.map((variable) => {
    const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
    item.detail = `${variable.signature} — clause variable of ${callable}`;
    item.sortText = `0-${variable.name}`;
    return item;
  });
}

function wordAt(document, position) {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  return range ? { range, value: document.getText(range) } : undefined;
}

function declarationHover(declaration) {
  const markdown = new vscode.MarkdownString();
  if (declaration.kind === 'module') {
    const uri = vscode.Uri.parse(declaration.moduleKey);
    markdown.appendMarkdown(`Module \`${declaration.name}\` from \`${relativePath(uri)}\``);
    return new vscode.Hover(markdown);
  }
  markdown.appendCodeblock(declaration.signature, 'argent');
  if (declaration.documentation) {
    markdown.appendMarkdown(`\n\n${declaration.documentation}`);
  }
  markdown.appendMarkdown(`\n\nDeclared in \`${relativePath(declaration.uri)}\``);
  return new vscode.Hover(markdown);
}

function fieldHover(field) {
  const markdown = new vscode.MarkdownString();
  markdown.appendCodeblock(field.signature, 'argent');
  if (field.documentation) {
    markdown.appendMarkdown(`\n\n${field.documentation}`);
  }
  markdown.appendMarkdown(`\n\nField of \`${field.state}\` in \`${relativePath(field.uri)}\``);
  return new vscode.Hover(markdown);
}

function parameterHover(parameter) {
  const markdown = new vscode.MarkdownString();
  markdown.appendCodeblock(parameter.signature, 'argent');
  const owner = parameter.actor ? `\`${parameter.actor}.${parameter.callable}\`` : `\`${parameter.callable}\``;
  markdown.appendMarkdown(`\n\nParameter of ${owner}`);
  return new vscode.Hover(markdown);
}

function declarationLocation(catalog, declaration) {
  if (declaration.kind === 'module') {
    return new vscode.Location(vscode.Uri.parse(declaration.moduleKey), new vscode.Position(0, 0));
  }
  const module = catalog.modules.find((candidate) => candidate.uri.toString() === declaration.uri.toString());
  const start = module ? positionAt(module.scan.source, declaration.start) : new vscode.Position(0, 0);
  const end = module ? positionAt(module.scan.source, declaration.end) : start;
  return new vscode.Location(declaration.uri, new vscode.Range(start, end));
}

function semanticModifiers(declaration, isDeclaration) {
  const modifiers = [];
  if (isDeclaration) {
    modifiers.push('declaration');
  }
  if (declaration.kind === 'constant') {
    modifiers.push('readonly');
  }
  return modifiers;
}

function activate(context) {
  const index = new ArgentIndex();
  const selector = { language: 'argent' };
  const semanticChanges = new vscode.EventEmitter();

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.ag');
  watcher.onDidChange((uri) => {
    index.invalidate(uri);
    semanticChanges.fire();
  });
  watcher.onDidCreate((uri) => {
    index.invalidate(uri);
    semanticChanges.fire();
  });
  watcher.onDidDelete((uri) => {
    index.invalidate(uri);
    semanticChanges.fire();
  });

  context.subscriptions.push(
    watcher,
    semanticChanges,
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'argent') {
        index.invalidate(event.document.uri);
        semanticChanges.fire();
      }
    }),
    vscode.languages.registerCompletionItemProvider(selector, {
      async provideCompletionItems(document, position) {
        const catalog = await index.collect(document);
        const symbols = namespaceSymbols(catalog, document.uri, document.getText(), document.offsetAt(position));
        if (symbols) {
          return completionItems(catalog, undefined, symbols, true);
        }
        if (isSelfCompletion(document, position)) {
          const actor = enclosingActor(catalog, document.uri, document.offsetAt(position));
          if (actor) {
            return fieldCompletionItems(fieldsForState(catalog, actor.ownedState, actor.uri));
          }
        }
        const callable = enclosingCallable(catalog, document.uri, document.offsetAt(position));
        const actor = enclosingActor(catalog, document.uri, document.offsetAt(position));
        const fields = actor ? fieldCompletionItems(fieldsForState(catalog, actor.ownedState, actor.uri)) : [];
        return [
          ...parameterCompletionItems(callable?.parameters ?? []),
          ...clauseVariableCompletionItems(callable?.clauseVariables ?? [], callable?.name),
          ...fields,
          ...completionItems(catalog, actor, catalog.exports.get(document.uri.toString()) ?? new Map()),
        ];
      },
    }, '.', ':'),
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, position) {
        const scan = scanDocument(document.getText());
        const offset = document.offsetAt(position);
        const imported = scan.imports.find((item) => item.pathStart <= offset && offset <= item.pathEnd);
        if (imported) {
          const target = index.resolveImport(document.uri, imported.path);
          return target ? new vscode.Location(target, new vscode.Position(0, 0)) : undefined;
        }

        const word = wordAt(document, position);
        if (!word) {
          return undefined;
        }
        const catalog = await index.collect(document);
        if (followsSelfDot(document.getText(), document.offsetAt(word.range.start))) {
          const field = selfField(catalog, document.uri, document.offsetAt(word.range.start), word.value);
          if (field) {
            return declarationLocation(catalog, field);
          }
        }
        const reference = referenceAt(catalog, document.uri, document.offsetAt(word.range.start));
        const parameter = !reference?.qualified && visibleParameter(catalog, document.uri, document.offsetAt(word.range.start), word.value);
        if (parameter) {
          return declarationLocation(catalog, parameter);
        }
        if (!reference?.target) {
          return undefined;
        }
        return declarationLocation(catalog, reference.target);
      },
    }),
    vscode.languages.registerHoverProvider(selector, {
      async provideHover(document, position) {
        const word = wordAt(document, position);
        if (!word) {
          return undefined;
        }

        const catalog = await index.collect(document);
        if (followsSelfDot(document.getText(), document.offsetAt(word.range.start))) {
          const field = selfField(catalog, document.uri, document.offsetAt(word.range.start), word.value);
          if (field) {
            return fieldHover(field);
          }
        }

        const reference = referenceAt(catalog, document.uri, document.offsetAt(word.range.start));
        const parameter = !reference?.qualified && visibleParameter(catalog, document.uri, document.offsetAt(word.range.start), word.value);
        if (parameter) {
          return parameterHover(parameter);
        }

        const current = catalog.modules.find((module) => module.uri.toString() === document.uri.toString());
        const tokenIndex = current?.scan.tokens.findIndex((token) => token.start === document.offsetAt(word.range.start)) ?? -1;
        const builtin = current ? builtinCall(current.scan.tokens, tokenIndex) : undefined;
        if (builtin) {
          const markdown = new vscode.MarkdownString();
          markdown.appendCodeblock(builtin.signature, 'argent');
          markdown.appendMarkdown(`\n\n${builtin.documentation ?? 'Argent builtin'}`);
          return new vscode.Hover(markdown, word.range);
        }
        if (PRIMITIVE_TYPES.includes(word.value)) {
          const markdown = new vscode.MarkdownString(`Argent primitive type \`${word.value}\``);
          if (PRIMITIVE_DOCUMENTATION[word.value]) {
            markdown.appendMarkdown(`\n\n${PRIMITIVE_DOCUMENTATION[word.value]}`);
          }
          return new vscode.Hover(markdown, word.range);
        }

        return reference?.target ? declarationHover(reference.target) : undefined;
      },
    }),
    vscode.languages.registerDocumentLinkProvider(selector, {
      provideDocumentLinks(document) {
        return scanDocument(document.getText()).imports.flatMap((imported) => {
          const target = index.resolveImport(document.uri, imported.path);
          if (!target) {
            return [];
          }
          return [
            new vscode.DocumentLink(
              new vscode.Range(document.positionAt(imported.pathStart), document.positionAt(imported.pathEnd)),
              target,
            ),
          ];
        });
      },
    }),
    vscode.languages.registerDocumentSemanticTokensProvider(
      selector,
      {
        onDidChangeSemanticTokens: semanticChanges.event,
        async provideDocumentSemanticTokens(document) {
          const catalog = await index.collect(document);
          const current = catalog.modules.find((module) => module.uri.toString() === document.uri.toString());
          const builder = new vscode.SemanticTokensBuilder(semanticLegend);
          if (!current) {
            return builder.build();
          }

          const localDeclarations = catalog.declarations.filter(
            (item) => item.uri.toString() === document.uri.toString(),
          );
          const declarationsByStart = new Map(localDeclarations.map((item) => [item.start, item]));
          const parametersByStart = new Map(
            localDeclarations
              .filter(isCallable)
              .flatMap((item) => item.parameters ?? [])
              .map((parameter) => [parameter.start, parameter]),
          );
          const fieldsByStart = new Map(
            current.scan.declarations
              .filter((item) => item.kind === 'state')
              .flatMap((state) => state.fields ?? [])
              .map((field) => [field.start, field]),
          );
          for (const [tokenIndex, token] of current.scan.tokens.entries()) {
            if (token.kind !== 'ident') {
              continue;
            }

            const localDeclaration = declarationsByStart.get(token.start);
            const localField = fieldsByStart.get(token.start);
            const localParameter = parametersByStart.get(token.start);
            const referencedField = followsSelfDot(current.scan.source, token.start)
              ? selfField(catalog, document.uri, token.start, token.value)
              : undefined;
            const reference = referenceAt(catalog, document.uri, token.start, tokenIndex);
            const referencedParameter = !reference?.qualified && parameterInScope(catalog, document.uri, token.start, token.value);
            const declaration = localDeclaration ?? reference?.target;
            let type;
            let modifiers = [];

            if (localField || referencedField) {
              type = 'property';
              modifiers = localField ? ['declaration'] : [];
            } else if (localParameter || referencedParameter) {
              type = 'parameter';
              modifiers = localParameter ? ['declaration'] : [];
            } else if (declaration) {
              type = DECLARATION_SEMANTIC_KIND[declaration.kind];
              const alias = current.scan.imports.some((item) => item.aliasStart === token.start);
              modifiers = semanticModifiers(declaration, Boolean(localDeclaration || alias));
            } else if (PRIMITIVE_TYPES.includes(token.value)) {
              type = 'type';
              modifiers = ['defaultLibrary'];
            } else if (builtinCall(current.scan.tokens, tokenIndex)) {
              type = 'function';
              modifiers = ['defaultLibrary'];
            }

            if (type) {
              builder.push(
                new vscode.Range(document.positionAt(token.start), document.positionAt(token.end)),
                type,
                modifiers,
              );
            }
          }
          return builder.build();
        },
      },
      semanticLegend,
    ),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
