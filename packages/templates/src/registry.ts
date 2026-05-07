import type { Template } from './types.js';

/**
 * Public plugin API for community-authored templates.
 *
 * See [docs/CREATING-A-PROVIDER.md](../../../docs/CREATING-A-PROVIDER.md)
 * for the broader plugin philosophy. Templates are easier to ship than
 * providers because they don't need icons, schemas or per-field defaults
 * — just a `slug`, a `provider`, a `params` Zod schema and a `build`
 * function that returns an `IRPatch`.
 *
 * Convention for npm packages:
 *   - Name them `@blueprint-template/<slug>` (`@blueprint-template/eks-ha`).
 *   - Export a `register()` so the host app can call it once at startup.
 */
export interface RegisterTemplateOptions {
  templates: Template[];
}

export interface RegisteredTemplate {
  template: Template;
  /** Insertion order — useful for stable UI ordering. */
  index: number;
}

const REGISTRY = new Map<string, RegisteredTemplate>();
let order = 0;

/**
 * Register one or more templates. Idempotent on `slug`; the **last**
 * registration wins (so a vendor can ship a corrected version of a slug
 * a user already loaded).
 */
export function registerTemplate(arg: Template | RegisterTemplateOptions): RegisteredTemplate[] {
  const templates = 'templates' in arg ? arg.templates : [arg];
  const out: RegisteredTemplate[] = [];
  for (const t of templates) {
    order += 1;
    const entry: RegisteredTemplate = { template: t, index: order };
    REGISTRY.set(t.slug, entry);
    out.push(entry);
  }
  return out;
}

/** Remove a template by slug. */
export function unregisterTemplate(slug: string): boolean {
  return REGISTRY.delete(slug);
}

/** Drop every registered template. Test-only. */
export function clearTemplateRegistry(): void {
  REGISTRY.clear();
  order = 0;
}

/** Return all registered templates in insertion order. */
export function getRegisteredTemplates(): Template[] {
  return Array.from(REGISTRY.values())
    .sort((a, b) => a.index - b.index)
    .map((r) => r.template);
}

/** Find a registered template by slug. */
export function findRegisteredTemplate(slug: string): Template | undefined {
  return REGISTRY.get(slug)?.template;
}
