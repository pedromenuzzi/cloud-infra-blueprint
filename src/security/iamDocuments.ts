/**
 * IAM policies written as `data "aws_iam_policy_document"`: a statement that
 * allows every action (`"*"`) on every resource (`"*"`) is full administrator
 * access. Flagged only when the audit can be sure from the code alone: the
 * statement's `effect` is Allow (or left to its default), its `actions` and
 * `resources` are literal lists holding `"*"`, it has no `condition`,
 * `not_actions` or `not_resources`, and something in the project reads the
 * document (a policy, a role, a bucket policy…). Anything built from
 * expressions or `dynamic` blocks is left alone.
 */
import { dataReferrers } from '@/ir/dataSources';
import type { DataNode, Expression, IR } from '@/ir/types';

export interface WildcardStatement {
  document: DataNode;
  /** 0-based position of the statement among the document's `statement` blocks */
  index: number;
  /** blocks that read the document */
  readers: string[];
}

/** the literal strings of a list, or null when any item (or the list) is an expression */
function literalStrings(e: Expression | undefined): string[] | null {
  if (!e || e.kind !== 'list') return null;
  const out: string[] = [];
  for (const item of e.items) {
    if (item.kind !== 'literal' || typeof item.value !== 'string') return null;
    out.push(item.value);
  }
  return out;
}

function allowsEverything(statement: Record<string, Expression>): boolean {
  const effect = statement.effect;
  if (effect !== undefined && !(effect.kind === 'literal' && effect.value === 'Allow')) return false;
  if (statement.not_actions || statement.not_resources || statement.condition) return false;
  const actions = literalStrings(statement.actions);
  const resources = literalStrings(statement.resources);
  if (!actions || !resources) return false;
  return actions.some((a) => a === '*' || a === '*:*') && resources.includes('*');
}

/** every statement of the project's IAM policy documents that grants `"*"` on `"*"` and is used */
export function wildcardStatements(ir: IR): WildcardStatement[] {
  const out: WildcardStatement[] = [];
  for (const d of ir.data) {
    if (d.type !== 'aws_iam_policy_document') continue;
    const s = d.args.statement;
    const statements = s?.kind === 'block' ? [s.body] : s?.kind === 'blocks' ? s.items : [];
    const readers = dataReferrers(ir, d.id);
    if (readers.length === 0) continue;
    statements.forEach((statement, index) => {
      if (allowsEverything(statement)) out.push({ document: d, index, readers });
    });
  }
  return out;
}
