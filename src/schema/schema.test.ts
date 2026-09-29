import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { providerSourceName } from '@/ir/types';
import { allDefs } from '@/resources/registry';
import { scratchProject, TEMPLATES } from '@/templates';
import { attributeSnippet, blockSnippet, bodyCompletions, exportCompletions } from './completion';
import { cursorContext, referenceBefore } from './context';
import { blockAt, closestName, editDistance, entryOf, exportedEntries, parseType, settableEntries } from './lookup';
import { GOOGLE_WITH_HELP } from './popular';
import { getProviderSchema, loadSchema, resourceSchema, schemaProviderOf, useSchemas } from './store';
import { SCHEMA_PROVIDERS, type SchemaAttribute, type SchemaBlockType, type SchemaData } from './types';
import { constraintAllows, providerConstraints } from './versions';

const dataFile = (p: string) => new URL(`./data/${p}.json`, import.meta.url);

describe('lazy loading', () => {
  it('knows nothing until a provider schema is loaded, then looks up synchronously', async () => {
    expect(resourceSchema('aws_instance')).toBeUndefined();
    const revision = useSchemas.getState().revision;
    const pending = loadSchema('aws');
    expect(useSchemas.getState().status.aws).toBe('loading');
    expect(loadSchema('aws')).toBe(pending); // one request per provider
    await pending;
    expect(useSchemas.getState().status.aws).toBe('ready');
    expect(useSchemas.getState().revision).toBe(revision + 1);
    expect(resourceSchema('aws_instance')).toBeDefined();
    expect(resourceSchema('google_compute_instance')).toBeUndefined(); // its own chunk, not loaded
  });

  it('maps resource types to providers', () => {
    expect(schemaProviderOf('aws_s3_bucket')).toBe('aws');
    expect(schemaProviderOf('azurerm_resource_group')).toBe('azurerm');
    expect(schemaProviderOf('google_storage_bucket')).toBe('google');
    expect(schemaProviderOf('azuread_user')).toBeUndefined();
    expect(schemaProviderOf('random_id')).toBeUndefined();
  });
});

describe('shipped schemas', () => {
  beforeAll(async () => {
    await Promise.all(SCHEMA_PROVIDERS.map((p) => loadSchema(p)));
  });

  // each chunk is what Vite emits for a JSON import: `JSON.parse("<the json, as a JS string>")`
  it.each(SCHEMA_PROVIDERS)('%s stays inside the 300 KB gzip budget', (provider) => {
    const data = JSON.parse(readFileSync(dataFile(provider), 'utf8')) as SchemaData;
    const chunk = `export default /* #__PURE__ */ JSON.parse(${JSON.stringify(JSON.stringify(data))})`;
    const gzip = gzipSync(chunk).length;
    expect(gzip, `${provider} chunk is ${(gzip / 1024).toFixed(0)} KB gzip`).toBeLessThanOrEqual(300 * 1024);
  });

  it('covers every palette type, at the provider version the templates pin', () => {
    for (const def of allDefs()) {
      const provider = providerSourceName(def.provider) as 'aws';
      const schema = getProviderSchema(provider)!;
      expect(schema.has(def.type), def.type).toBe(true);
      const pin = /version\s*=\s*"([^"]+)"/.exec(scratchProject(def.provider, 'x')['versions.tf'])![1];
      expect(constraintAllows(pin, schema.version), `${provider} ${schema.version} vs ${pin}`).toBe(true);
    }
  });

  it('covers every resource type of each provider', () => {
    expect(getProviderSchema('aws')!.types().length).toBeGreaterThan(1500);
    expect(getProviderSchema('azurerm')!.types().length).toBeGreaterThan(1000);
    expect(getProviderSchema('google')!.types().length).toBeGreaterThan(1200);
  });

  it('keeps Google help text for the hand-picked common resources', () => {
    const google = getProviderSchema('google')!;
    for (const type of GOOGLE_WITH_HELP) expect(google.has(type), type).toBe(true);
    expect(google.resource('google_storage_bucket')!.attributes.location.description).toMatch(/\w/);
  });

  it('decodes attributes and nested blocks', () => {
    const ec2 = resourceSchema('aws_instance')!;
    expect(ec2.attributes.instance_type).toMatchObject({ type: 'string', optional: true, computed: true, required: false });
    expect(ec2.attributes.arn).toMatchObject({ computed: true, optional: false });
    expect(ec2.blocks.root_block_device).toMatchObject({ nesting: 'list', maxItems: 1 });
    expect(blockAt(ec2, ['root_block_device'])!.attributes.volume_size.type).toBe('number');
    expect(blockAt(ec2, ['nope'])).toBeUndefined();
    expect(entryOf(ec2, 'metadata_options')?.kind).toBe('block');
    expect(entryOf(ec2, 'constructor')).toBeUndefined(); // no prototype leaks
    const listener = resourceSchema('aws_lb_listener')!;
    expect(listener.blocks.default_action.minItems).toBe(1);
  });

  it('lists settable entries required first, and exports computed attributes first', () => {
    const names = settableEntries(resourceSchema('aws_lb_listener')!).map((e) => e.name);
    expect(names[0]).toBe('default_action');
    expect(names).not.toContain('arn');
    expect(names).not.toContain('id');
    const exported = exportedEntries(resourceSchema('aws_db_instance')!).map((e) => e.name);
    expect(exported[0]).toBe('id');
    expect(exported.indexOf('endpoint')).toBeLessThan(exported.indexOf('engine'));
    expect(exported).toContain('arn');
  });
});

