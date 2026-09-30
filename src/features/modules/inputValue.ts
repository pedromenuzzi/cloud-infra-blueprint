/**
 * Module inputs typed in the inspector or the "Add module" dialog: the text
 * someone types (no HCL quoting needed) → the expression written, and back.
 */
import { parseExpressionText } from '@/hcl/parser';
import { exprPreview, lit, ref } from '@/ir/expr';
import type { Expression, IR } from '@/ir/types';
import { looksLikeTraversal } from '@/features/editor/connections';

const NUMBER = /^-?\d+(?:\.\d+)?$/;
/** `var.x`, `module.vpc.private_subnets[0]`, `data.aws_ami.x.id`, `local.tags["a"]` */
const REF_TEXT = /^(?:var|local|module|data|each|count|path)\.[A-Za-z_][\w-]*(?:\[[^\]\s]*\]|\.[\w*-]+)*$/;

/** Should this typed text be written as a reference rather than a string? */
export function looksLikeRef(text: string, ir: IR): boolean {
  return REF_TEXT.test(text) || looksLikeTraversal(text, ir);
}

/** an input name Terraform accepts (a variable name) */
export const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * A value typed freely: `true` / `false`, numbers, `[…]` / `{…}` literals,
 * references (`var.x`, `module.vpc.vpc_id`, a resource's attribute) —
 * anything else is a string (quotes around it are optional).
 */
export function parseInputText(text: string, ir: IR): Expression {
  const t = text.trim();
  if (t === 'true' || t === 'false') return lit(t === 'true');
  if (t === 'null') return lit(null);
  if (NUMBER.test(t) && String(Number(t)) === t) return lit(Number(t));
  if (/^"(?:[^"\\]|\\.)*"$/.test(t) || /^[[{]/.test(t)) {
    const parsed = parseExpressionText(t);
    if (parsed && parsed.kind !== 'raw') return parsed;
  }
  if (looksLikeRef(t, ir)) return ref(t);
  return lit(t);
}

/** What an input's field shows for editing: literals as plain text, null for anything else (edit in code). */
export function editableText(e: Expression): string | null {
  if (e.kind !== 'literal' || e.value === null) return null;
  return String(e.value);
}

/**
 * The value an edited literal field commits, keeping the literal's type: a
 * number stays a number while the text is one, a string stays a string
 * unless it becomes a reference. Null: nothing changed.
 */
export function commitLiteral(original: Expression, text: string, ir: IR): Expression | null {
  if (original.kind !== 'literal') return null;
  const t = text.trim();
  let next: Expression;
  if (typeof original.value === 'number') next = NUMBER.test(t) ? lit(Number(t)) : lit(t);
  else if (typeof original.value === 'boolean') next = lit(t === 'true');
  else next = looksLikeRef(t, ir) ? ref(t) : lit(text);
  return exprPreview(next) === exprPreview(original) && next.kind === original.kind ? null : next;
}

/** A starting value for an input the module requires, from its `type` constraint. */
export function placeholderFor(type: string | undefined): Expression {
  const t = (type ?? '').replace(/\s/g, '');
  if (t === 'number') return lit(0);
  if (t === 'bool') return lit(false);
  if (/^(list|set|tuple)\(/.test(t) || t === 'list' || t === 'set') return { kind: 'list', items: [] };
  if (/^(map|object)\(/.test(t) || t === 'map') return { kind: 'object', fields: {} };
  return lit('');
}
