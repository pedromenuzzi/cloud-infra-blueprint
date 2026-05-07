import { emptyIR, type Expression, type IR, type ResourceNode } from '@blueprint/ir';
import { fc, test } from '@fast-check/vitest';
import { beforeAll, describe, expect } from 'vitest';

import { emitIR } from './emitter.js';
import { parse, type Hcl2JsonAdapter } from './parser.js';
import { createNodeAdapter } from './workerClient.js';

/* -------------------------------------------------------------------------- */
/* Arbitraries                                                                */
/*                                                                            */
/* We DELIBERATELY restrict the generators to what hcl2json round-trips        */
/* losslessly. The escape hatch (`raw`) is excluded here because it doesn't    */
/* survive a structural diff — it's the catch-all for "we already accepted    */
/* we can't beat this case".                                                  */
/* -------------------------------------------------------------------------- */

const safeIdentifier = fc
  .string({ minLength: 1, maxLength: 12, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz') })
  .map((s) => `n${s}`);

const safeStringValue = fc
  .string({ minLength: 1, maxLength: 24 })
  .map((s) =>
    s
      .replace(/\\/g, '')
      .replace(/"/g, '')
      .replace(/[\n\r\t]/g, ' ')
      // Avoid HCL interpolation, comments and the percent-block syntax.
      .replace(/[$%{}#]/g, '_'),
  )
  .filter((s) => s.trim().length > 0);

const literalArb: fc.Arbitrary<Expression> = fc.oneof(
  safeStringValue.map((value) => ({ kind: 'literal' as const, value })),
  fc
    .integer({ min: -1_000_000, max: 1_000_000 })
    .map((value) => ({ kind: 'literal' as const, value })),
  fc.boolean().map((value) => ({ kind: 'literal' as const, value })),
);

const listOfLiteralArb: fc.Arbitrary<Expression> = fc
  .array(literalArb, { minLength: 0, maxLength: 4 })
  .map((items) => ({ kind: 'list' as const, items }));

const flatObjectArb: fc.Arbitrary<Expression> = fc
  .uniqueArray(fc.tuple(safeIdentifier, literalArb), {
    minLength: 0,
    maxLength: 4,
    selector: ([k]) => k,
  })
  .map((entries) => ({
    kind: 'object' as const,
    fields: Object.fromEntries(entries),
  }));

const valueArb: fc.Arbitrary<Expression> = fc.oneof(
  { weight: 5, arbitrary: literalArb },
  { weight: 2, arbitrary: listOfLiteralArb },
  { weight: 1, arbitrary: flatObjectArb },
);

const argsArb: fc.Arbitrary<Record<string, Expression>> = fc
  .uniqueArray(fc.tuple(safeIdentifier, valueArb), {
    minLength: 1,
    maxLength: 5,
    selector: ([k]) => k,
  })
  .map((entries) => Object.fromEntries(entries));

const resourceArb: fc.Arbitrary<ResourceNode> = fc
  .tuple(safeIdentifier, safeIdentifier, argsArb)
  .map(([type, name, args], i) => ({
    id: `gen_${i ?? 0}_${type}_${name}`,
    provider: 'aws' as const,
    type: `aws_${type}`,
    name,
    args,
    position: { x: 0, y: 0 },
    trivia: { leadingComments: [], trailingComments: [] },
  }));

const irArb: fc.Arbitrary<IR> = fc
  .uniqueArray(resourceArb, {
    minLength: 1,
    maxLength: 6,
    selector: (r) => `${r.type}.${r.name}`,
  })
  .map((resources) => ({
    ...emptyIR(),
    resources,
  }));

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

function normalize(ir: IR): unknown {
  return {
    resources: [...ir.resources]
      .sort((a, b) => `${a.type}.${a.name}`.localeCompare(`${b.type}.${b.name}`))
      .map((r) => ({
        type: r.type,
        name: r.name,
        args: r.args,
      })),
  };
}

/**
 * Spec criterion F1: 1000 property iterations in CI, lower locally for speed.
 * Override with `PROPERTY_RUNS=1000` to force the full sweep.
 */
const NUM_RUNS = process.env.PROPERTY_RUNS
  ? Number(process.env.PROPERTY_RUNS)
  : process.env.CI
    ? 1000
    : 250;

describe('HCL property-based round-trip', () => {
  let adapter: Hcl2JsonAdapter;
  beforeAll(async () => {
    adapter = await createNodeAdapter();
  });

  test.prop([irArb], { numRuns: NUM_RUNS, verbose: 1 })(
    'emit -> parse -> emit is structurally idempotent',
    async (ir) => {
      const files1 = emitIR(ir);
      const ir2 = await parse(files1, adapter);
      const files2 = emitIR(ir2);
      expect(files1).toEqual(files2);
      expect(normalize(ir2)).toEqual(normalize(ir));
    },
  );
});
