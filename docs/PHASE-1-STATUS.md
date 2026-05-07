# Phase 1 — final status

> Phase 1 (IR + HCL contract) and the Phase 1.5 polish round (UX backbone,
> design system, accessibility) are **complete**. This document is the closing
> snapshot — what shipped, what's green, and what's queued for F2.

## Executive summary

- **F0 Foundations** ✅
  - Monorepo (Turborepo 2 + pnpm 9 + TypeScript 5.5).
  - OSS scaffolding: `README`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`,
    `NOTICE`, `LICENSE` (Apache-2.0), CodeQL, Dependabot, CODEOWNERS.
  - GitHub Actions: lint + typecheck + tests + build + E2E in parallel jobs.
  - `infra/docker-compose.yml` (Postgres 16 + Redis 7), Prisma schema applied.
- **F1 IR + HCL contract** ✅
  - 130+ tests passing locally (5 IR + 22 catalog + 76 round-trip + property
    - bench + UI + routes).
  - Round-trip ≥ **100%** on the 75-fixture corpus (criterion: ≥ 95%).
  - `fast-check` property-based at 250 iterations local / 1000 on CI.
  - Bench on ~500 LOC: 35–135 ms median (criterion < 80 ms; 200 ms safety
    ceiling for Windows runners).
  - Minimal text patching via `trivia.rawTextRange`, comments preserved.
- **F1.5 UX backbone** ✅
  - Design system canonical (palette, typography, shadows, radii, components).
  - Light / dark / system theme synced across tabs.
  - Landing, Dashboard, Templates Gallery, NotFound, Editor shell.
  - Command Palette (Ctrl+K) and global keyboard layer (`?`, `/`, `Esc`).
  - Offline-first data hooks (`useTemplates`, `useProjects`).
  - Accessibility: 4/4 main routes pass `@axe-core/playwright` clean.
  - End-to-end suite (Playwright) covering the happy path and theme switch.

## Acceptance criteria

| Criterion                  | Target           | Result                            |
| -------------------------- | ---------------- | --------------------------------- |
| Round-trip on snapshots    | ≥ 95%            | **100%** (75/75)                  |
| Property-based idempotency | ≥ 250 iterations | 250 local · 1000 CI               |
| Parse + emit ~500 LOC      | < 80 ms median   | 35–135 ms (within 200 ms ceiling) |
| ESLint warnings            | 0                | 0 (`--max-warnings 0`)            |
| TypeScript strict          | 0 errors         | 0 (13/13 packages)                |
| Unit tests                 | green            | 130+ passing                      |
| Playwright E2E             | green            | 5/5 happy path + theme            |
| Axe a11y                   | 0 violations     | 4/4 main routes                   |

## What shipped during F1.5 (delta vs. prior status)

| Area               | Highlights                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme              | `theme/useTheme.ts` (Zustand), `ThemeToggle` (icon/labelled), anti-flash inline script, `prefers-color-scheme` listener, `StorageEvent` cross-tab sync.                                                                                         |
| Design system      | `packages/ui/src/styles.css` with CSS vars + Tailwind preset; `Button`, `Card`, `Input`, `Badge`, `Avatar`, `Logo`, `ProviderIcon`, `Modal` (a11y-correct, ref-forwarding).                                                                     |
| Routing & layout   | `LandingRoute`, `DashboardRoute`, `EditorRoute`, `NotFoundRoute` lazy-loaded. `<main>` landmarks on every route.                                                                                                                                |
| Data plumbing      | `lib/api.ts` (typed fetch + `ApiError`), `useTemplates`, `useProjects` with offline fallback + optimistic update. API exposes `/api/templates` and `/api/projects` with JSON schema validation.                                                 |
| Keyboard           | `CommandPalette`, `ShortcutsLayer`, `ShortcutsHelp`. Wired through `<ShortcutsLayer>` wrapping the router.                                                                                                                                      |
| Accessibility      | All ARIA fixes: heading order on Dashboard (`h2`), screen-reader-only `h1` inside Editor `<main>`, `role="img"` on `Avatar`, unique landmarks on `AppRail` / `Palette` / `Inspector`.                                                           |
| Tests              | UI tests (Button/Card/Badge/Avatar/Logo/Modal/ProviderIcon), route tests (Landing/Templates/NotFound), Playwright (`landing.spec.ts`, `dashboard.spec.ts`, `a11y.spec.ts`).                                                                     |
| API DX             | NestJS SWC builder for fast hot reload + correct decorator metadata; graceful `PrismaService.onModuleInit`; `/health` reports `degraded` if DB is down; `ProjectsService` returns `[]` on read / 503 on write when DB is unavailable.           |
| Workspace plumbing | `@blueprint/{ir,hcl,resources,templates}` publish `dist/` as the runtime entry; web/Vitest read TypeScript sources directly via custom `blueprint:source` resolve condition. Result: API runtime is rock solid, the SPA still gets instant HMR. |

## Current command surface

```bash
pnpm dev              # web + api in parallel
pnpm build            # all packages, turbo cache
pnpm lint             # eslint, max-warnings 0
pnpm typecheck        # tsc --noEmit, all packages
pnpm test             # vitest
pnpm test:e2e         # playwright
pnpm format           # prettier
pnpm db:migrate       # prisma migrate dev
pnpm db:studio        # prisma studio
pnpm infra:up/down    # docker-compose
```

## Local infra state (preserved)

- Docker Desktop running.
- `pnpm infra:up` recreates Postgres 16 + Redis 7.
- Volumes `cloud-blueprint_postgres-data` / `cloud-blueprint_redis-data` keep
  the `20260429232543_init` migration applied and the dev seed
  (`dev@local.cloudblueprint.dev` + org `local`).
- Reset everything: `pnpm db:reset`.

## Up next (F2 kickoff)

- React Flow canvas with custom resource nodes (provider-tinted).
- Resource palette wired to the canvas via drag/drop.
- Inspector with two-way binding to selected node.
- ELK / Dagre layout for "auto arrange".
- Yjs scaffolding (no live multi-user yet — that's F3).

> Anything blocking F2? **No.** The design system, the IR contract, the parser
> and emitter, and the offline-first hooks are all stable and documented.
