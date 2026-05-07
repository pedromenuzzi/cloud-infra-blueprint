import { containerStackAws } from './aws-container-stack.js';
import { staticSiteAws } from './aws-static-site.js';
import { webAppAws } from './aws-web-app.js';
import { webAppAzure } from './azure-web-app.js';
import { staticSiteGcp } from './gcp-static-site.js';
import { findRegisteredTemplate as findRegistered, getRegisteredTemplates } from './registry.js';

import type { Template } from './types.js';

export type { Template } from './types.js';
export { defineTemplate } from './types.js';

export { webAppAws } from './aws-web-app.js';
export { staticSiteAws } from './aws-static-site.js';
export { containerStackAws } from './aws-container-stack.js';
export { webAppAzure } from './azure-web-app.js';
export { staticSiteGcp } from './gcp-static-site.js';

export {
  clearTemplateRegistry,
  findRegisteredTemplate,
  getRegisteredTemplates,
  registerTemplate,
  unregisterTemplate,
  type RegisterTemplateOptions,
  type RegisteredTemplate,
} from './registry.js';

/**
 * Built-in templates shipped with the core package. Stays a frozen
 * baseline regardless of which third-party templates are registered at
 * runtime.
 */
export const coreTemplates: Template[] = [
  webAppAws,
  staticSiteAws,
  containerStackAws,
  webAppAzure,
  staticSiteGcp,
];

/**
 * Backwards-compatible eager view of the core catalog. Reflects only the
 * templates available at module evaluation time, *before* any plugin
 * registrations. **For new code, prefer `getAllTemplates()`** which
 * always reflects the current registry state.
 */
export const allTemplates: Template[] = coreTemplates;

/**
 * Live view of the catalog: the core templates plus everything any
 * extension has registered via `registerTemplate(...)`.
 */
export function getAllTemplates(): Template[] {
  return [...coreTemplates, ...getRegisteredTemplates()];
}

/**
 * Lookup index by slug, built from the core catalog. Stays stable for
 * legacy callers; new code should prefer `findTemplate()`.
 */
export const templatesBySlug: Record<string, Template> = Object.fromEntries(
  coreTemplates.map((t) => [t.slug, t]),
);

/**
 * Find a template by slug, consulting both the core catalog and every
 * registered plugin.
 */
export function findTemplate(slug: string): Template | undefined {
  return templatesBySlug[slug] ?? findRegistered(slug);
}
