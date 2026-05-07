# Documentation

Internal docs for the project. Everything here is versioned in git and uses
plain Markdown (no MDX yet).

| Doc                                                    | When to read                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md)           | High-level snapshot of everything: proposal, stack, flows, code map, status  |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                   | Before touching anything non-trivial                                         |
| [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)                 | Before adding/changing UI components or tokens                               |
| [DEVELOPMENT.md](./DEVELOPMENT.md)                     | Local setup, troubleshooting, day-to-day flow                                |
| [PERFORMANCE.md](./PERFORMANCE.md)                     | Bundle and runtime budgets, audit recipe                                     |
| [PHASE-1-STATUS.md](./PHASE-1-STATUS.md)               | Closing snapshot of F1 / F1.5                                                |
| [ROADMAP.md](./ROADMAP.md)                             | What ships in each phase                                                     |
| [IR-SPEC.md](./IR-SPEC.md)                             | Before touching `packages/ir` or `packages/hcl`                              |
| [RESOURCES.md](./RESOURCES.md)                         | Before adding a new resource to the catalog                                  |
| [STACK.md](./STACK.md)                                 | Pinned versions of every dependency                                          |
| [SECURITY-HALL-OF-FAME.md](./SECURITY-HALL-OF-FAME.md) | Vulnerability reporters                                                      |
| [adr/](./adr/README.md)                                | Architecture Decision Records — why we chose what we chose                   |
| [GOOD-FIRST-ISSUES.md](./GOOD-FIRST-ISSUES.md)         | Backlog estruturado de boas primeiras issues (mantido pelo maintainer)       |
| [`apps/storybook/`](../apps/storybook/README.md)       | Public Storybook do `@blueprint/ui` — auto-deploy em GitHub Pages            |
| [RELEASING.md](./RELEASING.md)                         | Como funciona o release de pacotes públicos via Changesets + npm publish     |
| [CREATING-A-PROVIDER.md](./CREATING-A-PROVIDER.md)     | Tutorial passo a passo para autores de community providers e templates       |
| [`infra/`](../infra/README.md)                         | Stack docker-compose local (Postgres + Redis + Adminer + Infracost opcional) |
| [OSS-ROADMAP-EXECUTION.md](./OSS-ROADMAP-EXECUTION.md) | Bitácola incremental dos 10 itens da roadmap OSS — escolhas, bugs, racional  |

### Funis de entrada

| Rota          | Para quê serve                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `/`           | Landing pública com hero, CTA "Start free", botão "Import existing Terraform" e mockup do produto.        |
| `/dashboard`  | Lista de projetos do usuário (offline-first), abre o gallery de templates.                                |
| `/editor/:id` | Split-view canvas + Monaco. Topbar tem **Share** que gera URL `/p/:hash`.                                 |
| `/p/:hash`    | Playground público read-only — IR LZ-string na própria URL, sem backend, com botão **Fork to edit**.      |
| `/import`     | Drop de `.tf`, `.tfstate` ou `.zip` — parseia no Worker, faz auto-layout dagre e abre `/editor/imported`. |

## Original spec

The master spec that started this project (22 pages, AI-Ready Master
Specification v1.0) is the canonical source whenever ambiguity arises during
implementation. Keep it in sync with this repo: if anything diverges, open a
`clarification` issue.
