import { parse } from '@babel/parser';

const JAVASCRIPT_LANGUAGES = new Set(['javascript', 'js', 'node.js', 'nodejs', 'typescript', 'ts']);
const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);
const IGNORED_KEYS = new Set([
  'loc', 'start', 'end', 'tokens', 'comments', 'leadingComments',
  'trailingComments', 'innerComments', 'extra',
]);

function getKeyName(key) {
  if (key?.type === 'Identifier' || key?.type === 'PrivateName') {
    return key.id?.name || key.name;
  }
  if (key?.type === 'StringLiteral' || key?.type === 'NumericLiteral') {
    return String(key.value);
  }
  return null;
}

export function buildAstGraph(source, language, fileName) {
  const normalizedLanguage = String(language || '').toLowerCase();
  const isAutoLanguage = ['auto', 'auto-detect', ''].includes(normalizedLanguage);
  if (!JAVASCRIPT_LANGUAGES.has(normalizedLanguage) && !isAutoLanguage) {
    return {
      graphStatus: 'unsupported',
      graphMessage: `AST parsing is currently available for JavaScript and TypeScript, not ${language || 'this language'}.`,
      nodes: [],
    };
  }

  if (!String(source || '').trim()) {
    return { graphStatus: 'no-source', graphMessage: 'No source code was provided to parse.', nodes: [] };
  }

  let ast;
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: ['jsx', 'typescript'],
    });
  } catch (error) {
    return {
      graphStatus: 'parse-error',
      graphMessage: `Could not parse source${error.loc?.line ? ` near line ${error.loc.line}` : ''}.`,
      nodes: [],
    };
  }

  const fileId = `file:${fileName}`;
  const nodes = new Map();
  const importedLocals = new Map();
  const callableIds = new Map();
  const pendingCalls = [];

  function addNode(id, label, type, line, detail) {
    if (!nodes.has(id)) {
      nodes.set(id, { id, label, type, line, detail, deps: [] });
    }
    return id;
  }

  function addEdge(fromId, toId) {
    const from = nodes.get(fromId);
    if (from && nodes.has(toId) && !from.deps.includes(toId)) {
      from.deps.push(toId);
    }
  }

  function addCallableName(name, id) {
    const ids = callableIds.get(name) || [];
    ids.push(id);
    callableIds.set(name, ids);
  }

  addNode(fileId, fileName, 'file', 1, 'Parsed source file');

  function visit(node, ownerId = fileId, parent = null, key = '', scopeName = '') {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'ImportDeclaration') {
      const importPath = node.source.value;
      const importId = `import:${importPath}`;
      addNode(importId, importPath, 'import', node.loc?.start.line, 'Imported module');
      addEdge(fileId, importId);
      for (const specifier of node.specifiers) {
        importedLocals.set(specifier.local.name, importId);
      }
    }

    let nextOwnerId = ownerId;
    let nextScopeName = scopeName;

    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const name = node.id?.name || `AnonymousClass@${node.loc?.start.line || node.start}`;
      const classId = `class:${name}`;
      addNode(classId, name, 'class', node.loc?.start.line, 'Class declaration');
      addEdge(ownerId, classId);
      nextOwnerId = classId;
      nextScopeName = name;
    } else if (FUNCTION_TYPES.has(node.type)) {
      const methodName = ['ObjectMethod', 'ClassMethod', 'ClassPrivateMethod'].includes(node.type)
        ? getKeyName(node.key)
        : null;
      const variableName = parent?.type === 'VariableDeclarator' ? parent.id?.name : null;
      const name = node.id?.name
        || variableName
        || (methodName ? `${scopeName ? `${scopeName}.` : ''}${methodName}` : null)
        || `callback@${node.loc?.start.line || node.start}`;
      const functionId = `function:${name}`;
      addNode(functionId, name, 'function', node.loc?.start.line, `${node.type} declaration`);
      addEdge(ownerId, functionId);
      addCallableName(name, functionId);
      if (methodName) addCallableName(methodName, functionId);
      nextOwnerId = functionId;
      nextScopeName = name;
    } else if (node.type === 'VariableDeclarator' && ownerId === fileId && node.id?.type === 'Identifier') {
      const valueType = node.init?.type;
      if (!FUNCTION_TYPES.has(valueType)) {
        const variableId = `variable:${node.id.name}`;
        addNode(variableId, node.id.name, 'variable', node.loc?.start.line, 'Module-level variable');
        addEdge(fileId, variableId);
      }
    }

    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee;
      const directName = callee?.type === 'Identifier' ? callee.name : null;
      const memberName = callee?.type === 'MemberExpression' ? getKeyName(callee.property) : null;
      const importedName = callee?.type === 'MemberExpression' && callee.object?.type === 'Identifier'
        ? callee.object.name
        : directName;
      pendingCalls.push({
        fromId: ownerId,
        name: directName || memberName,
        importId: importedLocals.get(importedName),
      });
    }

    for (const [childKey, value] of Object.entries(node)) {
      if (IGNORED_KEYS.has(childKey) || childKey === 'type') continue;
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (child && typeof child === 'object' && typeof child.type === 'string') {
          visit(child, nextOwnerId, node, childKey, nextScopeName);
        }
      }
    }
  }

  visit(ast.program);

  for (const call of pendingCalls) {
    if (call.importId) addEdge(call.fromId, call.importId);
    const targetId = call.name && callableIds.get(call.name)?.[0];
    if (targetId) addEdge(call.fromId, targetId);
  }

  const nodesList = [...nodes.values()];
  const parserErrors = ast.errors || [];
  const graphMessage = parserErrors.length
    ? `Showing a partial graph; the parser found ${parserErrors.length} syntax issue${parserErrors.length === 1 ? '' : 's'}.`
    : '';

  return {
    graphStatus: parserErrors.length ? 'partial' : 'ready',
    graphMessage,
    nodes: nodesList,
  };
}