# Architecture

> **30-second summary:** the canvas and Monaco are two projections of the same
> canonical IR. The HCL parser/emitter runs in the browser via WASM. The backend
> stays thin — persistence, auth, WebSocket relay (Yjs) and exports.

## Layers

```
┌─────────────────────────── BROWSER ───────────────────────────┐
│ React 18 + TypeScript + Vite                                   │
│ ├─ React Flow (canvas, subflows)                               │
│ ├─ Monaco (HCL editor with diagnostics)                        │
│ ├─ Zustand (IR store)                                          │
│ ├─ Yjs + y-monaco (CRDT over the .tf text — F3+)               │
│ ├─ Web Worker → @cdktf/hcl2json (WASM, HCL → JSON AST)         │
│ ├─ packages/hcl emitter (IR → HCL with trivia preserved)       │
│ ├─ Command Palette + ShortcutsLayer (global keyboard fabric)    │
│ └─ @blueprint/ui design system (light · dark · system themes)  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP (REST, JSON-Schema validated)
                            │ WebSocket (y-websocket — F3+)
                            ▼
┌─────────────────────────── BACKEND ───────────────────────────┐
│ NestJS 10 + Fastify                                            │
│ ├─ Prisma 5 + PostgreSQL (Neon in prod)                        │
│ ├─ Redis + BullMQ (queues, rate-limit, cache)                  │
│ ├─ WebSocket Gateway (y-websocket protocol)                    │
│ ├─ Auth (Clerk OR Auth.js, behind a port)                      │
│ ├─ Health (graceful: API stays up if DB is down)               │
│ └─ Cloudflare R2 (export zips — F5)                            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────── EXTERNAL ──────────────────────────┐
│ GitHub / GitLab APIs (OAuth + push — F5)                       │
│ Sentry, PostHog                                                │
└─────────────────────────────────────────────────────────────────┘
```

## Key decision

> The whole HCL ↔ IR transformation runs in the browser.

Why:

- **Latency.** No round-trip to the server on every keystroke; UX stays under
  100 ms.
- **Cost.** The backend doesn't have to parse for each user; modest machines
  scale far.
- **Resilience.** The editor works offline (PWA in F6).

The backend only stores snapshots of the IR (`Project.ir` jsonb) and the `.tf`
files (`Project.files` jsonb), and relays Yjs updates over WebSocket for
collaborative editing.

## Edit flow

### Case A — drag from the palette to the canvas

1. `Palette` triggers `dataTransfer` with the resource type.
2. `CanvasPane.onDrop` calls `useIRStore.apply([{ kind: 'add_resource', node }])`.
3. Yjs applies the change on the IR `Y.Map` (F3+).
4. The worker emits the HCL block and `Y.Text.insert`s it in the right file.
5. Other peers converge over WebSocket.

### Case B — typing in Monaco

1. y-monaco propagates the keystroke to `Y.Text`.
2. The worker observes the delta, calls `parse(filename, source)` via WASM,
   gets the AST.
3. Diff against the current IR yields a sequence of `Op`s.
4. `applyOps(ir, ops)` produces the new IR; the canvas re-renders only the
   nodes that changed.

### Conflict resolution

- Yjs guarantees eventual convergence (CRDT).
- Trivial fields (string/number) → last-write-wins.
- Simultaneous edits to the same block → the Monaco user wins because the
  canvas re-parses every resolved token.
- `position` (x/y) lives in a separate Yjs map — never conflicts with text.

## The IR

Strictly typed (TypeScript discriminated unions):

- **`Expression`** — `literal | list | object | ref | raw`.
- **`Trivia`** — preserves comments and `rawTextRange` (start/end byte offsets).
- **`Op`** — atomic mutation sequence (`add_resource`, `remove_resource`,
  `set_attribute`, `move_node`, …).

`raw` is the escape hatch: whenever the parser can't model an expression
perfectly (complex heredocs, nested `for` expressions), the original source goes
into `raw` and the emitter spits it back verbatim. This guarantees round-trip
even on the messiest fixtures.

## Minimal patching

`packages/hcl/src/patch.ts` reuses `trivia.rawTextRange` to **rewrite only the
affected text range**. Comments above the block, blank lines, and unrelated
blocks survive untouched. `shiftRanges` keeps subsequent ranges valid after a
patch.

## Front-end architecture

```
apps/web/src/
├── routes/                 # React Router lazy routes
├── features/
│   ├── editor/             # Canvas + Monaco + topbar
│   ├── palette/            # Resource palette + filters
│   ├── inspector/          # Property panel
│   └── templates/          # Templates gallery
├── components/
│   ├── AppRail.tsx         # Primary navigation
│   ├── CommandPalette.tsx  # Ctrl+K cmdk
│   ├── ShortcutsLayer.tsx  # Global keyboard fabric
│   └── ShortcutsHelp.tsx   # ? cheat sheet
├── theme/                  # Light / dark / system store
├── lib/
│   ├── api.ts              # Typed fetch + ApiError
│   ├── useTemplates.ts     # offline-first hook
│   └── useProjects.ts      # offline-first hook
└── test/                   # vitest (UI + routes + a11y stubs)
```

## Back-end architecture

```
apps/api/src/
├── main.ts                 # Fastify bootstrap (helmet, cors, swagger)
├── app.module.ts
├── modules/
│   ├── auth/               # Clerk / Auth.js port
│   ├── orgs/
│   ├── projects/
│   ├── versions/
│   ├── share/
│   ├── git/                # GitHub + GitLab (F5)
│   ├── export/             # zip + R2 upload (F5)
│   ├── templates/
│   ├── realtime/           # y-websocket gateway (F3+)
│   └── health/             # /health, graceful when DB is down
└── prisma/                 # PrismaService (graceful onModuleInit)
```

## Test contract

In `packages/hcl/src/*.test.ts`:

- **Round-trip snapshots** (HCL → IR → HCL → string equal).
- **Property-based** with `fast-check`: random IR, emit, parse, compare. CI
  runs 1000 iterations.
- **Bench** (`performance.now()`) keeps parse + emit on ~500 LOC under 80 ms
  locally (200 ms ceiling for Windows CI).

In `apps/web/src/test/*.test.tsx`:

- **UI components** (Button, Card, Badge, …) rendered with React Testing
  Library and basic ARIA assertions.
- **Routes** (Landing, Templates, NotFound, Dashboard) rendered through
  `MemoryRouter` to test offline-first behaviour and headings.

In `apps/web/tests/e2e/*.spec.ts`:

- **End-to-end** (`landing.spec.ts`, `dashboard.spec.ts`) covering
  navigation, templates filter, theme switching, command palette.
- **Accessibility audit** (`a11y.spec.ts`) using `@axe-core/playwright` on
  every main route.

If any of these break, a PR cannot land.

## Deployment

- **Web** → Vercel (preview per PR, prod on `main`).
- **API** → Fly.io with a single shared region in F0/F1, multi-region in F6.
- **Database** → Neon (Postgres serverless) for prod, Docker for dev.
- **Storage** → Cloudflare R2 for export zips.
- **Observability** → Sentry (errors), PostHog (product analytics), pino
  (structured logs piped to Datadog or Loki later).
