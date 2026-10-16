/**
 * "Create a project from a state": clean HCL for what a state manages.
 *
 * Only the catalog's resource types are written, with the arguments the
 * catalog asks for (its fields, defaults and connections), the ones the
 * provider schema requires, and the security rules (inline ingress /
 * egress, routes). Whatever Terraform computes is left out, a value that
 * is another resource's `id` / `arn` in the same state becomes a reference
 * to it (`vpc_id = aws_vpc.main.id`), and a secret becomes a variable: the
 * generated code never holds one. Resources with `count` / `for_each` keep
 * their instance keys, so the state's addresses still match the code.
 * Everything that couldn't be written is listed, so the UI can say so.
 */
import { emitExpression, emitProject } from '@/hcl/emitter';
import { block, blocks, lit, list, obj, raw, ref } from '@/ir/expr';
import { emptyIR, providerOfType, providerSourceName, type Expression, type IR, type Provider, type ResourceNode } from '@/ir/types';
import { getDef } from '@/resources/registry';
import type { SchemaBlock } from '@/schema/types';
import { versionsBlock } from '@/templates';
import { indexSuffix, isObject, SECRET_NAME, type Json, type JsonObject } from './json';
import { isSensitivePath, type ParsedState, type StateInstance, type StateResource } from './state';

export type SkipReason = 'not-in-catalog' | 'data-source' | 'in-module' | 'no-instances';

export interface FromStateResult {
  files: Record<string, string>;
  /** resource addresses written (without instance keys) */
  converted: string[];
  instances: number;
  skipped: Array<{ address: string; type: string; reason: SkipReason }>;
  /** variables standing in for the state's secrets */
  secrets: string[];
  /** values that couldn't be written as they are */
  leftOut: Array<{ address: string; path: string; why: 'sensitive' | 'varies' }>;
  references: number;
}

/** inline rules and routes: what the security audit and the canvas read, kept though no catalog field names them */
const RULES: Record<string, string[]> = {
  aws_security_group: ['ingress', 'egress'],
  aws_network_acl: ['ingress', 'egress'],
  aws_route_table: ['route'],
  azurerm_network_security_group: ['security_rule'],
  azurerm_route_table: ['route'],
  google_compute_firewall: ['allow', 'deny', 'source_ranges', 'target_tags', 'direction'],
};

/** the arguments written for a type, in the catalog's order */
function argNames(type: string, schema: SchemaBlock | undefined): string[] {
  const def = getDef(type)!;
  const names = [
    ...def.fields.map((f) => f.name),
    ...Object.keys(def.defaults ?? {}),
    ...(def.connections ?? []).map((c) => c.arg),
    ...(def.blockConnections ?? []).map((c) => c.block),
    ...(RULES[type] ?? []),
    ...Object.values(schema?.attributes ?? {}).filter((a) => a.required).map((a) => a.name),
    ...Object.values(schema?.blocks ?? {}).filter((b) => b.minItems > 0).map((b) => b.name),
  ];
  return [...new Set(names)];
}

/** read-only in the schema: Terraform computes it, it's never written */
const computedOnly = (schema: SchemaBlock | undefined, name: string) => {
  const a = schema?.attributes[name];
  return a ? a.computed && !a.optional && !a.required : false;
};

const isEmpty = (v: Json | undefined) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (isObject(v) && Object.keys(v).length === 0);

/** id / arn → the reference to the resource that has it, once every resource is known */
class References {
  private readonly byValue = new Map<string, string | null>();
  /** `from → to` pairs written */
  readonly used = new Set<string>();

  constructor(resources: StateResource[]) {
    for (const r of resources) {
      for (const inst of r.instances) {
        for (const attr of ['id', 'arn']) {
          const value = inst.attributes[attr];
          if (typeof value !== 'string' || value.length < 4) continue;
          const target = `${r.type}.${r.name}${indexSuffix(inst.key)}.${attr}`;
          // two resources with one id: no way to tell which one is meant
          this.byValue.set(value, this.byValue.has(value) && this.byValue.get(value) !== target ? null : target);
        }
      }
    }
  }

