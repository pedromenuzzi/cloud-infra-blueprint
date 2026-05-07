import type { IRPatch, Provider } from '@blueprint/ir';
import type { z, ZodTypeAny } from 'zod';

export interface Template<S extends ZodTypeAny = ZodTypeAny> {
  slug: string;
  name: string;
  description: string;
  provider: Provider;
  thumbnail: string;
  /** Optional Zod schema for parameters the user fills before applying. */
  params: S;
  /** Build the IR patch (atomic insert of all resources/edges). */
  build(params: z.infer<S>): IRPatch;
}

/** Identity helper for type inference. */
export function defineTemplate<S extends ZodTypeAny>(t: Template<S>): Template<S> {
  return t;
}
