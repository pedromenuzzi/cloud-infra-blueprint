# Good First Issues — Backlog inicial

Este documento é o **estoque de boas primeiras issues** do Cloud Infra
Blueprint. A regra é simples: **manter ~10 issues `good first issue`
abertas no GitHub o tempo todo**. Quando uma é mergeada, abrir uma nova
deste arquivo (ou outra que faça sentido).

Cada item abaixo tem o que você precisa para criar a issue: título,
labels, descrição, critérios de aceite e arquivos relevantes. Copie e
cole no [novo-issue do GitHub](https://github.com/cloud-blueprint/cloud-blueprint/issues/new/choose),
ou rode `gh issue create` com os flags certos.

## Como abrir uma destas issues

```bash
gh issue create \
  --title "[resource]: aws_lambda_function" \
  --label "type:enhancement,area:resources,good first issue,effort:S" \
  --body-file <(cat <<'EOF'
... cole a descrição da issue aqui ...
EOF
)
```

Convenção de labels para todas as good-first-issues abaixo:

- `good first issue` (sempre)
- `area:<...>` (uma)
- `type:<...>` (uma)
- `effort:<XS|S|M>` (uma — nunca L ou XL para uma _first_ issue)

---

## Catálogo de recursos (alvo: 4 issues abertas o tempo todo)

Cada novo recurso é uma good-first-issue de tamanho `S` quase por construção.
Modelo em [`docs/RESOURCES.md`](RESOURCES.md). Esqueleto de teste em
[`packages/resources/src/catalog.test.ts`](../packages/resources/src/catalog.test.ts).

### 1. `aws_lambda_function`

- **Labels:** `type:enhancement`, `area:resources`, `good first issue`, `effort:S`
- **Por quê:** lambda é o segundo recurso AWS mais usado depois de EC2 e está
  faltando no catálogo. Cobre o caso "serverless puro".
- **O que fazer:** criar `packages/resources/src/aws/lambda.ts` exportando um
  `defineResource` com schema Zod para os campos essenciais (`function_name`,
  `runtime`, `handler`, `role`, `filename`, `s3_bucket`/`s3_key`, `memory_size`,
  `timeout`, `environment`, `tags`).
- **Aceite:** smoke test em `catalog.test.ts` passa; round-trip do HCL emitido
  fecha; ícone em `apps/web/public/icons/aws/lambda.svg` (use o oficial AWS
  Architecture Icons, gratuito).

### 2. `aws_cloudwatch_log_group`

- **Labels:** `type:enhancement`, `area:resources`, `good first issue`, `effort:XS`
- **Por quê:** complemento natural de Lambda e qualquer compute serverless.
  Schema é trivial (5 campos).
- **Arquivo alvo:** `packages/resources/src/aws/cloudwatch.ts` (novo).

### 3. `aws_sqs_queue`

- **Labels:** `type:enhancement`, `area:resources`, `good first issue`, `effort:S`
- **Por quê:** desbloqueia padrões de mensageria. Schema com 8–10 campos.
- **Arquivo alvo:** `packages/resources/src/aws/sqs.ts` (novo).

### 4. `azurerm_storage_blob`

- **Labels:** `type:enhancement`, `area:resources`, `good first issue`, `effort:S`
- **Por quê:** o catálogo Azure é o mais magro hoje. Storage é base.
- **Arquivo alvo:** `packages/resources/src/azure/storage.ts` (estender).

### 5. `google_storage_bucket`

- **Labels:** `type:enhancement`, `area:resources`, `good first issue`, `effort:S`
- **Por quê:** GCP precisa de um análogo a S3 no catálogo.
- **Arquivo alvo:** `packages/resources/src/gcp/storage.ts` (novo).

---

## Documentação (alvo: 2 issues abertas)

### 6. Adicionar página `docs/CREATING-A-PROVIDER.md`

- **Labels:** `type:docs`, `area:docs`, `good first issue`, `effort:M`
- **Por quê:** o catálogo é a porta de entrada mais comum, mas o passo a
  passo de "como adicionar um provider novo" só existe implicitamente nos
  arquivos de `packages/resources/src/aws/*.ts`.
- **O que fazer:** documento Markdown com (1) anatomia de um `defineResource`,
  (2) como gerar/exportar um ícone, (3) onde fica o smoke test, (4) PR
  checklist.
- **Aceite:** documento referenciado de `CONTRIBUTING.md` e do
  `RESOURCES.md`. Inclui ao menos um exemplo completo end-to-end.

### 7. Diagrama Mermaid em `docs/ARCHITECTURE.md`

- **Labels:** `type:docs`, `area:docs`, `good first issue`, `effort:S`
- **Por quê:** o diagrama ASCII em `PROJECT-OVERVIEW.md §4` funciona, mas
  perde nuances. Um diagrama Mermaid renderizado pelo GitHub é mais legível.
- **O que fazer:** dois diagramas Mermaid (1) componentes do browser,
  (2) fluxo "drag → IR → emit → texto" — substituindo ou complementando o ASCII.
- **Aceite:** renderiza corretamente no preview do GitHub; cores funcionam
  em light e dark.

---

## DX e UI (alvo: 2 issues abertas)

### 8. Botões "Undo" e "Redo" no Topbar do editor

- **Labels:** `type:enhancement`, `area:web`, `good first issue`, `effort:S`
- **Por quê:** o store já expõe `undo`/`redo`/`canUndo`/`canRedo`
  ([apps/web/src/store/useIRStore.ts](../apps/web/src/store/useIRStore.ts)).
  Falta o botão visível para quem não conhece o atalho.
- **Arquivo alvo:** `apps/web/src/features/topbar/Topbar.tsx`.
- **Aceite:** dois `Button` do design system com `Undo2`/`Redo2` (lucide),
  `disabled` quando não aplicável, `aria-label` descritivo. Teste em
  `apps/web/src/test/ui.test.tsx` ou em um novo arquivo
  `topbar.test.tsx`.

### 9. Atalho `Ctrl+Y` documentado no `ShortcutsHelp`

- **Labels:** `type:docs`, `area:web`, `good first issue`, `effort:XS`
- **Por quê:** o `ShortcutsLayer` já aceita `Ctrl+Y` para redo (convenção
  Windows), mas o cheat sheet em `ShortcutsHelp.tsx` só lista
  `Ctrl+Shift+Z`. Adicionar a linha redondinho.
- **Arquivo alvo:** `apps/web/src/components/ShortcutsHelp.tsx`.

---

## Templates (alvo: 1 issue aberta)

### 10. Template `aws-lambda-api`

- **Labels:** `type:enhancement`, `area:templates`, `good first issue`, `effort:M`
- **Por quê:** API Gateway + Lambda + DynamoDB é o padrão "serverless API"
  mais buscado. Hoje há `aws-web-app` (EC2 clássico) mas nenhum serverless.
- **Pré-requisito:** issues #1 (`aws_lambda_function`) e #3 (`aws_sqs_queue`)
  fechadas, ou aceitar o `Expression.kind = 'raw'` enquanto o catálogo não
  cobre o resource.
- **Arquivo alvo:** `packages/templates/src/aws-lambda-api.ts` (novo).

---

## Testes (alvo: 1 issue aberta)

### 11. Property test para `invertOp`

- **Labels:** `type:enhancement`, `area:ir`, `good first issue`, `effort:M`
- **Por quê:** [packages/ir/src/invert.test.ts](../packages/ir/src/invert.test.ts)
  cobre exemplos. Falta uma propriedade `fast-check` que gere `Op`s
  arbitrários e verifique `applyOp(applyOp(ir, op), invertOp(ir, op)) === ir`
  para qualquer entrada.
- **Arquivo alvo:** novo `packages/ir/src/invert.property.test.ts` usando
  `@fast-check/vitest` (já é dependência de `@blueprint/hcl`).
- **Aceite:** 250 iterações local, 1000 em CI; cobre todas as 12 variantes
  de `Op`.

---

## Como o mantenedor mantém o ritmo

Toda **segunda-feira pela manhã**, abrir 2 good-first-issues novas deste
backlog. Quando o backlog encolher abaixo de 6 itens, abrir um PR neste
arquivo adicionando 4–6 novos.

Issues fechadas com `good first issue` que viraram boa contribuição vão
para a galeria pública (TODO: link para showcase quando F5 chegar).
