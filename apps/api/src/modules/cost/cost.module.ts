import { Body, Controller, Module, Post } from '@nestjs/common';
import { z } from 'zod';

import { CostService } from './cost.service';

import type { CostEstimateResponse } from './cost.types';
import type { IR } from '@blueprint/ir';

/**
 * Permissive Zod schema for the IR shape coming over the wire.
 *
 * We **don't** mirror the full IR types here on purpose:
 *   - The IR is a structural type with ~30 fields and `unknown` escape
 *     hatches (`Expression.kind === 'raw'`). A 1:1 schema would be brittle
 *     and reject perfectly valid payloads as the IR evolves.
 *   - The `CostService` only reads what `emitIR` consumes — anything
 *     beyond that gets silently ignored.
 *
 * So we accept any object that *looks* like an IR (`resources` is an
 * array, `version` is `1`) and trust the typed pipeline downstream.
 */
const irShape = z
  .object({
    version: z.literal(1),
    resources: z.array(z.unknown()),
    modules: z.array(z.unknown()).optional(),
    edges: z.array(z.unknown()).optional(),
    providers: z.record(z.unknown()).optional(),
    variables: z.record(z.unknown()).optional(),
    outputs: z.record(z.unknown()).optional(),
  })
  .passthrough();

const requestSchema = z.object({ ir: irShape });

@Controller('cost-estimate')
class CostController {
  constructor(private readonly cost: CostService) {}

  @Post()
  async estimate(@Body() body: unknown): Promise<CostEstimateResponse> {
    const parsed = requestSchema.parse(body);
    return this.cost.estimate(parsed.ir as unknown as IR);
  }
}

@Module({
  controllers: [CostController],
  providers: [CostService],
  exports: [CostService],
})
export class CostModule {}
