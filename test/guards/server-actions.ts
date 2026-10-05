import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { admin } from 'better-auth/plugins/admin';
import { parseSync } from 'oxc-parser';
import { ac, roleCan, roles, type Permissions } from '../../lib/server/auth/permissions';

/*
 * The scanner behind test/guards/require-permission.guard.test.ts. TypeScript
 * 7 has no JS compiler API, so it parses with oxc-parser (the parser behind
 * oxlint) and walks the ESTree.
 */

type Node = { type: string; [key: string]: unknown };

/** Top-level directories that hold no app code; dot-directories and node_modules are skipped everywhere. */
const NOT_APP_CODE = new Set(['e2e', 'test', 'docs', 'design-src', 'public', 'playwright-report', 'test-results']);
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const ADMIN_ROUTE = /^app\/api\/admin\/(?:.*\/)?route\.[jt]sx?$/;
const NOT_FIRST = 'does not start with await requirePermission()';
const FALLS_THROUGH = 'a failed requirePermission() can run more code (its catch must be one return or throw statement; no finally)';
const NOT_LITERAL = 'requirePermission() must take an object literal of plain keys and string arrays';

/** Every source file under `dir` except tests and type declarations. */
function files(dir: string, top = false): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      const skip = e.name === 'node_modules' || e.name.startsWith('.') || (top && NOT_APP_CODE.has(e.name));
      return skip ? [] : files(path);
    }
    return SOURCE.test(e.name) && !/\.test\.[jt]sx?$/.test(e.name) && !/\.d\.[cm]?ts$/.test(e.name) ? [path] : [];
  });
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!isNode(node)) return;
  visit(node);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') walk(value, visit);
}

const isFunction = (n: unknown): n is Node =>
  isNode(n) && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type);

/** Statements of a function body, directives ('use server') left out. */
function statements(fn: Node): Node[] {
  const body = fn.body as Node | null;
  if (!body || body.type !== 'BlockStatement') return [];
  return (body.body as Node[]).filter((s) => !(s.type === 'ExpressionStatement' && typeof s.directive === 'string'));
}

/** `await requirePermission(…)` as a statement, or as the one initializer of a declaration. */
function awaitsCheck(statement: Node | undefined): boolean {
  const awaited = (e: unknown): boolean => {
    if (!isNode(e) || e.type !== 'AwaitExpression' || !isNode(e.argument) || e.argument.type !== 'CallExpression') return false;
    const callee = e.argument.callee as Node;
    return callee.type === 'Identifier' && callee.name === 'requirePermission';
  };
  if (statement?.type === 'ExpressionStatement') return awaited(statement.expression);
  if (statement?.type === 'VariableDeclaration') {
    const declarations = statement.declarations as Node[];
    return declarations.length === 1 && awaited(declarations[0].init);
  }
  return false;
}

/**
 * Why a function does not check first, or null. Its first statement must await
 * requirePermission(…) (not call it without await, not under a condition), or
 * be a try that starts so. That try's catch must be exactly one return or
 * throw statement: then no code after the try runs when the check fails, and
 * neither does anything else in the catch (a write placed before the return
 * would run for a caller the check just refused). It may have no finally,
 * which would run anyway.
 */
function firstStatementProblem(fn: Node): string | null {
  const [first] = statements(fn);
  if (first?.type !== 'TryStatement') return awaitsCheck(first) ? null : NOT_FIRST;
  if (!awaitsCheck(((first.block as Node).body as Node[])[0])) return NOT_FIRST;
  const handler = first.handler as Node | null;
  const caught = handler ? ((handler.body as Node).body as Node[]) : [];
  const exits = !handler || (caught.length === 1 && ['ReturnStatement', 'ThrowStatement'].includes(caught[0].type));
  return exits && !first.finalizer ? null : FALLS_THROUGH;
}

export function checksFirst(fn: Node): boolean {
  return firstStatementProblem(fn) === null;
}

function hasUseServer(fn: Node): boolean {
  const body = fn.body as Node | null;
  return (
    body?.type === 'BlockStatement' &&
    (body.body as Node[]).some((s) => s.type === 'ExpressionStatement' && s.directive === 'use server')
  );
}

/** name → function node for every exported binding of a module. */
export function exportedFunctions(program: Node): { name: string; fn: Node | null }[] {
  const locals = new Map<string, Node>();
  for (const s of program.body as Node[]) {
    const decl = s.type === 'ExportNamedDeclaration' ? (s.declaration as Node | null) : s;
    if (decl?.type === 'FunctionDeclaration' && decl.id) locals.set((decl.id as Node).name as string, decl);
    if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations as Node[]) if (isFunction(d.init)) locals.set((d.id as Node).name as string, d.init);
    }
  }
  const out: { name: string; fn: Node | null }[] = [];
  for (const s of program.body as Node[]) {
    if (s.type === 'ExportDefaultDeclaration') out.push({ name: 'default', fn: isFunction(s.declaration) ? s.declaration : null });
    if (s.type === 'ExportAllDeclaration') out.push({ name: '*', fn: null });
    if (s.type !== 'ExportNamedDeclaration' || s.exportKind === 'type') continue;
    const decl = s.declaration as Node | null;
    if (decl?.type === 'FunctionDeclaration') out.push({ name: (decl.id as Node).name as string, fn: decl });
    if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations as Node[]) out.push({ name: (d.id as Node).name as string, fn: isFunction(d.init) ? d.init : null });
    }
    for (const spec of (s.specifiers as Node[]) ?? []) {
      if (spec.exportKind === 'type') continue;
      const local = (spec.local as Node).name as string;
      out.push({ name: (spec.exported as Node).name as string, fn: s.source ? null : (locals.get(local) ?? null) });
    }
  }
  return out;
}

