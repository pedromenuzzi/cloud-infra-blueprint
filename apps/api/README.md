# @blueprint/api

Backend NestJS + Fastify do Cloud Infra Blueprint.

## Estrutura

```
src/
├── main.ts                    bootstrap (Fastify + helmet + cors)
├── app.module.ts              wires all modules + ConfigModule + Throttler
├── prisma/                    PrismaService global
├── common/
│   └── guards/                AuthGuard, RoleGuard (RBAC)
└── modules/
    ├── auth/                  Clerk OR Auth.js (encapsulated)
    ├── orgs/
    ├── projects/              CRUD + autosave
    ├── versions/              snapshots
    ├── share/                 read-only share links
    ├── git/                   GitHub / GitLab integration (F5)
    ├── export/                project .zip generator
    ├── templates/             list of patterns
    ├── realtime/              y-websocket gateway (F4)
    └── health/                /health endpoint
```

## Banco

Schema completo em `prisma/schema.prisma`. Modelos:

- `User`, `Organization`, `Membership` (multi-tenant + RBAC).
- `Project` (com snapshot da IR e dos arquivos `.tf`).
- `ProjectVersion` (history).
- `ShareLink` (read-only).
- `GitIntegration` (token AES-GCM).
- `Template` (org-scoped + público).

## Comandos

```bash
pnpm --filter @blueprint/api dev         # nest start --watch em :3000
pnpm --filter @blueprint/api build
pnpm --filter @blueprint/api start:prod

pnpm --filter @blueprint/api db:migrate  # prisma migrate dev
pnpm --filter @blueprint/api db:studio
pnpm --filter @blueprint/api db:reset
```

Antes do primeiro `db:migrate`, suba o Postgres com `pnpm infra:up` na raiz do monorepo.

## Endpoints implementados (F0)

| Method | Path                              | Descrição               |
| ------ | --------------------------------- | ----------------------- |
| GET    | `/health`                         | DB check                |
| GET    | `/api/auth/me`                    | usuário corrente (stub) |
| GET    | `/api/orgs`                       | orgs do usuário         |
| GET    | `/api/projects`                   | lista por `?orgId=`     |
| POST   | `/api/projects`                   | cria projeto vazio      |
| GET    | `/api/projects/:id`               | obtém                   |
| PATCH  | `/api/projects/:id`               | autosave                |
| DELETE | `/api/projects/:id`               | remove                  |
| GET    | `/api/projects/:id/versions`      | history                 |
| POST   | `/api/projects/:id/versions`      | snapshot manual         |
| POST   | `/api/share/:projectId`           | cria share link         |
| GET    | `/api/share/:token`               | abre via token          |
| GET    | `/api/git/:projectId/integration` | metadata                |
| GET    | `/api/export/:projectId/zip`      | baixa .zip              |
| GET    | `/api/templates`                  | lista patterns          |

WebSocket Yjs em `/ws/:projectId` é stub por enquanto — implementação real vem em F4.
