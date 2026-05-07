/**
 * Public shape returned by `POST /cost-estimate`.
 *
 * Stable wire format — anything we add must be optional (additive). The
 * frontend's `useCostEstimate` hook validates the shape via Zod before
 * touching state.
 */
export interface CostEstimateResponse {
  /** Total monthly cost across every priced resource, in USD. */
  totalMonthlyCost: number;
  /** Currency of every monetary field below. Always `USD` today. */
  currency: 'USD';
  /** Per-resource monthly cost, keyed by Terraform address (`type.name`). */
  byResource: Record<string, ResourceCost>;
  /**
   * Resources Infracost recognised but skipped (free tier, missing
   * required fields, unsupported region). The UI shows a small "?" badge
   * for these so the user knows it's not a bug.
   */
  unsupported: string[];
  /** Provider that produced the estimate. */
  provider: 'infracost' | 'disabled';
  /** ISO-8601 timestamp of when the estimate was produced. */
  generatedAt: string;
  /**
   * Optional warning surfaced to the UI ("infracost not running",
   * "request truncated to N resources", etc.). Never used for hard
   * errors — those come back as HTTP 4xx/5xx.
   */
  warning?: string;
}

export interface ResourceCost {
  /** Terraform address: `type.name` (e.g. `aws_instance.web`). */
  address: string;
  monthlyCost: number;
  /** Hourly cost when available; absent for monthly-only resources. */
  hourlyCost?: number;
  /**
   * Per-component cost line items so the inspector can show a breakdown
   * ("Linux on-demand: $7.49/mo, EBS storage: $1.20/mo").
   */
  components?: Array<{ name: string; monthlyCost: number; unit?: string }>;
}

/** Severity bucket for the canvas badge color. */
export type CostBucket = 'free' | 'low' | 'medium' | 'high';

/**
 * Map an absolute monthly cost (USD) to a bucket so the UI can colour
 * the badge consistently.
 *
 * Thresholds are deliberately simple (`<10 / <100 / >=100`) because
 * Infracost's per-resource estimate is itself an approximation — finer
 * brackets would imply a precision we don't have.
 */
export function bucketForMonthlyCost(usd: number): CostBucket {
  if (usd <= 0) return 'free';
  if (usd < 10) return 'low';
  if (usd < 100) return 'medium';
  return 'high';
}