function parse(rel: string, source: string): Node {
  const { program, errors } = parseSync(rel, source);
  if (errors.length) throw new Error(`${rel}: parse error ${errors[0]?.message}`);
  return program as unknown as Node;
}

/** Problems in one source file (`rel` is relative to the repository root). */
export function checkActions(rel: string, source: string, publicActions: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const program = parse(rel, source);
  const fileLevel = (program.body as Node[]).some((s) => s.type === 'ExpressionStatement' && s.directive === 'use server');

  if (fileLevel) {
    for (const { name, fn } of exportedFunctions(program)) {
      if (publicActions.has(`${rel}#${name}`)) continue;
      const problem = fn ? firstStatementProblem(fn) : 'export the action as a function declared in this file';
      if (problem) problems.push(`${rel}#${name}: ${problem}`);
    }
  }
  walk(program, (n) => {
    const problem = isFunction(n) && hasUseServer(n) ? firstStatementProblem(n) : null;
    if (problem) {
      const name = ((n.id as Node | null)?.name as string | undefined) ?? 'anonymous';
      problems.push(`${rel}: inline 'use server' function ${name}: ${problem}`);
    }
  });
  if (ADMIN_ROUTE.test(rel)) {
    for (const { name, fn } of exportedFunctions(program)) {
      const problem = !HTTP_METHODS.has(name) ? null : fn ? firstStatementProblem(fn) : NOT_FIRST;
      if (problem) problems.push(`${rel}#${name}: ${problem}`);
    }
  }
  return problems;
}

/** Every source file of the repository that could hold app code, relative to `root`. */
const sourceFiles = (root: string) => files(root, true).map((f) => relative(root, f));

export function scanRepo(root: string, publicActions: ReadonlySet<string>): string[] {
  return sourceFiles(root).flatMap((rel) => {
    const source = readFileSync(join(root, rel), 'utf8');
    if (!source.includes('use server') && !ADMIN_ROUTE.test(rel)) return [];
    return checkActions(rel, source, publicActions);
  });
}

