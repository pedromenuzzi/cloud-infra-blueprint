---
'@blueprint/ir': minor
'@blueprint/hcl': minor
'@blueprint/resources': minor
'@blueprint/templates': minor
'@blueprint/ui': minor
---

First public release of the Cloud Infra Blueprint packages.

- `@blueprint/ir` — canonical Intermediate Representation (`Op` system, `applyOp`/`applyOps`, `invertOp`/`invertOps`, factory helpers).
- `@blueprint/hcl` — HCL parser and emitter, including the new `HclIncrementalParser` (per-block cache via `Trivia.rawTextRange`) and a Web Worker client.
- `@blueprint/resources` — declarative multi-cloud catalog (AWS / Azure / GCP) with `defineResource`.
- `@blueprint/templates` — pre-baked architecture patterns emitted as IR patches via `defineTemplate`.
- `@blueprint/ui` — design-system primitives (Button, Card, Input, Badge, Avatar, Logo, ProviderIcon, Modal) on Tailwind + shadcn conventions, with a public Storybook on GitHub Pages.

These five packages now follow public semver via Changesets and publish to npm under the `@blueprint/*` scope (`access: public`).
