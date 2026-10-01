import { describe, expect, it } from 'vitest';
import { ProviderSchema } from './lookup';
import { serializeSchema } from './serialize';
import { deprecationNote, shortDescription, trimProviderSchema, typeExpression, type RawProviderSchema } from './trim';

const timeouts = { nesting_mode: 'single', block: { attributes: { create: { type: 'string', optional: true } } } };

const FIXTURE: RawProviderSchema = {
  resource_schemas: {
    demo_thing: {
      version: 0,
      block: {
        attributes: {
          id: { type: 'string', optional: true, computed: true },
          arn: { type: 'string', computed: true, description: 'ARN of the thing.' },
          name: {
            type: 'string',
            required: true,
            description: '(Required) Name of the [thing](https://example.com/docs). Must be unique.',
          },
          password: { type: 'string', optional: true, sensitive: true, write_only: true },
          legacy: {
            type: 'bool',
            optional: true,
            deprecated: true,
            description: 'Old switch. Deprecated: use `modern` instead.',
          },
          ports: { type: ['list', 'number'], optional: true },
          labels: { type: ['map', 'string'], optional: true },
          rules: { type: ['set', ['object', { cidr: 'string', port: 'number' }]], optional: true },
          blob: { type: 'dynamic', optional: true },
          pair: { type: ['tuple', ['string', 'bool']], optional: true },
          settings: {
            nested_type: { nesting_mode: 'list', attributes: { key: { type: 'string', required: true } } },
            optional: true,
          },
        },
        block_types: {
          disk: {
            nesting_mode: 'list',
            min_items: 1,
            max_items: 1,
            block: {
              description: 'The boot disk.',
              attributes: {
                size: { type: 'number', optional: true, description: 'Size in GB.' },
                disk_id: { type: 'string', computed: true, description: 'Read-only id — noise here.' },
              },
              block_types: {
                encryption: { nesting_mode: 'single', block: { attributes: { key: { type: 'string', required: true } } } },
              },
            },
          },
          old_block: { nesting_mode: 'set', block: { deprecated: true, description: 'Deprecated. Use disk instead.' } },
          timeouts,
        },
      },
    },
    demo_other: {
      block: {
        deprecated: true,
        description: 'This resource is deprecated and will be removed in v9.',
        attributes: { name: { type: 'string', required: true, description: 'Name.' } },
        block_types: { timeouts },
      },
    },
  },
};

