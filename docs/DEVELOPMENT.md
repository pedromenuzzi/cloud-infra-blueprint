# Local development

## Prerequisites

| Tool    | Version            | How                                                          |
| ------- | ------------------ | ------------------------------------------------------------ |
| Node.js | 20.10+             | [nodejs.org](https://nodejs.org) or `nvm use` (`.nvmrc`)     |
| pnpm    | 9.12+              | `corepack enable && corepack prepare pnpm@9.12.0 --activate` |
| Docker  | 20+ with `compose` | [docker.com](https://www.docker.com)                         |
| Git     | 2.40+              | your favourite package manager                               |

> Tip: the web app **runs without the API**. Skip Docker/Postgres if you only
> want to play with the UI — the templates gallery and dashboard fall back to
> bundled demo data. The "Offline mode" badge tells you when that is happening.

## First-time setup

```bash
git clone https://github.com/cloud-blueprint/cloud-blueprint.git
cd cloud-blueprint

cp .env.example .env
# Leave Clerk/GitHub OAuth empty for "dev no-auth" mode.

pnpm install            # installs every workspace package
pnpm infra:up           # Postgres 16 + Redis 7 in docker
pnpm db:migrate         # apply Prisma migrations
pnpm --filter @blueprint/api db:seed     # optional dev seed
```

## Run

```bash
pnpm dev                # web on :5173, api on :3000
```

Then open <http://localhost:5173>.

If you only want the front-end:

```bash
pnpm --filter @blueprint/web dev
```

If you only want the API (with hot reload via `tsx watch`):

```bash
pnpm --filter @blueprint/api dev
```

## Useful commands

```bash
# Build
pnpm build
pnpm --filter @blueprint/web build
pnpm --filter @blueprint/api build

# Tests
pnpm test                                # vitest (130+ tests)
pnpm --filter @blueprint/hcl test        # round-trip + property + bench
pnpm --filter @blueprint/web test        # UI + route tests
pnpm test:e2e                            # playwright (web app + a11y)

# Lint / typecheck / format
pnpm lint                                # eslint, max-warnings 0
pnpm typecheck                           # tsc --noEmit, all packages
pnpm format
pnpm format:check

# Database
pnpm db:migrate                          # apply dev migrations
pnpm db:reset                            # drop & recreate
pnpm db:studio                           # Prisma Studio on :5555

# Local infra
pnpm infra:up
pnpm infra:down
pnpm infra:logs

# Cleanup
pnpm clean                               # turbo + node_modules
```

## Mental model

- **Each package owns its `package.json`, `tsconfig.json`, `README.md`.**
- **Cross-package imports use `@blueprint/<pkg>`** (workspace protocol).
- Internal packages publish `exports` for both ESM (Vite/Vitest) and CJS
  (`tsx` runtime in the API). That's why the API can `import { ResourceDecl }`
  from `@blueprint/ir` while the SPA also bundles it cleanly.
- **Builds happen in topological order** via Turbo cache.
- **`pnpm dev`** runs everything in parallel with file watchers.

### How the API boots in dev

The API uses `nest start --watch` with the **SWC builder** (configured in
`apps/api/nest-cli.json` and `apps/api/.swcrc`). SWC is significantly faster
than `tsc` for incremental builds and — crucially — emits the decorator
metadata that NestJS' dependency injection relies on. NestJS production builds
go through `nest build` (also SWC) and run with `node dist/main.js`.

For workspace package consumption, `apps/api` always reads the **built**
`dist/` of `@blueprint/{ir,hcl,resources,templates}`. Because Turbo runs
package builds before the API build (topological order), this is automatic
during `pnpm dev` / `pnpm build`. The first time you clone:

```bash
pnpm install
pnpm build       # builds packages, then web + api
pnpm dev         # hot reload everywhere
```

The web app uses Vite with a custom `blueprint:source` resolve condition that
**bypasses** the dist output and reads TypeScript sources directly from
`packages/*/src/`. That gives the SPA instant HMR with zero extra build steps.
Vitest does the same. Only Node-based runtimes (the API) consume `dist/`.

### Offline-first front-end

`apps/web/src/lib/api.ts` is a typed `fetch` wrapper with `AbortController`,
timeouts, and a structured `ApiError`. The data hooks (`useTemplates`,
`useProjects`) catch `ApiError` and fall back to bundled fixtures, surfacing a
discreet "Offline mode" badge. This means:

- Anyone can clone the repo and `pnpm --filter @blueprint/web dev` without
  Docker / Postgres.
- The visual look-and-feel is testable in isolation.
- Real persistence is one `pnpm infra:up && pnpm db:migrate && pnpm dev` away.

## Troubleshooting

### `prisma generate` fails

```bash
pnpm --filter @blueprint/api db:generate
```

Keeps the Prisma client in sync with `schema.prisma`. It also runs after
`pnpm install` via `postinstall` when configured.

### `@cdktf/hcl2json` (WASM) doesn't load

Check:

1. `apps/web/vite.config.ts` has `vite-plugin-wasm` in `plugins`.
2. `optimizeDeps.exclude` includes `@cdktf/hcl2json`.
3. The worker is declared with `type: 'module'`.

### "Cannot find module '@blueprint/ir'"

```bash
pnpm install
pnpm build
```

### Postgres refusing connections

```bash
pnpm infra:logs
docker compose -f infra/docker-compose.yml ps
```

### Full reset

```bash
pnpm clean
docker compose -f infra/docker-compose.yml down -v
pnpm install
pnpm infra:up
pnpm db:migrate
```

## Code conventions

- **Strict TypeScript.** No unjustified `any`.
- **Imports ordered** (`eslint-plugin-import`, rule `import/order`).
- **Comments explain _why_, never the _what_.**
- **Pure functions** preferred for IR/HCL logic (testable, deterministic).
- **Tailwind** — use `cn(...)` from `@blueprint/ui` to merge classes.
- **Conventional Commits** — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `test:`. Husky + lint-staged enforce formatting on `pre-commit`.
- **Design system** — read [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) before
  inventing new colours, spacings, or shadows. Tokens first, hex last.

## Keyboard layer

Implemented in `apps/web/src/components/ShortcutsLayer.tsx` and exposed via
the Cheat Sheet (`?`) and Command Palette (`Ctrl+K`).

| Shortcut           | Action                       |
| ------------------ | ---------------------------- |
| `Ctrl+K` / `Cmd+K` | Command palette              |
| `?`                | Show shortcuts help          |
| `/`                | Focus the search field       |
| `Esc`              | Close palette / modal / help |

## When to ask vs. when to ship

If something in the spec is ambiguous:

1. Open an issue with the `clarification` label.
2. Document your interpretation in the PR ("Notes for the reviewer").
3. Continue with the safest interpretation.

## "Dev no-auth" mode

To iterate quickly without Clerk/GitHub OAuth, leave `AUTH_PROVIDER=` empty in
`.env`. The `AuthGuard` becomes a no-op and every route is open. **Never** ship
this mode to production.
