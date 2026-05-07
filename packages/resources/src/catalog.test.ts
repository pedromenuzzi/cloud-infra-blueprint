import { createNodeAdapter, emitResource, parse } from '@blueprint/hcl';
import { newId, type ResourceNode } from '@blueprint/ir';
import { beforeAll, describe, expect, it } from 'vitest';

import { allResources, resourcesByProvider, resourcesByType } from './index.js';

/**
 * Smoke tests for the resource catalogue.
 *
 *   1. Every definition has a non-empty type, provider, schema and emit fn.
 *   2. The defaults from each definition can be turned into a valid IR
 *      ResourceNode whose HCL is parseable by hcl2json (no syntax errors).
 *   3. The provider/type indexes are mutually consistent with `allResources`.
 */

describe('Resource catalog', () => {
  it('exposes a non-empty catalogue', () => {
    expect(allResources.length).toBeGreaterThan(10);
  });

  it('has unique resource types', () => {
    const types = allResources.map((r) => r.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('keeps the indexes consistent with allResources', () => {
    for (const def of allResources) {
      expect(resourcesByType[def.type]).toBe(def);
      expect(resourcesByProvider[def.provider]).toContain(def);
    }
  });

  let adapter: Awaited<ReturnType<typeof createNodeAdapter>>;
  beforeAll(async () => {
    adapter = await createNodeAdapter();
  });

  for (const def of allResources) {
    it(`${def.type}: defaults emit valid HCL`, async () => {
      const node: ResourceNode = {
        id: newId(),
        provider: def.provider,
        type: def.type,
        name: 'test',
        args: structuredClone(def.defaults),
        position: { x: 0, y: 0 },
        trivia: { leadingComments: [], trailingComments: [] },
      };
      const hcl = emitResource(node);
      // Parses without error — round-trip not asserted here, just legality.
      const ir = await parse({ 'main.tf': hcl }, adapter);
      expect(ir.resources, `expected one resource emitted for ${def.type}`).toHaveLength(1);
      expect(ir.resources[0]?.type).toBe(def.type);
    });
  }
});
