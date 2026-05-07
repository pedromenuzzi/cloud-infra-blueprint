# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning 2.0](https://semver.org/).

## [Unreleased]

### Added — Phase 1.5 (UX backbone)

- **Design system canonical** baseado nas referências 01-06: paleta HSL completa
  (light + dark), tipografia Inter Variable + JetBrains Mono Variable,
  raios/sombras padronizados, tokens de provider (AWS / Azure / GCP / multi).
- **Componentes compartilhados** em `@blueprint/ui`: `Button`, `Card`, `Input`,
  `Badge`, `Avatar` + `AvatarGroup`, `Logo`, `ProviderIcon`, `Modal`. Todos
  acessíveis (focus visível, semântica correta, ARIA validado).
- **Dark mode** com `light` / `dark` / `system`, sincronizado entre abas via
  `StorageEvent` e respeitando `prefers-color-scheme`. Anti-flash inline script
  no `index.html`.
- **Landing page** redesenhada (hero + value props + CTAs) com responsividade
  e contraste AA.
- **Dashboard** com listagem real de projetos via `useProjects` (offline-first
  fallback para demo data), toggle grid/list, busca e ação "New project".
- **Templates Gallery** com filtros por provider, badges, e fallback offline.
- **Command Palette (Ctrl+K / Cmd+K)** global: navegação, troca de tema,
  ações de projeto. Sem dependência externa, ~3 KB.
- **Camada global de atalhos** (`?` para help, `/` para focar busca,
  `Esc` para fechar tudo) e modal `ShortcutsHelp`.
- **API client** com `AbortController`, timeouts e `ApiError` estruturado.
- **Hooks de dados** `useTemplates` e `useProjects` com fetch + fallback +
  optimistic update.
- **Acessibilidade**: landmarks únicas (`AppRail`, `Palette`, `Inspector`),
  hierarquia de heading correta, `aria-label` em todos os controles
  ambíguos, audit `@axe-core/playwright` verde nas 4 rotas principais.

### Added — Phase 1 (IR + HCL contract)

- **IR canônica** (`packages/ir`) com discriminated unions: `ProjectIR`,
  `ResourceDecl`, `ModuleDecl`, `VariableDecl`, `OutputDecl`, `ProviderDecl`,
  `Expression` (`literal | list | object | ref | raw`), `Trivia`, `Op`.
- **Parser HCL → IR** (`packages/hcl/src/parser.ts`) cobrindo `resource`,
  `module`, `variable`, `output`, `provider`. Inclui `scanBlockRanges` (matcher
  próprio respeitando strings, comentários e heredocs) que injeta
  `trivia.rawTextRange` em cada bloco para suportar patch mínimo.
- **Emitter IR → HCL** (`packages/hcl/src/emitter.ts`) com sort canônico
  alfabético em corpos e objetos, garantindo idempotência e diffs estáveis.
- **Patch mínimo textual** (`packages/hcl/src/patch.ts`): `patchResource`,
  `removeResource`, `shiftRanges` que reescrevem só o range textual afetado,
  preservando comentários e ordem original.
- **76 fixtures de Terraform real** (AWS, Azure, GCP, multi, edge cases) com
  round-trip ≥ 100% (critério: ≥ 95%).
- **Testes property-based** com `fast-check` (250 iterações local, 1000 em CI)
  garantindo idempotência estrutural.
- **Bench**: parse + emit de ~500 LOC com mediana 35–135 ms (limite < 80 ms na
  máquina dev, teto seguro 200 ms para Windows CI).
- **Catálogo declarativo** (`packages/resources`) AWS / Azure / GCP nas
  categorias Compute / Storage / Network / Database / Identity, com smoke
  tests garantindo que cada definição emite HCL parseável.
- **Templates compostos** (`packages/templates`): Web App AWS/Azure, Static
  Site AWS/GCP, Container Stack AWS — cada um expõe variáveis tipadas e gera
  IR montável.

### Added — Phase 0 (Foundation)

- Bootstrap do monorepo (Turborepo 2 + pnpm 9 + TypeScript 5.5).
- `apps/web` (React 18 + Vite 5 + Tailwind + `@blueprint/ui`).
- `apps/api` (NestJS 10 + Fastify) com módulos `auth`, `orgs`, `projects`,
  `versions`, `share`, `git`, `export`, `templates`, `realtime`, `health`.
- Schema Prisma inicial: `User`, `Organization`, `Membership`, `Project`,
  `ProjectVersion`, `ShareLink`, `GitIntegration`, `Template`.
- Pacotes `packages/ir`, `packages/hcl`, `packages/resources`,
  `packages/templates`, `packages/ui`, `packages/config`.
- `infra/docker-compose.yml` com Postgres 16 + Redis 7.
- CI no GitHub Actions (lint + typecheck + test + build + E2E em paralelo) e
  CodeQL.
- Templates de issue/PR, Dependabot, FUNDING, CODEOWNERS.
- Documentação OSS: `README`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`,
  `NOTICE`, `docs/ARCHITECTURE`, `docs/DESIGN-SYSTEM`, `docs/ROADMAP`,
  `docs/IR-SPEC`, `docs/RESOURCES`, `docs/DEVELOPMENT`, `docs/STACK`,
  `docs/PHASE-1-STATUS`.

### Changed

- API agora roda com **NestJS SWC builder** (`nest start --watch`) para hot
  reload rápido e emissão correta de decorator metadata para DI.
- `PrismaService.onModuleInit` é tolerante a falhas de conexão — a API sobe
  mesmo sem Postgres e o `/health` responde `degraded`.
- `ProjectsService.list` retorna `[]` quando o DB está down; mutações lançam
  `503` com mensagem instrutiva.
- Pacotes internos (`@blueprint/{ir,hcl,resources,templates}`) publicam
  `dist/` como entry runtime; web/Vitest leem source diretamente via custom
  `blueprint:source` resolve condition (HMR continua instantâneo).
- CI: matrix Node 20 + 22, job de Playwright + a11y separado com cache de
  browsers, upload de relatório em falhas.
- Husky pre-commit (lint-staged: eslint --fix + prettier) + pre-push
  (typecheck + test).

### Fixed

- Round-trip de `variable.type = "string"` que era serializado como
  `"${string}"` — `VariableDecl.type` virou `Expression`.
- `AvatarGroup` `+N` agora é uma `<span>` separada (axe-clean).
- Heading order do dashboard corrigida (`h2` em cards, `h1` único por rota).
- `aria-label` em landmarks duplicados (`AppRail`, `Palette`, `Inspector`)
  para satisfazer `landmark-unique`.

[Unreleased]: https://github.com/cloud-blueprint/cloud-blueprint/compare/HEAD
