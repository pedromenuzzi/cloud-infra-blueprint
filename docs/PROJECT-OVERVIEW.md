# Cloud Infra Blueprint — Project Overview

> Snapshot vivo do que existe no monorepo nesta data. Pensado para uma leitura
> de cima a baixo: proposta, arquitetura, stack, fluxos, código, testes e
> roadmap. Cada seção aponta para os arquivos canônicos quando você quiser
> mergulhar.

---

## 1. Proposta

**Cloud Infra Blueprint** é um SaaS multi-tenant que une um editor visual
estilo Cloudcraft a um editor Monaco de Terraform HCL em uma tela dividida,
com **sincronização bidirecional** garantida por uma IR (Intermediate
Representation) canônica + Yjs CRDT. Multi-cloud (AWS / Azure / GCP) desde o
MVP. Não roda `terraform apply` — apenas gera código portável que o usuário
exporta como zip ou empurra para GitHub/GitLab.

### Por que existe

Equipes de cloud vivem em dois mundos:

- **Diagramas** (Cloudcraft, Lucid, Excalidraw) que viram lixo no instante em
  que a infra muda.
- **Código Terraform**, potente mas cansativo de explicar e iterar
  visualmente.

Tentativas anteriores de unir os dois lados são fechadas (Brainboard), só
visuais (Cloudcraft) ou foram descontinuadas (Terraform Visual Editor).

### Diferenciais

- **Sync verdadeiramente bidirecional.** Canvas ↔ HCL via IR canônica +
  patch mínimo preservando trivia (comentários e ordem de blocos).
- **Multi-cloud desde o dia 1.** AWS, Azure e GCP em um catálogo declarativo
  extensível.
- **Roda no navegador.** Parser/emitter HCL via WASM (`@cdktf/hcl2json`) em
  Web Worker — backend é fino.
- **Colaboração real-time** (planejada para F3) via Yjs.
- **Sem lock-in.** Export Terraform real (`main.tf`, `variables.tf`,
  `outputs.tf`, `providers.tf`) ou push direto para Git.
- **Templates compostos.** Patterns prontos viram código customizável.
- **Acessível e bonito por construção.** Design system canonical, axe-clean
  em todas as rotas principais, dark mode com sync entre abas.
- **Offline-first.** O web sobe sozinho com dados embutidos quando a API não
  está disponível.

---

## 2. Status atual (em uma página)

| Fase                     | Escopo                                                                | Estado                          |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------- |
| **F0** Foundations       | Monorepo, CI, docs OSS, infra Docker                                  | Completo                        |
| **F1** IR + HCL contract | IR tipado, parser/emitter, round-trip ≥ 95%                           | Completo (≥ 100% / 75 fixtures) |
| **F1.5** UX backbone     | Design system, dark mode, dashboard, templates, command palette, a11y | Completo                        |
| **F2** Canvas + paleta   | React Flow canvas, layout automático                                  | Próximo                         |
| **F3** Yjs sync          | Bidirecional Monaco ↔ canvas                                          | Planejado                       |
| **F4** Persistence       | Multi-tenant, autosave, presence                                      | Planejado                       |
| **F5** Templates + Git   | Export zip, GitHub/GitLab push                                        | Planejado                       |
| **F6** Polish + beta     | Observability, landing, beta privado                                  | Planejado                       |

### Métricas-chave hoje

| Gate                          | Resultado                                                 |
| ----------------------------- | --------------------------------------------------------- |
| Lint (eslint, max-warnings 0) | 0 erros / 0 warnings                                      |
| Typecheck (tsc --noEmit)      | 12/12 packages                                            |
| Unit tests (vitest)           | 132 testes (5 IR + 22 catalog + 103 HCL + 32 web/UI)      |
| Build (turbo)                 | 6/6 packages                                              |
| Playwright E2E                | 6/6 happy path + theme + palette                          |
| Axe a11y                      | 4/4 rotas (landing, dashboard, editor, 404)               |
| Round-trip HCL                | 100% em 75+ fixtures (critério: 95%)                      |
| Bench parse + emit ~500 LOC   | 35–135 ms (critério < 80 ms; teto 200 ms para Windows CI) |
| Bundle inicial gzip           | ~88 kB (budget 100 kB)                                    |

---

## 3. Stack tecnológica

### Frontend (`apps/web`)

| Camada                | Tecnologia                                                           |
| --------------------- | -------------------------------------------------------------------- |
| Framework             | React 18 + TypeScript 5.5                                            |
| Build / dev           | Vite 5 + `vite-plugin-wasm`                                          |
| Roteamento            | React Router 6 (lazy routes)                                         |
| Estado                | Zustand (com `persist` para tema)                                    |
| Estilo                | Tailwind CSS 3 + design tokens próprios                              |
| Componentes           | `@blueprint/ui` (in-house, sem radix/shadcn)                         |
| Canvas (F2)           | `@xyflow/react` (React Flow) + `dagre`                               |
| Editor de código (F2) | Monaco                                                               |
| CRDT (F3)             | Yjs + `y-monaco` + `y-websocket`                                     |
| HCL parser            | `@cdktf/hcl2json` (WASM, em Web Worker)                              |
| Fontes                | `@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono` |
| Ícones                | `lucide-react`                                                       |
| Testes                | Vitest 2 + `@testing-library/react` + `happy-dom`                    |
| E2E                   | Playwright 1.55 + `@axe-core/playwright`                             |

