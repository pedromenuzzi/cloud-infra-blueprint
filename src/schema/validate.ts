/**
 * Schema-aware validation of a resource block: unknown arguments and blocks
 * (with a "did you mean"), missing schema-required arguments the catalog
 * doesn't already flag, deprecated arguments, read-only attributes, and
 * literals whose type can't possibly convert. Anything the IR can't see into
 * — `dynamic` blocks, verbatim sub-blocks, expressions — is given the benefit
 * of the doubt: a warning is raised only when Terraform would certainly fail.
 */
import { messagesFor } from '@/i18n/messages';
import type { BodySpans, Diagnostic, Expression, IR, ResourceNode } from '@/ir/types';
import type { ResourceDef } from '@/resources/types';
import { acceptsBlockSyntax, closestName, entryOf, isSettable, parseType, type TypeNode } from './lookup';
import { schemaMessages, type Got, type SchemaText, type Wanted } from './messages';
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

function describeValue(expr: Expression): Got {
  switch (expr.kind) {
    case 'literal':
      return { kind: 'literal', text: typeof expr.value === 'string' ? JSON.stringify(expr.value) : String(expr.value) };
    case 'list':
      return { kind: 'list' };
    case 'object':
      return { kind: 'object' };
    default:
      return { kind: 'value' };
  }
}

const typeName = (t: TypeNode): string =>
  t.kind === 'list' || t.kind === 'set' || t.kind === 'map' ? `${t.kind}(${typeName(t.elem)})` : t.kind;

/** why a value can't convert: a plain mismatch, or one inside a collection item / map entry */
type Mismatch =
  | { wanted: Wanted; got: Got }
  | { collection: string; item: true; inner: Mismatch }
  | { collection: string; key: string; inner: Mismatch };

function mismatch(expr: Expression, type: TypeNode): Mismatch | undefined {
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
            ? { wanted: { kind: 'bool' }, got: describeValue(expr) }
            : undefined;
        case 'number':
          return typeof v === 'boolean' || (typeof v === 'string' && !NUMERIC.test(v))
            ? { wanted: { kind: 'number' }, got: describeValue(expr) }
            : undefined;
        default:
          return { wanted: { kind: 'type', name: typeName(type) }, got: describeValue(expr) };
      }
    }
    case 'list': {
      if (type.kind === 'list' || type.kind === 'set') {
        for (const item of expr.items) {
          const inner = mismatch(item, type.elem);
          if (inner) return { collection: typeName(type), item: true, inner };
        }
        return undefined;
      }
      if (type.kind === 'tuple') return undefined;
      return { wanted: { kind: 'type', name: typeName(type) }, got: { kind: 'list' } };
    }
    case 'object': {
      if (type.kind === 'map') {
        for (const [k, v] of Object.entries(expr.fields)) {
          const inner = mismatch(v, type.elem);
          if (inner) return { collection: typeName(type), key: k, inner };
        }
        return undefined;
      }
      if (type.kind === 'object') return undefined;
      return { wanted: { kind: 'type', name: typeName(type) }, got: { kind: 'object' } };
    }
    default:
      return undefined;
  }
}

/** `expects a number, got "x"`; nested ones read on: `expects list(number): an item should be a number, got "x"` */
function describeMismatch(m: SchemaText, problem: Mismatch, lead = m.expects): string {
  if ('wanted' in problem) return m.mismatch(lead, m.wanted(problem.wanted), m.got(problem.got));
  const inner = describeMismatch(m, problem.inner, m.shouldBe);
  return 'key' in problem ? m.entryMismatch(lead, problem.collection, problem.key, inner) : m.itemMismatch(lead, problem.collection, inner);
}

/**
 * Why a value can't convert to `type` (in the UI language in effect), or
 * undefined when it can (or might — references, functions and templates are
 * never judged).
 */
export function literalTypeProblem(expr: Expression, type: TypeNode): string | undefined {
  const problem = mismatch(expr, type);
  return problem ? describeMismatch(messagesFor(schemaMessages), problem) : undefined;
}

/* ------------------------------------------------------------------- walk */

interface Walk {
  issues: SchemaIssue[];
  /** top-level arguments the catalog already reports as missing */
  catalogRequired: Set<string>;
  /** the messages in effect when the walk started */
  m: SchemaText;
}

/** ` in ingress.cidr_blocks`, or nothing at the top level */
function where(w: Walk, path: Array<string | number>): string {
  const names = path.filter((p): p is string => typeof p === 'string');
  return names.length ? w.m.where(names.join('.')) : '';
}

