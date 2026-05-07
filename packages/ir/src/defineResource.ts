import type { Expression, Provider, ResourceNode } from './types.js';
import type { z, ZodTypeAny } from 'zod';

export type ResourceCategory =
  | 'Compute'
  | 'Storage'
  | 'Network'
  | 'Database'
  | 'Identity'
  | 'Container'
  | 'Serverless'
  | 'Messaging'
  | 'Analytics'
  | 'CDN'
  | 'DNS'
  | 'Other';

export interface ResourcePort {
  kind: 'network' | 'iam' | 'reference' | 'data';
  label: string;
  /** Optional schema for what kind of node can connect here. */
  acceptsTypes?: string[];
}

/**
 * Context handed to the `emit` function. Provides safe HCL block / argument
 * builders so resource definitions never have to deal with raw string concat.
 */
export interface EmitContext {
  /**
   * Render a top-level block: `resource "aws_instance" "web" { ... }`.
   * `labels` is the array of double-quoted labels between the keyword and the body.
   */
  block(keyword: string, labels: string[], body: Record<string, Expression | undefined>): string;
  /** Render a nested block: `tags { Name = "x" }`. */
  nested(keyword: string, body: Record<string, Expression | undefined>): string;
  /** Indentation helper for hand-written multi-block emits. */
  indent(text: string, level?: number): string;
}

export interface ResourceDefinition<S extends ZodTypeAny = ZodTypeAny> {
  provider: Provider;
  /** Terraform type, e.g. `aws_instance`. */
  type: string;
  category: ResourceCategory;
  displayName: string;
  /** Path served by `apps/web` to render an icon for the palette / canvas. */
  icon: string;
  /** User-facing description shown in palette tooltips. */
  description?: string;
  /** Tags / keywords for the palette search box. */
  tags?: string[];
  schema: S;
  defaults?: Partial<z.infer<S>>;
  ports: { in: ResourcePort[]; out: ResourcePort[] };
  /**
   * Render the resource as an HCL string.
   *
   * Implementations should USE `ctx.block(...)` and pass arguments through;
   * the emitter is responsible for escaping, quoting, and rendering each
   * `Expression` correctly.
   */
  emit(res: ResourceNode, ctx: EmitContext): string;
}

/**
 * Identity helper that just types the definition, so `defineResource({...})`
 * gives full IntelliSense without callers needing to type the generic.
 */
export function defineResource<S extends ZodTypeAny>(
  def: ResourceDefinition<S>,
): ResourceDefinition<S> {
  return def;
}
