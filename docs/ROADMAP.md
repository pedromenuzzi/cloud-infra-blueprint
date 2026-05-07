# Roadmap (12 semanas / 7 fases)

Cada fase tem um critério de aceite mensurável. Não pule fases — a Fase N depende dos artefatos da N-1.

## F0 — Fundações (semana 1-2)

- [x] Bootstrap monorepo Turborepo + pnpm
- [x] `apps/web` (Vite + React 18 + TS + Tailwind + shadcn-style)
- [x] `apps/api` (NestJS + Fastify + Prisma + Postgres via docker-compose)
- [x] Migrations iniciais (`User`, `Org`, `Membership`, `Project`)
- [x] CI: GitHub Actions (lint + typecheck + test em PRs)
- [ ] Auth: Clerk OU Auth.js com login GitHub
- [ ] Deploy preview funcionando (Vercel + Railway)

**Critério de aceite:** Login GitHub funciona em staging; CI verde; pode-se criar/listar projects via API.

---

## F1 — IR + Parser HCL (semana 3-4)

- [x] `packages/ir` com tipos canônicos
- [x] `packages/hcl` com `parse()` e `emit()`
- [ ] WASM `@cdktf/hcl2json` rodando em WebWorker
- [ ] AST walker → IR (resource, module, variable, output, provider)
- [ ] Emitter com preservação de `trivia.rawTextRange`
- [ ] Suite de 100+ snapshots de round-trip
- [ ] Property-based via `fast-check` (1000 iterações em CI)
- [ ] Bench: parse de 500 linhas em < 80ms no browser médio

**Critério de aceite:** Round-trip HCL→IR→HCL idêntico em 95% dos snapshots; tempo < 80ms.

---

## F2 — Canvas e paleta (semana 5-6)

- [ ] React Flow (`@xyflow/react`) com background grid, minimap, controles
- [ ] Custom `ResourceNode` (ícone, nome, handles)
- [ ] Subflows para VPC/Subnet/Resource Group
- [ ] Paleta lateral arrastável (já tem skeleton)
- [ ] Drag-from-palette → cria `ResourceNode` na IR
- [ ] Inspector com form gerado do schema Zod (react-hook-form)
- [ ] Layout automático via dagre na primeira renderização
- [ ] Atalhos: Delete, Cmd/Ctrl+D, Cmd/Ctrl+Z

**Critério de aceite:** Drag de 5+ recursos da paleta cria nós; inspector edita campos; layout automático funciona.

---

## F3 — Sync bidirecional (semana 7-8)

- [ ] Monaco Editor com tabs por arquivo `.tf`
- [ ] HCL language: tokens básicos + autocomplete dos tipos do catálogo
- [ ] Yjs document compartilhado (Y.Text por arquivo, Y.Map para positions)
- [ ] Binding `y-monaco`
- [ ] Worker observa Y.Text → parseia → diff vs IR atual → ops
- [ ] Worker observa canvas → patch HCL mínimo → Y.Text
- [ ] Validações semânticas (refs inexistentes, cycles, conexões inválidas)
- [ ] Marcadores no Monaco (red squiggly) e badges no canvas

**Critério de aceite:** Edição em qualquer lado reflete no outro em < 200ms; conflitos não corrompem estado.

---

## F4 — Persistência + Multi-tenant (semana 9)

- [x] REST endpoints (`POST /projects`, `GET`, `PATCH`, `versions`)
- [ ] Auto-save debounced (3s) em `Project.ir` e `Project.files`
- [ ] Snapshot automático em `ProjectVersion` a cada N saves ou via botão
- [ ] WebSocket Gateway Yjs (rooms por `projectId`, JWT no upgrade)
- [ ] Permissões por `Membership.role` (OWNER/ADMIN deletam; VIEWER read-only)
- [ ] Lista de projetos no Dashboard com busca/filtros

**Critério de aceite:** Auto-save persiste; reload restaura projeto idêntico; 3 usuários editando convergem.

---

## F5 — Templates + Export + Git (semana 10)

- [x] Catálogo de templates (`packages/templates`)
- [ ] Galeria modal com cards (thumbnail, descrição, params)
- [ ] Aplicar template em projeto vazio ou mesclar com existente
- [x] Export `.zip` (skeleton)
- [ ] Export `.zip` via BullMQ + R2
- [ ] OAuth GitHub no perfil → vincula ao projeto
- [ ] Push para repo (branch `blueprint/sync`, commit, abre PR)
- [ ] Pull from repo (read-only): importa `.tf` para o canvas

**Critério de aceite:** Aplicar `web-app-aws` gera 5 recursos válidos com `terraform validate`.

---

## F6 — Polish + Deploy + Lançamento (semana 11-12)

- [ ] Onboarding tour (react-joyride ou intro.js)
- [ ] Empty states bonitos, loading skeletons, atalhos documentados
- [ ] Sentry frontend e backend (release tagging por SHA)
- [ ] PostHog para funnels (eventos do apêndice D)
- [ ] Landing page marketing (`apps/web` rota `/` — já tem skeleton)
- [ ] Pricing tiers se for monetizar (Free / Pro / Team)
- [ ] Docs (Mintlify ou Docusaurus em `apps/docs`)
- [ ] Deploy production: Vercel + Railway + Neon + R2
- [ ] Beta privado para 20 engenheiros

**Critério de aceite:** Lighthouse > 90; uptime 99.5% por 7 dias; 10 usuários beta concluem onboarding sem ajuda.

---

## Pós-MVP

- AWS: ECS Fargate, EKS, Lambda, ALB, NLB, Route53, DynamoDB, SQS, SNS, CloudFront, ACM
- Azure: AKS, Function App, App Service, Cosmos DB, Service Bus, Front Door
- GCP: GKE, Cloud Run, Cloud Functions, BigQuery, Pub/Sub, Cloud Load Balancing
- Transversais: `random_password`, `tls_private_key`, `kubernetes_*`, `helm_release`
- Importer de Terraform State (lê `terraform.tfstate` e popula a IR)
- AI assistant ("desenhe uma arquitetura para um SaaS B2B com 10k usuários")