describe('types and suggestions', () => {
  it('parses type expressions', () => {
    expect(parseType('list(string)')).toEqual({ kind: 'list', elem: { kind: 'string' } });
    expect(parseType('map(list(number))')).toEqual({ kind: 'map', elem: { kind: 'list', elem: { kind: 'number' } } });
    expect(parseType('object({ a = string, b = set(bool) })')).toEqual({
      kind: 'object',
      fields: { a: { kind: 'string' }, b: { kind: 'set', elem: { kind: 'bool' } } },
    });
    expect(parseType('tuple([string, number])')).toEqual({ kind: 'tuple', elems: [{ kind: 'string' }, { kind: 'number' }] });
    expect(parseType('weird(')).toEqual({ kind: 'any' });
  });

  it('suggests close names only', () => {
    expect(editDistance('instnace_type', 'instance_type')).toBe(1);
    expect(closestName('instance_typ', ['instance_type', 'ami'])).toBe('instance_type');
    expect(closestName('Tags', ['tags', 'tags_all'])).toBe('tags');
    expect(closestName('banana', ['instance_type', 'ami'])).toBeUndefined();
    expect(closestName('ab', ['ami'])).toBeUndefined();
  });
});

describe('completion items', () => {
  beforeAll(async () => {
    await loadSchema('aws');
  });
  const attr = (name: string, type: string): SchemaAttribute => ({
    kind: 'attribute', name, type, required: false, optional: true, computed: false, sensitive: false, deprecated: false, writeOnly: false,
  });

  it('writes attributes as `name = …` and blocks as `name { }`', () => {
    expect(attributeSnippet(attr('name', 'string'))).toBe('name = "$0"');
    expect(attributeSnippet(attr('port', 'number'))).toBe('port = $0');
    expect(attributeSnippet(attr('on', 'bool'))).toBe('on = ${1|true,false|}');
    expect(attributeSnippet(attr('ids', 'set(string)'))).toBe('ids = [$0]');
    expect(attributeSnippet(attr('tags', 'map(string)'))).toBe('tags = {\n  $0\n}');
    const block = { kind: 'block', name: 'disk', nesting: 'list', minItems: 0, maxItems: 1 } as SchemaBlockType;
    expect(blockSnippet(block)).toBe('disk {\n  $0\n}');
    expect(blockSnippet({ ...block, nesting: 'map' } as SchemaBlockType)).toBe('disk "${1:key}" {\n  $0\n}');
  });

  it('puts required entries first and leaves out curated and written ones', () => {
    const items = bodyCompletions(resourceSchema('aws_lb_listener')!, {
      curated: new Set(['load_balancer_arn']),
      written: new Set(['port']),
    });
    expect(items[0]).toMatchObject({ label: 'default_action', kind: 'block', insertText: 'default_action {\n  $0\n}' });
    expect(items[0].sortText < items[1].sortText).toBe(true);
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('load_balancer_arn');
    expect(labels).not.toContain('port');
    expect(labels).not.toContain('arn'); // read-only
    expect(labels).toContain('certificate_arn');
  });

  it('completes inside nested blocks, keeping repeatable blocks', () => {
    const listener = resourceSchema('aws_lb_listener')!;
    const action = bodyCompletions(blockAt(listener, ['default_action'])!, { written: new Set(['type', 'forward']) });
    const labels = action.map((i) => i.label);
    expect(labels).not.toContain('type');
    expect(labels).not.toContain('forward'); // a single block, already there
    expect(labels).toContain('fixed_response');
    const ec2 = bodyCompletions(resourceSchema('aws_instance')!, { written: new Set(['ebs_block_device']) });
    expect(ec2.map((i) => i.label)).toContain('ebs_block_device'); // a set of blocks: add another
    const volume = bodyCompletions(blockAt(resourceSchema('aws_instance')!, ['root_block_device'])!).find((i) => i.label === 'volume_size')!;
    expect(volume).toMatchObject({ kind: 'attribute', insertText: 'volume_size = $0', detail: 'number · optional · computed' });
  });

  it('marks deprecated entries and sorts them last', () => {
    const items = bodyCompletions(resourceSchema('aws_instance')!);
    const nic = items.find((i) => i.label === 'network_interface')!;
    expect(nic.deprecated).toBe(true);
    expect(nic.sortText.startsWith('3')).toBe(true);
  });

  it('completes exported attributes, the catalog attribute first', () => {
    const items = exportCompletions(resourceSchema('aws_db_instance')!, 'address');
    expect(items[0].label).toBe('address');
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['arn', 'id', 'endpoint', 'port']));
    expect(items.every((i) => i.kind === 'export' && i.insertText === i.label)).toBe(true);
  });
});

