/**
 * Static values the checks can trust: literals, `var.x` defaults and plain
 * templates such as `"${var.region}a"`. Anything else (functions, locals,
 * data sources, conditionals) is unknown, and the checks skip it.
 */
import { refTargetAddress } from '../expr';
import type { Expression, IR, ProviderBlock, ResourceNode } from '../types';

export interface Resolved {
  value: string;
  /** the variable it came from, when it wasn't written in place */
  via?: string;
}

const VAR_REF = /^var\.([A-Za-z_][\w-]*)$/;
/** a quoted template made only of text and `${var.x}` interpolations */
const SIMPLE_TEMPLATE = /^"((?:[^"\\$%]|\$\{\s*var\.[A-Za-z_][\w-]*\s*\})*)"$/;

function variableDefault(ir: IR, name: string): Expression | undefined {
  return ir.variables.find((v) => v.name === name)?.args.default;
}

/** The string an expression evaluates to without running Terraform, if it is certain. */
export function resolveString(ir: IR, e: Expression | undefined): Resolved | undefined {
  if (!e) return undefined;
  if (e.kind === 'literal') return typeof e.value === 'string' ? { value: e.value } : undefined;
  if (e.kind === 'ref') {
    const name = VAR_REF.exec(e.path)?.[1];
    const fallback = name ? variableDefault(ir, name) : undefined;
    const value = fallback?.kind === 'literal' && typeof fallback.value === 'string' ? fallback.value : undefined;
    return value === undefined ? undefined : { value, via: e.path };
  }
  if (e.kind === 'raw') {
    const body = SIMPLE_TEMPLATE.exec(e.hcl.trim())?.[1];
    if (body === undefined) return undefined;
    let via: string | undefined;
    let unknown = false;
    const value = body.replace(/\$\{\s*(var\.[A-Za-z_][\w-]*)\s*\}/g, (_, path: string) => {
      const part = resolveString(ir, { kind: 'ref', path });
      if (!part) unknown = true;
      via ??= path;
      return part?.value ?? '';
    });
    return unknown ? undefined : { value, via };
  }
  return undefined;
}

/**
 * A list of strings (`["10.0.0.0/16"]`, or `var.spaces` with a list default).
 * `complete` is false when some item can't be resolved — callers that need
 * the whole list (is a subnet inside its network?) must then skip.
 */
export function resolveStringList(ir: IR, e: Expression | undefined): { items: Resolved[]; complete: boolean } {
  if (!e) return { items: [], complete: true };
  let list: Expression[] | undefined;
  let via: string | undefined;
  if (e.kind === 'list') list = e.items;
  else if (e.kind === 'ref') {
    const name = VAR_REF.exec(e.path)?.[1];
    const fallback = name ? variableDefault(ir, name) : undefined;
    if (fallback?.kind === 'list') {
      list = fallback.items;
      via = e.path;
    }
  }
  if (!list) return { items: [], complete: false };
  const items: Resolved[] = [];
  let complete = true;
  for (const item of list) {
    const r = resolveString(ir, item);
    if (r) items.push(via ? { value: r.value, via } : r);
    else complete = false;
  }
  return { items, complete };
}

/** The resource an argument points at (`aws_vpc.main.id` → the `aws_vpc.main` node). */
export function refTarget(ir: IR, e: Expression | undefined): ResourceNode | undefined {
  if (e?.kind !== 'ref') return undefined;
  const address = refTargetAddress(e.path);
  return address ? ir.resources.find((r) => r.id === address) : undefined;
}

/**
 * `count` / `for_each` make a resource conditional or repeated: comparing it
 * with its neighbours (overlaps, duplicate names) would be guesswork.
 */
export function isRepeated(node: ResourceNode): boolean {
  const count = node.args.count;
  if (node.args.for_each) return true;
  return count !== undefined && !(count.kind === 'literal' && count.value === 1);
}

/** The provider configuration a resource uses: its `provider = aws.west`, else the default one. */
export function providerFor(ir: IR, node: ResourceNode, source: string): ProviderBlock | undefined {
  const alias = node.args.provider?.kind === 'ref' ? node.args.provider.path.split('.') : undefined;
  if (alias && alias[0] !== source) return undefined;
  return ir.providers.find((p) => {
    if (p.name !== source) return false;
    const own = p.args.alias?.kind === 'literal' ? p.args.alias.value : undefined;
    return alias ? own === alias[1] : own === undefined;
  });
}

/** How to name that provider configuration in a message: `the AWS provider`, `the aws.west provider`. */
export function providerLabel(node: ResourceNode, fallback: string): string {
  const alias = node.args.provider?.kind === 'ref' ? node.args.provider.path : undefined;
  return alias ? `the ${alias} provider` : `the ${fallback} provider`;
}
