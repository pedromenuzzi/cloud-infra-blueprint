/**
 * Schema-aware validation of a resource block: unknown arguments and blocks
 * (with a "did you mean"), missing schema-required arguments the catalog
 * doesn't already flag, deprecated arguments, read-only attributes, and
 * literals whose type can't possibly convert. Anything the IR can't see into
 * — `dynamic` blocks, verbatim sub-blocks, expressions — is given the benefit
 * of the doubt: a warning is raised only when Terraform would certainly fail.
 */
import type { BodySpans, Diagnostic, Expression, IR, ResourceNode } from '@/ir/types';
import type { ResourceDef } from '@/resources/types';
import { acceptsBlockSyntax, closestName, entryOf, isSettable, parseType, type TypeNode } from './lookup';
import { getProviderSchema, schemaFor, schemaProviderOf } from './store';
import type { SchemaBlock, SchemaProvider } from './types';
import { constraintAllows, providerConstraints } from './versions';

export type SchemaIssueKind =
  | 'unknown-type'
  | 'deprecated-type'
  | 'unknown'
  | 'missing'
  | 'deprecated'
  | 'read-only'
  | 'type'
  | 'syntax'
  | 'too-many';

export interface SchemaIssue {
  kind: SchemaIssueKind;
  /** nested block names (with item indexes of repeated blocks) down to the body the issue is in */
  path: Array<string | number>;
  /** the argument / block key the issue is about (absent: the block itself) */
  key?: string;
  message: string;
  /** "did you mean" candidate */
  suggestion?: string;
}

/** meta-arguments and blocks Terraform handles itself, valid in every resource body */
export const META_ARGUMENTS = new Set(['count', 'for_each', 'provider', 'depends_on', 'lifecycle', 'connection', 'provisioner']);

const IDENT = /^[A-Za-z_][\w-]*$/;
/** labeled sub-block kept verbatim by the parser: `dynamic "ingress" #0` */
const LABELED = /^([A-Za-z_][\w-]*) "([^"]*)" #\d+$/;
/** unparseable or too-deep sub-block kept verbatim: `ingress #0 raw` */
const VERBATIM = /^([A-Za-z_][\w-]*) #\d+ raw$/;

/** the schema name a body key stands for (`dynamic "ingress" #0` → ingress), and how */
export function bodyKeyName(key: string): { name: string; via: 'plain' | 'dynamic' | 'labeled' | 'verbatim' } | undefined {
  const labeled = LABELED.exec(key);
  if (labeled) return labeled[1] === 'dynamic' ? { name: labeled[2], via: 'dynamic' } : { name: labeled[1], via: 'labeled' };
  const verbatim = VERBATIM.exec(key);
  if (verbatim) return { name: verbatim[1], via: 'verbatim' };
  return IDENT.test(key) ? { name: key, via: 'plain' } : undefined;
}

/* ------------------------------------------------------------ type checks */

const NUMERIC = /^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$/;

function describeValue(expr: Expression): string {
  switch (expr.kind) {
    case 'literal':
      return typeof expr.value === 'string' ? JSON.stringify(expr.value) : String(expr.value);
    case 'list':
      return 'a list';
    case 'object':
      return 'an object';
    default:
      return 'this value';
  }
}

const typeName = (t: TypeNode): string =>
  t.kind === 'list' || t.kind === 'set' || t.kind === 'map' ? `${t.kind}(${typeName(t.elem)})` : t.kind;

/**
 * Why a value can't convert to `type`, or undefined when it can (or might —
 * references, functions and templates are never judged).
 */
