import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSync } from 'oxc-parser';

/*
 * The scanner behind test/guards/guest-text.guard.test.ts (spec §13 "mọi chữ
 * khách nhìn thấy đều nằm trong registry hoặc bảng nội dung"). It parses the
 * guest site's source with oxc-parser (TypeScript 7 has no JS compiler API)
 * and reports every literal that reads like words a guest could see:
 *
 *   1. JSX text with a letter in it ("Explore by Cuisine");
 *   2. a string in a JSX attribute that is not a known non-text attribute
 *      (aria-label="Close", label="Location", placeholder="…"; className,
 *      href, type and the like are code);
 *   3. any other string or template part that looks like prose: two words,
 *      a capitalised word or an all-capitals word ('View restaurant',
 *      'Today', 'RESULTS', `${n} restaurants →`).
 *
 * Text that comes from t()/strings[...] or from the database is an
 * expression, never a literal, so it is invisible here by construction.
 * Glyphs (→ × · —), numbers and punctuation have no letters and pass.
 * What remains must be listed as locked (brand text, technical tokens) or
 * pending (phase 7 still has to move it), each with its reason or key.
 */

type Node = { type: string; start: number; end: number; [key: string]: unknown };

export type Finding = { file: string; line: number; kind: 'jsx-text' | 'attribute' | 'string'; text: string; attr?: string };

/** The guest site's source: what renders under app/(site), and the client code and helpers it builds text with. */
export const GUEST_SOURCES = [
  'components',
  'app/(site)',
  'app/global-not-found.tsx',
  'app/global-error.tsx',
  'lib/content',
  'lib/booking',
  'lib/booking.ts',
  'lib/booking-errors.ts',
  'lib/motion.tsx',
] as const;

/** JSX attributes whose string is never shown to a guest: element plumbing, enums and URLs. */
export const NON_TEXT_ATTRIBUTES = new Set([
  'className',
  'id',
  'key',
  'type',
  'role',
  'rel',
  'target',
  'href',
  'src',
  'sizes',
  'media',
  'loading',
  'decoding',
  'fetchPriority',
  'autoComplete',
  'inputMode',
  'name',
  'htmlFor',
  'method',
  'action',
  'enterKeyHint',
  'lang',
  'dir',
  'tabIndex',
  'aria-hidden',
  'aria-modal',
  'aria-haspopup',
  'aria-controls',
  'aria-expanded',
  'aria-current',
  'aria-live',
  'aria-describedby',
  'aria-labelledby',
  'aria-pressed',
  // Component props that take an enum value, never words.
  'view',
  'variant',
  'kind',
  'tone',
]);

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const LETTER = /\p{L}/u;

function sourceFiles(path: string): string[] {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [];
  }
  if (stat.isFile()) return SOURCE.test(path) && !/\.test\.[jt]sx?$/.test(path) && !/\.d\.[cm]?ts$/.test(path) ? [path] : [];
  return readdirSync(path, { withFileTypes: true }).flatMap((e) => (e.name.startsWith('.') ? [] : sourceFiles(join(path, e.name))));
}

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && typeof (v as Node).type === 'string';

function walk(node: unknown, visit: (n: Node, parent: Node | null, key: string) => void, parent: Node | null = null, key = ''): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit, parent, key));
  if (!isNode(node)) return;
  visit(node, parent, key);
  for (const [k, v] of Object.entries(node)) if (k !== 'parent') walk(v, visit, node, k);
}

/** Words a guest could read: two words, a capitalised word or an all-capitals word. */
export function looksLikeProse(text: string): boolean {
  if (!LETTER.test(text)) return false;
  return /\p{L}[\p{L}'’.,!?…]*[\s ]+\S*\p{L}/u.test(text) || /^\s*\p{Lu}\p{Ll}+/u.test(text) || /\b\p{Lu}{2,}\b/u.test(text);
}

function attributeName(attr: Node): string {
  const name = attr.name as Node & { name: unknown; namespace?: { name: string } };
  return name.type === 'JSXNamespacedName' ? `${name.namespace!.name}:${(name.name as { name: string }).name}` : String(name.name);
}

/**
 * A template part with a word standing alone (" restaurants →", " left", " of "): unlike a lone
 * string literal ('all', 'resort'), a word between interpolations is always meant to be read.
 */
export function templateHasWord(text: string): boolean {
  // A space before the word: `${n}px`, `tel:${x}` and `error.${code}` glue their word to code.
  return /\s\p{L}{2,}(?=[\s.,!?…→]|$)/u.test(text);
}

/** A non-text attribute's value, whatever expression builds it: className={a ? 'x y' : 'z'}. */
function underNonTextAttribute(ancestors: Node[]): boolean {
  return ancestors.some((a) => {
    if (a.type !== 'JSXAttribute') return false;
    const attr = attributeName(a);
    return NON_TEXT_ATTRIBUTES.has(attr) || attr.startsWith('data-');
  });
}

/**
 * A literal that becomes rendered text as it is: a JSX child or a template slot, reached only through
 * ?: and || / ?? (`{name || 'you'}`, `${n === 1 ? 'guest' : 'guests'}`). Catches lone lowercase words,
 * which the prose rule leaves alone because most lone words are code ('all', 'resort').
 */
function rendersDirectly(ancestors: Node[]): boolean {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'ConditionalExpression' || a.type === 'LogicalExpression' || a.type === 'ParenthesizedExpression') continue;
    if (a.type === 'JSXExpressionContainer') return ancestors[i - 1]?.type !== 'JSXAttribute';
    return a.type === 'TemplateLiteral';
  }
  return false;
}

