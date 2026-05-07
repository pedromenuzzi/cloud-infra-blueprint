# 0002 — Canonical IR as the single source of truth

- **Status:** Accepted
- **Date:** 2025-04-16
- **Tags:** `architecture`, `ir`, `parser`, `canvas`

## Context

The product needs a **single source of truth** that the visual canvas and the
HCL editor can both project into and from. Three shapes were on the table at
MVP design time:

1. **Text as truth.** Store the raw `.tf` source; rebuild canvas state from
   the parser on every change. Simple, but the canvas would have nowhere to
   put visual-only data (positions, parent groupings, ephemeral selection).
2. **AST as truth.** Use the JSON AST emitted by `@cdktf/hcl2json`
   ([ADR 0001](0001-hcl-parsing-in-the-browser.md)) directly. No
   transformation layer, no maintenance. But the AST shape changes between
   parser releases, includes Terraform-quirks we don't want leaking into the
   canvas, and has no place for canvas metadata either.
3. **Bespoke IR.** A typed graph designed for the canvas, with explicit
   bridges to and from HCL.

Constraints at decision time:

- The canvas must support **operations the AST cannot natively model**:
  drag positions, parent/child grouping (VPC → Subnet → EC2), edges that
  represent IAM/network/reference relationships, and stable node ids that
  survive a Terraform `name` rename.
- The IR is consumed by **multiple writers**: the inspector form, the
  palette drag-drop, the HCL parser walk and (in F4) bulk template patches.
  All four must agree on what an "operation" is.
- We need **invertible mutations** for Undo/Redo and for the future Yjs
  CRDT integration ([ADR 0004](0004-yjs-vs-ot.md)).
- We need to round-trip arbitrary user HCL (heredocs, dynamic blocks,
  ternaries with function calls) without dropping bytes — so the IR has
  to leave space for "I don't fully understand this expression, keep it
  verbatim" (`Expression.kind = 'raw'`).

## Decision

> A purpose-built IR lives in `@blueprint/ir`. It is the canonical state of
> a project; HCL is a serialization format and the canvas is a view.

Concretely:

- [`packages/ir/src/types.ts`](../../packages/ir/src/types.ts) defines
  `IR`, `ResourceNode`, `ModuleNode`, `IREdge`, `Expression`, `Trivia`
  and `Op` as discriminated unions.
- Mutations only happen through `Op` (a closed union of 12 atomic kinds).
  All canvas/inspector/parser code calls
  [`applyOp(ir, op)`](../../packages/ir/src/graph.ts) instead of mutating
  state directly. This makes every mutation **inspectable** and
  **invertible**.
- Two escape hatches keep the IR honest under real-world Terraform:
  - `Expression.kind = 'raw'` for any expression the parser does not
    confidently model — heredocs, complex interpolations, function
    calls. The emitter dumps it verbatim.
  - `Trivia` carries comments and the original `rawTextRange` so we can
    apply minimal patches (see [ADR 0003](0003-minimal-patch-via-rawtextrange.md))
    instead of reformatting the whole file on every save.
- The IR is **the** wire format between the worker, the canvas and the
  backend. The backend stores it as `Project.ir` jsonb and ships it to
  new clients alongside the source `files` jsonb.

## Alternatives considered

### Use the hcl2json AST directly

Tried for the first prototype. Failed within a week because the AST
collapses some HCL constructs in lossy ways (e.g. interpolation strings
are returned as plain JS strings, indistinguishable from string literals)
and offers no place for canvas metadata. **Rejected** because the canvas
would need to keep a parallel state anyway.

### Plain mutable Zustand state without `Op`

Faster to write, no closed union to maintain. **Rejected** because Yjs
([ADR 0004](0004-yjs-vs-ot.md)) needs a way to merge concurrent changes,
Undo/Redo needs invertibility (planned ADR), and the templates feature
([packages/templates](../../packages/templates/src/)) needs transactional
bulk patches. All three are trivial with `Op` and painful without.

### Reuse `@cdktf/cdktf` constructs

CDKTF's data model is built around Construct trees and assumes a code-as-IR
workflow (you write JSX-like code, it emits JSON for `terraform`). Wrong
abstraction for an editor that **consumes** existing HCL. **Rejected.**

## Consequences

- **Positive**
  - Canvas, parser, inspector and templates speak the same language. New
    code added next to any of them automatically benefits from the closed
    `Op` union (TypeScript `switch` exhaustiveness errors at compile time).
  - The IR survives parser version bumps. We can switch from
    `@cdktf/hcl2json` to a tree-sitter parser later (see ADR 0001
    follow-ups) without any canvas changes.
  - `Op` makes Yjs adoption mechanical: each `Op` becomes a single
    `Y.Doc` transaction, and `Y.UndoManager` works out of the box.
  - Bench: parse + emit + IR walk on a 500 LOC project measures in the
    35–135 ms band, well under the 200 ms budget.
- **Negative**
  - Two serialization formats to maintain: the IR (consumed by canvas +
    backend) and the HCL emitter (consumed by Monaco + export). Every
    new resource type touches both.
  - The `Expression.kind = 'raw'` escape hatch means some bits of HCL
    are opaque to the canvas. A user-written `dynamic "tags"` block
    cannot be edited from the inspector — only deleted or copied.
  - The IR adds a hop: a one-byte change in HCL becomes "parse → diff IR →
    apply Ops → emit". The diff step is what costs 35–135 ms today; it
    is the first thing ADR 0006 (incremental parsing) attacks.
- **Follow-ups**
  - ADR 0006: incremental parser, so re-parse work is bounded by the
    block the user just touched, not the full file.
  - ADR 0007: Undo/Redo manager built on `Op` invertibility (small,
    arrives before Yjs).

## References

- [`packages/ir/src/types.ts`](../../packages/ir/src/types.ts) — canonical types.
- [`packages/ir/src/graph.ts`](../../packages/ir/src/graph.ts) — `applyOp`, `applyOps`, `applyPatch`.
- [`packages/hcl/src/parser.ts`](../../packages/hcl/src/parser.ts) — AST → IR walk.
- [`packages/hcl/src/emitter.ts`](../../packages/hcl/src/emitter.ts) — IR → HCL.
- [`docs/IR-SPEC.md`](../IR-SPEC.md) — narrative spec.