export function literalTypeProblem(expr: Expression, type: TypeNode): string | undefined {
  if (type.kind === 'any') return undefined;
  switch (expr.kind) {
    case 'literal': {
      const v = expr.value;
      if (v === null) return undefined;
      switch (type.kind) {
        case 'string':
          return undefined; // numbers and bools convert
        case 'bool':
          return typeof v === 'number' || (typeof v === 'string' && !['true', 'false', '1', '0'].includes(v))
            ? `expects a bool, got ${describeValue(expr)}`
            : undefined;
        case 'number':
          return typeof v === 'boolean' || (typeof v === 'string' && !NUMERIC.test(v))
            ? `expects a number, got ${describeValue(expr)}`
            : undefined;
        default:
          return `expects ${typeName(type)}, got ${describeValue(expr)}`;
      }
    }
    case 'list': {
      if (type.kind === 'list' || type.kind === 'set') {
        for (const item of expr.items) {
          const problem = literalTypeProblem(item, type.elem);
          if (problem) return `expects ${typeName(type)}: an item ${problem.replace(/^expects /, 'should be ')}`;
        }
        return undefined;
      }
      if (type.kind === 'tuple') return undefined;
      return `expects ${typeName(type)}, got a list`;
    }
    case 'object': {
      if (type.kind === 'map') {
        for (const [k, v] of Object.entries(expr.fields)) {
          const problem = literalTypeProblem(v, type.elem);
          if (problem) return `expects ${typeName(type)}: "${k}" ${problem.replace(/^expects /, 'should be ')}`;
        }
        return undefined;
      }
      if (type.kind === 'object') return undefined;
      return `expects ${typeName(type)}, got an object`;
    }
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------- walk */

interface Walk {
  issues: SchemaIssue[];
  /** top-level arguments the catalog already reports as missing */
  catalogRequired: Set<string>;
}

const where = (path: Array<string | number>) => {
  const names = path.filter((p): p is string => typeof p === 'string');
  return names.length ? ` in ${names.join('.')}` : '';
};

function blockCandidates(schema: SchemaBlock): string[] {
  return [...Object.values(schema.attributes).filter(isSettable).map((a) => a.name), ...Object.keys(schema.blocks)];
}

/** `name` as written; `key` is its body key (they differ for `dynamic "name"` blocks) */
function unknown(w: Walk, path: Array<string | number>, name: string, what: string, candidates: string[], key = name) {
  const suggestion = closestName(name, candidates);
  w.issues.push({
    kind: 'unknown',
    path,
    key,
    suggestion,
    message: `unknown ${what} "${name}"${where(path)}${suggestion ? ` — did you mean "${suggestion}"?` : ''}`,
  });
}

/** keys of a block written for an object-typed attribute (`ingress { … }` in aws_security_group) */
function checkObjectBlock(w: Walk, body: Record<string, Expression>, type: TypeNode, path: Array<string | number>) {
  if (type.kind !== 'object') return;
  const fields = Object.keys(type.fields);
  for (const [key, expr] of Object.entries(body)) {
    const named = bodyKeyName(key);
    if (!named || named.via !== 'plain') continue;
    const field = type.fields[key];
    if (!field) {
      unknown(w, path, key, 'argument', fields);
      continue;
    }
    const problem = literalTypeProblem(expr, field);
    if (problem) w.issues.push({ kind: 'type', path, key, message: `"${key}"${where(path)} ${problem}` });
  }
}

function checkBody(w: Walk, body: Record<string, Expression>, schema: SchemaBlock, path: Array<string | number>) {
  const top = path.length === 0;
  const present = new Set<string>();
  /** blocks generated by `dynamic`: their count is unknown until plan */
  const dynamic = new Set<string>();

  for (const [key, expr] of Object.entries(body)) {
    const named = bodyKeyName(key);
    if (!named) continue; // quoted keys: the parser and Terraform have their say
    const { name, via } = named;
    if (top && META_ARGUMENTS.has(name)) continue;
    const entry = entryOf(schema, name);

    if (via === 'verbatim') {
      present.add(name); // can't see inside — the parser reports what's broken there
      continue;
    }
    if (via === 'dynamic' || via === 'labeled') {
      if (entry?.kind === 'block') {
        present.add(name);
        if (via === 'dynamic') dynamic.add(name);
        if (entry.deprecated) {
          w.issues.push({ kind: 'deprecated', path, key, message: `block "${name}"${where(path)} is deprecated${entry.deprecation ? ` — ${entry.deprecation}` : ''}` });
        }
      } else if (!entry) {
        unknown(w, path, name, 'block type', Object.keys(schema.blocks), key);
      }
      continue;
    }

    if (!entry) {
      if (name === 'timeouts') continue; // provider-managed; some SDKs add it at runtime
      const isBlock = expr.kind === 'block' || expr.kind === 'blocks';
      unknown(w, path, key, isBlock ? 'block' : 'argument', blockCandidates(schema));
      continue;
    }
    present.add(name);

    if (entry.kind === 'attribute') {
      if (!entry.required && !entry.optional) {
        w.issues.push({ kind: 'read-only', path, key, message: `"${key}"${where(path)} is read-only — the provider computes it` });
        continue;
      }
      if (entry.deprecated) {
        w.issues.push({ kind: 'deprecated', path, key, message: `"${key}"${where(path)} is deprecated${entry.deprecation ? ` — ${entry.deprecation}` : ''}` });
      }
      const type = parseType(entry.type);
      if (expr.kind === 'block' || expr.kind === 'blocks') {
        if (acceptsBlockSyntax(type) && (type.kind === 'list' || type.kind === 'set')) {
          const items = expr.kind === 'block' ? [expr.body] : expr.items;
          items.forEach((item, i) => checkObjectBlock(w, item, type.elem, [...path, key, i]));
        } else if (type.kind === 'string' || type.kind === 'number' || type.kind === 'bool') {
          w.issues.push({ kind: 'syntax', path, key, message: `"${key}"${where(path)} is an argument — write ${key} = …, not a block` });
        }
        continue;
      }
      const problem = literalTypeProblem(expr, type);
      if (problem) w.issues.push({ kind: 'type', path, key, message: `"${key}"${where(path)} ${problem}` });
      continue;
    }

    // nested block type
    if (entry.deprecated) {
      w.issues.push({ kind: 'deprecated', path, key, message: `block "${key}"${where(path)} is deprecated${entry.deprecation ? ` — ${entry.deprecation}` : ''}` });
    }
    if (expr.kind !== 'block' && expr.kind !== 'blocks') {
      w.issues.push({ kind: 'syntax', path, key, message: `"${key}"${where(path)} is a block — write ${key} { … }, not ${key} = …` });
      continue;
    }
    const items = expr.kind === 'block' ? [expr.body] : expr.items;
    items.forEach((item, i) => checkBody(w, item, entry.block, [...path, key, i]));
  }

  for (const [name, entry] of Object.entries(schema.blocks)) {
    if (entry.maxItems > 0 && !dynamic.has(name)) {
      const expr = body[name];
      const count = expr?.kind === 'blocks' ? expr.items.length : 0;
      if (count > entry.maxItems) {
        w.issues.push({ kind: 'too-many', path, key: name, message: `block "${name}"${where(path)} may appear at most ${entry.maxItems === 1 ? 'once' : `${entry.maxItems} times`}, found ${count}` });
      }
    }
  }

  for (const attr of Object.values(schema.attributes)) {
    if (!attr.required || present.has(attr.name)) continue;
    if (top && w.catalogRequired.has(attr.name)) continue;
    w.issues.push({ kind: 'missing', path, message: `required argument "${attr.name}"${where(path)} is missing`, suggestion: attr.name });
  }
  for (const entry of Object.values(schema.blocks)) {
    if (entry.minItems === 0 || present.has(entry.name)) continue;
    if (top && w.catalogRequired.has(entry.name)) continue;
    w.issues.push({ kind: 'missing', path, message: `required block "${entry.name}"${where(path)} is missing`, suggestion: entry.name });
  }
}

/** schema findings for one resource; empty while its provider's schema isn't loaded */
export function schemaIssues(node: ResourceNode, def?: ResourceDef): SchemaIssue[] {
  const provider = schemaProviderOf(node.type);
  if (!provider) return [];
  const schema = schemaFor(node.type);
  if (!schema) {
    const providerSchema = getProviderSchema(provider);
    if (!providerSchema) return []; // not loaded (yet)
    const suggestion = closestName(node.type, providerSchema.types());
    return [
      {
        kind: 'unknown-type',
        path: [],
        suggestion,
        message: `resource type "${node.type}" is not in the ${provider} provider ${providerSchema.version}${suggestion ? ` — did you mean "${suggestion}"?` : ''}`,
      },
    ];
  }
  const w: Walk = {
    issues: [],
    catalogRequired: new Set(def?.fields.filter((f) => f.required).map((f) => f.name) ?? []),
  };
  const deprecation = schema.resourceDeprecation(node.type);
  if (deprecation !== undefined) {
    w.issues.push({ kind: 'deprecated-type', path: [], message: `resource type "${node.type}" is deprecated${deprecation ? ` — ${deprecation}` : ''}` });
  }
  checkBody(w, node.args, schema.resource(node.type)!, []);
  return w.issues;
}

/* ---------------------------------------------------------------- markers */

type Marker = Pick<Diagnostic, 'start' | 'end'>;
export type MarkerAt = (node: ResourceNode, field?: string) => Marker;

/** spans of the body at `path` (block names + item indexes), when the text still matches */
function bodySpansAt(node: ResourceNode, path: Array<string | number>): BodySpans | undefined {
  let body = node.trivia.spans?.body;
  for (let i = 0; body && i < path.length; i++) {
    const key = path[i];
    if (typeof key !== 'string') continue;
    const index = typeof path[i + 1] === 'number' ? (path[i + 1] as number) : 0;
    body = body.entries.filter((e) => e.key === key && e.kind === 'block')[index]?.body;
  }
  return body;
}

/**
 * The marker for an issue, through the validator's own `markerAt`: nested
 * keys are looked up in their block's spans; issues about a whole nested
 * block point at that block's key.
 */
function issueMarker(node: ResourceNode, issue: SchemaIssue, markerAt: MarkerAt): Marker {
  const spans = node.trivia.spans;
  if (!spans) return markerAt(node);
  let path = issue.path;
  let key = issue.key;
  // missing entries point at the block that lacks them
  if (key === undefined && path.length > 0) {
    const last = typeof path[path.length - 1] === 'number' ? path.length - 2 : path.length - 1;
    key = path[last] as string;
    path = path.slice(0, last);
  }
  if (path.length === 0) return markerAt(node, key);
  const body = bodySpansAt(node, path);
  if (!body || !key || !body.entries.some((e) => e.key === key)) {
    return markerAt(node, path.find((p): p is string => typeof p === 'string'));
  }
  return markerAt({ ...node, trivia: { ...node.trivia, spans: { ...spans, body } } }, key);
}

const pinsCache = new WeakMap<IR['extras'], Partial<Record<SchemaProvider, string>>>();

/**
 * The project's `required_providers` pin for this resource's provider, when
 * it excludes the version the shipped schema describes (see ./versions.ts).
 */
export function pinMismatch(ir: IR, type: string): string | undefined {
  const provider = schemaProviderOf(type);
  const schema = provider ? getProviderSchema(provider) : undefined;
  if (!provider || !schema) return undefined;
  let pins = pinsCache.get(ir.extras);
  if (!pins) {
    pins = providerConstraints(ir);
    pinsCache.set(ir.extras, pins);
  }
  const pin = pins[provider];
  return pin && !constraintAllows(pin, schema.version) ? pin : undefined;
}

/** schema warnings as diagnostics (see src/ir/validate.ts) — none when the project pins another version */
export function schemaDiagnostics(
  ir: IR,
  node: ResourceNode,
  def: ResourceDef | undefined,
  file: string,
  markerAt: MarkerAt,
): Diagnostic[] {
  if (pinMismatch(ir, node.type)) return [];
  return schemaIssues(node, def).map((issue) => ({
    file,
    severity: 'warning' as const,
    message: `${node.id}: ${issue.message}`,
    nodeId: node.id,
    ...issueMarker(node, issue, markerAt),
  }));
}
