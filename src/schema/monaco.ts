/**
 * Schema-backed completion and hover for the Monaco providers in
 * src/features/editor/monaco/setup.ts. Every function returns undefined when
 * no schema applies (not loaded yet, unknown type), and the caller falls back
 * to its catalog-only behavior — so nothing changes until a schema arrives.
 * Our labels are built when Monaco asks, in the UI language in effect; the
 * schema's own descriptions are the provider's English.
 *
 * `data` blocks read the provider's data sources (their own lazy chunk):
 * their arguments in the body, `data "…` type labels, and what
 * `data.aws_ami.ubuntu.` exposes.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { messagesFor } from '@/i18n/messages';
import { bodyCompletions, dataTypeCompletions, entryDetail, exportCompletions, type SchemaCompletion } from './completion';
import { cursorContext, dataReferenceBefore, referenceBefore } from './context';
import { blockAt, entryOf } from './lookup';
import { schemaMessages } from './messages';
import { DATA_SOURCES_WITH_HELP } from './popular';
import {
  dataSchemaFor,
  getDataSchema,
  getProviderSchema,
  requestDataSchemasFor,
  requestSchemasFor,
  schemaFor,
  schemaProviderOf,
} from './store';
import { SCHEMA_PROVIDERS, type SchemaEntry, type SchemaProvider } from './types';

type MonacoApi = typeof Monaco;

const PROVIDER_NAMES = { aws: 'AWS', azurerm: 'AzureRM', google: 'Google' } as const;

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

/** the loaded data-source schema of `type`, asking for it when it isn't there yet */
function dataSchemaOrRequest(type: string) {
  const schema = dataSchemaFor(type);
  if (!schema && schemaProviderOf(type)) requestDataSchemasFor([type]);
  return schema;
}

/**
 * Attribute and block names for the block body at the caret (a resource's,
 * or a data block's). `nested` tells the caller the caret is inside a nested
 * block, where the catalog's top-level fields don't apply.
 */
