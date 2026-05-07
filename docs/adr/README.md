# Architecture Decision Records (ADRs)

This directory captures the **non-obvious** technical decisions behind Cloud
Infra Blueprint, in the [MADR](https://adr.github.io/madr/) format. Read these
before opening a deep technical issue or PR — most "why don't you just …?"
questions are answered here.

## Index

| #    | Title                                                                            | Status   |
| ---- | -------------------------------------------------------------------------------- | -------- |
| 0001 | [HCL parsing happens in the browser](0001-hcl-parsing-in-the-browser.md)         | Accepted |
| 0002 | [Canonical IR as the single source of truth](0002-canonical-ir.md)               | Accepted |
| 0003 | [Minimal HCL patches via `rawTextRange`](0003-minimal-patch-via-rawtextrange.md) | Accepted |
| 0004 | [Yjs (CRDT) for collaborative editing instead of OT](0004-yjs-vs-ot.md)          | Accepted |
| 0005 | [Fastify + NestJS instead of Express](0005-fastify-vs-express.md)                | Accepted |
| 0006 | [Plugin API for community providers and templates](0006-plugin-api.md)           | Accepted |
| 0007 | [Cost estimation via the open-source Infracost CLI](0007-cost-via-infracost.md)  | Accepted |

## How to add a new ADR

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-kebab-case-title.md`
   using the next free number.
2. Fill in **Status**, **Context**, **Decision** and **Consequences** sections.
3. Open a PR. The ADR is the discussion artifact — reviewers comment on the
   document, not on the implementation.
4. Reference the ADR from the relevant code with a line comment:
   `// See docs/adr/0007-...md`.

## When to write an ADR

You probably need an ADR if the change:

- introduces a new runtime dependency or a new shared package boundary,
- changes the IR public types in [packages/ir/src/types.ts](../../packages/ir/src/types.ts),
- changes the wire protocol used by `@blueprint/hcl/worker`,
- changes how Monaco and the canvas exchange state,
- removes or replaces an existing accepted decision (a new ADR with status
  `Supersedes 000X`).

Trivial bug fixes, new resources in the catalog, and isolated refactors do
**not** need an ADR.