/** The files under `prefixes` whose first statement is 'use server' (Server Action modules), relative to `root`. */
export function actionFiles(root: string, prefixes: readonly string[]): string[] {
  return sourceFiles(root)
    .filter((rel) => prefixes.some((p) => rel.startsWith(p)))
    .filter((rel) => /^\s*['"]use server['"]/.test(readFileSync(join(root, rel), 'utf8')))
    .sort();
}

/** Allowlist entries ("file#export") that no longer name an exported function. */
export function publicActionsMissing(root: string, entries: readonly string[]): string[] {
  return entries.filter((entry) => {
    const [rel, name] = entry.split('#');
    let source: string;
    try {
      source = readFileSync(join(root, rel), 'utf8');
    } catch {
      return true;
    }
    return !exportedFunctions(parse(rel, source)).some((e) => e.name === name && e.fn);
  });
}

/*
 * The admin plugin's endpoints write staff accounts outside our transaction
 * and without our last-Admin check (lib/server/auth/staff.ts says why), so only
 * that file and the bootstrap script may call them. The list comes from the
 * plugin itself (15 endpoints in 1.7.7, adminUpdateUser among them), so an
 * upgrade that adds one is covered. Read from the syntax tree, so comments
 * that name an endpoint do not count.
 */
export const ADMIN_PLUGIN_ENDPOINTS: readonly string[] = Object.keys(admin({ ac, roles }).endpoints);
const ADMIN_PLUGIN_CALLERS = new Set(['lib/server/auth/staff.ts', 'scripts/create-admin.mjs']);

const isEndpoint = (name: unknown): name is string => typeof name === 'string' && ADMIN_PLUGIN_ENDPOINTS.includes(name);

const keyName = (property: Node): unknown => {
  const key = property.key as Node | undefined;
  return key?.type === 'Identifier' ? key.name : key?.type === 'Literal' ? key.value : undefined;
};

/** `x.api` or a bare `api`, through await, parentheses and TypeScript casts. */
function isApiObject(node: unknown): boolean {
  let n = node;
  while (isNode(n) && ['AwaitExpression', 'ParenthesizedExpression', 'TSAsExpression', 'TSNonNullExpression'].includes(n.type)) {
    n = n.type === 'AwaitExpression' ? n.argument : n.expression;
  }
  if (!isNode(n)) return false;
  if (n.type === 'Identifier') return n.name === 'api';
  return n.type === 'MemberExpression' && !n.computed && (n.property as Node).name === 'api';
}

/**
 * Endpoints read off an `.api` object: `auth.api.setRole`, `api['setRole']`,
 * `const { setRole } = auth.api` and `const { api: { setRole } } = auth`.
 */
function endpointUses(program: Node): string[] {
  const found: string[] = [];
  const take = (pattern: unknown) => {
    if (!isNode(pattern) || pattern.type !== 'ObjectPattern') return;
    for (const property of pattern.properties as Node[]) {
      const name = keyName(property);
      if (property.type === 'Property' && isEndpoint(name)) found.push(name);
    }
  };
  walk(program, (n) => {
    if (n.type === 'MemberExpression' && isApiObject(n.object)) {
      const property = n.property as Node;
      const name = n.computed ? (property.type === 'Literal' ? property.value : undefined) : property.name;
      if (isEndpoint(name)) found.push(name);
    }
    if (n.type === 'VariableDeclarator' && isApiObject(n.init)) take(n.id);
    if (n.type === 'AssignmentExpression' && isApiObject(n.right)) take(n.left);
    if (n.type === 'ObjectPattern') {
      for (const property of n.properties as Node[]) if (property.type === 'Property' && keyName(property) === 'api') take(property.value);
    }
  });
  return found;
}

export function adminPluginCallsIn(rel: string, source: string): string[] {
  if (ADMIN_PLUGIN_CALLERS.has(rel) || !ADMIN_PLUGIN_ENDPOINTS.some((name) => source.includes(name))) return [];
  return endpointUses(parse(rel, source)).map((name) => `${rel}: auth.api.${name}`);
}

export function adminPluginCalls(root: string): string[] {
  return sourceFiles(root).flatMap((rel) => adminPluginCallsIn(rel, readFileSync(join(root, rel), 'utf8')));
}

/** The first requirePermission(...) call inside a node. */
function requirePermissionCall(node: unknown): Node | null {
  let call: Node | null = null;
  walk(node, (n) => {
    const callee = n.type === 'CallExpression' ? (n.callee as Node) : null;
    if (!call && callee?.type === 'Identifier' && callee.name === 'requirePermission') call = n;
  });
  return call;
}

/**
 * `{ user: ['set-role'] }` as written in the source, or null if it is anything
 * but plain keys and string arrays. A computed key (`{ [r]: ['update'] }`)
 * names whatever `r` holds at run time, not the resource "r", so it is not
 * a literal this check can read.
 */
function literalPermissions(arg: unknown): Permissions | null {
  if (!isNode(arg) || arg.type !== 'ObjectExpression') return null;
  const out: Record<string, string[]> = {};
  for (const prop of arg.properties as Node[]) {
    const key = prop.key as Node | undefined;
    const value = prop.value as Node | undefined;
    const name = key?.type === 'Identifier' ? key.name : key?.type === 'Literal' ? key.value : undefined;
    if (prop.type !== 'Property' || prop.computed || typeof name !== 'string' || value?.type !== 'ArrayExpression') return null;
    const actions = (value.elements as Node[]).map((e) => (e?.type === 'Literal' && typeof e.value === 'string' ? e.value : null));
    if (actions.some((a) => a === null)) return null;
    out[name] = actions as string[];
  }
  return out as Permissions;
}

/**
 * Each exported action of a file → the permission literal its first
 * requirePermission() asks for (null when that is not a plain literal).
 */
export function actionPermissions(
  root: string,
  rel: string,
  read: (rel: string) => string = (r) => readFileSync(join(root, r), 'utf8'),
): Record<string, Permissions | null> {
  return Object.fromEntries(
    exportedFunctions(parse(rel, read(rel))).map(({ name, fn }) => {
      const [first] = fn ? statements(fn) : [];
      const scope = first?.type === 'TryStatement' ? ((first.block as Node).body as Node[])[0] : first;
      return [name, literalPermissions((requirePermissionCall(scope)?.arguments as unknown[] | undefined)?.[0])];
    }),
  );
}

/**
 * Every action in these files must ask for a permission the Editor lacks,
 * written as a literal so this check can read it: a typo or a shared
 * permission would otherwise open an Admin-only action to Editors.
 */
export function adminOnlyProblems(
  root: string,
  rels: readonly string[],
  read: (rel: string) => string = (rel) => readFileSync(join(root, rel), 'utf8'),
): string[] {
  return rels.flatMap((rel) =>
    Object.entries(actionPermissions(root, rel, read)).flatMap(([name, permissions]) => {
      if (!permissions) return [`${rel}#${name}: ${NOT_LITERAL}`];
      if (roleCan('editor', permissions)) return [`${rel}#${name}: an Editor passes requirePermission(${JSON.stringify(permissions)})`];
      return [];
    }),
  );
}
