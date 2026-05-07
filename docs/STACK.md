# Stack — versões fixas

> Mantenha sincronizado com a Seção 6 da spec mestre. Mudanças exigem justificativa em PR.

| Camada       | Pacote                       | Versão     | Por que                       |
| ------------ | ---------------------------- | ---------- | ----------------------------- |
| **Core**     | node                         | 20.10+ LTS | runtime                       |
|              | pnpm                         | 9.12+      | monorepo eficiente            |
|              | turbo                        | 2.3+       | task runner com cache         |
|              | typescript                   | 5.5+       | tipos                         |
| **Frontend** | vite                         | 5.4+       | bundler / dev server          |
|              | react / react-dom            | 18.3       | UI                            |
|              | react-router-dom             | 6.27+      | routing                       |
|              | @xyflow/react                | 12.3+      | canvas (React Flow)           |
|              | monaco-editor                | 0.52+      | editor de código              |
|              | @monaco-editor/react         | 4.6+       | wrapper React                 |
|              | yjs                          | 13.6+      | CRDT                          |
|              | y-monaco                     | 0.1+       | binding Yjs ↔ Monaco          |
|              | y-websocket                  | 2.0+       | transporte                    |
|              | @cdktf/hcl2json              | 0.20+      | parser HCL via WASM           |
|              | zustand                      | 5.0+       | estado (IR)                   |
|              | zod                          | 3.23+      | schemas                       |
|              | tailwindcss                  | 3.4+       | styling                       |
|              | class-variance-authority     | 0.7+       | variantes shadcn              |
|              | lucide-react                 | latest     | ícones                        |
|              | dagre                        | 0.8+       | layout automático             |
|              | react-hook-form              | 7.53+      | forms (inspector)             |
| **Backend**  | @nestjs/core                 | 10.4+      | framework                     |
|              | @nestjs/platform-fastify     | 10.4+      | adapter Fastify               |
|              | prisma + @prisma/client      | 5.21+      | ORM                           |
|              | ioredis                      | 5.4+       | redis                         |
|              | bullmq                       | 5.21+      | filas                         |
|              | y-websocket (server)         | 2.0+       | colaboração                   |
|              | jszip                        | 3.10+      | export zip                    |
|              | @octokit/rest                | 21.0+      | GitHub API                    |
|              | @gitbeaker/rest              | 40.5+      | GitLab API                    |
| **Auth**     | @clerk/clerk-sdk-node        | 5.x        | OU Auth.js (intercambiáveis)  |
| **DevOps**   | docker-compose               | v2         | dev local                     |
|              | github-actions               | —          | CI/CD                         |
| **Hosting**  | vercel                       | —          | frontend                      |
|              | railway                      | —          | backend (alternativa: fly.io) |
|              | neon                         | —          | postgres serverless           |
|              | cloudflare r2                | —          | storage de exports            |
| **Observ.**  | @sentry/node + @sentry/react | 8.x        | erros                         |
|              | posthog-js + posthog-node    | latest     | analytics                     |
| **Testing**  | vitest                       | 2.1+       | unit                          |
|              | playwright                   | 1.48+      | e2e                           |
|              | fast-check                   | 3.23+      | property-based round-trip     |

## Política de upgrade

- **Patch / minor de deps de ferramenta** (Tailwind, Prettier, ESLint, types) — sem cerimônia.
- **Patch de deps de runtime** (React, Vite, NestJS, Prisma) — passa em CI, merge.
- **Major de qualquer dep core** (React, NestJS, Prisma, Vite, Yjs, React Flow) — issue dedicada com plano de migração e janela de testes manuais.
- **Dependabot** abre PRs semanais às segundas (`.github/dependabot.yml`).

## Por que NÃO usar X

- **Next.js no frontend** — não precisamos de SSR; SPA pura é mais leve e o canvas só faz sentido client-side.
- **GraphQL** — REST simples + Yjs WS atende. Sem cabeça de schema separado pra manter.
- **Drizzle / Kysely** — Prisma ganha em DX (Studio, migrations, types).
- **Lit / Vue** — React tem o ecossistema completo (Flow, Monaco wrapper, Yjs binding).
