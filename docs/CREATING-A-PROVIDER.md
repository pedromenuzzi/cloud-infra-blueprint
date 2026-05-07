# Creating a Blueprint provider or template

Blueprint ships with first-party support for AWS, Azure and GCP. **Anything
else** — Cloudflare, Oracle Cloud, VMware, internal company catalogs,
exotic Kubernetes operators — is meant to live in **community packages**
that the host app loads at startup. This page is the contract.

Two related extension points live in two packages:

| Extension              | Package                | Lives in                  |
| ---------------------- | ---------------------- | ------------------------- |
| Resource type          | `@blueprint/resources` | `registerProvider({ … })` |
| Multi-resource pattern | `@blueprint/templates` | `registerTemplate({ … })` |

Both APIs are **stable**: breaking changes only ship behind a major
version of their package, with a migration note in the changeset.

> Looking for the Architecture Decision behind the plugin design? See
> [`adr/0006-plugin-api.md`](./adr/0006-plugin-api.md) (TBD).

---

## TL;DR — minimal Cloudflare provider

```bash
mkdir blueprint-provider-cloudflare && cd $_
pnpm init
pnpm add @blueprint/ir @blueprint/resources zod
```

```ts
// src/zone.ts
import { defineResource, lit } from '@blueprint/ir';
import { z } from 'zod';

export const cloudflareZone = defineResource({
  type: 'cloudflare_zone',
  provider: 'aws', // see "Provider key" below
  category: 'DNS',
  displayName: 'Cloudflare Zone',
  icon: '/icons/cloudflare/zone.svg',
  description: 'A DNS zone managed by Cloudflare.',
  schema: z.object({
    zone: z.string().min(1),
    plan: z.enum(['free', 'pro', 'business', 'enterprise']).default('free'),
  }),
  defaults: { plan: 'free' },
  ports: { in: [], out: [{ kind: 'reference', label: 'records' }] },
  emit(res, ctx) {
    return ctx.block('resource', [res.type, res.name], res.args);
  },
});
```

```ts
// src/index.ts
import { registerProvider } from '@blueprint/resources';

import { cloudflareZone } from './zone.js';

export function register() {
  registerProvider({
    provider: 'cloudflare',
    displayName: 'Cloudflare',
    resources: [cloudflareZone],
  });
}
```

In the host app:

```ts
import { register as registerCloudflare } from '@blueprint-provider/cloudflare';

registerCloudflare();
```

That's it. The palette, inspector, parser and emitter pick up
`cloudflare_zone` automatically — no host-app patch required.

---

## Naming conventions

| Thing                   | Convention                                                                |
| ----------------------- | ------------------------------------------------------------------------- |
| npm package (provider)  | `@blueprint-provider/<name>` (`-provider/cloudflare`)                     |
| npm package (templates) | `@blueprint-template/<slug>` (`-template/eks-ha`)                         |
| Repository name         | `cloud-blueprint/community-providers/<name>`                              |
| Provider key            | The Terraform provider's CLI name (`cloudflare`, `vmware`, `oraclepaas`). |
| Resource `type`         | The Terraform `<type>` exactly (`cloudflare_zone`).                       |

The host app keys the registry by the **`provider` field on the
definition**, not by package name — so two packages can extend the same
provider without collisions. A registration with the same
`(provider, type)` pair as one already in the registry is **silently
ignored** (idempotency for HMR).

### Provider key

Today the IR's `Provider` type only enumerates `aws`, `azure`, `gcp`,
`kubernetes`, `random`, `tls`. Until we widen it, **community resources
must pick the closest core provider** for the `provider` field on the
definition (use `aws` for cloud-style providers, `kubernetes` for
operator-style ones). The **palette grouping** is keyed independently
through `registerProvider({ provider: 'cloudflare', … })`, so users still
see Cloudflare as its own group — only the IR's typed `Provider` is
limited to the core set. Widening the IR's `Provider` enum to a string
is tracked as a follow-up to keep the typed catalog backwards compatible.

---

## Resource definition checklist

When you implement `defineResource({ … })`:

- [ ] **`type`** matches the Terraform resource exactly.
- [ ] **`category`** is one of `Compute | Storage | Network | Database |
Identity | Container | Serverless | Messaging | Analytics | CDN | DNS |
Other`.
- [ ] **`schema`** is a Zod schema (used by the inspector to render forms
      and validate before emit).
- [ ] **`defaults`** are sensible — they decide what the user sees the
      moment they drag the node onto the canvas.
- [ ] **`ports`** describe where edges are meaningful. `in` ports accept
      incoming connections; `out` ports are where outgoing edges originate.
- [ ] **`emit`** stays a one-liner whenever possible: `return ctx.block('resource',
[res.type, res.name], res.args);`. Reach for nested blocks only when
      the Terraform schema requires them.
- [ ] **Pareto 80/20.** Cover the 5–15 most-used fields, not all 200.
      Anything left out automatically falls into the "raw" inspector pane,
      so users can still hand-edit.

---

## Template definition checklist

```ts
import { defineTemplate, registerTemplate } from '@blueprint/templates';
import { newResource, edge } from '@blueprint/ir';
import { z } from 'zod';

export const eksHa = defineTemplate({
  slug: 'eks-ha',
  name: 'EKS — High Availability',
  description: 'EKS cluster across 3 AZs with managed node groups.',
  provider: 'aws',
  thumbnail: '/templates/eks-ha.png',
  params: z.object({ name: z.string().default('eks-ha') }),
  build({ name }) {
    const cluster = newResource('aws_eks_cluster', name, {});
    return { addResources: [cluster], addEdges: [] };
  },
});

registerTemplate(eksHa);
```

- [ ] **`slug`** is unique across the registry. Re-registering replaces
      the previous entry — useful in HMR, dangerous in prod, so prefer a
      unique name.
- [ ] **`params`** is a Zod schema; the dashboard's "Use template"
      modal turns it into a form automatically.
- [ ] **`build` returns an `IRPatch`.** Don't try to run side effects.

---

## Stability promise

| Surface                                           | Stability                           |
| ------------------------------------------------- | ----------------------------------- |
| `defineResource` field shape                      | **public** — major bumps only       |
| `defineTemplate` field shape                      | **public** — major bumps only       |
| `registerProvider` / `unregisterProvider`         | **public**                          |
| `setProviderResources` (replace-wholesale)        | public, "use sparingly"             |
| `registerTemplate` / `unregisterTemplate`         | **public**                          |
| `getRegisteredCatalog()` / `getAllResources()`    | **public**                          |
| `getRegisteredTemplates()` / `getAllTemplates()`  | **public**                          |
| `clearProviderRegistry` / `clearTemplateRegistry` | **test-only** — no backwards compat |

---

## Where to host your package

Until we open a dedicated GitHub org, host community providers under your
own org and link them in the [Resource & template registry](./RESOURCES.md)
issue or in the [`good-first-issues` board][gfi]. We'll move popular ones
into `cloud-blueprint/community-providers` once that monorepo is set up.

[gfi]: ./GOOD-FIRST-ISSUES.md
