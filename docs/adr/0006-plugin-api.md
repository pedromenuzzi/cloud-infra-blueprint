# 0006. Plugin API for community providers and templates

- **Status:** Accepted
- **Date:** 2026-05-04
- **Tags:** packages, ecosystem, public-api

## Context

The core team will never ship every Terraform provider — and shouldn't.
Cloudflare, Oracle Cloud Infrastructure, VMware, exotic Kubernetes
operators, internal company catalogs are all things the community will
implement _if and only if_ there's a clean public API. The same applies
to architecture templates: the five MVP patterns will not exhaust the
useful set; users will want to ship their own.

Up to now both `@blueprint/resources` and `@blueprint/templates` exposed
catalogs as **module-level constants** (`allResources`, `allTemplates`).
They were treated as the single source of truth by the host app — the
palette iterates over them at module evaluation time. That works for
in-tree code but blocks extensions: a third-party package has nowhere to
plug in resources without forking the catalog.

We considered three approaches:

1. **Status quo.** Vendors fork the monorepo, add their resources to the
   catalog, ship a private build. Works but is hostile to contribution
   and impossible to maintain across upstream upgrades.
2. **Build-time codegen.** A `blueprint.config.ts` lists provider
   packages, a CLI generates an `allResources.generated.ts` that the
   palette imports. Adds a new build step and surfaces nothing useful at
   runtime (e.g. `register()` from a browser extension).
3. **Runtime registry.** Public `registerProvider({ … })` and
   `registerTemplate({ … })` functions mutate a process-local registry.
   The host app composes core + registry at read time
   (`getAllResources()`, `getAllTemplates()`).

## Decision

We pick **option 3 — runtime registry** for both packages.

The legacy module-level exports (`allResources`, `allTemplates`,
`templatesBySlug`, `resourcesByType`) stay frozen to the **core**
catalog so existing callers keep working. New code uses the live
helpers (`getAllResources`, `getAllTemplates`, `findResourceDef`,
`findTemplate`) which read both core and registry.

Public surface (see [`docs/CREATING-A-PROVIDER.md`](../CREATING-A-PROVIDER.md)
for the full contract):

```ts
import { registerProvider } from '@blueprint/resources';
import { registerTemplate } from '@blueprint/templates';
```

Both APIs are idempotent on their natural key
(`(provider, type)` for resources, `slug` for templates) so HMR doesn't
double-register. Replacing an entry requires the explicit
`setProviderResources` (or re-registering a template — last write wins).

## Alternatives

- **Codegen build step.** Rejected — adds a CLI dependency to every host
  application and prevents zero-config browser extensions.
- **DI container injected into the host.** Rejected — a global registry
  is simpler, the host app already has a single boot point, and the cost
  of a missed plugin is low (no UI for that resource, but everything
  else keeps working).
- **Plugins as direct exports re-imported by the host.** Rejected — that
  bakes the plugin list into the host build and beats the goal entirely.

## Consequences

Positive:

- Third-party providers ship as standalone npm packages
  (`@blueprint-provider/<name>`) and templates as
  `@blueprint-template/<slug>`.
- Plugins compose cleanly: two extensions can both add to a `cloudflare`
  provider without conflict.
- The core catalog is unchanged and stays frozen for legacy callers; we
  do not break a single existing consumer.
- HMR works because registrations are idempotent on natural keys.

Negative / open:

- Plugins must run **before** the canvas mounts. We document this in
  the contributing guide; an `await Promise.all([…register()])` at the
  top of `apps/web/src/main.tsx` is the recommended pattern.
- The IR's `Provider` type is still a closed enum. Until we widen it,
  community providers must pick the closest core key (`aws`,
  `kubernetes`, etc.). Tracked as a follow-up; the registry already
  accepts `string & {}` so widening is non-breaking.
- The registry is **process-local**. SSR setups (we don't have one yet)
  must register on each request — out of scope for now.
