import { awsCatalog } from './aws/index.js';
import { azureCatalog } from './azure/index.js';
import { gcpCatalog } from './gcp/index.js';
import { getRegisteredCatalog } from './registry.js';

import type { Provider, ResourceDefinition } from '@blueprint/ir';

export * from './aws/index.js';
export * from './azure/index.js';
export * from './gcp/index.js';

export {
  clearProviderRegistry,
  getRegisteredCatalog,
  getRegisteredProviders,
  registerProvider,
  setProviderResources,
  unregisterProvider,
  type ProviderRegistration,
  type RegisterProviderOptions,
} from './registry.js';

/**
 * Built-in catalog shipped with the core package. Stays a frozen baseline
 * regardless of which third-party providers are registered at runtime.
 */
export const coreResources: ResourceDefinition[] = [...awsCatalog, ...azureCatalog, ...gcpCatalog];

/**
 * Master catalog used by the palette / inspector / parser.
 *
 * Composed lazily via `getAllResources()` so plugins registered at
 * application startup (after the module first loads) are picked up. The
 * eagerly-evaluated `allResources` constant remains for backwards
 * compatibility — it equals `coreResources` because it is read at module
 * evaluation time, before any plugin can call `registerProvider`.
 *
 * **For new code, prefer `getAllResources()`** — it always reflects the
 * current registry state.
 */
export const allResources: ResourceDefinition[] = coreResources;

/**
 * Live view of the catalog. Reads `coreResources` plus everything any
 * extension has registered via `registerProvider(...)`.
 */
export function getAllResources(): ResourceDefinition[] {
  return [...coreResources, ...getRegisteredCatalog()];
}

/**
 * Lookup index by Terraform `type` (e.g. `aws_instance`). Built from the
 * **core** catalog only — keep this stable for legacy callers. Plugins
 * should use `findResourceDef()`, which consults the live registry.
 */
export const resourcesByType: Record<string, ResourceDefinition> = Object.fromEntries(
  coreResources.map((r) => [r.type, r]),
);

/**
 * Group definitions by provider for the palette UI. Only contains the
 * core providers — the palette is expected to merge in registered
 * providers via `getRegisteredProviders()`.
 */
export const resourcesByProvider: Record<Provider, ResourceDefinition[]> = {
  aws: awsCatalog,
  azure: azureCatalog,
  gcp: gcpCatalog,
  kubernetes: [],
  random: [],
  tls: [],
};

/**
 * Find a resource definition by Terraform `type`, consulting both the
 * core catalog and every plugin currently registered.
 */
export function findResourceDef(type: string): ResourceDefinition | undefined {
  if (resourcesByType[type]) return resourcesByType[type];
  return getRegisteredCatalog().find((r) => r.type === type);
}