### Backend (`apps/api`)

| Camada          | Tecnologia                                      |
| --------------- | ----------------------------------------------- |
| Framework       | NestJS 10 + Fastify v4                          |
| ORM             | Prisma 5                                        |
| DB              | PostgreSQL 16 (Neon em prod)                    |
| Cache / fila    | Redis 7 + BullMQ                                |
| WebSocket (F3+) | `y-websocket` via NestJS WS gateway             |
| Auth            | Clerk **ou** Auth.js (módulo `auth` plugável)   |
| Storage         | Cloudflare R2 (export zips, F5)                 |
| Validação       | Zod + `class-validator`                         |
| Logs            | Pino                                            |
| Hot reload      | NestJS SWC builder (decorator metadata correto) |

### Pacotes compartilhados (`packages/*`)

| Pacote                 | O que faz                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `@blueprint/ir`        | IR canônica (TypeScript ADTs), factories, graph helpers                                         |
| `@blueprint/hcl`       | Parser (WASM) + emitter + patch mínimo + benchmarks                                             |
| `@blueprint/resources` | Catálogo declarativo AWS / Azure / GCP                                                          |
| `@blueprint/templates` | Patterns prontos (Web App, Static Site, Container Stack)                                        |
| `@blueprint/ui`        | Design system (Button, Card, Input, Badge, Avatar, Logo, ProviderIcon, Modal) + Tailwind preset |
| `@blueprint/config`    | Bases ESLint + tsconfig compartilhadas                                                          |

### DX e infra

| Ferramenta                                                          | Função                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| pnpm 9 + Turborepo 2                                                | Monorepo + cache de tasks                                          |
| ESLint 9 (flat config) + Prettier 3 + `prettier-plugin-tailwindcss` | Lint e formatação consistentes                                     |
| Husky + lint-staged                                                 | Pre-commit (eslint --fix + prettier) e pre-push (typecheck + test) |
| GitHub Actions                                                      | CI: lint, typecheck, test (matrix Node 20+22), build, E2E + a11y   |
| Dependabot, CodeQL, Codeowners                                      | Higiene OSS                                                        |
| Docker Compose                                                      | Postgres + Redis locais                                            |
| `cross-env`                                                         | Compat Windows/Linux nas envs                                      |

---

## 4. Arquitetura

### Visão de alto nível

```
┌─────────────────────────── BROWSER ───────────────────────────┐
│ React 18 + TypeScript + Vite                                   │
│ ├─ Landing / Dashboard / Templates / Editor (lazy routes)      │
│ ├─ @blueprint/ui (design system, light/dark/system theme)      │
│ ├─ Command Palette + ShortcutsLayer (camada global teclado)    │
│ ├─ Zustand stores (theme, future IR)                           │
│ ├─ Editor (F2): React Flow + Monaco                            │
│ ├─ Yjs + y-monaco (F3, CRDT sobre o texto HCL)                 │
│ └─ Web Worker → @cdktf/hcl2json (WASM, HCL → JSON AST)         │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP (REST, JSON validado)
                            │ WebSocket y-websocket (F3+)
                            ▼
┌─────────────────────────── BACKEND ───────────────────────────┐
│ NestJS 10 + Fastify                                            │
│ ├─ Prisma 5 + PostgreSQL (Neon em prod)                        │
│ ├─ Redis + BullMQ (filas, rate limit, cache)                   │
│ ├─ Auth (Clerk OU Auth.js, atrás de uma porta)                 │
│ ├─ Health (graceful: API sobe mesmo sem DB)                    │
│ ├─ Templates / Projects / Versions / Share / Git / Export      │
│ └─ Realtime gateway (y-websocket — F3+)                        │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────── EXTERNAL ──────────────────────────┐
│ GitHub / GitLab APIs (OAuth + push — F5)                       │
│ Cloudflare R2 (export zips — F5)                               │
│ Sentry, PostHog                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Decisão chave

> Toda a transformação HCL ↔ IR roda no browser.

- **Latência:** sem ida ao servidor a cada keystroke.
- **Custo:** o backend não precisa parsear para cada usuário.
- **Resiliência:** o editor funciona offline (PWA na F6).

O backend só armazena snapshots (`Project.ir` jsonb e `Project.files` jsonb) e
relaya WebSocket para colaboração. Esse design encolhe radicalmente o
servidor.

### Resolução de pacotes (monorepo)

- `@blueprint/{ir,hcl,resources,templates}` publicam `dist/` como entry de
  runtime — é o que a API consome em prod e em dev.
- Web e Vitest leem **source TypeScript direto** via uma resolve condition
  customizada `blueprint:source` (em `vite.config.ts` e `vitest.config.ts`).
  Resultado: API é robusta em runtime, SPA mantém HMR instantâneo.

---

## 5. Fluxos do produto

### 5.1 Edição (F2/F3, contrato definido em F1)

#### Caso A — usuário arrasta da paleta para o canvas

1. `Palette` dispara `dataTransfer` com o `type` do recurso.
2. `CanvasPane.onDrop` chama `useIRStore.apply([{ kind: 'add_resource', node }])`.
3. Yjs aplica como mutação no `Y.Map` de IR.
4. Worker emite o bloco HCL e faz `Y.Text.insert(...)` no arquivo correto.
5. Outros peers convergem via WebSocket.

#### Caso B — usuário digita no Monaco

1. `y-monaco` propaga keystroke para `Y.Text`.
2. Worker observa o delta, chama `parse(filename, source)` via WASM, gera AST.
3. Diff contra IR atual produz uma sequência de `Op`s.
4. `applyOps(ir, ops)` produz nova IR; o canvas re-renderiza só os nós
   afetados.

#### Resolução de conflitos

- Yjs garante convergência eventual (CRDT).
- Campos triviais → last-write-wins.
- Edição simultânea no mesmo bloco → o usuário do Monaco vence (canvas
  re-parseia a cada token).
- `position` (x/y) vive em mapa Yjs separado — sem conflito com texto.

### 5.2 Onboarding atual (F1.5, já funcional)

```
Landing  ──"Get started"──▶  Dashboard
  │                             │
  └──"Browse templates"──┬──▶ Templates Gallery
                         │      │
                         │      └──"Use template"──▶ Editor (mock)
                         │
                         └──"New project"──────────▶ Editor (mock)
