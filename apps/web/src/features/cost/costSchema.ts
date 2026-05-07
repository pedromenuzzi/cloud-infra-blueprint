import { z } from 'zod';

/**
 * Wire-format Zod schema for `POST /cost-estimate` responses.
 *
 * Keep this schema in sync with `apps/api/src/modules/cost/cost.types.ts`.
 * We deliberately validate at the network boundary so a misbehaving API
 * cannot crash the canvas — `safeParse` failures degrade to an empty
 * estimate with a warning instead.
 */
export const costEstimateSchema = z.object({
  totalMonthlyCost: z.number().nonnegative(),
  currency: z.literal('USD'),
  byResource: z.record(
    z.object({
      address: z.string(),
      monthlyCost: z.number(),
      hourlyCost: z.number().optional(),
      components: z
        .array(
          z.object({
            name: z.string(),
            monthlyCost: z.number(),
            unit: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
  unsupported: z.array(z.string()),
  provider: z.enum(['infracost', 'disabled']),
  generatedAt: z.string(),
  warning: z.string().optional(),
});

export type CostEstimate = z.infer<typeof costEstimateSchema>;
export type ResourceCost = CostEstimate['byResource'][string];

/** Bucket thresholds — must mirror `bucketForMonthlyCost` on the server. */
export type CostBucket = 'free' | 'low' | 'medium' | 'high';

export function bucketForMonthlyCost(usd: number): CostBucket {
  if (usd <= 0) return 'free';
  if (usd < 10) return 'low';
  if (usd < 100) return 'medium';
  return 'high';
}

/**
 * Build the canonical Terraform address (`type.name`) for an IR resource.
 * The cost API keys `byResource` by this address so the UI can index
 * into it without needing to know the resource's UUID.
 */
export function addressFor(resource: { type: string; name: string }): string {
  return `${resource.type}.${resource.name}`;
}
