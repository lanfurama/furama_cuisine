import { IntlMessageFormat } from 'intl-messageformat';
import { usesIcuSyntax } from './format';

/*
 * ICU MessageFormat checks for the registry and the content editors (spec
 * §7.4: "Lưu bản dịch mà các biến {placeholder} hoặc ICU khác bản EN thì
 * server từ chối"). A value is checked against the registry's declared vars
 * (names) and against the English text's arguments (names and types): a
 * translation that turns {count, plural, …} into {count, date} would format
 * the guest's party size as a date.
 *
 * Tags are off (ignoreTag): the guest site renders strings as React text, so
 * "<b>" is two characters, never markup, and a stray "<" must not be a
 * syntax error.
 *
 * A plain template ({name} placeholders only) is filled by formatMessage's
 * replace, where an apostrophe is a character: it is parsed here with its
 * apostrophes doubled, so "It's '{name}'" uses {name} as the guest sees it
 * (phase-7A ledger A3), not ICU's quoting.
 */

/** Element kinds of @formatjs/icu-messageformat-parser that name an argument. */
const KIND: Record<number, ArgType> = { 1: 'string', 2: 'number', 3: 'date', 4: 'time', 5: 'select', 6: 'plural' };
const SELECT = 5;
const PLURAL = 6;

export type ArgType = 'string' | 'number' | 'date' | 'time' | 'plural' | 'select' | 'selectordinal';
export type MessageArg = { name: string; type: ArgType };

type Element = { type: number; value?: unknown; pluralType?: string; options?: Record<string, { value: Element[] }> };

export type MessageProblem =
  /** Not valid ICU (an unclosed brace, a plural or select without `other`, …). */
  | { code: 'syntax'; detail: string }
  /** A declared variable the text no longer uses: the guest would lose that information. */
  | { code: 'missing_var'; name: string }
  /** A {name} the code never fills: the guest would see the braces. */
  | { code: 'unknown_var'; name: string }
  /** A variable used as another kind than in the English text ({count} where English has {count, plural, …}). */
  | { code: 'var_type'; name: string; expected: string; actual: string };

function ast(text: string): Element[] {
  const source = usesIcuSyntax(text) ? text : text.replace(/'/g, "''");
  return new IntlMessageFormat(source, 'en', undefined, { ignoreTag: true }).getAst() as unknown as Element[];
}

function collect(elements: Element[], args: Map<string, Set<ArgType>>): void {
  for (const el of elements) {
    const kind = KIND[el.type];
    if (kind && typeof el.value === 'string') {
      const type = el.type === PLURAL && el.pluralType === 'ordinal' ? 'selectordinal' : kind;
      args.set(el.value, (args.get(el.value) ?? new Set()).add(type));
    }
    if ((el.type === SELECT || el.type === PLURAL) && el.options) {
      for (const option of Object.values(el.options)) collect(option.value, args);
    }
  }
}

function argMap(text: string): Map<string, Set<ArgType>> {
  const args = new Map<string, Set<ArgType>>();
  collect(ast(text), args);
  return args;
}

/** The arguments a message uses, by name then type; throws on invalid ICU. */
export function messageArgs(text: string): MessageArg[] {
  return [...argMap(text)]
    .flatMap(([name, types]) => [...types].map((type) => ({ name, type })))
    .sort((a, b) => (a.name === b.name ? a.type.localeCompare(b.type) : a.name < b.name ? -1 : 1));
}

const typesOf = (args: readonly MessageArg[], name: string) =>
  args
    .filter((a) => a.name === name)
    .map((a) => a.type)
    .sort()
    .join(', ');

/**
 * Why `text` cannot be saved for a key that declares `vars`, or [] when it
 * can. `reference`: the English text's arguments (messageArgs), whose types a
 * shared variable must keep.
 */
export function checkMessage(text: string, vars: readonly string[] = [], reference?: readonly MessageArg[]): MessageProblem[] {
  let args: MessageArg[];
  try {
    args = messageArgs(text);
  } catch (err) {
    return [{ code: 'syntax', detail: err instanceof Error ? err.message : String(err) }];
  }
  const names = new Set(args.map((a) => a.name));
  const problems: MessageProblem[] = [];
  for (const v of vars) if (!names.has(v)) problems.push({ code: 'missing_var', name: v });
  for (const n of names) if (!vars.includes(n)) problems.push({ code: 'unknown_var', name: n });
  if (reference) {
    for (const n of names) {
      const expected = typesOf(reference, n);
      const actual = typesOf(args, n);
      if (expected && expected !== actual) problems.push({ code: 'var_type', name: n, expected, actual });
    }
  }
  return problems;
}

const TYPE_LABELS: Record<ArgType, string> = {
  string: 'chữ',
  number: 'số',
  date: 'ngày',
  time: 'giờ',
  plural: 'số nhiều (plural)',
  select: 'chọn (select)',
  selectordinal: 'thứ tự (selectordinal)',
};
const typeLabel = (types: string) =>
  types
    .split(', ')
    .map((t) => TYPE_LABELS[t as ArgType] ?? t)
    .join(', ');

/** Vietnamese, for the admin field error (spec §7.3: admin speaks Vietnamese). */
export function describeProblem(p: MessageProblem): string {
  switch (p.code) {
    case 'syntax':
      return 'Cú pháp ICU không hợp lệ (kiểm tra dấu { } và nhánh other).';
    case 'missing_var':
      return `Thiếu biến {${p.name}}: phải giữ nguyên biến này.`;
    case 'unknown_var':
      return `Biến {${p.name}} không tồn tại ở chuỗi này. Chỉ dùng các biến được liệt kê.`;
    case 'var_type':
      return `Biến {${p.name}} phải dùng kiểu như bản tiếng Anh (${typeLabel(p.expected)}), không phải ${typeLabel(p.actual)}.`;
  }
}
