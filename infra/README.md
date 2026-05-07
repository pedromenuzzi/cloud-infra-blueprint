# Infra (dev local)

Sobe Postgres 16 + Redis 7 para desenvolvimento. Não use em produção — em prod usamos **Neon** (Postgres serverless) e **Upstash/Redis Cloud**.

## Comandos

```bash
pnpm infra:up         # docker compose up -d (postgres + redis)
pnpm infra:up:cost    # também sobe o serviço opcional Infracost
pnpm infra:down       # docker compose down (inclui profiles cost + tools)
pnpm infra:logs       # tail -f
docker compose -f infra/docker-compose.yml --profile tools up -d adminer
# Adminer: http://localhost:8080  (system: PostgreSQL, server: postgres, user/pass: postgres, db: blueprint)
```

## Estimativa de custo (opcional)

O serviço `infracost` no `cost` profile sobe o **CLI open-source da Infracost
(Apache 2.0)** com uma price database embutida — não exige conta nem API key
para preços públicos AWS/Azure/GCP. Veja
[`docs/adr/0007-cost-via-infracost.md`](../docs/adr/0007-cost-via-infracost.md)
para a decisão arquitetural.

```bash
pnpm infra:up:cost
export BLUEPRINT_COST_ENABLED=1
# se o binário não estiver no PATH do host, aponte para o do container ou
# instale o CLI localmente via https://www.infracost.io/docs/
export BLUEPRINT_COST_BINARY=infracost
pnpm dev
```

A API expõe `POST /cost-estimate` (body `{ ir }`) e o frontend já consome via
o hook `useCostEstimate(ir)` — quando o serviço está desligado, a UI esconde
o badge de custo silenciosamente.

## Volumes persistentes

Os dados ficam em volumes Docker nomeados (`cloud-blueprint_postgres-data`, `cloud-blueprint_redis-data`). Para resetar tudo:

```bash
docker compose -f infra/docker-compose.yml down -v
```

## Variáveis usadas

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/blueprint?schema=public
REDIS_URL=redis://localhost:6379
```
