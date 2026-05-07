# 0003 — Minimal HCL patches via `rawTextRange`

- **Status:** Accepted
- **Date:** 2025-04-18
- **Tags:** `parser`, `emitter`, `ux`

## Context

Once we decided that the IR is canonical ([ADR 0002](0002-canonical-ir.md))
and that HCL is just a serialization format, the obvious implementation of
"save" was: **serialize the entire IR back to HCL on every change**. That
is what most diagram-as-code tools do, and it is also what destroys real
users' files.

Real Terraform repositories contain:

- **Comments** above resources (`# Why this ALB exists`, `# TODO: shrink`).
- **Block ordering** intentionally different from alphabetical (related
  resources grouped together by humans).
- **Whitespace** that signals visual structure (blank lines between logical
  sections).
- **Heredocs** and **dynamic blocks** that the IR's typed expressions cannot
  fully model.

A naive emitter that re-renders the whole file would:

1. Drop comments (or move them to alien locations).
2. Reorder resources alphabetically (the canonical sort the emitter uses).
3. Squash whitespace.
4. Round-trip heredocs into broken `raw` strings.

The first time a user runs `git diff` after editing one EC2 instance and
sees a 400-line reformat, they uninstall the product. This is non-negotiable.

## Decision

> Every IR node carries a `Trivia.rawTextRange` pointing back to the byte
> range it originated from in the source. The emitter writes back **only
> the bytes inside that range**, leaving the rest of the file untouched.

Concretely:

- The parser walks the AST from `@cdktf/hcl2json`, then runs a second pass
  ([`scanBlockRanges`](../../packages/hcl/src/parser.ts) in
  `packages/hcl/src/parser.ts`) over the original source text. That scanner
  is a tiny brace-matching state machine that respects strings, line
  comments, block comments and heredocs, so braces inside them don't
  throw the depth counter.
- Each `ResourceNode` and `ModuleNode` gets a `trivia.rawTextRange =
{ start, end }` pointing at exactly the byte slice it came from.
- The patch helpers in [`packages/hcl/src/patch.ts`](../../packages/hcl/src/patch.ts):
  - `patchResource(text, range, newBody)` rewrites only the bytes inside
    `range`.
  - `removeResource(text, range)` deletes the bytes plus the surrounding
    blank lines.
  - `shiftRanges(ranges, change)` keeps subsequent ranges valid after the
    file size changed.
- For brand-new resources (no `rawTextRange` yet), the emitter appends
  fresh blocks at the end of the file and assigns a range from the new
  insertion point.

## Alternatives considered

### Whole-file canonical re-emit (the naive baseline)

Simplest possible emitter, ~50 lines. **Rejected** because of the
"reformatted my whole repo" experience above. Ignored once was enough.

### Source maps

Keep an external `Map<NodeId, SourceRange>` instead of embedding it in
`Trivia`. **Rejected** because the IR is already passed across worker
boundaries, persisted as `Project.ir` jsonb and merged through Yjs —
maintaining a parallel map in lock-step would be a constant correctness
hazard. Embedding the range in the node makes drift impossible.

### A textual diff library (`diff-match-patch`, etc.)

Compute a textual diff between "old emitted HCL" and "new emitted HCL",
then apply the diff to the source. **Rejected** because the diff library
sees text without semantics — it would happily collapse a comment block
that "looks similar" to one above another resource, or split an
attribute across sibling blocks. The pain of debugging that class of bug
exceeds the cost of writing the range scanner.

## Consequences

- **Positive**
  - Comments and block ordering survive every IR mutation. `git diff`
    after editing one attribute is exactly one line — predictable and
    reviewable.
  - The emitter is decoupled into "render a single block" and "splice
    bytes into the source", both of which are independently testable
    (see `packages/hcl/src/patch.test.ts`).
  - The `rawTextRange` doubles as the key for incremental parsing in
    ADR 0006: when the user edits inside `range`, only that block needs
    to be re-parsed, not the whole file.
- **Negative**
  - The range scanner is a second pass over the source, paid on every
    parse. Today this costs 5–15 ms on a 500 LOC file — acceptable, but
    it has to keep up with `@cdktf/hcl2json` if the parser ever gains
    grammar features we miss.
  - `shiftRanges` is the most error-prone code in the package. Off-by-one
    bugs corrupt the file silently. Mitigated by 75+ round-trip fixtures
    - a property test (`packages/hcl/src/property.test.ts`) with 250
      iterations locally and 1000 in CI.
  - Brand-new resources are appended; we cannot insert them at a
    user-friendly place yet (e.g. next to a related resource). This is a
    known UX limitation — see issue tracker for "smart insertion point".
- **Follow-ups**
  - ADR 0006 (incremental parser) reuses `rawTextRange` as its cache key.
  - When the canvas gains drag-to-reorder, we will need an `Op` for
    moving a block within the file (today, ordering changes are silently
    dropped on round-trip).

## References

- [`packages/hcl/src/parser.ts`](../../packages/hcl/src/parser.ts) — `scanBlockRanges`, brace matcher, heredoc skipper.
- [`packages/hcl/src/patch.ts`](../../packages/hcl/src/patch.ts) — minimal patch primitives.
- [`packages/hcl/src/patch.test.ts`](../../packages/hcl/src/patch.test.ts) — 4 patch scenarios verifying trivia preservation.
- [`packages/hcl/src/roundtrip.test.ts`](../../packages/hcl/src/roundtrip.test.ts) — 75+ fixture round-trip suite.