```

- Tudo offline-first: se a API estiver fora, mostra dados embutidos com
  `Badge` "Offline mode".
- Command Palette (`Ctrl+K` / `Cmd+K`) permite navegar, trocar tema, abrir
  templates e criar projeto sem mouse.

### 5.3 Patch mínimo (F1, em produção)

Cada `Op` que toca um bloco existente vira um patch textual no range
`trivia.rawTextRange`. Comentários acima do bloco, linhas em branco e blocos
não relacionados sobrevivem intactos. `shiftRanges` mantém os ranges seguintes
válidos depois de um patch.

```
ANTES                                    DEPOIS
# AWS web server                         # AWS web server
resource "aws_instance" "web" {          resource "aws_instance" "web" {
  ami           = "ami-123"                ami           = "ami-456"   ◀── único delta
  instance_type = "t3.micro"               instance_type = "t3.micro"
}                                        }
```

---

## 6. Estrutura do monorepo

```
cloud-blueprint/
├── apps/
│   ├── web/         # React + Vite + Tailwind
│   │   ├── src/
│   │   │   ├── routes/        # landing, dashboard, editor, not-found
│   │   │   ├── features/      # editor, palette, inspector, topbar, templates, canvas
│   │   │   ├── components/    # AppRail, CommandPalette, ShortcutsLayer/Help, RouteFallback, ProductMockup
│   │   │   ├── theme/         # Zustand store + toggle + provider + tests
│   │   │   ├── lib/           # api client, useTemplates, useProjects
│   │   │   ├── store/         # useIRStore (placeholder p/ F2)
│   │   │   ├── workers/       # hcl.worker.ts (WASM)
│   │   │   ├── test/          # ui + routes + setup vitest
│   │   │   ├── router.tsx
│   │   │   └── main.tsx
│   │   ├── tests/e2e/         # landing, dashboard, a11y
│   │   ├── public/
│   │   ├── playwright.config.ts
│   │   └── vite.config.ts
│   │
│   └── api/         # NestJS + Fastify + Prisma
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── prisma/        # PrismaService (graceful) + module global
│       │   ├── common/guards/ # auth.guard, role.guard (stubs F1)
│       │   └── modules/
│       │       ├── auth/      # controller + service + module
│       │       ├── orgs/
│       │       ├── projects/  # controller + service + dto + module
│       │       ├── versions/
│       │       ├── share/
│       │       ├── git/       # GitHub + GitLab (F5)
│       │       ├── export/    # zip + R2 (F5)
│       │       ├── templates/
│       │       ├── realtime/  # y-websocket gateway (F3+)
│       │       └── health/    # /health degraded-aware
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/
│       │   └── seed.ts
│       ├── nest-cli.json      # builder: swc
│       └── .swcrc             # decorator metadata + paths
│
├── packages/
│   ├── ir/          # IR canônica + factory + graph
│   ├── hcl/         # parser (WASM) + emitter + patch + 75+ fixtures + property tests + bench
│   ├── resources/   # catálogo aws/azure/gcp + smoke test
│   ├── templates/   # aws-web-app, aws-static-site, aws-container-stack, azure-web-app, gcp-static-site
│   ├── ui/          # design system completo (Button, Card, Input, Badge, Avatar, Logo, ProviderIcon, Modal)
│   └── config/      # tsconfigs base + node + react
│
├── infra/
│   └── docker-compose.yml     # postgres:16-alpine + redis:7-alpine
│
├── docs/
│   ├── README.md              # índice
│   ├── ARCHITECTURE.md
│   ├── DESIGN-SYSTEM.md
│   ├── DEVELOPMENT.md
│   ├── PERFORMANCE.md
│   ├── PHASE-1-STATUS.md
│   ├── ROADMAP.md
│   ├── IR-SPEC.md
│   ├── RESOURCES.md
│   ├── STACK.md
│   ├── PROJECT-OVERVIEW.md    # ← este documento
│   └── SECURITY-HALL-OF-FAME.md
│
└── .github/
    ├── workflows/             # ci.yml, codeql.yml, deploy-web.yml, deploy-api.yml
    ├── ISSUE_TEMPLATE/
    ├── PULL_REQUEST_TEMPLATE.md
    ├── CODEOWNERS
    ├── dependabot.yml
    └── FUNDING.yml
