import { IntlMessageFormat } from 'intl-messageformat';

/*
 * ICU MessageFormat checks for the registry and the content editors (spec
 * §7.4: "Lưu bản dịch mà các biến {placeholder} hoặc ICU khác bản EN thì
 * server từ chối"). Phase 7 edits English only, so a value is checked against
 * the registry's declared vars; phase 8 compares a translation with its
 * English text through the same function (messageArgs of both).
 *
 * Tags are off (ignoreTag): the guest site renders strings as React text, so
 * "<b>" is two characters, never markup, and a stray "<" must not be a
 * syntax error.
 */

/** Element kinds of @formatjs/icu-messageformat-parser that name an argument: argument, number, date, time, select, plural. */
const NAMED = new Set([1, 2, 3, 4, 5, 6]);
const SELECT = 5;
const PLURAL = 6;

type Element = { type: number; value?: unknown; options?: Record<string, { value: Element[] }> };

export type MessageProblem =
  /** Not valid ICU (an unclosed brace, a plural without `other`, …). */
  | { code: 'syntax'; detail: string }
  /** A declared variable the text no longer uses: the guest would lose that information. */
  | { code: 'missing_var'; name: string }
  /** A {name} the code never fills: the guest would see the braces. */
  | { code: 'unknown_var'; name: string }
  /** A plural or select without its `other` branch. */
  | { code: 'no_other'; name: string };

function ast(text: string): Element[] {
  return new IntlMessageFormat(text, 'en', undefined, { ignoreTag: true }).getAst() as unknown as Element[];
}

function collect(elements: Element[], names: Set<string>, problems: MessageProblem[]): void {
  for (const el of elements) {
    if (NAMED.has(el.type) && typeof el.value === 'string') names.add(el.value);
    if ((el.type === SELECT || el.type === PLURAL) && el.options) {
      if (!('other' in el.options)) problems.push({ code: 'no_other', name: String(el.value) });
      for (const option of Object.values(el.options)) collect(option.value, names, problems);
    }
  }
}

/** The argument names a message uses, sorted; throws on invalid ICU. */
export function messageArgs(text: string): string[] {
  const names = new Set<string>();
  collect(ast(text), names, []);
  return [...names].sort();
}

/** Why `text` cannot be saved for a key that declares `vars`, or [] when it can. */
export function checkMessage(text: string, vars: readonly string[] = []): MessageProblem[] {
  let elements: Element[];
  try {
    elements = ast(text);
  } catch (err) {
    return [{ code: 'syntax', detail: err instanceof Error ? err.message : String(err) }];
  }
  const names = new Set<string>();
  const problems: MessageProblem[] = [];
  collect(elements, names, problems);
  for (const v of vars) if (!names.has(v)) problems.push({ code: 'missing_var', name: v });
  for (const n of names) if (!vars.includes(n)) problems.push({ code: 'unknown_var', name: n });
  return problems;
}

/** Vietnamese, for the admin field error (spec §7.3: admin speaks Vietnamese). */
export function describeProblem(p: MessageProblem): string {
  switch (p.code) {
    case 'syntax':
      return 'Cú pháp ICU không hợp lệ (kiểm tra dấu { } và nhánh other).';
    case 'missing_var':
      return `Thiếu biến {${p.name}}: phải giữ nguyên biến này.`;
    case 'unknown_var':
      return `Biến {${p.name}} không tồn tại ở chuỗi này. Chỉ dùng các biến được liệt kê.`;
    case 'no_other':
      return `Nhánh số nhiều/chọn của {${p.name}} phải có nhánh other.`;
  }
}
