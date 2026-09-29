import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { getDef } from '@/resources/registry';
import { parseType } from '@/schema/lookup';
import { loadSchema, resourceSchema } from '@/schema/store';
import type { SchemaAttribute } from '@/schema/types';
import { schemaIssues } from '@/schema/validate';
import { buildArgGroups, editorFieldFor, matchesQuery } from './schemaFieldsModel';

beforeAll(async () => {
  await loadSchema('aws');
});

function groupsFor(hcl: string) {
  const { ir } = parseProject({ 'main.tf': hcl });
  const node = ir.resources[0];
  const def = getDef(node.type);
  const curated = new Set(def?.fields.map((f) => f.name) ?? []);
  return buildArgGroups(node, resourceSchema(node.type)!, curated, schemaIssues(node, def));
}

const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

describe('All arguments rows', () => {
  it('leaves the curated fields out and lists the rest', () => {
    const g = groupsFor('resource "aws_instance" "web" {\n  ami           = "ami-1"\n  instance_type = "t3.micro"\n}\n');
    const all = [...g.required, ...g.set, ...g.optional].map((r) => r.name);
    for (const curated of getDef('aws_instance')!.fields.map((f) => f.name)) expect(all).not.toContain(curated);
    expect(all).toEqual(expect.arrayContaining(['monitoring', 'root_block_device', 'user_data']));
    expect(all).not.toContain('arn'); // read-only
    expect(all).not.toContain('id');
    expect(g.set).toEqual([]);
    // deprecated ones sort last
    expect(g.optional[g.optional.length - 1].deprecated).toBe(true);
  });

  it('groups required, then set in code order (dynamic, meta and unknown keys too)', () => {
    const g = groupsFor(`resource "aws_lb_listener" "http" {
  load_balancer_arn = "arn"
  port              = 80
  count             = 1
  dynamic "default_action" {
    for_each = []
    content {}
  }
  mutual_authenticaton {
  }
  tags = { a = "b" }
}
`);
    expect(names(g.required)).toEqual(['default_action']);
    expect(g.required[0]).toMatchObject({ kind: 'block', opaque: true, keys: ['dynamic "default_action" #0'] });
    expect(names(g.set)).toEqual(['count', 'mutual_authenticaton', 'tags']);
    expect(g.set[0].kind).toBe('meta');
    expect(g.set[1]).toMatchObject({ kind: 'unknown' });
    expect(g.set[2]).toMatchObject({ kind: 'simple', field: { type: 'tags' } });
    expect(g.set[1].issues[0].suggestion).toBe('mutual_authentication');
  });

  it('attaches nested findings to their block row', () => {
    const g = groupsFor(`resource "aws_instance" "web" {
  ami           = "ami-1"
  instance_type = "t3.micro"
  root_block_device {
    volum_size = 20
  }
  monitoring = "yes"
}
`);
    const root = g.set.find((r) => r.name === 'root_block_device')!;
    expect(root.issues.map((i) => i.suggestion)).toEqual(['volume_size']);
    expect(root.blockCount).toBe(1);
    const monitoring = g.set.find((r) => r.name === 'monitoring')!;
    expect(monitoring).toMatchObject({ kind: 'simple', field: { type: 'boolean' } });
    expect(monitoring.issues[0].kind).toBe('type');
  });

  it('attributes written as repeated blocks are previews, not editors', () => {
    const g = groupsFor(`resource "aws_security_group" "web" {
  name = "web"
  ingress {
    from_port = 80
  }
  ingress {
    from_port = 443
  }
}
`);
    const ingress = g.set.find((r) => r.name === 'ingress')!;
    expect(ingress).toMatchObject({ kind: 'complex', blockCount: 2 });
    expect(ingress.field).toBeUndefined();
  });

  it('searches names (spaces as underscores) and descriptions', () => {
    const g = groupsFor('resource "aws_instance" "web" {\n  ami = "a"\n  instance_type = "t"\n}\n');
    const rows = [...g.optional];
    expect(names(rows.filter((r) => matchesQuery(r, 'root block')))).toEqual(['root_block_device']);
    expect(rows.filter((r) => matchesQuery(r, 'region')).length).toBeGreaterThan(0); // name or description
    expect(rows.every((r) => matchesQuery(r, '  '))).toBe(true);
  });
});

describe('editor fields for schema types', () => {
  const attr = (type: string): SchemaAttribute => ({
    kind: 'attribute', name: 'x', type, required: true, optional: false, computed: false, sensitive: false, deprecated: false, writeOnly: false, description: 'help',
  });
  it('reuses the inspector editors for simple types only', () => {
    expect(editorFieldFor(attr('string'))).toEqual({ name: 'x', type: 'string', required: true, doc: 'help' });
    expect(editorFieldFor(attr('number'))?.type).toBe('number');
    expect(editorFieldFor(attr('bool'))?.type).toBe('boolean');
    expect(editorFieldFor(attr('list(string)'))?.type).toBe('list');
    expect(editorFieldFor(attr('set(string)'))?.type).toBe('list');
    expect(editorFieldFor(attr('map(string)'))?.type).toBe('tags');
    expect(editorFieldFor(attr('list(number)'))).toBeUndefined();
    expect(editorFieldFor(attr('map(list(string))'))).toBeUndefined();
    expect(editorFieldFor(attr('object({ a = string })'))).toBeUndefined();
    expect(parseType('any').kind).toBe('any');
  });
});