  /** the reference for `value`, unless it would point at `self` */
  find(value: string, self: string): string | undefined {
    const target = this.byValue.get(value);
    if (!target || target.startsWith(`${self}.`) || target.startsWith(`${self}[`)) return undefined;
    this.used.add(`${self} → ${target}`);
    return target;
  }
}

interface Ctx {
  refs: References;
  self: string;
  address: string;
  leftOut: FromStateResult['leftOut'];
}

/** a value from the state as an expression; undefined when there's nothing worth writing */
function convert(value: Json, path: string, schema: SchemaBlock | undefined, name: string, ctx: Ctx): Expression | undefined {
  if (isEmpty(value) || value === false) return undefined;
  if (typeof value === 'string') {
    const target = ctx.refs.find(value, ctx.self);
    return target ? ref(target) : lit(value);
  }
  if (typeof value === 'number' || value === true) return lit(value);
  const nested = schema?.blocks[name]?.block;
  if (Array.isArray(value)) {
    if (value.every((v) => !isObject(v) && !Array.isArray(v))) {
      const items = value.map((v) => convert(v, path, undefined, name, ctx) ?? lit(null));
      return list(items);
    }
    const bodies = value.filter(isObject).map((v) => body(v, path, nested, ctx)).filter((b) => Object.keys(b).length > 0);
    if (bodies.length === 0) return undefined;
    return bodies.length === 1 ? block(bodies[0]) : blocks(bodies);
  }
  // a nested block (schema says so, or it holds more than scalars) or a map (`tags`)
  const object = value as JsonObject;
  if (nested || Object.values(object).some((v) => isObject(v) || Array.isArray(v))) {
    const b = body(object, path, nested, ctx);
    return Object.keys(b).length > 0 ? block(b) : undefined;
  }
  const fields: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(object)) {
    if (v === null) continue;
    fields[k] = typeof v === 'string' ? lit(v) : convert(v, path, undefined, k, ctx) ?? lit(null);
  }
  return obj(fields);
}

/** a nested block's body: computed and empty values out, secrets out (listed) */
function body(value: JsonObject, path: string, schema: SchemaBlock | undefined, ctx: Ctx): Record<string, Expression> {
  const out: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(value)) {
    if (computedOnly(schema, k)) continue;
    if (SECRET_NAME.test(k) || schema?.attributes[k]?.sensitive) {
      if (!isEmpty(v)) ctx.leftOut.push({ address: ctx.address, path: `${path}.${k}`, why: 'sensitive' });
      continue;
    }
    const e = convert(v, `${path}.${k}`, schema, k, ctx);
    if (e) out[k] = e;
  }
  return out;
}

/** stands for a secret while the arguments are read: one variable per argument replaces it */
const SECRET: Expression = raw('');

const varName = (taken: Set<string>, base: string) => {
  let name = base.replace(/[^A-Za-z0-9_]/g, '_');
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  taken.add(name);
  return name;
};

/** `aws` region from the first ARN that names one; Azure and Google take theirs from attributes */
function providerArgs(provider: Provider, resources: StateResource[]): Record<string, Expression> {
  const attrs = resources.flatMap((r) => r.instances.map((i) => i.attributes));
  if (provider === 'aws') {
    const arn = attrs.map((a) => a.arn).find((a): a is string => typeof a === 'string' && /^arn:aws[\w-]*:[^:]+:[a-z]{2}-[a-z]+-\d:/.test(a));
    return { region: lit(arn?.split(':')[3] ?? 'us-east-1') };
  }
  if (provider === 'azure') return { features: block({}) };
  const project = attrs.map((a) => a.project).find((p): p is string => typeof p === 'string' && p !== '');
  const region = attrs.map((a) => a.region).find((p): p is string => typeof p === 'string' && p !== '');
  return { ...(project ? { project: lit(project) } : {}), region: lit(region ?? 'us-central1') };
}

