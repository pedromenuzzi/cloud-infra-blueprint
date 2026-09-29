/**
 * Which provider versions a project asks for. The shipped schema is one
 * version per provider; when a project pins a range that excludes it (an
 * imported `~> 4.0` AWS project), validating against it would flag arguments
 * that are fine for the version the project actually uses.
 */
import type { IR } from '@/ir/types';
import { SCHEMA_PROVIDERS, type SchemaProvider } from './types';

/** `version` constraints of the hashicorp providers in the project's `required_providers` */
export function providerConstraints(ir: IR): Partial<Record<SchemaProvider, string>> {
  const out: Partial<Record<SchemaProvider, string>> = {};
  for (const extra of ir.extras) {
    const at = extra.text.search(/\brequired_providers\s*\{/);
    if (at === -1) continue;
    const entries = /\{([\s\S]*)/.exec(extra.text.slice(at))?.[1] ?? '';
    for (const m of entries.matchAll(/(^|\s)([A-Za-z][\w-]*)\s*=\s*\{([^{}]*)\}/g)) {
      const [, , local, body] = m;
      const source = /\bsource\s*=\s*"([^"]+)"/.exec(body)?.[1] ?? `hashicorp/${local}`;
      const provider = /(?:^|\/)hashicorp\/([\w-]+)$/.exec(source)?.[1];
      const version = /\bversion\s*=\s*"([^"]+)"/.exec(body)?.[1];
      if (provider && version && (SCHEMA_PROVIDERS as readonly string[]).includes(provider)) {
        out[provider as SchemaProvider] = version;
      }
    }
  }
  return out;
}

const parse = (v: string): number[] | null => {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[\w.]+)?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
};

const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Does a Terraform version constraint (`~> 6.0`, `>= 5.10, < 7`, `= 6.66.0`)
 * allow `version`? Anything it can't read counts as allowed.
 */
export function constraintAllows(constraint: string, version: string): boolean {
  const v = parse(version);
  if (!v) return true;
  for (const clause of constraint.split(',')) {
    const m = /^\s*(~>|>=|<=|!=|=|>|<)?\s*(\S+)\s*$/.exec(clause);
    if (!m) continue;
    const op = m[1] ?? '=';
    const target = parse(m[2]);
    if (!target) continue;
    const c = compare(v, target);
    switch (op) {
      case '=':
        if (c !== 0) return false;
        break;
      case '!=':
        if (c === 0) return false;
        break;
      case '>':
        if (c <= 0) return false;
        break;
      case '>=':
        if (c < 0) return false;
        break;
      case '<':
        if (c >= 0) return false;
        break;
      case '<=':
        if (c > 0) return false;
        break;
      case '~>': {
        if (c < 0) return false;
        // the rightmost written segment may grow: ~> 6.1 → < 7.0 · ~> 6.1.2 → < 6.2.0 · ~> 6 → < 7
        const segments = m[2].split('-')[0].split('.').length;
        const upper = segments <= 2 ? [target[0] + 1, 0, 0] : [target[0], target[1] + 1, 0];
        if (compare(v, upper) >= 0) return false;
        break;
      }
    }
  }
  return true;
}