export function schemaBodySuggestions(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  range: Monaco.IRange,
  curated: Set<string>,
): { suggestions: Monaco.languages.CompletionItem[]; nested: boolean } | undefined {
  const ctx = cursorContext(model.getValue(), model.getOffsetAt(position));
  const type = ctx.resourceType ?? ctx.dataType;
  if (!type || ctx.where !== 'body') return undefined;
  // a data block's arguments come from the provider's data sources (the catalog has no fields for them)
  const schema = ctx.dataType ? dataSchemaOrRequest(type) : schemaOrRequest(type);
  if (!schema) return undefined;
  const nested = ctx.path.length > 0;
  const block = blockAt(schema.resource(type)!, ctx.path);
  if (!block) return { suggestions: [], nested };
  const items = bodyCompletions(block, { written: ctx.keys, curated: nested || ctx.dataType ? undefined : curated });
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

/** after `data.aws_ami.ubuntu.`: the attributes that data source exposes */
export function dataReferenceSuggestions(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): Monaco.languages.CompletionItem[] | undefined {
  const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const ref = dataReferenceBefore(before);
  if (!ref) return undefined;
  const schema = dataSchemaOrRequest(ref.type);
  if (!schema) return undefined;
  const range = new monaco.Range(position.lineNumber, position.column - ref.partial.length, position.lineNumber, position.column);
  return exportCompletions(schema.resource(ref.type)!).map((c) => toItem(monaco, c, range));
}

const PROVIDER_PREFIX = /^(aws|azurerm|google)_/;

/**
 * `data "…` being typed: data source types, the common ones first, then
 * every one the loaded data schemas know. The data chunks of the typed
 * prefix's provider and of `providers` (the project's) are asked for.
 */
export function dataTypeSuggestions(
  monaco: MonacoApi,
  typed: string,
  range: Monaco.IRange,
  providers: Iterable<SchemaProvider>,
): Monaco.languages.CompletionItem[] {
  const wanted = new Set(providers);
  const prefix = PROVIDER_PREFIX.exec(typed)?.[1] as SchemaProvider | undefined;
  if (prefix) wanted.add(prefix);
  requestDataSchemasFor([...wanted].map((p) => `${p}_`));
  const m = messagesFor(schemaMessages);
  const loaded = SCHEMA_PROVIDERS.flatMap((p) => getDataSchema(p)?.types() ?? []);
  const detail = (type: string) => {
    const provider = schemaProviderOf(type);
    if (!provider) return m.dataSource(type);
    const version = getDataSchema(provider)?.version;
    return m.dataSource(version ? m.providerVersion(PROVIDER_NAMES[provider], version) : PROVIDER_NAMES[provider]);
  };
  return dataTypeCompletions(loaded, DATA_SOURCES_WITH_HELP, detail).map((c) => ({
    label: c.label,
    kind: monaco.languages.CompletionItemKind.Class,
    insertText: c.label,
    detail: c.detail,
    sortText: c.sortText,
    range,
  }));
}

/**
 * The schema entry a word in the code names: a key in a block body (of a
 * resource or a data block), `aws_x.name.<attr>` or `data.aws_x.name.<attr>`.
 * `argument` is set for keys of the resource body itself (where the
 * catalog's curated help applies).
 */
export function schemaEntryAt(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): { entry: SchemaEntry; argument: boolean } | undefined {
  const word = model.getWordAtPosition(position);
  if (!word) return undefined;
  const line = model.getLineContent(position.lineNumber);
  const upTo = line.slice(0, word.startColumn - 1) + word.word;
  const read = dataReferenceBefore(upTo);
  if (read && read.partial === word.word) {
    const block = dataSchemaFor(read.type)?.resource(read.type);
    const entry = block ? entryOf(block, read.partial) : undefined;
    return entry ? { entry, argument: false } : undefined;
  }
  const ref = referenceBefore(upTo);
  if (ref && ref.partial === word.word) {
    const block = schemaFor(ref.type)?.resource(ref.type);
    const entry = block ? entryOf(block, ref.partial) : undefined;
    return entry ? { entry, argument: false } : undefined;
  }
  const offset = model.getOffsetAt({ lineNumber: position.lineNumber, column: word.startColumn });
  const ctx = cursorContext(model.getValue(), offset);
  const type = ctx.resourceType ?? ctx.dataType;
  if (!type || ctx.where !== 'body') return undefined;
  const after = line.slice(word.endColumn - 1);
  // `dynamic "ingress" {` names the ingress block
  const dynamicLabel = /dynamic\s+"$/.test(line.slice(0, word.startColumn - 1));
  if (!dynamicLabel && !/^\s*(=|\{|")/.test(after)) return undefined;
  const root = (ctx.dataType ? dataSchemaFor(type) : schemaFor(type))?.resource(type);
  const block = root ? blockAt(root, ctx.path) : undefined;
  const entry = block ? entryOf(block, word.word) : undefined;
  return entry ? { entry, argument: ctx.path.length === 0 && !ctx.dataType } : undefined;
}

/** hover markdown for a schema entry; `curatedDoc` (the catalog's help) wins over the schema's */
export function schemaHoverContents(entry: SchemaEntry, curatedDoc?: string): Monaco.IMarkdownString[] {
  const contents: Monaco.IMarkdownString[] = [{ value: `**${entry.name}** · \`${entryDetail(entry)}\`` }];
  const help = curatedDoc ?? entry.description;
  if (help) contents.push({ value: help });
  if (entry.deprecated) contents.push({ value: messagesFor(schemaMessages).deprecatedHeading(entry.deprecation) });
  return contents;
}

/** a resource type the catalog doesn't describe: what the provider schema knows about it */
export function schemaTypeHover(word: string): Monaco.IMarkdownString[] | undefined {
  const provider = schemaProviderOf(word);
  const schema = provider ? getProviderSchema(provider) : undefined;
  const block = schema?.resource(word);
  if (!provider || !schema || !block) return undefined;
  const args = Object.values(block.attributes).filter((a) => a.required || a.optional).length + Object.keys(block.blocks).length;
  const m = messagesFor(schemaMessages);
  const contents: Monaco.IMarkdownString[] = [
    { value: `**${word}** · ${m.providerVersion(PROVIDER_NAMES[provider], schema.version)}` },
    { value: m.argumentCount(args) },
  ];
  const deprecation = schema.resourceDeprecation(word);
  if (deprecation !== undefined) contents.push({ value: m.deprecatedHeading(deprecation) });
  return contents;
}

/** the type label of a `data "aws_ami"` header: what the provider's data sources say about it */
export function dataTypeHover(type: string): Monaco.IMarkdownString[] | undefined {
  const provider = schemaProviderOf(type);
  if (!provider) return undefined;
  const schema = dataSchemaOrRequest(type);
  const block = schema?.resource(type);
  if (!schema || !block) return undefined;
  const m = messagesFor(schemaMessages);
  const attributes = Object.values(block.attributes);
  const args = attributes.filter((a) => a.required || a.optional).length + Object.keys(block.blocks).length;
  const contents: Monaco.IMarkdownString[] = [
    { value: `**${type}** · ${m.dataSource(m.providerVersion(PROVIDER_NAMES[provider], schema.version))}` },
    { value: m.argumentCount(args) },
    { value: m.exposedCount(attributes.length) },
  ];
  const deprecation = schema.resourceDeprecation(type);
  if (deprecation !== undefined) contents.push({ value: m.deprecatedHeading(deprecation) });
  return contents;
}
