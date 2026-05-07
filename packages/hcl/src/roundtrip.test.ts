import { beforeAll, describe, expect, it } from 'vitest';

import { extendedFixtures } from './__fixtures__/extended.js';
import { fixtures as baseFixtures, type Fixture } from './__fixtures__/index.js';
import { emitIR } from './emitter.js';
import { parse, type Hcl2JsonAdapter } from './parser.js';
import { createNodeAdapter } from './workerClient.js';

const fixtures = [...baseFixtures, ...extendedFixtures];

/**
 * Strip volatile fields (uuids, exact x/y positions) before comparing two
 * IRs. Round-trip is "semantic", not bit-for-bit on internal ids.
 */
function normalize(ir: unknown): unknown {
  const seen = new Map<string, string>();
  let counter = 0;
  const remap = (id: string): string => {
    let mapped = seen.get(id);
    if (!mapped) {
      mapped = `id_${counter++}`;
      seen.set(id, mapped);
    }
    return mapped;
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'id' && typeof val === 'string') out[k] = remap(val);
        else if (k === 'fromNodeId' && typeof val === 'string') out[k] = remap(val);
        else if (k === 'toNodeId' && typeof val === 'string') out[k] = remap(val);
        else if (k === 'parentId' && typeof val === 'string') out[k] = remap(val);
        else if (k === 'position') out[k] = { x: 0, y: 0 };
        else if (k === 'trivia') {
          // Drop rawTextRange because it's tied to specific source text.
          const t = (val ?? {}) as Record<string, unknown>;
          out[k] = {
            leadingComments: t.leadingComments ?? [],
            trailingComments: t.trailingComments ?? [],
          };
        } else out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(ir);
}

describe('HCL round-trip suite (snapshot of real Terraform)', () => {
  let adapter: Hcl2JsonAdapter;
  beforeAll(async () => {
    adapter = await createNodeAdapter();
  });

  for (const fx of fixtures) {
    it(`round-trip: ${fx.name}`, async () => {
      const ir1 = await parse({ 'main.tf': fx.source }, adapter);

      // Expected counts (sanity).
      if (fx.expectResources !== undefined) {
        expect(ir1.resources, `expected ${fx.expectResources} resources`).toHaveLength(
          fx.expectResources,
        );
      }
      if (fx.expectModules !== undefined) {
        expect(ir1.modules).toHaveLength(fx.expectModules);
      }
      if (fx.expectVariables !== undefined) {
        expect(Object.keys(ir1.variables)).toHaveLength(fx.expectVariables);
      }
      if (fx.expectOutputs !== undefined) {
        expect(Object.keys(ir1.outputs)).toHaveLength(fx.expectOutputs);
      }
      if (fx.expectProviders !== undefined) {
        expect(Object.keys(ir1.providers)).toHaveLength(fx.expectProviders);
      }

      // First emit -> parse -> compare normalised IRs.
      const files1 = emitIR(ir1);
      const ir2 = await parse(files1, adapter);

      expect(normalize(ir2)).toEqual(normalize(ir1));

      // Second emit must equal first emit (idempotency).
      const files2 = emitIR(ir2);
      expect(files2).toEqual(files1);
    });
  }
});

describe('round-trip pass rate aggregate', () => {
  let adapter: Hcl2JsonAdapter;
  beforeAll(async () => {
    adapter = await createNodeAdapter();
  });

  it(`>= 95% of fixtures round-trip cleanly (criterion F1)`, async () => {
    let passed = 0;
    const failures: { name: string; error: string }[] = [];
    for (const fx of fixtures) {
      try {
        const ir1 = await parse({ 'main.tf': fx.source }, adapter);
        const files1 = emitIR(ir1);
        const ir2 = await parse(files1, adapter);
        const files2 = emitIR(ir2);
        const normEq =
          JSON.stringify(normalize(ir1)) === JSON.stringify(normalize(ir2)) &&
          JSON.stringify(files1) === JSON.stringify(files2);
        if (normEq) passed++;
        else failures.push({ name: fx.name, error: 'IR or emit not idempotent' });
      } catch (err) {
        failures.push({ name: fx.name, error: (err as Error).message });
      }
    }
    const rate = passed / fixtures.length;
    if (rate < 0.95) {
      console.error('Round-trip failures:', failures);
    }
    expect(rate, `Round-trip pass rate ${(rate * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.95);
  });
});

/* helper for type narrowing in fixture map */
export type _Fixture = Fixture;
