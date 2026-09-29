/**
 * The inspector's "All arguments" rows for a resource: every schema argument
 * and nested block the curated catalog fields don't already show, grouped
 * (required · set · optional) and searchable. Pure — SchemaFields renders it.
 */
import type { Expression, ResourceNode } from '@/ir/types';
import type { FieldDef } from '@/resources/types';
import { entryOf, isRequired, parseType, settableEntries } from '@/schema/lookup';
import type { SchemaAttribute, SchemaBlock, SchemaEntry } from '@/schema/types';
import { bodyKeyName, META_ARGUMENTS, type SchemaIssue } from '@/schema/validate';

export type RowKind =
  /** an editor from the inspector's field kit (string, number, bool, list(string), map(string)) */
  | 'simple'
  /** objects, other collections: preview + edit in code */
  | 'complex'
  | 'block'
  | 'meta'
  | 'unknown';

export interface ArgRow {
  name: string;
  /** the keys in `node.args` that set it (a block may come as `dynamic "name"` too) */
  keys: string[];
  entry?: SchemaEntry;
  kind: RowKind;
  /** simple rows: the field the inspector's editors take */
  field?: FieldDef;
  required: boolean;
  deprecated: boolean;
  /** findings about this row (nested ones included) */
  issues: SchemaIssue[];
  /** written as `dynamic "name"`, a labeled or verbatim block: only code can edit it */
  opaque: boolean;
  /** how many literal blocks set it (`ingress { }` three times → 3) */
  blockCount: number;
}

function blockCount(keys: string[], args: Record<string, Expression>): number {
  return keys.reduce((n, k) => n + (args[k]?.kind === 'block' ? 1 : args[k]?.kind === 'blocks' ? (args[k] as { items: unknown[] }).items.length : 0), 0);
}

export interface ArgGroups {
  required: ArgRow[];
  set: ArgRow[];
  optional: ArgRow[];
}

/** the inspector editor that fits a schema attribute, if one does */
export function editorFieldFor(attr: SchemaAttribute): FieldDef | undefined {
  const type = parseType(attr.type);
  const base = { name: attr.name, required: attr.required, doc: attr.description };
  switch (type.kind) {
    case 'string':
      return { ...base, type: 'string' };
    case 'number':
      return { ...base, type: 'number' };
    case 'bool':
      return { ...base, type: 'boolean' };
    case 'list':
    case 'set':
      return type.elem.kind === 'string' ? { ...base, type: 'list' } : undefined;
    case 'map':
      return type.elem.kind === 'string' ? { ...base, type: 'tags' } : undefined;
    default:
      return undefined;
  }
}

/**
 * Findings about a row: its own key's, and any from inside its blocks. A
 * missing top-level argument isn't repeated — its row already says required.
 */
function issuesOf(issues: SchemaIssue[], keys: string[]): SchemaIssue[] {
  return issues.filter((i) => (i.path.length === 0 ? keys.includes(i.key ?? '') : keys.includes(String(i.path[0]))));
}

function rowFor(entry: SchemaEntry, keys: string[], issues: SchemaIssue[], args: Record<string, Expression>): ArgRow {
  const opaque = keys.some((k) => bodyKeyName(k)?.via !== 'plain');
  const field = entry.kind === 'attribute' ? editorFieldFor(entry) : undefined;
  // attributes written in block syntax (`ingress { }`) are code-only too
  const blockSyntax = keys.some((k) => args[k]?.kind === 'block' || args[k]?.kind === 'blocks');
  return {
    name: entry.name,
    keys,
    entry,
    kind: entry.kind === 'block' ? 'block' : field && !blockSyntax ? 'simple' : 'complex',
    field: blockSyntax ? undefined : field,
    required: isRequired(entry),
    deprecated: entry.deprecated,
    issues: issuesOf(issues, keys),
    opaque,
    blockCount: blockCount(keys, args),
  };
}

export function buildArgGroups(
  node: ResourceNode,
  block: SchemaBlock,
  curated: Set<string>,
  issues: SchemaIssue[],
): ArgGroups {
  // which body keys stand for which schema name
  const keysByName = new Map<string, string[]>();
  const order: string[] = [];
  for (const key of Object.keys(node.args)) {
    const named = bodyKeyName(key);
    if (!named) continue;
    if (!keysByName.has(named.name)) {
      keysByName.set(named.name, []);
      order.push(named.name);
    }
    keysByName.get(named.name)!.push(key);
  }

  const groups: ArgGroups = { required: [], set: [], optional: [] };
  const listed = new Set<string>();
  for (const entry of settableEntries(block)) {
    if (curated.has(entry.name)) continue;
    listed.add(entry.name);
    const keys = keysByName.get(entry.name) ?? [];
    const row = rowFor(entry, keys, issues, node.args);
    if (row.required) groups.required.push(row);
    else if (keys.length === 0) groups.optional.push(row);
  }
  // set arguments in code order: schema ones, then meta-arguments and unknown keys
  for (const name of order) {
    if (curated.has(name) || groups.required.some((r) => r.name === name)) continue;
    const keys = keysByName.get(name)!;
    const entry = entryOf(block, name);
    if (entry) {
      groups.set.push(rowFor(entry, keys, issues, node.args));
      continue;
    }
    const meta = META_ARGUMENTS.has(name);
    groups.set.push({
      name,
      keys,
      kind: meta ? 'meta' : 'unknown',
      required: false,
      deprecated: false,
      issues: meta ? [] : issuesOf(issues, keys),
      opaque: keys.some((k) => bodyKeyName(k)?.via !== 'plain'),
      blockCount: blockCount(keys, node.args),
    });
  }
  groups.optional.sort((a, b) => Number(a.deprecated) - Number(b.deprecated) || (a.name < b.name ? -1 : 1));
  return groups;
}

/** case-insensitive match on the name (spaces act like underscores) or the description */
export function matchesQuery(row: ArgRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = row.name.toLowerCase();
  return name.includes(q) || name.includes(q.replace(/\s+/g, '_')) || (row.entry?.description?.toLowerCase().includes(q) ?? false);
}
