/**
 * The data source catalog: every type exists in the provider schema the app
 * ships, every preset is added without a schema warning, every "usually
 * read by" link names a real resource argument and a real attribute, and
 * the text is translated without dash punctuation.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { sentenceDash } from '@/i18n/dashes';
import { parseProject } from '@/hcl/parser';
import { applyOpsWithPatches } from '@/hcl/patch';
import { exprText } from '@/ir/repeat';
import { entryOf, isSettable } from '@/schema/lookup';
import { dataSourceSchema, loadDataSchema, loadSchema, resourceSchema } from '@/schema/store';
import { dataSchemaIssues } from '@/schema/validate';
import { SCHEMA_PROVIDERS } from '@/schema/types';
import { DATA_SOURCE_PRESETS, DATA_SOURCE_TYPES, dataDocsUrl, presetProvider, presetsFor, typeDef } from './catalog';
import { DATA_PRESETS_PT_BR, DATA_TYPES_PT_BR } from './catalog.messages';
import { dataSourceDescription, dataSourceName, dataSourceShortName, presetDescription, presetName } from './i18n';
import { buildDataNode } from './newData';

beforeAll(async () => {
  await Promise.all(SCHEMA_PROVIDERS.flatMap((p) => [loadSchema(p), loadDataSchema(p)]));
});

const SCHEMALESS = new Set(['terraform_remote_state']);

describe('the data source catalog', () => {
  it('holds types the shipped provider schemas know, with the attributes it names', () => {
    for (const t of DATA_SOURCE_TYPES) {
      if (SCHEMALESS.has(t.type)) continue;
      const block = dataSourceSchema(t.type);
      expect(block, t.type).toBeDefined();
      for (const attr of t.attributes) expect(entryOf(block!, attr), `${t.type}.${attr}`).toBeDefined();
    }
  });

  it('adds every preset without a schema warning, round-tripping through the patcher', () => {
    for (const preset of DATA_SOURCE_PRESETS) {
      const files = { 'main.tf': 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n' };
      const { ir } = parseProject(files);
      const { node, ops } = buildDataNode(ir, preset);
      if (!SCHEMALESS.has(preset.type)) expect(dataSchemaIssues(node).map((i) => i.message), preset.key).toEqual([]);
      const out = applyOpsWithPatches(files, ir, ops);
      expect(out.refused, preset.key).toBeUndefined();
      expect(out.ir.data.map((d) => d.id)).toEqual([node.id]);
      // what the parser reads back is what the preset wrote
      for (const [k, v] of Object.entries(node.args)) expect(exprText(out.ir.data[0].args[k]), `${preset.key}.${k}`).toBe(exprText(v));
    }
  });

  it('links each "usually read by" to a settable resource argument and an attribute the data source exposes', () => {
    for (const t of DATA_SOURCE_TYPES) {
      for (const feed of t.feeds ?? []) {
        const attr = feed.read.split(/[.[]/)[0];
        expect(entryOf(dataSourceSchema(t.type)!, attr), `${t.type} exposes ${attr}`).toBeDefined();
        for (const type of feed.resourceTypes) {
          const entry = entryOf(resourceSchema(type)!, feed.arg);
          expect(entry && entry.kind === 'attribute' && isSettable(entry), `${type}.${feed.arg}`).toBe(true);
        }
      }
    }
  });

  it('lists presets per provider, remote state under its backend, with unique keys', () => {
    expect(new Set(DATA_SOURCE_PRESETS.map((p) => p.key)).size).toBe(DATA_SOURCE_PRESETS.length);
    expect(DATA_SOURCE_PRESETS.every((p) => typeDef(p.type) !== undefined)).toBe(true);
    expect(presetsFor('aws').map((p) => p.key)).toContain('terraform_remote_state.s3');
    expect(presetsFor('azure').map((p) => p.key)).toContain('terraform_remote_state.azurerm');
    expect(presetsFor('gcp').map((p) => p.key)).toContain('terraform_remote_state.gcs');
    expect(presetProvider(DATA_SOURCE_PRESETS.find((p) => p.key === 'aws_ami.ubuntu')!)).toBe('aws');
    expect(presetsFor('aws').length).toBeGreaterThanOrEqual(12);
  });

  it('points at the Terraform docs of each type', () => {
    expect(dataDocsUrl('aws_ami')).toBe('https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/ami');
    expect(dataDocsUrl('azurerm_client_config')).toBe('https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/data-sources/client_config');
    expect(dataDocsUrl('google_compute_zones')).toBe('https://registry.terraform.io/providers/hashicorp/google/latest/docs/data-sources/compute_zones');
    expect(dataDocsUrl('archive_file')).toBe('https://registry.terraform.io/providers/hashicorp/archive/latest/docs/data-sources/file');
    expect(dataDocsUrl('terraform_remote_state')).toMatch(/developer\.hashicorp\.com\/terraform\/language\/state\/remote-state-data$/);
    expect(dataDocsUrl('acme_thing')).toBeUndefined();
  });
});

describe('catalog text', () => {
  it('is in Portuguese for every type and every preset with words of its own', () => {
    for (const t of DATA_SOURCE_TYPES) expect(DATA_TYPES_PT_BR[t.type], t.type).toBeDefined();
    for (const p of DATA_SOURCE_PRESETS) {
      const pt = DATA_PRESETS_PT_BR[p.key as keyof typeof DATA_PRESETS_PT_BR];
      if ('displayName' in p && p.displayName) expect(pt?.name, `${p.key} name`).toBeDefined();
      if ('description' in p && p.description) expect(pt?.description, `${p.key} description`).toBeDefined();
    }
    expect(presetName('aws_ami.ubuntu', 'pt-BR')).toBe('AMI Ubuntu');
    expect(dataSourceName('aws_availability_zones', 'pt-BR')).toBe('Zonas de disponibilidade');
    // a type the catalog doesn't describe: the resource catalog's name, else the bare type
    expect(dataSourceShortName('aws_lb_listener', 'en')).not.toBe('aws_lb_listener');
    expect(dataSourceShortName('aws_ssoadmin_instances', 'en')).toBe('ssoadmin_instances');
  });

  it('has no dash used as punctuation, in either language', () => {
    const texts: string[] = [];
    for (const locale of ['en', 'pt-BR'] as const) {
      for (const t of DATA_SOURCE_TYPES) {
        texts.push(dataSourceName(t.type, locale), dataSourceShortName(t.type, locale), dataSourceDescription(t.type, locale) ?? '');
      }
      for (const p of DATA_SOURCE_PRESETS) texts.push(presetName(p, locale), presetDescription(p, locale) ?? '');
    }
    expect(texts.filter((t) => sentenceDash(t) !== null)).toEqual([]);
  });
});