/** The project for `state`'s managed resources of catalog types. `schemaOf` reads the provider schemas loaded. */
export function stateToProject(state: ParsedState, schemaOf: (type: string) => SchemaBlock | undefined = () => undefined): FromStateResult {
  const skipped: FromStateResult['skipped'] = [];
  const kept: StateResource[] = [];
  for (const r of state.resources) {
    const reason: SkipReason | null =
      r.mode === 'data' ? 'data-source' : r.module ? 'in-module' : r.instances.length === 0 ? 'no-instances' : !getDef(r.type) ? 'not-in-catalog' : null;
    if (reason) skipped.push({ address: r.address, type: r.type, reason });
    else kept.push(r);
  }
  const refs = new References(kept);
  const leftOut: FromStateResult['leftOut'] = [];
  const ir: IR = emptyIR();
  const taken = new Set<string>();
  const secrets: string[] = [];

  for (const r of kept) {
    const schema = schemaOf(r.type);
    const def = getDef(r.type)!;
    const self = `${r.type}.${r.name}`;
    const ctx: Ctx = { refs, self, address: r.address, leftOut };
    // per argument, its value in each instance
    const perInstance = (inst: StateInstance, name: string): Expression | undefined => {
      const value = inst.attributes[name];
      if (value === undefined || computedOnly(schema, name)) return undefined;
      if (isSensitivePath(inst, name) || schema?.attributes[name]?.sensitive) {
        if (isEmpty(value)) return undefined;
        if (typeof value !== 'string') {
          leftOut.push({ address: r.address, path: name, why: 'sensitive' });
          return undefined;
        }
        return SECRET;
      }
      // a `false` the catalog sets on new resources is a choice worth keeping
      if (value === false && def.defaults?.[name]) return lit(false);
      return convert(value, name, schema, name, ctx);
    };

    const args: Record<string, Expression> = {};
    const keys = r.instances.map((i) => i.key);
    const repeated = keys.some((k) => k !== undefined);
    const byCount = repeated && keys.every((k) => typeof k === 'number');
    if (repeated) {
      // ponytail: count keys are assumed 0..n-1; a state with gaps gets count = n (the lowest keys)
      args[byCount ? 'count' : 'for_each'] = byCount
        ? lit(r.instances.length)
        : raw(`toset([${keys.map((k) => JSON.stringify(String(k))).join(', ')}])`);
    }
    for (const name of argNames(r.type, schema)) {
      const values = r.instances.map((inst) => perInstance(inst, name));
      const first = values.find((v) => v !== undefined);
      if (!first) continue;
      if (first === SECRET) {
        const v = varName(taken, `${r.name}_${name}`);
        ir.variables.push({
          id: `var.${v}`,
          name: v,
          args: { description: lit(`${name} of ${self}, kept out of the code`), type: ref('string'), sensitive: lit(true) },
          trivia: { leadingComments: [] },
        });
        secrets.push(v);
        args[name] = ref(`var.${v}`);
        continue;
      }
      const texts = values.map((v) => (v ? emitExpression(v, '  ') : 'null'));
      if (texts.every((t) => t === texts[0])) {
        args[name] = first;
      } else if (values.some((v) => v?.kind === 'block' || v?.kind === 'blocks')) {
        // blocks can't be picked per instance: the first instance's are written
        args[name] = first;
        leftOut.push({ address: r.address, path: name, why: 'varies' });
      } else if (byCount) {
        args[name] = raw(`[${texts.join(', ')}][count.index]`);
      } else {
        args[name] = raw(`{ ${keys.map((k, i) => `${JSON.stringify(String(k))} = ${texts[i]}`).join(', ')} }[each.key]`);
      }
    }
    const node: ResourceNode = { id: self, provider: providerOfType(r.type), type: r.type, name: r.name, args, trivia: { leadingComments: [] } };
    ir.resources.push(node);
  }

  const providers = [...new Set(ir.resources.map((r) => r.provider).filter((p) => p !== 'other'))];
  for (const p of providers) {
    const name = providerSourceName(p);
    ir.providers.push({ id: `provider.${name}.0`, name, args: providerArgs(p, kept.filter((r) => providerOfType(r.type) === p)), trivia: { leadingComments: [] } });
  }
  if (providers.length > 0) ir.extras.push(versionsBlock(providers));

  const files = emitProject(ir);
  if (!files['main.tf']) files['main.tf'] = '';
  return {
    files,
    converted: kept.map((r) => r.address),
    instances: kept.reduce((n, r) => n + r.instances.length, 0),
    skipped,
    secrets,
    leftOut,
    references: refs.used.size,
  };
}
