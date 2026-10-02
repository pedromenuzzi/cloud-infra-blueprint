/**
 * The schema-backed Monaco helpers inside `data` blocks, against a tiny
 * stand-in for Monaco's model and enums (no editor in the node test env).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import {
  dataReferenceSuggestions,
  dataTypeHover,
  dataTypeSuggestions,
  schemaBodySuggestions,
  schemaEntryAt,
} from './monaco';
import { loadDataSchema, loadSchema } from './store';
import { SCHEMA_PROVIDERS } from './types';

class Range {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

const fakeMonaco = {
  Range,
  languages: {
    CompletionItemKind: { Module: 8, Field: 3, Property: 9, Class: 5 },
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    CompletionItemTag: { Deprecated: 1 },
  },
} as unknown as typeof Monaco;

/** a model over `text`, the caret where `|` is */
function at(source: string) {
  const offset = source.indexOf('|');
  const text = source.replace('|', '');
  const lines = text.split('\n');
  const before = text.slice(0, offset).split('\n');
  const position = { lineNumber: before.length, column: before[before.length - 1].length + 1 } as Monaco.Position;
  const model = {
    getValue: () => text,
    getLineContent: (n: number) => lines[n - 1],
    getOffsetAt: (p: { lineNumber: number; column: number }) =>
      lines.slice(0, p.lineNumber - 1).reduce((sum, l) => sum + l.length + 1, 0) + p.column - 1,
    getWordAtPosition: (p: { lineNumber: number; column: number }) => {
      const line = lines[p.lineNumber - 1];
      let s = p.column - 1;
      let e = p.column - 1;
      while (s > 0 && /[\w-]/.test(line[s - 1])) s--;
      while (e < line.length && /[\w-]/.test(line[e])) e++;
      return s === e ? null : { word: line.slice(s, e), startColumn: s + 1, endColumn: e + 1 };
    },
  } as unknown as Monaco.editor.ITextModel;
  return { model, position };
}

const range = new Range(1, 1, 1, 1) as unknown as Monaco.IRange;

beforeAll(async () => {
  await Promise.all(SCHEMA_PROVIDERS.flatMap((p) => [loadSchema(p), loadDataSchema(p)]));
});

describe('Monaco inside data blocks', () => {
  it('completes a data block body from the data source schema, not the resource of the same name', () => {
    const { model, position } = at('data "aws_ami" "x" {\n  owners = ["self"]\n  mo|\n}\n');
    const result = schemaBodySuggestions(fakeMonaco, model, position, range, new Set(['ami']))!;
    const labels = result.suggestions.map((s) => s.label);
    expect(result.nested).toBe(false);
    expect(labels).toEqual(expect.arrayContaining(['most_recent', 'filter', 'name_regex']));
    expect(labels).not.toContain('owners'); // written
    expect(labels).not.toContain('image_id'); // only exposed
    const vpc = schemaBodySuggestions(fakeMonaco, at('data "aws_vpc" "x" {\n  |\n}\n').model, at('data "aws_vpc" "x" {\n  |\n}\n').position, range, new Set())!;
    // the data source's arguments (`default`, `filter`), not the resource's (`cidr_block` is settable on both, `enable_dns_hostnames` is only the resource's)
    expect(vpc.suggestions.map((s) => s.label)).toEqual(expect.arrayContaining(['default', 'filter']));
    expect(vpc.suggestions.map((s) => s.label)).not.toContain('enable_dns_hostnames');
  });

  it('completes nested blocks of a data block', () => {
    const { model, position } = at('data "aws_ami" "x" {\n  filter {\n    |\n  }\n}\n');
    const result = schemaBodySuggestions(fakeMonaco, model, position, range, new Set())!;
    expect(result.nested).toBe(true);
    expect(result.suggestions.map((s) => s.label).sort()).toEqual(['name', 'values']);
    expect(result.suggestions.find((s) => s.label === 'values')!.insertText).toBe('values = [$0]');
  });

  it('completes what a data source exposes after data.type.name.', () => {
    const { model, position } = at('resource "aws_instance" "w" {\n  availability_zone = data.aws_availability_zones.available.|\n}\n');
    const labels = dataReferenceSuggestions(fakeMonaco, model, position)!.map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['names', 'zone_ids', 'id']));
    const partial = at('output "a" {\n  value = data.aws_caller_identity.me.acc|\n}\n');
    const items = dataReferenceSuggestions(fakeMonaco, partial.model, partial.position)!;
    expect(items.map((s) => s.label)).toContain('account_id');
    expect(items[0].range).toMatchObject({ startColumn: partial.position.column - 3, endColumn: partial.position.column });
    expect(dataReferenceSuggestions(fakeMonaco, at('  x = aws_vpc.main.|\n').model, at('  x = aws_vpc.main.|\n').position)).toBeUndefined();
  });

  it('offers data source types after data ", the common ones first', () => {
    const items = dataTypeSuggestions(fakeMonaco, 'aws_', range, ['aws']);
    const labels = items.map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['aws_ami', 'aws_availability_zones', 'aws_vpcs', 'google_client_config']));
    const first = [...items].sort((a, b) => (a.sortText! < b.sortText! ? -1 : 1))[0];
    expect(first.sortText!.startsWith('0')).toBe(true);
    expect(items.find((s) => s.label === 'aws_ami')!.detail).toBe('data source · AWS provider 6.66.0');
  });

  it('hovers an attribute read from a data source, a data block argument and a data type label', () => {
    const read = at('output "z" {\n  value = data.aws_availability_zones.available.na|mes\n}\n');
    const hit = schemaEntryAt(read.model, read.position)!;
    expect(hit.entry).toMatchObject({ name: 'names', kind: 'attribute', type: 'list(string)' });
    expect(hit.argument).toBe(false);
    const arg = at('data "aws_ami" "x" {\n  most_re|cent = true\n}\n');
    expect(schemaEntryAt(arg.model, arg.position)!.entry).toMatchObject({ name: 'most_recent', type: 'bool' });
    const hover = dataTypeHover('aws_ami')!.map((c) => c.value);
    expect(hover[0]).toBe('**aws_ami** · data source · AWS provider 6.66.0');
    expect(hover.join('\n')).toMatch(/exposes \d+ attributes/);
    expect(dataTypeHover('aws_not_a_data_source')).toBeUndefined();
    expect(dataTypeHover('archive_file')).toBeUndefined();
  });
});