/** A string that is code by where it sits: a module path, a directive, an object key, a thrown error, a console call. */
function isCodePosition(parent: Node | null, key: string, ancestors: Node[]): boolean {
  if (!parent) return false;
  if (underNonTextAttribute(ancestors)) return true;
  if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(parent.type)) return true;
  if (parent.type === 'ExpressionStatement' && typeof parent.directive === 'string') return true;
  if ((parent.type === 'Property' || parent.type === 'PropertyDefinition') && key === 'key') return true;
  if (parent.type === 'MemberExpression' && key === 'property') return true;
  if (parent.type === 'TSLiteralType' || parent.type.startsWith('TS')) return true;
  return ancestors.some(
    (a) =>
      a.type === 'NewExpression' && (a.callee as Node).type === 'Identifier' && /Error$/.test((a.callee as { name: string }).name) ||
      a.type === 'ThrowStatement' ||
      (a.type === 'CallExpression' &&
        (a.callee as Node).type === 'MemberExpression' &&
        ((a.callee as { object: Node }).object as { name?: string }).name === 'console'),
  );
}

export function scanFile(file: string, root = process.cwd()): Finding[] {
  const src = readFileSync(join(root, file), 'utf8');
  const { program, errors } = parseSync(file, src);
  if (errors.length) throw new Error(`${file}: ${errors[0].message}`);
  const lineAt = (pos: number) => src.slice(0, pos).split('\n').length;
  const out: Finding[] = [];
  const stack: Node[] = [];

  const visit = (node: unknown, parent: Node | null, key: string): void => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, parent, key));
    if (!isNode(node)) return;
    if (node.type === 'JSXText') {
      const text = String(node.value).replace(/\s+/g, ' ').trim();
      if (LETTER.test(text)) out.push({ file, line: lineAt(node.start), kind: 'jsx-text', text });
    } else if (node.type === 'Literal' && typeof node.value === 'string') {
      const text = node.value.replace(/\s+/g, ' ').trim();
      if (parent?.type === 'JSXAttribute') {
        const attr = attributeName(parent);
        if (LETTER.test(text) && !NON_TEXT_ATTRIBUTES.has(attr) && !attr.startsWith('data-'))
          out.push({ file, line: lineAt(node.start), kind: 'attribute', text, attr });
      } else if (!isCodePosition(parent, key, stack) && (looksLikeProse(node.value) || (LETTER.test(text) && rendersDirectly(stack)))) {
        out.push({ file, line: lineAt(node.start), kind: 'string', text });
      }
    } else if (node.type === 'TemplateElement') {
      const cooked = String((node.value as { cooked: string }).cooked ?? '');
      if (!isCodePosition(stack.at(-1) ?? null, 'quasis', stack) && (looksLikeProse(cooked) || templateHasWord(cooked)))
        out.push({ file, line: lineAt(node.start), kind: 'string', text: cooked.replace(/\s+/g, ' ').trim() });
    }
    stack.push(node);
    for (const [k, v] of Object.entries(node)) if (k !== 'parent') visit(v, node, k);
    stack.pop();
  };
  visit(program, null, '');
  return out;
}

export function scanGuestText(root = process.cwd()): Finding[] {
  return GUEST_SOURCES.flatMap((p) => sourceFiles(join(root, p)))
    .map((abs) => relative(root, abs))
    .sort()
    .flatMap((file) => scanFile(file, root));
}

/** How the allowlists name a finding: file and text, no line number, so moving code does not churn the lists. */
export const findingId = (f: Pick<Finding, 'file' | 'text'>) => `${f.file}: ${f.text}`;

// walk is exported for the editing-screens guard, which reads JSX props the same way.
export { walk };