/** ` — <provider's deprecation note>`, when there is one */
const note = (w: Walk, text: string | undefined) => (text ? w.m.note(text) : '');

function blockCandidates(schema: SchemaBlock): string[] {
  return [...Object.values(schema.attributes).filter(isSettable).map((a) => a.name), ...Object.keys(schema.blocks)];
}

/** `name` as written; `key` is its body key (they differ for `dynamic "name"` blocks) */
function unknown(
  w: Walk,
  path: Array<string | number>,
  name: string,
  what: 'argument' | 'block' | 'block type',
  candidates: string[],
  key = name,
) {
  const suggestion = closestName(name, candidates);
  w.issues.push({
    kind: 'unknown',
    path,
    key,
    suggestion,
    message: w.m.unknown(what, name, where(w, path), suggestion ? w.m.didYouMean(suggestion) : ''),
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
    const problem = mismatch(expr, field);
    if (problem) w.issues.push({ kind: 'type', path, key, message: w.m.typeProblem(key, where(w, path), describeMismatch(w.m, problem)) });
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
          w.issues.push({ kind: 'deprecated', path, key, message: w.m.blockDeprecated(name, where(w, path), note(w, entry.deprecation)) });
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
        w.issues.push({ kind: 'read-only', path, key, message: w.m.readOnly(key, where(w, path)) });
        continue;
      }
      if (entry.deprecated) {
        w.issues.push({ kind: 'deprecated', path, key, message: w.m.deprecated(key, where(w, path), note(w, entry.deprecation)) });
      }
      const type = parseType(entry.type);
      if (expr.kind === 'block' || expr.kind === 'blocks') {
        if (acceptsBlockSyntax(type) && (type.kind === 'list' || type.kind === 'set')) {
          const items = expr.kind === 'block' ? [expr.body] : expr.items;
          items.forEach((item, i) => checkObjectBlock(w, item, type.elem, [...path, key, i]));
        } else if (type.kind === 'string' || type.kind === 'number' || type.kind === 'bool') {
          w.issues.push({ kind: 'syntax', path, key, message: w.m.notABlock(key, where(w, path)) });
        }
        continue;
      }
      const problem = mismatch(expr, type);
      if (problem) w.issues.push({ kind: 'type', path, key, message: w.m.typeProblem(key, where(w, path), describeMismatch(w.m, problem)) });
      continue;
    }

    // nested block type
    if (entry.deprecated) {
      w.issues.push({ kind: 'deprecated', path, key, message: w.m.blockDeprecated(key, where(w, path), note(w, entry.deprecation)) });
    }
    if (expr.kind !== 'block' && expr.kind !== 'blocks') {
      w.issues.push({ kind: 'syntax', path, key, message: w.m.notAnArgument(key, where(w, path)) });
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
        w.issues.push({ kind: 'too-many', path, key: name, message: w.m.tooMany(name, where(w, path), entry.maxItems, count) });
      }
    }
  }

  for (const attr of Object.values(schema.attributes)) {
    if (!attr.required || present.has(attr.name)) continue;
    if (top && w.catalogRequired.has(attr.name)) continue;
    w.issues.push({ kind: 'missing', path, message: w.m.missingArgument(attr.name, where(w, path)), suggestion: attr.name });
  }
  for (const entry of Object.values(schema.blocks)) {
    if (entry.minItems === 0 || present.has(entry.name)) continue;
    if (top && w.catalogRequired.has(entry.name)) continue;
    w.issues.push({ kind: 'missing', path, message: w.m.missingBlock(entry.name, where(w, path)), suggestion: entry.name });
  }
}

/**
 * schema findings for one resource, in the UI language in effect; empty while
 * its provider's schema isn't loaded
 */
export function schemaIssues(node: ResourceNode, def?: ResourceDef): SchemaIssue[] {
  const provider = schemaProviderOf(node.type);
  if (!provider) return [];
  const m = messagesFor(schemaMessages);
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
        message: m.unknownType(node.type, provider, providerSchema.version, suggestion ? m.didYouMean(suggestion) : ''),
      },
    ];
  }
  const w: Walk = {
    issues: [],
    catalogRequired: new Set(def?.fields.filter((f) => f.required).map((f) => f.name) ?? []),
    m,
  };
  const deprecation = schema.resourceDeprecation(node.type);
  if (deprecation !== undefined) {
    w.issues.push({ kind: 'deprecated-type', path: [], message: m.typeDeprecated(node.type, note(w, deprecation)) });
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
