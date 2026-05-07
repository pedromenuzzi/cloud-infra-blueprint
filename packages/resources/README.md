# @blueprint/resources

[![npm version](https://img.shields.io/npm/v/@blueprint/resources.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/@blueprint/resources)
[![npm downloads](https://img.shields.io/npm/dm/@blueprint/resources.svg?logo=npm)](https://www.npmjs.com/package/@blueprint/resources)
[![license](https://img.shields.io/npm/l/@blueprint/resources.svg?color=blue)](../../LICENSE)
[![types](https://img.shields.io/npm/types/@blueprint/resources.svg?logo=typescript)](https://www.npmjs.com/package/@blueprint/resources)

> Catálogo declarativo multi-cloud (AWS / Azure / GCP).

```bash
npm install @blueprint/resources @blueprint/ir
# or
pnpm add @blueprint/resources @blueprint/ir
```

Cada recurso é exportado de `packages/resources/src/<provider>/<arquivo>.ts` via `defineResource(...)`. O frontend consome esse catálogo para renderizar a paleta, o inspector e validar campos antes do emit.

## MVP atual

| Provider | Compute                         | Storage                   | Network                                                | Database                       | Identity                              |
| -------- | ------------------------------- | ------------------------- | ------------------------------------------------------ | ------------------------------ | ------------------------------------- |
| AWS      | `aws_instance`                  | `aws_s3_bucket`           | `aws_vpc` + `aws_subnet`                               | `aws_db_instance`              | `aws_iam_role` + `aws_security_group` |
| Azure    | `azurerm_linux_virtual_machine` | `azurerm_storage_account` | `azurerm_virtual_network` + `azurerm_subnet`           | `azurerm_mssql_database`       | `azurerm_resource_group` (logical)    |
| GCP      | `google_compute_instance`       | `google_storage_bucket`   | `google_compute_network` + `google_compute_subnetwork` | `google_sql_database_instance` | `google_service_account`              |

Pós-MVP listado em `docs/RESOURCES.md`.

## Adicionar um novo recurso

1. Crie `packages/resources/src/<provider>/<nome>.ts` exportando via `defineResource()`.
2. Importe e re-exporte no `<provider>/index.ts` e adicione ao array do catálogo.
3. Adicione um teste mínimo (parse de exemplo + emit não joga).
4. Inclua o ícone em `apps/web/public/icons/<provider>/<nome>.svg` (placeholder OK).

## Convenções

- **Pareto 80/20.** Não tente cobrir os 200+ campos do provider. Inclua os 5–15 mais usados; o resto sempre cai no `raw` e o usuário escreve direto no editor.
- **`schema` é Zod.** Forms são gerados automaticamente a partir dele.
- **`defaults`** são aplicados quando o usuário arrasta da paleta.
- **`ports`** descrevem onde edges fazem sentido (in/out, network/iam/reference).
- **`emit`** geralmente é uma linha: `return ctx.block('resource', [type, name], res.args);` — só customize se o recurso precisar de blocos aninhados ou sintaxe especial.
