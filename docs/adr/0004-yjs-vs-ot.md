# 0004 — Yjs (CRDT) for collaborative editing instead of OT

- **Status:** Accepted
- **Date:** 2025-04-22
- **Tags:** `realtime`, `architecture`, `crdt`

## Context

The product promise is **bidirectional sync** between a visual canvas and
the HCL editor. F3 of the roadmap extends that promise to **multi-user**:
two engineers editing the same project, both seeing each other's cursors
and changes converge in real time, both able to keep working with patchy
networks.

Two families of algorithms solve this:

1. **Operational Transformation (OT).** Each client sends operations to a
   central server; the server transforms operations against the ones it
   has seen and rebroadcasts. Famous for powering Google Docs.
2. **Conflict-free Replicated Data Types (CRDT).** Each client tracks
   metadata (causality vectors, tombstones, position identifiers) so that
   any two replicas converge no matter the order they receive updates,
   without a privileged authority.

Constraints at decision time:

- We need to converge **two heterogeneous editors** for the same logical
  state: the Monaco text buffer (HCL) and the canvas (IR). A change to
  one must propagate to the other on every keystroke / drag.
- The backend must remain **stateless on the request hot path**
  (see [ADR 0001](0001-hcl-parsing-in-the-browser.md)). A WebSocket
  relay is acceptable; computing transforms server-side is not.
- Real Terraform sessions are bursty (long pauses, then 30 seconds of
  furious typing). The protocol should compress idle time to near-zero
  bandwidth.
- We need the same machinery to power **offline-then-reconnect**: an
  engineer on a flaky train Wi-Fi keeps editing locally, syncs back when
  the connection returns. CRDTs handle this trivially; OT requires
  custom buffering and replays.

## Decision

> The realtime layer uses **Yjs** (a CRDT library) with `y-monaco` for the
> text editor, a `Y.Map` for the IR, and `y-websocket` for the transport.
> The backend is a thin relay; it never transforms ops.

Concretely:

- Monaco's buffer is bound to a `Y.Text` via the `y-monaco` adapter.
  Cursor positions, selections and presence are exchanged over the same
  socket via the Awareness protocol.
- The IR is mirrored to a `Y.Map` of `Y.Map`s keyed by node id. Each
  `Op` from [ADR 0002](0002-canonical-ir.md) maps to a `doc.transact()`
  block — a single CRDT transaction that updates the relevant map keys.
- Visual-only fields (`position.x`, `position.y`) live in their own
  `Y.Map`, separate from the text buffer. Concurrent moves on the same
  node merge to last-write-wins per coordinate without ever touching
  the HCL.
- The backend gateway in
  `apps/api/src/modules/realtime/realtime.gateway.ts` (planned for F3)
  uses `y-websocket`'s server bindings: receive an update, persist it
  to `Project.files` jsonb periodically, broadcast to other clients
  in the same room. No transform logic.
- Undo/Redo is delegated to `Y.UndoManager`, which knows how to invert
  CRDT changes. The local Undo stack from the planned ADR 0007 will
  be **replaced** by `Y.UndoManager` in F3 — the API is intentionally
  shaped to make this swap mechanical.

## Alternatives considered

### Operational Transformation (ShareDB / sharejs)

Battle-tested by Google Docs and Etherpad. **Rejected** because:

- It requires a stateful, authoritative server for every active room.
  The whole point of ADR 0001 was to keep the API thin and stateless.
- The transform functions for our `Op` set would have to be hand-written
  and proven correct. Any bug means silent state divergence between
  clients.
- Offline-then-reconnect needs custom buffering and replay protocols on
  top.

### Automerge

The other production-grade CRDT in JS. **Rejected** at MVP time because:

- Automerge 2.x performance for large text documents was still maturing.
  Yjs has been used in production by Notion, Linear (briefly) and
  Maxime Heckel's editor — text is its hot path.
- The Automerge API leans heavily on Immer-style proxies and JSON,
  which fights our discriminated-union `Op` model. Yjs leaves us in
  control of how we shape changes.

### Roll-our-own diff + WebSocket protocol

Tempting because the IR is small and structured. **Rejected** as a
maintenance hazard. The first time two clients race a `set_arg` on the
same field, we would re-derive Yjs from first principles and ship the
bugs that come with it.

### No collaboration in MVP

Punt to F4+, ship single-user only. Briefly considered. **Rejected**
because the bidirectional sync inside a single tab (canvas ↔ HCL)
already needs CRDT-shaped semantics — the HCL parser worker and the
canvas can race against the user's own typing. Adopting Yjs early gives
single-tab convergence and multi-user convergence with the same code.

## Consequences

- **Positive**
  - The backend stays simple. The gateway is a few hundred lines of
    boilerplate around `y-websocket`. Persistence is a debounced "snapshot
    the doc state to jsonb" job.
  - Offline support is automatic: edits accumulate in the local `Y.Doc`,
    sync on reconnect.
  - Same protocol powers single-tab canvas ↔ HCL convergence and
    multi-user. One mental model.
  - Bandwidth is excellent at idle (zero) and reasonable under load
    (Yjs sends compact binary updates with structural sharing).
- **Negative**
  - CRDT garbage (tombstones for deleted text, deleted-node history)
    accumulates in the doc. We need a periodic snapshot+rebuild policy
    to keep `Project.files` jsonb from growing unboundedly. Acceptable
    cost; Notion ships the same compromise.
  - Yjs adds ~70 KB gzip to the editor route. Lazy-loaded with the rest
    of the editor chunk so the landing page stays under budget
    (`docs/PERFORMANCE.md`).
  - Some IR mutations are awkward to express as CRDT transactions —
    notably "delete a resource and re-add it under a different parent".
    Modelled today as `remove_resource` + `add_resource`, which is fine
    semantically but loses identity for cursor presence / undo grouping.
    Tracked as a known limitation.
- **Follow-ups**
  - ADR 0007 (Undo/Redo before Yjs lands) — local-only stack with the
    same API surface as `Y.UndoManager` so swap-in is mechanical.
  - The realtime gateway needs an authn step before F3 ships publicly;
    today it would accept any client. Tracked in the security backlog.

## References

- [`apps/api/src/modules/realtime/realtime.gateway.ts`](../../apps/api/src/modules/realtime/realtime.gateway.ts) — current gateway placeholder.
- [Yjs documentation](https://docs.yjs.dev/) — CRDT primitives we use.
- [y-monaco](https://github.com/yjs/y-monaco) — Monaco binding.
- [y-websocket](https://github.com/yjs/y-websocket) — transport.
- [Martin Kleppmann's CRDT survey](https://martin.kleppmann.com/papers/crdt-hardvard.pdf) — background reading.