```

---

## 7. IR canônica (`packages/ir`)

### Os tipos centrais

```ts
// packages/ir/src/types.ts (resumo)
type Provider = 'aws' | 'azure' | 'gcp' | 'kubernetes' | 'random' | 'tls';

type Expression =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'list'; items: Expression[] }
  | { kind: 'object'; fields: Record<string, Expression> }
  | { kind: 'ref'; path: string }
  | { kind: 'raw'; hcl: string }; // escape hatch p/ heredocs/expressões complexas

interface Trivia {
  leadingComments: string[];
  trailingComments: string[];
  rawTextRange?: { start: number; end: number }; // chave do patch mínimo
  sourceFile?: string;
}

interface ResourceNode {
  id: string; // UUID interno, estável em renomes
  provider: Provider;
  type: string; // ex: 'aws_instance'
  name: string; // ex: 'web'
  args: Record<string, Expression>;
  position: { x: number; y: number };
  parentId?: string; // grouping (VPC → Subnet → EC2)
  trivia: Trivia;
}

interface IR {
  version: 1;
  providers: Partial<Record<Provider, ProviderConfig>>;
  variables: Record<string, VariableDecl>;
  outputs: Record<string, OutputDecl>;
  modules: ModuleNode[];
  resources: ResourceNode[];
  edges: IREdge[];
}

type Op =
  | { kind: 'add_resource'; node: ResourceNode }
  | { kind: 'remove_resource'; nodeId: string }
  | { kind: 'set_arg'; nodeId: string; field: string; value: Expression }
  | { kind: 'unset_arg'; nodeId: string; field: string }
  | { kind: 'rename_resource'; nodeId: string; newName: string }
  | { kind: 'move_node'; nodeId: string; position: CanvasPosition }
  | { kind: 'reparent_node'; nodeId: string; parentId?: string }
  | { kind: 'add_edge'; edge: IREdge }
  | { kind: 'remove_edge'; edgeId: string }
  | { kind: 'set_provider'; provider: Provider; config: ProviderConfig }
  | { kind: 'set_variable'; name: string; decl: VariableDecl }
  | { kind: 'set_output'; name: string; decl: OutputDecl };
