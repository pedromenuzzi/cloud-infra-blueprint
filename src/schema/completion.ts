/**
 * Completion items and hover text from a provider schema, as plain data —
 * ./monaco.ts turns them into Monaco items (kept apart so they unit-test
 * without an editor).
 */
import { messagesFor } from '@/i18n/messages';
import { exportedEntries, isRequired, parseType, settableEntries } from './lookup';
import { schemaMessages, type SchemaText } from './messages';
import type { SchemaAttribute, SchemaBlock, SchemaBlockType, SchemaEntry } from './types';

export interface SchemaCompletion {
  label: string;
  kind: 'attribute' | 'block' | 'export';
  /** snippet syntax (`$0`, `${1|a,b|}`) */
  insertText: string;
  detail: string;
  /** markdown */
  documentation?: string;
  sortText: string;
  deprecated: boolean;
}

/** `name = "$0"` for a string, `name = [$0]` for a list… — the value shape its type wants */
export function attributeSnippet(attr: SchemaAttribute): string {
  const type = parseType(attr.type);
  switch (type.kind) {
    case 'string':
      return `${attr.name} = "$0"`;
    case 'bool':
      return `${attr.name} = \${1|true,false|}`;
    case 'list':
    case 'set':
    case 'tuple':
      return `${attr.name} = [$0]`;
    case 'map':
    case 'object':
      return `${attr.name} = {\n  $0\n}`;
    default:
      return `${attr.name} = $0`;
  }
}

/** `name {` … `}` — map-nested blocks carry a key label */
export function blockSnippet(block: SchemaBlockType): string {
  return block.nesting === 'map' ? `${block.name} "\${1:key}" {\n  $0\n}` : `${block.name} {\n  $0\n}`;
}

/** `block`, `block map`, `block list (max 3)` — in the UI language in effect */
export function nestingLabel(b: SchemaBlockType, m: SchemaText = messagesFor(schemaMessages)): string {
  return b.nesting === 'single' || (b.nesting === 'list' && b.maxItems === 1)
    ? m.block
    : b.nesting === 'map'
      ? m.blockMap
      : m.blockNesting(b.nesting, b.maxItems);
}

/** one line: `list(string)` · required · sensitive — in the UI language in effect */
export function entryDetail(entry: SchemaEntry): string {
  const m = messagesFor(schemaMessages);
  const parts: string[] = [];
  if (entry.kind === 'attribute') {
    parts.push(entry.type);
    parts.push(entry.required ? m.required : entry.optional ? m.optional : m.readOnlyDetail);
    if (entry.computed && (entry.optional || entry.required)) parts.push(m.computed);
    if (entry.sensitive) parts.push(m.sensitive);
    if (entry.writeOnly) parts.push(m.writeOnly);
  } else {
    parts.push(nestingLabel(entry, m));
    parts.push(entry.minItems > 0 ? m.required : m.optional);
  }
  if (entry.deprecated) parts.push(m.deprecatedDetail);
  return parts.join(' · ');
}

/** markdown for hovers and completion docs (the description is the provider's, in English) */
export function entryMarkdown(entry: SchemaEntry, heading = true): string {
  const lines: string[] = [];
  if (heading) lines.push(`**${entry.name}** · \`${entryDetail(entry)}\``);
  if (entry.description) lines.push(entry.description);
  if (entry.deprecated) lines.push(messagesFor(schemaMessages).deprecatedHeading(entry.deprecation));
  return lines.join('\n\n');
}

/**
 * Names that can go in this block body: required first, then optional,
 * deprecated last; ones already written are left out (repeatable blocks stay).
 * `curated` names are left to the catalog's own, richer items.
 */
export function bodyCompletions(
  block: SchemaBlock,
  options: { written?: Set<string>; curated?: Set<string> } = {},
): SchemaCompletion[] {
  const out: SchemaCompletion[] = [];
  for (const entry of settableEntries(block)) {
    if (options.curated?.has(entry.name)) continue;
    const repeatable = entry.kind === 'block' && entry.nesting !== 'single' && entry.maxItems !== 1;
    if (options.written?.has(entry.name) && !repeatable) continue;
    const rank = entry.deprecated ? 3 : isRequired(entry) ? 0 : 2;
    out.push({
      label: entry.name,
      kind: entry.kind,
      insertText: entry.kind === 'attribute' ? attributeSnippet(entry) : blockSnippet(entry),
      detail: entryDetail(entry),
      documentation: entryMarkdown(entry, false) || undefined,
      sortText: `${rank}${entry.name}`,
      deprecated: entry.deprecated,
    });
  }
  return out;
}

/** what `aws_x.name.` can read — `preferred` (the catalog's usual attribute) first */
export function exportCompletions(block: SchemaBlock, preferred?: string): SchemaCompletion[] {
  const entries = exportedEntries(block);
  const first = entries.findIndex((e) => e.name === preferred);
  if (first > 0) entries.unshift(...entries.splice(first, 1));
  return entries.map((entry, i) => ({
    label: entry.name,
    kind: 'export' as const,
    insertText: entry.name,
    detail: entry.kind === 'attribute' ? entry.type : entryDetail(entry),
    documentation: entryMarkdown(entry, false) || undefined,
    sortText: String(i).padStart(4, '0'),
    deprecated: entry.deprecated,
  }));
}
