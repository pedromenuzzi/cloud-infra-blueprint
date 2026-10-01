import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { bodyCompletions, dataTypeCompletions, exportCompletions } from './completion';
import { cursorContext, dataReferenceBefore, dataTypeLabelBefore, referenceBefore } from './context';
import { blockAt, exportedEntries, settableEntries } from './lookup';
import { DATA_SOURCE_USUAL_ATTRIBUTE, DATA_SOURCES_WITH_HELP } from './popular';
import {
  dataSchemaFor,
  dataSourceSchema,
  getDataSchema,
  loadDataSchema,
  requestDataSchemasFor,
  resourceSchema,
  usualDataAttribute,
  useSchemas,
} from './store';
import { SCHEMA_PROVIDERS, type SchemaData, type SchemaProvider } from './types';

const dataFile = (p: string) => new URL(`./data/${p}.data.json`, import.meta.url);

describe('data-source chunks load on their own', () => {
  it('knows no data source until the chunk arrives, and leaves the resource chunk alone', async () => {
    expect(dataSourceSchema('aws_ami')).toBeUndefined();
    const revision = useSchemas.getState().revision;
    const pending = loadDataSchema('aws');
    expect(useSchemas.getState().dataStatus.aws).toBe('loading');
    expect(loadDataSchema('aws')).toBe(pending);
    await pending;
    expect(useSchemas.getState().dataStatus.aws).toBe('ready');
    expect(useSchemas.getState().revision).toBe(revision + 1);
    expect(dataSourceSchema('aws_ami')).toBeDefined();
    expect(dataSchemaFor('aws_ami')?.version).toBe(getDataSchema('aws')!.version);
    // a data source is not a resource type, and the resource chunk wasn't fetched
    expect(useSchemas.getState().schemas.aws).toBeUndefined();
    expect(resourceSchema('aws_ami')).toBeUndefined();
    expect(dataSourceSchema('aws_instance_nope')).toBeUndefined();
    expect(dataSourceSchema('google_client_config')).toBeUndefined(); // its own chunk, not loaded
  });

  it('requests chunks by the providers of data source types', async () => {
    requestDataSchemasFor(['google_compute_zones', 'random_thing', 'terraform_remote_state']);
    expect(useSchemas.getState().dataStatus.google).toBe('loading');
    expect(useSchemas.getState().dataStatus.azurerm).toBeUndefined();
    await loadDataSchema('google');
    expect(dataSourceSchema('google_compute_zones')).toBeDefined();
  });
});

describe('shipped data-source schemas', () => {
  beforeAll(async () => {
    await Promise.all(SCHEMA_PROVIDERS.map((p) => loadDataSchema(p)));
  });

  // what Vite emits for a JSON import: `JSON.parse("<the json, as a JS string>")`
  it.each(SCHEMA_PROVIDERS)('%s.data stays well inside the 300 KB gzip budget (under 120 KB)', (provider) => {
    const data = JSON.parse(readFileSync(dataFile(provider), 'utf8')) as SchemaData;
    expect(data.kind).toBe('data');
    const chunk = `export default /* #__PURE__ */ JSON.parse(${JSON.stringify(JSON.stringify(data))})`;
    const gzip = gzipSync(chunk).length;
    expect(gzip, `${provider}.data chunk is ${(gzip / 1024).toFixed(0)} KB gzip`).toBeLessThanOrEqual(120 * 1024);
  });

  it('records the same provider version as the resource chunk', () => {
    for (const provider of SCHEMA_PROVIDERS) {
      const resources = JSON.parse(readFileSync(new URL(`./data/${provider}.json`, import.meta.url), 'utf8')) as SchemaData;
      expect(getDataSchema(provider)!.version, provider).toBe(resources.version);
    }
  });

  it('covers every data source of each provider, the common ones included', () => {
    expect(getDataSchema('aws')!.types().length).toBeGreaterThan(600);
    expect(getDataSchema('azurerm')!.types().length).toBeGreaterThan(350);
    expect(getDataSchema('google')!.types().length).toBeGreaterThan(400);
    for (const type of DATA_SOURCES_WITH_HELP) expect(dataSourceSchema(type), type).toBeDefined();
    for (const type of Object.keys(DATA_SOURCE_USUAL_ATTRIBUTE)) {
      const block = dataSourceSchema(type);
      if (!block) continue; // terraform_remote_state, archive_file: other providers
      expect(Object.hasOwn(block.attributes, DATA_SOURCE_USUAL_ATTRIBUTE[type]), `${type}.${DATA_SOURCE_USUAL_ATTRIBUTE[type]}`).toBe(true);
    }
  });

  it('decodes arguments, nested blocks and exposed attributes', () => {
    const ami = dataSourceSchema('aws_ami')!;
    expect(ami.attributes.most_recent).toMatchObject({ type: 'bool', optional: true, required: false });
    expect(ami.attributes.owners.type).toBe('list(string)');
    expect(ami.attributes.image_id).toMatchObject({ computed: true, optional: false });
    expect(blockAt(ami, ['filter'])!.attributes.values).toMatchObject({ required: true, type: 'set(string)' });
    const args = settableEntries(ami).map((e) => e.name);
    expect(args).toEqual(expect.arrayContaining(['most_recent', 'owners', 'name_regex', 'filter']));
    expect(args).not.toContain('image_id');
    const exposed = exportedEntries(ami).map((e) => e.name);
    expect(exposed[0]).toBe('id');
    expect(exposed).toEqual(expect.arrayContaining(['arn', 'image_id', 'name', 'root_device_name']));
    expect(dataSourceSchema('aws_ssm_parameter')!.attributes.name.required).toBe(true);
    expect(dataSourceSchema('azurerm_client_config')!.attributes.tenant_id.computed).toBe(true);
  });

  it('keeps help for Google common data sources, structure only for the long tail', () => {
    expect(dataSourceSchema('google_storage_bucket')!.attributes.name.description).toMatch(/bucket/);
    // a long-tail data source derived from its resource: the resource's help isn't repeated
    const tail = getDataSchema('google')!.types().filter((t) => !DATA_SOURCES_WITH_HELP.includes(t));
    const described = tail.filter((t) => Object.values(dataSourceSchema(t)!.attributes).some((a) => a.description));
    expect(described).toEqual([]);
  });

  it('the attribute a data source is usually read through', () => {
    expect(usualDataAttribute('aws_availability_zones')).toBe('names');
    expect(usualDataAttribute('aws_iam_policy_document')).toBe('json');
    expect(usualDataAttribute('terraform_remote_state')).toBe('outputs');
    // uncurated: the first attribute it only exposes
    const vpcs = dataSourceSchema('aws_vpcs')!;
    expect(Object.hasOwn(vpcs.attributes, usualDataAttribute('aws_vpcs'))).toBe(true);
    expect(usualDataAttribute('random_nothing')).toBe('id');
  });

  it('completes a data block body and what it exposes', () => {
    const ami = dataSourceSchema('aws_ami')!;
    const labels = bodyCompletions(ami, { written: new Set(['owners']) }).map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['most_recent', 'filter', 'name_regex']));
    expect(labels).not.toContain('owners');
    expect(labels).not.toContain('image_id'); // read-only
    const exports = exportCompletions(dataSourceSchema('aws_availability_zones')!).map((c) => c.label);
    expect(exports).toEqual(expect.arrayContaining(['names', 'zone_ids', 'id']));
  });
});