```

### Por que essa IR

- **Estritamente tipada** — discriminated unions impedem estados inválidos.
- **`raw` como escape hatch** — qualquer expressão que o parser não modela
  perfeitamente (heredocs, `for` aninhados, ternárias monstruosas) vai para
  `raw` e o emitter despeja verbatim. Garante round-trip.
- **`Trivia.rawTextRange`** — base do patch mínimo. Sem isso, salvar uma
  edição reformataria o arquivo inteiro.
- **`Op`** — sequência atômica de mutações, base para Yjs em F3.

---

## 8. Contrato HCL ↔ IR (`packages/hcl`)

### Parser (`parser.ts`)

- Wrapper de `@cdktf/hcl2json` (WASM) para a AST inicial.
- `scanBlockRanges` é um matcher próprio em texto que respeita strings,
  comentários e heredocs — injeta `trivia.rawTextRange` nos nós para o
  patch mínimo funcionar.
- Cobre `resource`, `module`, `variable`, `output`, `provider`.

### Emitter (`emitter.ts`)

- Sort canônico alfabético em `emitBody` e em campos de `object` para
  garantir saída determinística (idempotência).
- Sort de resources/modules por chave em `emitIR` para diffs estáveis.
- `VariableDecl.type` é `Expression`, então `type = "string"` (literal) e
  `type = list(string)` (raw) round-trippam corretamente.

### Patch mínimo (`patch.ts`)

- `patchResource(text, range, newBody)`: reescreve só os bytes do bloco.
- `removeResource`: retira o bloco e suas linhas em branco circundantes.
- `shiftRanges`: ajusta os ranges seguintes depois que o tamanho mudou.

### Worker (`worker.ts` + `workerClient.ts`)

- O parser/emitter rodam dentro de um Web Worker (`type: 'module'`).
- O cliente expõe uma API Promise-based; latência pequena, UI não congela.

### Testes

- **76 fixtures** (`__fixtures__/index.ts` + `extended.ts`) cobrindo AWS,
  Azure, GCP, multi-cloud e edge cases reais. **Round-trip 100%** hoje.
- **Property-based** (`property.test.ts`) com `fast-check`: gera IR aleatória,
  emite, parseia, compara. 250 iter local · 1000 em CI.
- **Bench** (`bench.test.ts`): parse + emit em ~500 LOC, mediana 35–135 ms.
- **Patch tests** (`patch.test.ts`): 4 cenários de patch garantindo trivia
  preservada.
- **Emitter tests** (`emitter.test.ts`): 8 testes de unidades pequenas.

---

## 9. Catálogo de recursos (`packages/resources`)

### Estrutura por provider

```
packages/resources/src/
├── index.ts          # re-exporta tudo
├── aws/
│   ├── index.ts      # registry AWS
│   ├── ec2.ts        # aws_instance, aws_launch_template
│   ├── s3.ts         # aws_s3_bucket, aws_s3_bucket_policy
│   ├── vpc.ts        # aws_vpc, aws_subnet, aws_security_group
│   ├── rds.ts        # aws_db_instance
│   └── iam.ts        # aws_iam_role, aws_iam_policy_attachment
├── azure/index.ts    # azurerm_resource_group, app_service, storage_account…
└── gcp/index.ts      # google_compute_instance, cloud_run_service, sql_database…
```

### Forma de uma definição

```ts
defineResource({
  type: 'aws_instance',
  provider: 'aws',
  category: 'compute',
  ports: ['network', 'iam'],
  schema: z.object({ ami: z.string(), instance_type: z.string(), /* ... */ }),
  defaults: { instance_type: 't3.micro' },
  emit: (node, ctx) => /* HCL string emitida */,
});
```

22 testes de smoke garantem que cada definição emite HCL válido (parseável de
volta).

---

## 10. Templates (`packages/templates`)

| Template              | Descrição                                     |
| --------------------- | --------------------------------------------- |
| `aws-web-app`         | EC2 + ALB + RDS + VPC + IAM (web app classic) |
| `aws-static-site`     | S3 + CloudFront + Route53                     |
| `aws-container-stack` | ECS Fargate + ALB + RDS                       |
| `azure-web-app`       | App Service + SQL Database + Resource Group   |
| `gcp-static-site`     | Cloud Storage + Cloud CDN + DNS               |

Cada template expõe variáveis tipadas (Zod) e produz uma `IRPatch` aplicável
de forma transacional sobre uma IR vazia ou existente.

---

## 11. Web app (`apps/web`)

### Rotas

| Path          | Componente         | Lazy |
| ------------- | ------------------ | ---- |
| `/`           | `LandingRoute`     | sim  |
| `/dashboard`  | `DashboardRoute`   | sim  |
| `/templates`  | `TemplatesGallery` | sim  |
| `/editor/:id` | `EditorRoute`      | sim  |
| `*`           | `NotFoundRoute`    | sim  |

Todas envolvidas em `ShortcutsLayer` (provê `Ctrl+K`, `?`, `/`, `Esc`).

### Features

| Pasta                 | Conteúdo                                                                            |
| --------------------- | ----------------------------------------------------------------------------------- |
| `features/templates/` | `TemplatesGallery.tsx` — listagem com filtros por provider, busca, fallback offline |
| `features/topbar/`    | `Topbar.tsx` — top bar do editor com presença, breadcrumbs, ações                   |
| `features/palette/`   | `Palette.tsx` — paleta lateral de recursos (estrutura pronta para F2)               |
| `features/inspector/` | `Inspector.tsx` — painel de propriedades (estrutura pronta para F2)                 |
| `features/canvas/`    | `CanvasPane.tsx` — placeholder do React Flow (F2)                                   |
| `features/editor/`    | `EditorPane.tsx` — placeholder do Monaco (F2)                                       |

### Componentes globais

| Componente         | Função                                                          |
| ------------------ | --------------------------------------------------------------- |
| `AppRail`          | Navegação primária à esquerda (logo, dashboard, templates, ...) |
| `CommandPalette`   | Cmdk próprio em ~3 KB (sem dependências)                        |
| `ShortcutsLayer`   | Listener global de teclado (`Ctrl+K`, `?`, `/`, `Esc`)          |
| `ShortcutsHelp`    | Modal com cheat sheet, abre via palette ou `?`                  |
| `RouteFallback`    | Skeleton de transição para `lazy()` routes                      |
| `ProductMockup`    | Mock visual usado na landing                                    |
| `ProjectThumbnail` | Mini-render da arquitetura no card de projeto                   |

### Estado e dados

```
useTheme    (Zustand) ── localStorage, matchMedia, StorageEvent (sync entre abas)
useTemplates(hook)    ── fetch /api/templates → fallback bundled (5 templates)
useProjects (hook)    ── fetch /api/projects  → fallback bundled (demo) + addLocal()
api.ts (módulo)       ── fetch tipado, AbortController, ApiError, timeout
```

### Tema

- Modo `light` / `dark` / `system`.
- Sincroniza entre abas via `StorageEvent`.
- Anti-flash via inline script no `index.html` (lê localStorage antes do React).
- Documentado em `docs/DESIGN-SYSTEM.md`.

---

## 12. API (`apps/api`)

### Módulos NestJS

| Módulo      | Endpoints                                                              | Estado                                                    |
| ----------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `health`    | `GET /health` (e `/api/health`) reporta `ok` ou `degraded` com detalhe | funcional, graceful sem DB                                |
| `auth`      | `GET /api/auth/me`                                                     | stub F1                                                   |
| `orgs`      | `GET /api/orgs`                                                        | stub F1                                                   |
| `projects`  | `GET/POST/PATCH/DELETE /api/projects[ /:id]`                           | leitura graceful (lista vazia sem DB), escrita 503 sem DB |
| `versions`  | `GET/POST /api/projects/:projectId/versions`                           | stub F1                                                   |
| `share`     | `POST /api/share/:projectId`, `GET /api/share/:token`                  | stub F1                                                   |
| `git`       | `GET /api/git/:projectId/integration`                                  | stub F5                                                   |
| `export`    | `GET /api/export/:projectId/zip`                                       | stub F5                                                   |
| `templates` | `GET /api/templates`                                                   | retorna 5 templates do `@blueprint/templates`             |
| `realtime`  | WS gateway placeholder                                                 | F3+                                                       |

### Bootstrap (`main.ts`)

- Fastify com `@fastify/helmet`, `@fastify/cors`, `@fastify/cookie`.
- Prefix global `/api` (com `/health` e `/` excluídos).
- Validação por `class-validator` em DTOs onde aplicável.
- `PrismaService` com `onModuleInit` tolerante: se Postgres está fora, loga
  warning e marca `connected = false` — a API segue subindo.

### Schema do banco (`prisma/schema.prisma`)

```
User ──┐
       ├──< Membership >── Organization ──┬──< Project ──┬──< ProjectVersion
                                          │              ├──< ShareLink
                                          │              └── GitIntegration
                                          └──< Template
