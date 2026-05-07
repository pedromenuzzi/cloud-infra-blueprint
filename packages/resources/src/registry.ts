import type { Provider, ResourceDefinition } from '@blueprint/ir';

/**
 * Public plugin API for community-authored providers.
 *
 * The motivation for this API is laid out in
 * [docs/CREATING-A-PROVIDER.md](../../../docs/CREATING-A-PROVIDER.md): we
 * want third parties to ship Blueprint coverage for resources we will not
 * implement in core (Cloudflare, VMware, Oracle, advanced Kubernetes
 * primitives, internal company catalogs).
 *
 * Stability promise:
 *   - The shape of `RegisterProviderOptions` is **public**. Breaking
 *     changes only ship via a major bump of `@blueprint/resources` with a
 *     migration note in the changeset.
 *   - The host app calls `getRegisteredCatalog()` once at startup; plugins
 *     should `registerProvider` *before* the canvas mounts, ideally during
 *     module evaluation in their own entry file.
 *   - Registering a `provider` that already exists is a no-op for that key
 *     but **appends** the new resources, so an extension can extend a core
 *     provider (e.g. add Cloudflare Workers Routes to the `cloudflare`
 *     provider another extension already registered).
 *
 * Convention for npm packages:
 *   - Name them `@blueprint-provider/<provider>` (`@blueprint-provider/cloudflare`).
 *   - Export a single `register()` function so the host app can call
 *     `import('@blueprint-provider/cloudflare').then((m) => m.register())`.
 */
export interface RegisterProviderOptions {
  /**
   * The Terraform provider key. Re-using a core key (`aws`, `azure`,
   * `gcp`, `kubernetes`) extends that provider with extra resources.
   * A new key (`cloudflare`, `vmware`, `oracle`) creates a new provider
   * silo in the palette.
   */
  provider: Provider | (string & {});
  /** Resource definitions exported from your package. */
  resources: ResourceDefinition[];
  /**
   * Optional. Pretty name shown in the palette. Defaults to a
   * capitalized version of the `provider` key.
   */
  displayName?: string;
}

/** Snapshot of the global plugin registry. */
export interface ProviderRegistration {
  provider: string;
  displayName: string;
  resources: ResourceDefinition[];
}

const REGISTRY = new Map<string, ProviderRegistration>();

function defaultDisplayName(provider: string): string {
  if (provider.length === 0) return provider;
  return provider[0]!.toUpperCase() + provider.slice(1);
}

/**
 * Register a community provider with Blueprint.
 *
 * Idempotent: calling twice with the same `(provider, type)` pair
 * **silently ignores** the duplicate so a hot-reloading dev environment
 * does not double-register. To override an entry, call `unregisterProvider`
 * first.
 */
export function registerProvider(opts: RegisterProviderOptions): ProviderRegistration {
  const provider = opts.provider;
  const existing = REGISTRY.get(provider);
  const knownTypes = new Set(existing?.resources.map((r) => r.type) ?? []);
  const fresh: typeof opts.resources = [];
  for (const r of opts.resources) {
    if (knownTypes.has(r.type)) continue;
    knownTypes.add(r.type);
    fresh.push(r);
  }
  const merged = (existing?.resources ?? []).concat(fresh);
  const next: ProviderRegistration = {
    provider,
    displayName: opts.displayName ?? existing?.displayName ?? defaultDisplayName(provider),
    resources: merged,
  };
  REGISTRY.set(provider, next);
  return next;
}

/**
 * Remove a provider entirely from the registry. Mostly useful in tests
 * and hot-reload contexts; users should rarely need this in production.
 */
export function unregisterProvider(provider: Provider | (string & {})): boolean {
  return REGISTRY.delete(provider);
}

/**
 * Replace the registered list of resources for a provider. Bypasses the
 * idempotency check in `registerProvider` so the caller can shrink an
 * existing entry. Use sparingly.
 */
export function setProviderResources(
  provider: Provider | (string & {}),
  resources: ResourceDefinition[],
  displayName?: string,
): ProviderRegistration {
  const next: ProviderRegistration = {
    provider,
    displayName: displayName ?? REGISTRY.get(provider)?.displayName ?? defaultDisplayName(provider),
    resources,
  };
  REGISTRY.set(provider, next);
  return next;
}

/** Return all currently-registered providers (in registration order). */
export function getRegisteredProviders(): ProviderRegistration[] {
  return Array.from(REGISTRY.values());
}

/**
 * Return all currently-registered resource definitions across every
 * registered provider. The host app concatenates this with its core
 * catalog (`allResources`) when composing the palette — see
 * [docs/CREATING-A-PROVIDER.md](../../../docs/CREATING-A-PROVIDER.md).
 */
export function getRegisteredCatalog(): ResourceDefinition[] {
  return getRegisteredProviders().flatMap((p) => p.resources);
}

/** Drop every plugin. Test-only escape hatch. */
export function clearProviderRegistry(): void {
  REGISTRY.clear();
}