describe('cursor context', () => {
  const at = (text: string) => cursorContext(text.replace('|', ''), text.indexOf('|'));

  it('finds the resource and the nested block path', () => {
    expect(at('resource "aws_instance" "web" {\n  |\n}')).toMatchObject({ resourceType: 'aws_instance', path: [], where: 'body' });
    expect(at('resource "aws_instance" "web" {\n  ami = "x"\n  root_block_device {\n    vol|\n  }\n}')).toMatchObject({
      resourceType: 'aws_instance',
      path: ['root_block_device'],
      where: 'body',
    });
    expect(at('resource "aws_lb" "a" {\n  access_logs {\n    bucket = "b"\n  }\n  |\n}').path).toEqual([]);
  });

  it('collects the keys already written in the block', () => {
    const ctx = at('resource "aws_instance" "web" {\n  ami = "x"\n  tags = {\n    a = "b"\n  }\n  root_block_device {}\n  |\n}');
    expect([...ctx.keys].sort()).toEqual(['ami', 'root_block_device', 'tags']);
  });

  it('resolves dynamic blocks to their label, and leaves meta blocks alone', () => {
    expect(at('resource "aws_security_group" "s" {\n  dynamic "ingress" {\n    for_each = []\n    content {\n      |\n    }\n  }\n}')).toMatchObject({
      path: ['ingress'],
      where: 'body',
    });
    expect(at('resource "aws_security_group" "s" {\n  dynamic "ingress" {\n    |\n  }\n}').where).toBe('meta');
    expect(at('resource "aws_instance" "w" {\n  lifecycle {\n    |\n  }\n}').where).toBe('meta');
    expect(at('variable "x" {\n  |\n}').where).toBe('meta');
  });

  it('knows values, strings, comments and heredocs from statement starts', () => {
    expect(at('resource "aws_instance" "w" {\n  ami = |\n}').where).toBe('value');
    expect(at('resource "aws_instance" "w" {\n  tags = {\n    |\n  }\n}').where).toBe('value');
    expect(at('resource "aws_instance" "w" {\n  ami = "ab|c"\n}').where).toBe('string');
    expect(at('resource "aws_instance" "w" {\n  # note |\n}').where).toBe('string');
    expect(at('resource "aws_instance" "w" {\n  user_data = <<-EOT\n    echo |\n  EOT\n}').where).toBe('string');
    // braces inside strings and interpolations don't open blocks
    expect(at('resource "aws_instance" "w" {\n  name = "${var.a}{"\n  |\n}')).toMatchObject({ path: [], where: 'body' });
    expect(at('resource "aws_instance" "w" {\n  user_data = <<EOT\n{ not a block\nEOT\n  |\n}')).toMatchObject({ path: [], where: 'body' });
  });

  it('spots attribute references being typed', () => {
    expect(referenceBefore('  value = aws_db_instance.main.end')).toEqual({ type: 'aws_db_instance', name: 'main', partial: 'end' });
    expect(referenceBefore('  name = "${aws_s3_bucket.logs.')).toEqual({ type: 'aws_s3_bucket', name: 'logs', partial: '' });
    expect(referenceBefore('  ami = data.aws_ami.ubuntu.')).toBeUndefined();
    expect(referenceBefore('  x = var.foo.')).toBeUndefined();
  });
});

describe('version pins', () => {
  it('reads required_providers from the terraform block', () => {
    for (const t of TEMPLATES.filter((x) => x.slug === 'multi-cloud-dr')) {
      const { ir } = parseProject(t.build('x'));
      expect(providerConstraints(ir)).toEqual({ aws: '~> 6.0', azurerm: '~> 5.0', google: '~> 8.0' });
    }
    const { ir } = parseProject({
      'versions.tf': 'terraform {\n  required_providers {\n    aws = {\n      source  = "hashicorp/aws"\n      version = ">= 4.0, < 5.0"\n    }\n    gcp = {\n      source = "hashicorp/google"\n      version = "~> 7.1"\n    }\n  }\n}\n',
    });
    expect(providerConstraints(ir)).toEqual({ aws: '>= 4.0, < 5.0', google: '~> 7.1' });
  });

  it('evaluates constraints', () => {
    expect(constraintAllows('~> 6.0', '6.66.0')).toBe(true);
    expect(constraintAllows('~> 5.0', '6.66.0')).toBe(false);
    expect(constraintAllows('~> 6.60.1', '6.66.0')).toBe(false);
    expect(constraintAllows('~> 6.66.0', '6.66.3')).toBe(true);
    expect(constraintAllows('~> 6', '6.1.0')).toBe(true);
    expect(constraintAllows('>= 5.0, < 7.0', '6.66.0')).toBe(true);
    expect(constraintAllows('= 6.65.0', '6.66.0')).toBe(false);
    expect(constraintAllows('6.66.0', '6.66.0')).toBe(true);
    expect(constraintAllows('!= 6.66.0', '6.66.0')).toBe(false);
    expect(constraintAllows('whatever', '6.66.0')).toBe(true);
  });
});