```

- Multi-tenant: User → Membership → Organization → Project.
- `Project.ir` (jsonb) e `Project.files` (jsonb) armazenam snapshots.
- `Template.orgId NULL` = template público disponível para todas as orgs.

### Hot reload

- `nest start --watch` com `builder: swc`.
- `.swcrc` ativa `legacyDecorator` + `decoratorMetadata` (DI funciona).
- Pacotes internos consumidos da `dist/` (Turbo garante ordem topológica).

---

## 13. Design system (`@blueprint/ui`)

### Princípios

1. **Calmo por padrão, intenso quando precisa.** Brand reservado para ação
   primária; status colorido só sinaliza.
2. **Tipografia faz o trabalho pesado.** Inter Variable + JetBrains Mono
   Variable, sem text-shadow nem decoração desnecessária.
3. **Densidade semântica.** Os mesmos tokens carregam intenção no canvas e
   na landing.
4. **Tema é uma feature de primeira classe.** Light, dark e system convivem.
5. **Acessível por construção.** Contraste AA, foco visível, landmarks
   semânticas, navegação por teclado.

### Tokens (resumo)

| Categoria   | Tokens                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Superfícies | `--background`, `--surface-1`, `--surface-2`, `--foreground`, `--muted-foreground`, `--border`                     |
| Brand       | `--primary` (#2563EB), `--primary-hover`, `--primary-foreground`                                                   |
| Status      | `--success`, `--warning`, `--danger`, `--destructive`                                                              |
| Provider    | `--provider-aws` (#FF9900), `--provider-azure` (#0078D4), `--provider-gcp` (#4285F4), `--provider-multi` (#7C3AED) |
| Raio        | `--radius-sm` (6px), `--radius` (10px), `--radius-lg` (14px)                                                       |
| Sombra      | `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-glow`                                        |

### Componentes

| Componente               | Variantes                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `Button`                 | `primary`, `secondary`, `ghost`, `outline`, `destructive` × `sm`/`md`/`lg`/`icon`    |
| `Card`                   | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`    |
| `Input`                  | Texto + `aria-invalid` ready, `prefix`, `suffix`                                     |
| `Badge`                  | `default`, `success`, `warning`, `danger`, `outline`, `aws`, `azure`, `gcp`, `multi` |
| `Avatar` / `AvatarGroup` | Iniciais coloridas determinísticas, ring opcional, overflow `+N`                     |
| `Logo`                   | `mark`, `wordmark`, `full` em qualquer tamanho                                       |
| `ProviderIcon`           | Marca AWS/Azure/GCP em tamanhos uniformes                                            |
| `Modal`                  | Trap de foco, fecha com `Esc`/overlay, `aria-labelledby` automático                  |