describe('data blocks in the editor', () => {
  const at = (text: string) => cursorContext(text.replace('|', ''), text.indexOf('|'));

  it('finds the data source type and the nested path', () => {
    expect(at('data "aws_ami" "ubuntu" {\n  |\n}')).toMatchObject({ dataType: 'aws_ami', path: [], where: 'body' });
    expect(at('data "aws_ami" "ubuntu" {\n  |\n}').resourceType).toBeUndefined();
    expect(at('data "aws_ami" "u" {\n  most_recent = true\n  filter {\n    na|\n  }\n}')).toMatchObject({
      dataType: 'aws_ami',
      path: ['filter'],
      where: 'body',
    });
    expect([...at('data "aws_ami" "u" {\n  owners = ["x"]\n  filter {}\n  |\n}').keys].sort()).toEqual(['filter', 'owners']);
    expect(at('data "aws_ami" "u" {\n  owners = |\n}').where).toBe('value');
    expect(at('data "aws_ami" "u" {\n  lifecycle {\n    |\n  }\n}').where).toBe('meta');
    // resources unchanged
    expect(at('resource "aws_instance" "web" {\n  |\n}')).toMatchObject({ resourceType: 'aws_instance', where: 'body' });
    expect(at('resource "aws_instance" "web" {\n  |\n}').dataType).toBeUndefined();
  });

  it('spots data source references and type labels being typed', () => {
    expect(dataReferenceBefore('  ami = data.aws_ami.ubuntu.')).toEqual({ type: 'aws_ami', name: 'ubuntu', partial: '' });
    expect(dataReferenceBefore('  az = data.aws_availability_zones.available.na')).toEqual({
      type: 'aws_availability_zones',
      name: 'available',
      partial: 'na',
    });
    expect(dataReferenceBefore('  vpc = data.aws_vpc.x[0].ar')).toEqual({ type: 'aws_vpc', name: 'x', partial: 'ar' });
    expect(dataReferenceBefore('  name = "${data.aws_region.current.')).toMatchObject({ type: 'aws_region', partial: '' });
    expect(dataReferenceBefore('  ami = data.aws_ami.')).toBeUndefined();
    expect(dataReferenceBefore('  x = mydata.aws_ami.u.')).toBeUndefined();
    expect(referenceBefore('  ami = data.aws_ami.ubuntu.')).toBeUndefined(); // not a resource reference
    expect(dataTypeLabelBefore('data "aws_am')).toBe('aws_am');
    expect(dataTypeLabelBefore('  data "')).toBe('');
    expect(dataTypeLabelBefore('data "aws_ami" "')).toBeUndefined();
    expect(dataTypeLabelBefore('resource "aws_')).toBeUndefined();
  });

  it('offers the common data source types first', () => {
    const items = dataTypeCompletions(['aws_vpcs', 'aws_ami', 'aws_zzz'], ['aws_ami', 'aws_region'], (t) => `d ${t}`);
    expect(items.map((i) => i.label)).toEqual(['aws_ami', 'aws_region', 'aws_vpcs', 'aws_zzz']);
    const sorted = [...items].sort((a, b) => (a.sortText < b.sortText ? -1 : 1)).map((i) => i.label);
    expect(sorted.slice(0, 2)).toEqual(['aws_ami', 'aws_region']);
    expect(items[0].detail).toBe('d aws_ami');
  });
});

describe('provider list', () => {
  it('ships one data chunk per provider', () => {
    for (const p of SCHEMA_PROVIDERS as readonly SchemaProvider[]) {
      expect(() => readFileSync(dataFile(p), 'utf8')).not.toThrow();
    }
  });
});
