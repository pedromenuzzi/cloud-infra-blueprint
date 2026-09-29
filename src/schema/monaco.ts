/**
 * Schema-backed completion and hover for the Monaco providers in
 * src/features/editor/monaco/setup.ts. Every function returns undefined when
 * no schema applies (not loaded yet, unknown type), and the caller falls back
 * to its catalog-only behavior — so nothing changes until a schema arrives.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { bodyCompletions, entryDetail, exportCompletions, type SchemaCompletion } from './completion';
import { cursorContext, referenceBefore } from './context';
import { blockAt, entryOf } from './lookup';
import { getProviderSchema, requestSchemasFor, schemaFor, schemaProviderOf } from './store';
import type { SchemaEntry } from './types';

type MonacoApi = typeof Monaco;

function toItem(monaco: MonacoApi, c: SchemaCompletion, range: Monaco.IRange): Monaco.languages.CompletionItem {
  const kinds = monaco.languages.CompletionItemKind;
  return {
    label: c.label,
    kind: c.kind === 'block' ? kinds.Module : c.kind === 'export' ? kinds.Field : kinds.Property,
    insertText: c.insertText,
    insertTextRules: c.kind === 'export' ? undefined : monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    detail: c.detail,
    documentation: c.documentation ? { value: c.documentation } : undefined,
    sortText: c.sortText,
    tags: c.deprecated ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
    range,
  };
}

/** the loaded schema of `type`, asking for it when it isn't there yet */
function schemaOrRequest(type: string) {
  const schema = schemaFor(type);
  if (!schema && schemaProviderOf(type)) requestSchemasFor([type]);
  return schema;
}

/**
 * Attribute and block names for the block body at the caret. `nested` tells
 * the caller the caret is inside a nested block, where the catalog's
 * top-level fields don't apply.
 */
export function schemaBodySuggestions(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  range: Monaco.IRange,
  curated: Set<string>,
): { suggestions: Monaco.languages.CompletionItem[]; nested: boolean } | undefined {
  const ctx = cursorContext(model.getValue(), model.getOffsetAt(position));
  if (!ctx.resourceType || ctx.where !== 'body') return undefined;
  const schema = schemaOrRequest(ctx.resourceType);
  if (!schema) return undefined;
  const nested = ctx.path.length > 0;
  const block = blockAt(schema.resource(ctx.resourceType)!, ctx.path);
  if (!block) return { suggestions: [], nested };
  const items = bodyCompletions(block, { written: ctx.keys, curated: nested ? undefined : curated });
  return { suggestions: items.map((c) => toItem(monaco, c, range)), nested };
}

/** after `aws_instance.web.`: the attributes that resource exports */
export function schemaReferenceSuggestions(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  preferred?: (type: string) => string | undefined,
): Monaco.languages.CompletionItem[] | undefined {
  const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const ref = referenceBefore(before);
  if (!ref) return undefined;
  const schema = schemaOrRequest(ref.type);
  if (!schema) return undefined;
  const range = new monaco.Range(position.lineNumber, position.column - ref.partial.length, position.lineNumber, position.column);
  return exportCompletions(schema.resource(ref.type)!, preferred?.(ref.type)).map((c) => toItem(monaco, c, range));
}

/**
 * The schema entry a word in the code names: a key in a block body, or
 * `aws_x.name.<attr>`. `argument` is set for keys of the resource body itself
 * (where the catalog's curated help applies).
 */
export function schemaEntryAt(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): { entry: SchemaEntry; argument: boolean } | undefined {
  const word = model.getWordAtPosition(position);
  if (!word) return undefined;
  const line = model.getLineContent(position.lineNumber);
  const ref = referenceBefore(line.slice(0, word.startColumn - 1) + word.word);
  if (ref && ref.partial === word.word) {
    const block = schemaFor(ref.type)?.resource(ref.type);
    const entry = block ? entryOf(block, ref.partial) : undefined;
    return entry ? { entry, argument: false } : undefined;
  }
  const offset = model.getOffsetAt({ lineNumber: position.lineNumber, column: word.startColumn });
  const ctx = cursorContext(model.getValue(), offset);
  if (!ctx.resourceType || ctx.where !== 'body') return undefined;
  const after = line.slice(word.endColumn - 1);
  // `dynamic "ingress" {` names the ingress block
  const dynamicLabel = /dynamic\s+"$/.test(line.slice(0, word.startColumn - 1));
  if (!dynamicLabel && !/^\s*(=|\{|")/.test(after)) return undefined;
  const root = schemaFor(ctx.resourceType)?.resource(ctx.resourceType);
  const block = root ? blockAt(root, ctx.path) : undefined;
  const entry = block ? entryOf(block, word.word) : undefined;
  return entry ? { entry, argument: ctx.path.length === 0 } : undefined;
}

/** hover markdown for a schema entry; `curatedDoc` (the catalog's help) wins over the schema's */
export function schemaHoverContents(entry: SchemaEntry, curatedDoc?: string): Monaco.IMarkdownString[] {
  const contents: Monaco.IMarkdownString[] = [{ value: `**${entry.name}** · \`${entryDetail(entry)}\`` }];
  const help = curatedDoc ?? entry.description;
  if (help) contents.push({ value: help });
  if (entry.deprecated) contents.push({ value: `**Deprecated**${entry.deprecation ? ` — ${entry.deprecation}` : ''}` });
  return contents;
}

const PROVIDER_NAMES = { aws: 'AWS', azurerm: 'AzureRM', google: 'Google' } as const;

/** a resource type the catalog doesn't describe: what the provider schema knows about it */
export function schemaTypeHover(word: string): Monaco.IMarkdownString[] | undefined {
  const provider = schemaProviderOf(word);
  const schema = provider ? getProviderSchema(provider) : undefined;
  const block = schema?.resource(word);
  if (!provider || !schema || !block) return undefined;
  const args = Object.values(block.attributes).filter((a) => a.required || a.optional).length + Object.keys(block.blocks).length;
  const contents: Monaco.IMarkdownString[] = [
    { value: `**${word}** · ${PROVIDER_NAMES[provider]} provider ${schema.version}` },
    { value: `${args} arguments and blocks — type inside the block to see them` },
  ];
  const deprecation = schema.resourceDeprecation(word);
  if (deprecation !== undefined) contents.push({ value: `**Deprecated**${deprecation ? ` — ${deprecation}` : ''}` });
  return contents;
}