Documentação completa: `docs/DESIGN-SYSTEM.md`.

---

## 14. Testes e qualidade

### Pirâmide

```
Unit (vitest)      →  132 testes (IR + HCL + resources + UI + theme + routes)
Property (fc)      →   1 teste, 250–1000 iterações
Bench              →   2 testes (parse + emit, performance.now)
E2E (playwright)   →   6 testes (landing + dashboard + theme + palette)
A11y (axe)         →   4 rotas (landing, dashboard, editor, 404)
```

### Onde estão

| Pacote               | Arquivos de teste                                          |
| -------------------- | ---------------------------------------------------------- |
| `packages/ir`        | `src/graph.test.ts`                                        |
| `packages/hcl`       | `src/{emitter,patch,bench,property,roundtrip}.test.ts`     |
| `packages/resources` | `src/catalog.test.ts`                                      |
| `apps/web`           | `src/test/{ui,routes}.test.tsx`, `src/theme/theme.test.ts` |
| `apps/web` (E2E)     | `tests/e2e/{landing,dashboard,a11y}.spec.ts`               |

### Acessibilidade

- `@axe-core/playwright` audita as 4 rotas principais a cada CI run.
- Hierarquia de heading respeitada (`h1` único por rota, `h2` em cards).
- Landmarks únicas via `aria-label` (`AppRail`, `Palette`, `Inspector`).
- `Avatar` usa `role="img"` para `aria-label` ser válido.
- `Editor` tem `<h1 class="sr-only">` dentro do `<main>` para satisfazer
  `page-has-heading-one` + `landmark-one-main`.

### Performance

Budgets formais em `docs/PERFORMANCE.md`:

| Bundle         | Budget gzip | Atual   |
| -------------- | ----------- | ------- |
| Initial route  | ≤ 100 kB    | ~88 kB  |
| `react-vendor` | ≤ 75 kB     | 67 kB   |
| `ui`           | ≤ 15 kB     | 10.8 kB |
| Editor lazy    | ≤ 30 kB     | 21.7 kB |
| Dashboard lazy | ≤ 10 kB     | 6.1 kB  |
| CSS total      | ≤ 12 kB     | 7.1 kB  |

---

## 15. CI/CD

### `.github/workflows/ci.yml`

| Job         | O que faz                                                                    |
| ----------- | ---------------------------------------------------------------------------- |
| `lint`      | `pnpm lint` + `pnpm format:check`                                            |
| `typecheck` | `pnpm typecheck` (12 pacotes)                                                |
| `test`      | Matrix Node 20 + 22, services Postgres + Redis, `pnpm test`                  |
| `build`     | `pnpm build` (turbo) + upload de `apps/web/dist`                             |
| `e2e`       | Playwright + axe, cache de browsers, upload de `playwright-report` em falhas |

Concorrência cancelando runs anteriores na mesma ref.

### Outros workflows

- `codeql.yml` — análise estática de segurança.
- `deploy-web.yml` — Vercel preview + prod.
- `deploy-api.yml` — Fly.io.
- Dependabot semanal para `npm` + `github-actions`.

### Husky

- `pre-commit`: `lint-staged` (eslint --fix + prettier nos arquivos staged).
- `pre-push`: `pnpm typecheck && pnpm test`.

---

## 16. Comandos do dia a dia

```bash
# Setup primeira vez
pnpm install
cp .env.example .env
pnpm infra:up                       # postgres + redis
pnpm db:migrate                     # migrações
pnpm --filter @blueprint/api db:seed  # opcional

# Dev
pnpm dev                            # web :5173 + api :3011 paralelos
pnpm --filter @blueprint/web dev    # só web
pnpm --filter @blueprint/api dev    # só api (nest start --watch)

# Qualidade
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm format

# Build
pnpm build                          # turbo: packages → web/api

# DB
pnpm db:migrate
pnpm db:reset
pnpm db:studio

# Infra
pnpm infra:up
pnpm infra:down
pnpm infra:logs

# Limpeza
pnpm clean
```

> Lembrete útil: o web roda **sem** o backend. Sem Postgres/API, ele cai
> automaticamente para os dados embutidos e exibe o badge "Offline mode".

---

## 17. Mapa de arquivos importantes

### Configuração raiz

