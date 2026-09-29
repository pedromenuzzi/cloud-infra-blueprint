/** What a pricing rule gets and returns, and the small builders every rule shares. */
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { HOURS_PER_MONTH, rate } from '../format';
import { blockBody, resolveBool, resolveNumber, resolveString } from '../resolve';
import type { CostLine, PriceBook } from '../types';

export interface RuleContext {
  r: ResourceNode;
  ir: IR;
  book: PriceBook;
  /** a default-region rate scaled to the resource's region */
  at(rate: number): number;
  /** an argument (or one of a nested block's, with `from`) as a string / number / boolean */
  str(field: string, from?: Record<string, Expression>): string | undefined;
  num(field: string, from?: Record<string, Expression>): number | undefined;
  bool(field: string, from?: Record<string, Expression>): boolean | undefined;
  /** the body of a nested block */
  block(field: string, from?: Record<string, Expression>): Record<string, Expression> | undefined;
}

export type RuleResult =
  | { kind: 'fixed'; lines: CostLine[]; assumptions?: string[] }
  | { kind: 'usage'; note: string; assumptions?: string[] }
  | { kind: 'free'; note?: string }
  | { kind: 'unknown'; note: string };

export type Rule = (ctx: RuleContext) => RuleResult;

export function makeContext(r: ResourceNode, ir: IR, book: PriceBook, multiplier: number): RuleContext {
  return {
    r,
    ir,
    book,
    at: (value) => value * multiplier,
    str: (field, from = r.args) => resolveString(from[field], ir),
    num: (field, from = r.args) => resolveNumber(from[field], ir),
    bool: (field, from = r.args) => resolveBool(from[field], ir),
    block: (field, from = r.args) => blockBody(from[field]),
  };
}

const times = (n: number) => (n === 1 ? '' : `${n} × `);

/** "t3.micro 730 h × $0.0104" (× `qty` units) */
export function hourly(label: string, hourRate: number, qty = 1): CostLine {
  return { label, detail: `${times(qty)}${HOURS_PER_MONTH} h × ${rate(hourRate)}`, monthly: HOURS_PER_MONTH * hourRate * qty };
}

/** "8 GB gp3 × $0.08" — `qty` GB at a GB-month rate */
export function perGbMonth(label: string, gb: number, gbRate: number): CostLine {
  return { label, detail: `× ${rate(gbRate)}`, monthly: gb * gbRate };
}

/** a monthly fee, `qty` times: "Hosted zone $0.50" */
export function monthlyFee(label: string, month: number, qty = 1): CostLine {
  return qty === 1 ? { label, monthly: month } : { label, detail: `${qty} × ${rate(month)}`, monthly: month * qty };
}

export const fixed = (lines: CostLine[], assumptions?: string[]): RuleResult => ({ kind: 'fixed', lines, assumptions });
export const usage = (note: string, assumptions?: string[]): RuleResult => ({ kind: 'usage', note, assumptions });
export const free = (note?: string): RuleResult => ({ kind: 'free', note });
export const unknown = (note: string): RuleResult => ({ kind: 'unknown', note });

/** `value` of `field` has no price in the table (or isn't set / is an expression) */
export function unpriced(field: string, value: string | undefined): RuleResult {
  return unknown(value === undefined ? `${field} isn't set to a literal value` : `${field} "${value}" isn't in the price table`);
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
