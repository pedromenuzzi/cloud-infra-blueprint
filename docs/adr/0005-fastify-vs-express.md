# 0005 — Fastify + NestJS instead of Express

- **Status:** Accepted
- **Date:** 2025-04-25
- **Tags:** `backend`, `architecture`, `performance`

## Context

The backend is intentionally thin (see
[ADR 0001](0001-hcl-parsing-in-the-browser.md) and
[ADR 0004](0004-yjs-vs-ot.md)) — it persists snapshots, relays Yjs updates,
and exposes a small REST surface (`/projects`, `/templates`, `/share`,
`/git`, `/export`). The framework choice was about three things:

1. **DI + module boundaries** that survive the project growing to 20+
   modules without turning into spaghetti.
2. **Per-request CPU budget**: even though the heavy work runs in the
   browser, the API still has to handle WebSocket fan-out and snapshot
   persistence at hundreds of req/s during peak collaboration.
3. **First-class TypeScript**, with metadata-driven validation and
   OpenAPI generation for the future docs site.

NestJS makes #1 a non-issue out of the box. The remaining call was
**which HTTP server adapter to plug into NestJS**:

- **Express adapter (default).** What 95% of NestJS tutorials use.
  Mature, but Express's request lifecycle is the slowest of the modern
  Node servers.
- **Fastify adapter.** An order of magnitude faster for plain JSON
  responses, schema-validated routes for free, plug-in based middleware
  with first-class async lifecycles.

## Decision

> The API is NestJS 10 + the official **Fastify** platform adapter
> (`@nestjs/platform-fastify`) — not the Express adapter.

Concretely:

- [`apps/api/src/main.ts`](../../apps/api/src/main.ts) bootstraps with
  `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())`.
- Security middleware uses Fastify-native plugins:
  `@fastify/helmet`, `@fastify/cors`, `@fastify/cookie`. Express
  middleware is **not** loaded — `app.useGlobalPipes` is enough for
  validation via `class-validator`.
- The realtime gateway in
  `apps/api/src/modules/realtime/realtime.gateway.ts` uses NestJS WS
  decorators on top of `@nestjs/platform-ws` (which itself works with
  either HTTP adapter).
- The Prisma `onModuleInit` lifecycle is graceful: if Postgres is down
  the API still boots and serves `/health` as `degraded` instead of
  crash-looping. This composes with Fastify's request hooks better than
  with Express middleware.

## Alternatives considered

### NestJS + Express (the default)

Pros: matches every tutorial, third-party Nest middleware modules tend
to assume Express. **Rejected** because the perf headroom matters once
F3 ships and a single project room can produce hundreds of WS
broadcasts per second. Plus, Fastify schema validation aligns with the
class-validator approach we already use on REST DTOs.

### Plain Fastify, no NestJS

Pros: smaller dependency surface, faster cold start. **Rejected** because
DI + module boundaries are not a luxury — `auth`, `projects`,
`versions`, `share`, `git`, `export`, `templates`, `realtime` are
already 8 modules and counting. Hand-rolled DI for that surface is
exactly the dev-time tax NestJS exists to remove.

### tRPC

Considered for the typed client surface. **Rejected** at MVP because the
public API will eventually be consumed by GitHub Apps, GitLab CI jobs
and CLI tools — the contract has to be REST + OpenAPI, not a
TypeScript-RPC. tRPC remains an option for an internal, web-only
project later.

### Hono / Elysia (newer JS server frameworks)

Faster than Fastify on synthetic benchmarks. **Rejected** because the
NestJS module ecosystem (Throttler, Config, Schedule, Bull, …) does not
support them. The marginal perf gain is irrelevant once Postgres and
Redis enter the picture.

## Consequences

- **Positive**
  - Fastify hooks integrate cleanly with NestJS interceptors. Request
    logging via Pino, rate limiting via `@nestjs/throttler` (Redis
    store) and CORS all stack predictably.
  - Schema validation has two complementary paths: `class-validator`
    decorators on DTOs (developer ergonomics) **and** Fastify schema
    pre-validation (perf + JSON-schema for OpenAPI generation later).
  - The dev hot-reload story is solid. NestJS uses the SWC builder
    (`apps/api/.swcrc`) which preserves decorator metadata correctly,
    even with the Fastify adapter; reloads are sub-second.
- **Negative**
  - Most third-party Nest tutorials assume Express. Anyone copy-pasting
    `app.use(...)` middleware will hit "function expected, got Fastify
    plugin". The CONTRIBUTING guide and code comments call this out
    explicitly.
  - Some Express-only middleware (e.g. older `passport` strategies) do
    not work without an Express compatibility shim. We have not needed
    Passport so far — auth is pluggable between Clerk and Auth.js
    behind a NestJS module — but it is a future trap.
  - Fastify's `request` and `reply` objects are not the same as
    Express's. Code that reaches into `@Req()` / `@Res()` directly must
    type-import `FastifyRequest` / `FastifyReply`. Reviewer convention:
    don't reach for the raw req/res unless you must.
- **Follow-ups**
  - When OpenAPI docs are introduced (planned for F5+), use Nest's
    `@nestjs/swagger` with the Fastify adapter (officially supported).
  - When the realtime gateway moves out of placeholder status (F3),
    confirm `y-websocket` integration plays nicely with Fastify's
    upgrade lifecycle.

## References

- [`apps/api/src/main.ts`](../../apps/api/src/main.ts) — bootstrap with FastifyAdapter, helmet, cors, cookie.
- [`apps/api/src/app.module.ts`](../../apps/api/src/app.module.ts) — module composition.
- [NestJS docs — Fastify adapter](https://docs.nestjs.com/techniques/performance) — official integration notes.
- [Fastify benchmarks](https://www.fastify.io/benchmarks/) — perf context.