- `package.json` — scripts globais, lint-staged.
- `turbo.json` — pipeline de tasks.
- `tsconfig.base.json` — base TypeScript.
- `eslint.config.js` — flat config único (substitui configs por pacote).
- `.prettierrc` + `prettier-plugin-tailwindcss`.
- `pnpm-workspace.yaml`.
- `infra/docker-compose.yml` — Postgres + Redis.

### IR/HCL (núcleo do produto)

- `packages/ir/src/types.ts` — tipos canônicos.
- `packages/hcl/src/parser.ts` — HCL → IR (com `rawTextRange`).
- `packages/hcl/src/emitter.ts` — IR → HCL (canonical sort).
- `packages/hcl/src/patch.ts` — patch textual mínimo.

### API

- `apps/api/src/main.ts` — bootstrap Fastify + helmet + cors.
- `apps/api/src/app.module.ts` — composição de módulos.
- `apps/api/src/prisma/prisma.service.ts` — graceful onModuleInit.
- `apps/api/src/modules/health/health.controller.ts` — `/health` degraded.
- `apps/api/src/modules/projects/projects.service.ts` — CRUD com graceful.
- `apps/api/prisma/schema.prisma` — schema multi-tenant.

### Web

- `apps/web/src/router.tsx` — rotas lazy + ShortcutsLayer.
- `apps/web/src/main.tsx` — entry React.
- `apps/web/src/lib/api.ts` — fetch tipado + ApiError.
- `apps/web/src/lib/{useTemplates,useProjects}.ts` — hooks offline-first.
- `apps/web/src/components/CommandPalette.tsx` — Cmdk próprio.
- `apps/web/src/theme/useTheme.ts` — Zustand + cross-tab + matchMedia.
- `apps/web/vite.config.ts` — `blueprint:source` condition + manualChunks.

### Documentação

- `README.md` (raiz) — pitch + quick start + status.
- `CHANGELOG.md` — F0 + F1 + F1.5.
- `docs/ARCHITECTURE.md` — visão técnica.
- `docs/DESIGN-SYSTEM.md` — tokens e componentes.
- `docs/DEVELOPMENT.md` — DX flow.
- `docs/PERFORMANCE.md` — budgets.
- `docs/PHASE-1-STATUS.md` — fechamento da F1/F1.5.
- `docs/IR-SPEC.md`, `docs/RESOURCES.md`, `docs/STACK.md`, `docs/ROADMAP.md`.

---

## 18. Roadmap detalhado (próximas fases)

### F2 — Canvas + paleta (semanas 5-6)

- React Flow canvas com nós custom (tintados pelo provider).
- Drag/drop da paleta para o canvas.
- Inspector com binding two-way ao nó selecionado.
- Layout automático (ELK ou Dagre).
- Zoom/pan, mini-map, controles padrão.
- Scaffolding Yjs (sem multi-user vivo ainda — isso é F3).

### F3 — Sync bidirecional (semanas 7-8)

- y-monaco no painel de código.
- Web Worker observando deltas de `Y.Text`.
- Diff IR → ops com convergência testada.
- Demonstração: dois browsers editando o mesmo projeto sem corromper estado.

### F4 — Persistência multi-tenant (semana 9)

- `/api/projects` real (sem o caminho graceful), autosave debounced.
- Presence (avatares de quem está editando).
- Versões (snapshot a cada N minutos) com rollback.

### F5 — Templates dinâmicos + Git (semana 10)

- API de export zip via Cloudflare R2.
- OAuth GitHub + GitLab; push do projeto para um repo.
- Templates customizados por org.

### F6 — Polish + observabilidade + beta (semanas 11-12)

- Sentry, PostHog, pino → Datadog/Loki.
- PWA (offline real).
- Landing pública + form de waitlist.
- Beta privado por invite.

---

## 19. Pontos de extensão imediatos

- **Adicionar um novo recurso AWS:** `packages/resources/src/aws/<arquivo>.ts`
  - smoke test em `catalog.test.ts`.
- **Adicionar um template:** `packages/templates/src/<nome>.ts` + export em
  `index.ts`.
- **Adicionar um componente UI:** `packages/ui/src/<nome>.tsx` + export em
  `index.ts` + teste em `apps/web/src/test/ui.test.tsx`.
- **Adicionar uma rota:** `apps/web/src/routes/<nome>.tsx` + entrada lazy em
  `apps/web/src/router.tsx` + test em `apps/web/src/test/routes.test.tsx`.
- **Adicionar um endpoint:** módulo em `apps/api/src/modules/<nome>/` + import
  em `app.module.ts`.

---

## 20. Em uma frase

Cloud Infra Blueprint é um editor visual de Terraform multi-cloud, com sync
bidirecional canvas ↔ HCL através de uma IR canônica, construído como um
monorepo TypeScript de produção (130+ testes, axe-clean, design system
próprio, CI exemplar) — pronto para sair do beta privado nas próximas três
fases (canvas → sync → persistência).
