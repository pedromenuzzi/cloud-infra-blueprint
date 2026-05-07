# 0001 — HCL parsing happens in the browser

- **Status:** Accepted
- **Date:** 2025-04-15
- **Tags:** `frontend`, `parser`, `architecture`

## Context

The product hinges on a **bidirectional sync** between a visual canvas and a
Monaco editor showing real Terraform HCL. Every keystroke in Monaco needs to
be parsed back into the canonical IR (see
[ADR 0002](0002-canonical-ir.md)) so the canvas can converge, and every
canvas mutation needs to be re-emitted as HCL so the editor stays in sync.

Two extremes were obvious from day one:

1. **Server-side parsing.** Send the buffer over HTTP/WebSocket, parse on the
   backend, ship back the IR diff. This is the path taken by IDE-like SaaS
   such as Brainboard.
2. **Browser-side parsing.** Run the parser inside the user's tab — no network
   hop on the hot path.

Constraints in play at decision time:

- The official HCL parser is written in Go. The maintained
  [`@cdktf/hcl2json`](https://www.npmjs.com/package/@cdktf/hcl2json) package
  ships it as a WASM blob (~1.5 MB compressed) that runs anywhere.
- The product needs a **130–200 ms budget** for the worst case parse + emit
  on ~500 LOC files (`docs/PERFORMANCE.md`). Adding a network round-trip alone
  burns 30–80 ms before any work is done.
- The MVP cannot afford a stateful socket per active editor pane. Even at
  200 active users, that's ~10 Mb/s of buffer churn for nothing more than
  reformatting.
- We want the editor to be usable **offline** (PWA target in F6). A
  server-side parser makes this impossible by construction.

## Decision

> The HCL parser and emitter run entirely in the browser, inside a dedicated
> Web Worker.

Concretely:

- [`packages/hcl/src/worker.ts`](../../packages/hcl/src/worker.ts) loads
  `@cdktf/hcl2json` and exposes a tiny postMessage protocol
  (`{ type: 'parse', filename, source } -> { type: 'result', ast }`).
- [`apps/web/src/workers/hcl.worker.ts`](../../apps/web/src/workers/hcl.worker.ts)
  re-exports it as a Vite worker entry so the bundler can fingerprint and
  ship it correctly.
- The emitter ([`packages/hcl/src/emitter.ts`](../../packages/hcl/src/emitter.ts))
  is pure TypeScript — no WASM, no DOM, no Node APIs — so it ships in the
  same worker, but is also reused server-side by tests and (later) by the
  export pipeline.
- The backend never parses HCL on a request hot path. It stores
  `Project.ir` and `Project.files` as opaque jsonb blobs and relays Yjs
  updates over `y-websocket` (see [ADR 0004](0004-yjs-vs-ot.md)).

## Alternatives considered

### Server-side parser (NestJS endpoint)

Would have required a `@cdktf/hcl2json` install on the API plus a queue to
amortize parse spikes (Redis + BullMQ already in the stack). **Rejected**
because it adds a network round-trip to every keystroke, breaks offline,
and turns the API into a fan-out hot spot that scales with active editors
rather than persisted projects.

### Hand-written TypeScript parser

The HCL grammar is not huge but the surface area of corner cases is
(heredocs, escaping, interpolation grammar, dynamic blocks). A hand-roll
would take weeks to reach the round-trip quality the WASM parser already
provides — and would still need the canonical IR (ADR 0002) for the
emitter side. **Rejected** as a maintenance liability.

### Tree-sitter (`tree-sitter-hcl`) compiled to WASM

Smaller binary, incremental parsing out of the box. **Rejected** at MVP
time because the existing AST shape didn't map cleanly onto our IR and
the maintenance pace of `tree-sitter-hcl` was uneven. Worth revisiting
when ADR 0006 (incremental parsing) is filed — see
[#parser-incremental on the roadmap](../ROADMAP.md).

## Consequences

- **Positive**
  - The backend is dramatically smaller. No HCL dependency, no parser CPU
    budget on the request path, no per-editor WebSocket fan-out for
    formatting alone.
  - Latency is dominated by user CPU + WASM startup (cached after first
    parse). Even on a slow Chromebook, parse + emit on a 500 LOC file
    measures in the 35–135 ms band.
  - Offline mode (F6 PWA) is free: the editor keeps working without the
    API as long as the browser tab is open.
  - The same worker file is reusable as a library (`@blueprint/hcl/worker`)
    by anyone wanting an HCL editor in their app — see ADR 0008 (planned)
    on `@blueprint/hcl` as a public npm package.
- **Negative**
  - First-load cost includes the WASM blob (~1.5 MB compressed). It loads
    in parallel with React and lives in its own worker chunk, so the
    landing page is unaffected, but the editor route is heavier than a
    pure-text editor would be.
  - We cannot enforce server-side validation of the HCL the user is
    authoring. The backend trusts the IR it persists; if a future
    "validate before save" feature is needed, the parser may need to run
    server-side _additionally_ (not instead).
  - WASM workers require a Content Security Policy that includes
    `worker-src blob:` and `wasm-unsafe-eval` — documented in
    [`apps/api/src/main.ts`](../../apps/api/src/main.ts) helmet config.
- **Follow-ups**
  - ADR 0006 (incremental parser with block cache) — re-parse only the
    block touched by the latest Yjs delta instead of the full file.
  - ADR 0008 (publishing `@blueprint/hcl` and `@blueprint/ir` to npm).

## References

- [`packages/hcl/src/worker.ts`](../../packages/hcl/src/worker.ts) — worker entry.
- [`packages/hcl/src/parser.ts`](../../packages/hcl/src/parser.ts) — AST → IR walk + range scanner.
- [`docs/PERFORMANCE.md`](../PERFORMANCE.md) — bench budgets for parse/emit.
- [`apps/web/vite.config.ts`](../../apps/web/vite.config.ts) — `optimizeDeps.exclude` for the WASM blob.