describe('trimProviderSchema', () => {
  const data = trimProviderSchema(FIXTURE, { provider: 'aws', version: '1.2.3' });
  const schema = new ProviderSchema(data);

  it('keeps every resource, sorted, with its version', () => {
    expect(Object.keys(data.resources)).toEqual(['demo_other', 'demo_thing']);
    expect(data.version).toBe('1.2.3');
    expect(data.deprecatedResources).toEqual({ demo_other: 'This resource is deprecated and will be removed in v9.' });
  });

  it('writes types as Terraform type expressions and flags compactly', () => {
    const a = data.blocks[data.resources.demo_thing].a!;
    expect(a.name).toEqual(['string', 'r', 'Name of the thing. Must be unique.']);
    expect(a.arn).toEqual(['string', 'c', 'ARN of the thing.']);
    expect(a.password).toEqual(['string', 'osw']);
    expect(a.ports).toEqual(['list(number)', 'o']);
    expect(a.labels).toEqual(['map(string)', 'o']);
    expect(a.rules).toEqual(['set(object({ cidr = string, port = number }))', 'o']);
    expect(a.blob).toEqual(['any', 'o']);
    expect(a.pair).toEqual(['tuple([string, bool])', 'o']);
    expect(a.settings).toEqual(['list(object({ key = string }))', 'o']);
    expect(a.legacy).toEqual(['bool', 'od', 'Old switch. Deprecated: use `modern` instead.', 'Deprecated: use `modern` instead.']);
  });

  it('keeps nesting modes and bounds, recursively', () => {
    const root = schema.resource('demo_thing')!;
    const disk = root.blocks.disk;
    expect(disk).toMatchObject({ nesting: 'list', minItems: 1, maxItems: 1, description: 'The boot disk.' });
    expect(disk.block.attributes.size).toMatchObject({ type: 'number', optional: true, description: 'Size in GB.' });
    expect(disk.block.blocks.encryption.nesting).toBe('single');
    expect(disk.block.blocks.encryption.block.attributes.key.required).toBe(true);
    expect(root.blocks.old_block).toMatchObject({ deprecated: true, deprecation: 'Deprecated. Use disk instead.' });
  });

  it('drops the help of read-only values inside blocks, keeps exported top-level ones', () => {
    const root = schema.resource('demo_thing')!;
    expect(root.blocks.disk.block.attributes.disk_id).toMatchObject({ computed: true, description: undefined });
    expect(root.attributes.arn.description).toBe('ARN of the thing.');
  });

  it('stores identical block bodies once', () => {
    const timeoutsIndex = data.blocks[data.resources.demo_thing].b!.timeouts[1];
    expect(data.blocks[data.resources.demo_other].b!.timeouts[1]).toBe(timeoutsIndex);
    const bodies = data.blocks.map((b) => JSON.stringify(b));
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it('can ship a resource as structure only, keeping deprecation notes', () => {
    const bare = trimProviderSchema(FIXTURE, { provider: 'aws', version: '1', help: (t) => t !== 'demo_thing' });
    const a = bare.blocks[bare.resources.demo_thing].a!;
    expect(a.name).toEqual(['string', 'r']);
    expect(a.legacy).toEqual(['bool', 'od', '', 'Deprecated: use `modern` instead.']);
    expect(bare.blocks[bare.resources.demo_other].a!.name).toEqual(['string', 'r', 'Name.']);
  });

  it('can leave resource types out', () => {
    const only = trimProviderSchema(FIXTURE, { provider: 'aws', version: '1', include: (t) => t === 'demo_other' });
    expect(Object.keys(only.resources)).toEqual(['demo_other']);
  });

  it('serializes deterministically, one resource and one block per line', () => {
    const text = serializeSchema(data);
    expect(JSON.parse(text)).toEqual(data);
    expect(serializeSchema(JSON.parse(text))).toBe(text);
    expect(text.split('\n').filter((l) => l.startsWith('    {')).length).toBe(data.blocks.length);
    expect(text).not.toContain('"kind"');
  });
});

describe('trimProviderSchema: data sources', () => {
  const RAW: RawProviderSchema = {
    ...FIXTURE,
    data_source_schemas: {
      demo_lookup: {
        version: 0,
        block: {
          attributes: {
            id: { type: 'string', optional: true, computed: true },
            name: { type: 'string', required: true, description: 'Name to look up.' },
            most_recent: { type: 'bool', optional: true, description: 'Pick the newest match.' },
            arn: { type: 'string', computed: true, description: 'ARN of the match: no help shipped for what is only read.' },
            names: { type: ['list', 'string'], computed: true },
          },
          block_types: {
            filter: {
              nesting_mode: 'set',
              block: { attributes: { name: { type: 'string', required: true }, values: { type: ['set', 'string'], required: true } } },
            },
          },
        },
      },
    },
  };
  const data = trimProviderSchema(RAW, { provider: 'aws', version: '1.2.3', section: 'data' });
  const schema = new ProviderSchema(data);

  it('reads data_source_schemas, marked as data sources', () => {
    expect(data.kind).toBe('data');
    expect(Object.keys(data.resources)).toEqual(['demo_lookup']);
    expect(schema.has('demo_thing')).toBe(false);
  });

  it('keeps the help of what one writes, the names and types of what it only exposes', () => {
    const body = schema.resource('demo_lookup')!;
    expect(body.attributes.name).toMatchObject({ required: true, description: 'Name to look up.' });
    expect(body.attributes.most_recent.description).toBe('Pick the newest match.');
    expect(body.attributes.arn).toMatchObject({ computed: true, optional: false, type: 'string' });
    expect(body.attributes.arn.description).toBeUndefined();
    expect(body.attributes.names.type).toBe('list(string)');
    expect(body.blocks.filter).toMatchObject({ nesting: 'set' });
  });

  it('serializes the marker and round-trips', () => {
    const text = serializeSchema(data);
    expect(text).toContain('"kind": "data",');
    expect(JSON.parse(text)).toEqual(data);
    expect(serializeSchema(JSON.parse(text))).toBe(text);
  });

  it('an empty section ships empty', () => {
    expect(trimProviderSchema(FIXTURE, { provider: 'aws', version: '1', section: 'data' }).resources).toEqual({});
  });
});

describe('descriptions', () => {
  it('cleans markdown, prefixes and whitespace', () => {
    expect(shortDescription('(Optional)  The **name** of the [bucket](https://x.y/z).\n\nMore.')).toBe('The name of the bucket. More.');
    expect(shortDescription('Optional. Output only. Something')).toBe('Output only. Something');
    expect(shortDescription('')).toBeUndefined();
  });

  it('cuts at a sentence end, else at a word with an ellipsis', () => {
    const long = `${'Word '.repeat(10)}ends here. ${'More text '.repeat(20)}`;
    expect(shortDescription(long, 80)).toBe(`${'Word '.repeat(10)}ends here.`);
    const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma';
    const cut = shortDescription(words, 40)!;
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(41);
    expect(words.startsWith(cut.slice(0, -1))).toBe(true);
  });

  it('finds the deprecation sentence', () => {
    expect(deprecationNote('Enables X. This field is deprecated, use `y` instead.')).toBe('This field is deprecated, use `y` instead.');
    expect(deprecationNote('Nothing to see.')).toBe('');
    expect(deprecationNote(undefined)).toBe('');
  });

  it('renders cty types', () => {
    expect(typeExpression(['map', ['list', 'string']])).toBe('map(list(string))');
    expect(typeExpression(['object', {}])).toBe('object({})');
    expect(typeExpression(42)).toBe('any');
  });
});
