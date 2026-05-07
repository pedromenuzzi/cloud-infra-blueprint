# Execução da roadmap OSS — bitácola incremental

> Este documento é a memória técnica da rodada que transformou a roadmap
> "Priorização OSS — Cloud Infra Blueprint (custo zero)" em código mergeado.
> Cada seção é um item da roadmap, na ordem em que foi entregue, com:
> **o que foi feito**, **as escolhas que tomamos** (e as que descartamos),
> **os bugs que esbarramos** e **o que ficou para depois**.
>
> Premissa fundamental atravessando tudo: **custo zero recorrente** para o
> mantenedor. Sem APIs pagas, sem dependências de SaaS pago. SaaS só entra
> com tier OSS gratuito e estável (GitHub Actions, GitHub Pages, npm
> público, GitHub Discussions).

---

## Sumário executivo

| Fase | Item                                                                                               | Pacote / app                                   | LOC novas\* |
| ---- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------- |
| F2   | [1. ADRs em formato MADR](#1-f2--adrs-em-formato-madr)                                             | `docs/adr/`                                    | docs        |
| F2   | [2. Undo / Redo local + atalhos](#2-f2--undo--redo-local--atalhos)                                 | `@blueprint/ir`, `@blueprint/web`              | ~430        |
| F2   | [3. Issue templates + labels + good-first-issues](#3-f2--issue-templates-labels-good-first-issues) | `.github/`                                     | docs/yaml   |
| F2   | [4. Parser HCL incremental](#4-f2--parser-hcl-incremental)                                         | `@blueprint/hcl`                               | ~750        |
| F3   | [5. Storybook 8 + GitHub Pages](#5-f3--storybook-8--github-pages)                                  | `apps/storybook`                               | ~900        |
| F3   | [6. Changesets + publish público no npm](#6-f3--changesets--publish-público-no-npm)                | root + 5 packages                              | ~250 + docs |
| F4   | [7. Playground `/p/:hash` (LZ-string)](#7-f4--playground-phash-lz-string)                          | `@blueprint/web`                               | ~520        |
| F4   | [8. Import de Terraform existente](#8-f4--import-de-terraform-existente)                           | `@blueprint/web`                               | ~720        |
| F5   | [9. Plugin API para providers e templates](#9-f5--plugin-api-para-providers-e-templates)           | `@blueprint/resources`, `@blueprint/templates` | ~430 + docs |
| F5   | [10. Estimativa de custo via Infracost CLI](#10-f5--estimativa-de-custo-via-infracost-cli)         | `@blueprint/api`, `@blueprint/web`, `infra/`   | ~660 + docs |

\* Linhas de código contam apenas TS/TSX/MD novos da rodada — não inclui
diffs cirúrgicos em arquivos existentes.

**Resultado da bateria final:**

```
pnpm lint        →  0 warnings, 0 errors
pnpm typecheck   →  13 / 13 tasks ok
pnpm test        →  11 / 11 tasks ok  (~140 testes adicionados nesta rodada)
```

---

## Critério de priorização

Antes de qualquer linha de código a roadmap original (24 itens) passou
por dois cortes:

1. **Custo zero recorrente.** Nenhuma API paga (Anthropic, OpenAI,
   Honeycomb, Datadog, Infracost SaaS, Chromatic, Percy). Self-hosting
   open-source vale (Infracost CLI binário, Jaeger local).
2. **ROI alto e mensurável.** Cada item pesa em uma de quatro alavancas:
   fundação técnica, confiança/governança, aquisição de usuários,
   aquisição de contribuidores.

**Itens cortados** com motivo:

- **Claude AI integrado** — pedido explícito do mantenedor (API paga).
- **OpenTelemetry com Honeycomb/Datadog** — SaaS pago.
- **Percy / Chromatic** — free tier OSS frágil pré-beta.
- **Discord + office hours** — gratuito mas é compromisso humano
  recorrente, não técnico.
- **HN/PH launch** — pertence a F6, é evento e não melhoria.

Sobraram os 10 que você acabou de ver na tabela acima.

---

## 1 (F2) — ADRs em formato MADR

**Por quê primeiro?** ROI absoluto. 2-3 horas de trabalho, zero linha de
código de produto, zero infra. Documenta as decisões sofisticadas que já
existiam no projeto e nunca tinham sido formalizadas — o sinal mais
forte de maturidade que um projeto OSS técnico pode emitir. Converte
"engenheiro curioso" em "contribuidor sério" porque ele pode ler o
**porquê** antes de confiar no **como**.

### O que foi feito

Criamos a pasta `docs/adr/` no formato [MADR](https://adr.github.io/madr/)
com:

- `0000-template.md` — template em branco com Status, Context, Decision,
  Alternatives, Consequences.
- `0001-hcl-parsing-in-the-browser.md` — por que parsing acontece via
  WASM no Web Worker em vez de no servidor.
- `0002-canonical-ir.md` — por que existe uma IR como única fonte de
  verdade em vez de canvas e Monaco se conversarem direto.
- `0003-minimal-patch-via-rawtextrange.md` — por que `Trivia.rawTextRange`
  permite reescrever apenas o range do bloco editado, preservando
  comentários e ordem.
- `0004-yjs-vs-ot.md` — por que CRDT (Yjs) em vez de OT no F3.
- `0005-fastify-vs-express.md` — por que NestJS com adapter Fastify.

Mais tarde nesta rodada acabamos adicionando dois ADRs adicionais
descobertos na execução:

- `0006-plugin-api.md` — racional de `registerProvider` /
  `registerTemplate` (entregue no item 9).
- `0007-cost-via-infracost.md` — por que CLI binária open-source em vez
  da Infracost Cloud (entregue no item 10).

### Escolhas e descartadas

- **MADR vs Nygard clássico.** MADR vence porque tem campos
  `Alternatives` e `Consequences` explícitos — força a escrever o que
  foi descartado, que é onde o valor mora.
- **Pasta `docs/adr/` vs `docs/decisions/`.** Convenção MADR padrão
  usa `adr/`; ferramentas como `adr-tools` esperam isso.

### Bug que esbarramos

Nenhum — pura escrita.

---

## 2 (F2) — Undo / Redo local + atalhos

**Por quê?** Pré-requisito de UX. No instante que o canvas F2 ficar
interativo, o usuário vai pressionar `Ctrl+Z`. Sem isso, a confiança na
ferramenta quebra no primeiro clique. Custa pouco porque o sistema de
`Op` em `packages/ir/src/types.ts` já é invertível por construção
(`add_resource` ↔ `remove_resource`, `set_arg` guarda valor anterior).

### O que foi feito

- **`packages/ir/src/invert.ts`** — implementa `invertOp(prev, op)` e
  `invertOps(prev, ops[])`. Cada caso do switch sabe construir o `Op`
  inverso lendo o estado _anterior_ à aplicação.
- **`packages/ir/src/invert.test.ts`** — testes round-trip:
  `apply(invert(op)) ∘ apply(op) === id`. Cobre `add_resource`,
  `remove_resource`, `set_arg`, `unset_arg`, `rename_resource`,
  `move_node`, `add_edge`, `remove_edge`.
- **`apps/web/src/store/useIRStore.ts`** — store Zustand ganhou:
  - `past: HistoryEntry[]` e `future: HistoryEntry[]` com limite de 50.
  - `apply(ops)` que computa o inverso, empurra `{ forward, inverse }`
    em `past` e zera `future`.
  - `undo()` / `redo()` que pegam o topo da pilha e aplicam.
- **`apps/web/src/components/ShortcutsLayer.tsx`** — registra
  `Ctrl+Z` (undo) e `Ctrl+Shift+Z` / `Ctrl+Y` (redo).
- **`apps/web/src/components/CommandPalette.tsx`** — comandos "Undo"
  e "Redo" listados, desabilitados quando `canUndo()` / `canRedo()` é
  `false`.
- **`apps/web/src/store/useIRStore.test.ts`** — 8 testes do
  comportamento da pilha.

### Escolha-chave: armazenar `{ forward, inverse }`, não só `forward`

A primeira tentativa guardava só `forward` e calculava o inverso
on-demand. **Bug:** depois de um undo de `add_resource`, o nó já não
está no IR — recalcular o inverso na hora "perdia" a operação e o redo
silenciosamente virava no-op.

A correção foi guardar o par `{ forward, inverse }` no momento do
`apply()`, quando `forward` ainda tem todo o contexto. Custa um pouco
mais de memória mas elimina uma classe inteira de bugs.

### Bugs que esbarramos

- **Redo desaparecia depois de undo de `add_resource`** — descrito
  acima. Diff: trocar `Op[][]` por `HistoryEntry[]` com `{ forward,
inverse }`.
- **`apply()` zerava o future em batches sem efeito.** Fix: comparar
  `inverse.length === 0 && next === ir`; se nada mudou, sair sem tocar
  no histórico.

### Compatibilidade futura

Quando F3 trouxer `Y.UndoManager`, o `past`/`future` local vira um
fallback. A API pública (`undo`, `redo`, `canUndo`, `canRedo`) não muda,
então o canvas e o command palette não precisam ser tocados — alinhado
com o ADR [0004 (Yjs vs OT)](./adr/0004-yjs-vs-ot.md).

---

## 3 (F2) — Issue templates, labels, good-first-issues

**Por quê?** Uma hora de configuração, transforma estrelas em PRs
imediatamente. O projeto já tinha `.github/ISSUE_TEMPLATE/` mas faltava
a estrutura de labels que sinaliza onde contribuir.

### O que foi feito

- **`.github/ISSUE_TEMPLATE/bug_report.yml`** — campos `area` e
  `severity` em dropdowns, labels padronizadas (`type:bug`).
- **`.github/ISSUE_TEMPLATE/feature_request.yml`** — campos `area`,
  `phase`, `effort`.
- **`.github/ISSUE_TEMPLATE/new_resource.yml`** — campo `category` e
  link para docs do provider; pré-aplica `good first issue`.
- **`.github/ISSUE_TEMPLATE/question.yml`** — novo template para perguntas
  com link para Discussions e ADRs.
- **`.github/ISSUE_TEMPLATE/config.yml`** — adiciona link para a lista
  filtrada de `good first issue` no rodapé do escolhe-template.
- **`.github/labels.yml`** — schema declarativo: `type:*`, `area:*`,
  `effort:*` (XS/S/M/L), `severity:*`, `status:*`, `good first issue`,
  `help wanted`, `needs design`, `needs docs`. Cada uma com cor
  específica.
- **`.github/workflows/sync-labels.yml`** — usa `EndBug/label-sync@v2`
  para garantir que o repo bata com `labels.yml` (idempotente).
- **`docs/GOOD-FIRST-ISSUES.md`** — backlog curado com 11 tarefas
  detalhadas (catálogo de recursos, docs, UI, templates, testes), cada
  uma com critérios de aceite explícitos.
- **`CONTRIBUTING.md`** — seção "Where to start" linkando o backlog e
  explicando o sistema de labels.

### Escolha-chave: labels como código

`labels.yml` + workflow é melhor que clicar na UI do GitHub porque:

1. PRs podem propor mudanças nas labels.
2. O estado do repo é reproduzível em forks.
3. Se alguém deletar uma label por engano, o próximo `push` na main
   restaura.

### Bug que esbarramos

Nenhum técnico. Risco social: backlog de good-first-issues envelhece
rápido — combinamos no documento que o mantenedor revisa o pool toda
sexta.

---

## 4 (F2) — Parser HCL incremental

**Por quê?** Dívida técnica que vira armadilha em F3. Hoje cada
keystroke re-parseia o HCL inteiro (35-135 ms para ~500 LOC). Em
colaboração real-time isso vira jank visível. A IR já tem
`Trivia.rawTextRange` em `packages/ir/src/types.ts` preparado
exatamente pra isso.

### O que foi feito

- **`packages/hcl/src/incremental.ts`** — `HclIncrementalParser`:
  - Mantém `Map<filename, Map<blockKey, CachedBlock>>` por arquivo.
  - `parse(filename, source)` extrai os ranges textuais dos blocos via
    `scanBlockRanges`, identifica quais bateram com cache (mesmo
    `keyword` + `labels` + texto), reusa esses nós e re-parseia só os
    novos / modificados.
  - Reconstrói **todas** as edges do conjunto final de resources (a
    primeira tentativa preservava edges em cache e isso vazava IDs
    velhos).
- **`packages/hcl/src/incremental.test.ts`** — cobre primeiro parse,
  re-parse byte-idêntico, edição de um bloco só, adição/remoção de
  resources, atualização de `rawTextRange`, invalidação manual e
  igualdade estrutural com o full parser ao longo de uma sequência de
  edições.
- **`packages/hcl/src/worker.ts`** — Web Worker passa a entender
  `parse-incremental` e `invalidate` além do `parse` original.
- **`packages/hcl/src/workerClient.ts`** — `IncrementalWorkerClient` +
  `createIncrementalWorkerClient` na API pública.
- **`packages/hcl/src/bench.test.ts`** — bench dedicado mostrando
  speedup vs full parse no caso comum.

### Escolha-chave: cache por bloco, não por arquivo

A primeira ideia foi cachear o IR inteiro por arquivo e fazer diff. Mas
isso (a) torna o invalidamento muito grosseiro e (b) não reusa nada
quando _qualquer_ byte muda. Cachear por bloco usando `rawTextRange`
como chave de identidade aproveita a granularidade que a IR já modela.

### Bugs que esbarramos

1. **Edges velhas sobreviviam ao re-parse.** Quando um bloco era
   removido, os IDs de resource sumiam mas as edges em cache continuavam
   apontando para eles. Fix: re-derivar **todas** as edges depois de
   stitch, descartando o cache de edges.
2. **Ordem dos resources diferente do full parse.** O `hcl2json`
   alfabetiza por `type` e depois `name`. O incremental preservava ordem
   do source. Fix: aplicar
   `sortResourcesLikeFullParse` / `sortModulesLikeFullParse` no fim.

### Resultado mensurado

Bench `pnpm --filter @blueprint/hcl test` imprime:

```
incremental bench: full median=33.7ms  incremental median=0.0ms  speedup=337.5x
```

---

## 5 (F3) — Storybook 8 + GitHub Pages

**Por quê?** GitHub Pages é gratuito e ilimitado para projetos
públicos. Documenta os 8 componentes do `@blueprint/ui` sem precisar
rodar o monorepo. **Diferença entre 0 PRs de design e 10 PRs por mês.**

### O que foi feito

- **`apps/storybook/`** — novo workspace com:
  - `package.json` — Storybook 8 + `@storybook/react-vite` (não
    webpack, casa com o resto do stack), `@storybook/addon-essentials`,
    `addon-interactions`, `addon-a11y`, `addon-themes`.
  - `.storybook/main.ts` — config + `viteFinal` que ajusta `base` para o
    path do GitHub Pages.
  - `.storybook/preview.tsx` — importa `@blueprint/ui/styles.css`,
    aplica `withThemeByClassName` para toggle dark/light, configura
    `addon-a11y`.
  - `tailwind.config.cjs` reusa o `tailwind-preset` do `@blueprint/ui`.
  - `stories/Introduction.mdx` — overview do design system.
  - `stories/Button.stories.tsx`, `Card`, `Input`, `Badge`, `Avatar`,
    `Modal`, `Logo`, `ProviderIcon`, `Foundations` — 8 componentes +
    tokens.
  - `apps/storybook/README.md`.
- **`.github/workflows/deploy-storybook.yml`** — build + deploy para
  GitHub Pages em todo push na `main`.
- **`.gitignore`** — ignora `storybook-static/`.
- **`eslint.config.js`** — adiciona `**/storybook-static/**` ao `ignores`
  (descoberta dolorosa, ver bug abaixo).

### Escolha-chave: framework Vite (não webpack)

`@storybook/react-vite` reusa o pipeline já estabelecido em
`apps/web` (Vite + plugin-react + tailwindcss). Trocar para webpack
duplicaria configuração de PostCSS, aliases e tipos.

### Bugs que esbarramos

1. **Lint quebrou com 22 mil erros** depois do primeiro build do
   Storybook — ESLint estava entrando no `storybook-static/` (gerado).
   Fix: ignorar a pasta no `eslint.config.js`.
2. **Imports do worker** com warnings de `import/order` foram corrigidos
   reordenando manualmente — convenção do projeto separa imports de
   tipo dos imports de valor.
3. **`Modal.stories.tsx` falhava typechecking** porque a `Story` exigia
   `args` mesmo para componente sem props padrão; resolvido passando
   `args: {}` explícito.

---

## 6 (F3) — Changesets + publish público no npm

**Por quê?** `npm publish` para packages públicos é gratuito
permanentemente. `@blueprint/hcl` e `@blueprint/ir` têm valor enorme
como bibliotecas standalone — qualquer ferramenta TypeScript que toque
Terraform vai querer usar. Cria ecossistema antes do produto principal
sair de beta.

### O que foi feito

- **`@changesets/cli`** adicionado ao root.
- **`.changeset/config.json`** — `access: public`,
  `updateInternalDependencies: patch`, `ignore` lista os apps
  (`@blueprint/web`, `/api`, `/storybook`) que não vão para o npm.
- **`.changeset/README.md`** — guia para contribuidores explicando
  quando precisa de changeset.
- **5 packages públicos** (`ir`, `hcl`, `resources`, `templates`, `ui`)
  ganharam:
  - Removido `private: true`.
  - Adicionado `publishConfig.access: public`, `repository`,
    `homepage`, `bugs`, `keywords`.
  - `sideEffects: false` (ou `["**/*.css"]` em `@blueprint/ui`).
  - Badges npm + Storybook nos READMEs.
- **`docs/RELEASING.md`** — diagrama mermaid do fluxo, checklist do
  contribuidor, instruções para o mantenedor, escape hatch manual.
- **`.github/workflows/release.yml`** — usa `changesets/action@v1`
  para abrir/atualizar a "Version PR" e publicar quando ela é mergeada.
- **`.github/workflows/ci.yml`** — novo job `changeset-check` que falha
  PRs que tocam um package público sem changeset (`changeset status
--since=origin/<base>`).
- **`.changeset/initial-public-release.md`** — primeiro changeset
  cobrindo a release pública inicial dos 5 packages.
- **`CONTRIBUTING.md`** — DoD ganhou item "rode `pnpm changeset` se o
  PR muda comportamento público de um dos packages".

### Escolha-chave: Changesets vs semantic-release

Changesets vence porque:

- **Funciona nativo em monorepo.** Versiona cada package
  independentemente.
- **Decisão é do autor.** O autor do PR escolhe `patch`/`minor`/`major`
  no momento que sabe melhor.
- **Versão acumula via "Version PR".** Mantém uma única PR aberta com
  diff legível antes da publicação.

semantic-release prende a versão ao commit message e quebra mais em
monorepo.

### Bug que esbarramos

`pnpm changeset status` falha localmente por o repo não ter commits na
`main` ainda — o action do GitHub não vai ter esse problema porque roda
contra um clone com history. Documentado em `docs/RELEASING.md` como
"escape hatch manual".

---

## 7 (F4) — Playground `/p/:hash` (LZ-string)

**Por quê?** **A feature de crescimento mais agressiva possível com
custo zero**. IR comprimida em base64url na própria URL → zero banco,
zero backend, zero custo. Cada projeto Terraform no GitHub vira um
funil potencial via badge `Open in Blueprint`. É o
Codepen/JSFiddle da infraestrutura cloud.

### O que foi feito

- **`apps/web/src/features/share/share.ts`** — encoder/decoder com
  envelope versionado:
  - `encodeIR(ir)` → comprime via `compressToEncodedURIComponent` do
    `lz-string`.
  - `decodeIR(hash)` → descomprime, valida envelope, devolve IR.
  - `MAX_SHARE_LENGTH = 6 * 1024` (proxies/Slack truncam acima).
  - `ShareTooLargeError` e `ShareDecodeError` — tipos próprios para
    tratamento explícito.
  - `OPEN_IN_BLUEPRINT_BADGE_URL` exportado para README.
- **`apps/web/src/features/share/useShare.ts`** — hook que encapsula:
  encode + clipboard + ciclo de vida de "copied" (1.6 s) + fallback
  para clipboard indisponível.
- **`apps/web/src/features/share/ShareButton.tsx`** — botão do topbar
  com swap de ícone (Share2 → Check → AlertTriangle), toast inline e
  `aria-live="polite"` para screen readers.
- **`apps/web/src/routes/playground.tsx`** — rota `/p/:hash`:
  - Decodifica via `useMemo`, popula a store via `setIR`.
  - Header com badge "Read-only" e CTA "Fork to edit" → `/dashboard`.
  - `PlaygroundReadyCard` quando OK, `PlaygroundErrorCard` quando
    falhou (com link de "Start blank").
- **`apps/web/src/router.tsx`** — registra `/p/:hash` (lazy).
- **`apps/web/src/features/topbar/Topbar.tsx`** — substitui o `<Button>`
  estático antigo pelo novo `<ShareButton />`.
- **README.md root** — sessão "Open in Blueprint" mostrando o snippet
  Markdown que repos podem colar.
- **`apps/web/src/features/share/share.test.ts`** — 8 testes incluindo
  round-trip, URL-safety, cap de tamanho, payloads malformados,
  envelopes de versão futura.
- **`apps/web/src/test/routes.test.tsx`** — 2 testes adicionais para
  rota válida e malformada.

### Escolha-chave: LZ-string vs Brotli WASM

LZ-string vence porque:

- 3 KB de JS contra ~200 KB de WASM Brotli.
- Já produz base64url — não precisa de etapa adicional de escape.
- Compressão suficiente (60-80% em IRs típicos com keys repetidas).

Brotli daria 5-10% melhor mas o trade de bundle não compensa.

### Escolha-chave: envelope versionado `{ v, ir }`

Sem o `v`, qualquer mudança breaking no formato quebra URLs antigas
silenciosamente. Com o `v`, `decodeIR` rejeita envelopes desconhecidos
com mensagem clara, e podemos manter uma matriz de compat caso
precisemos.

### Bugs que esbarramos

1. **`<Button asChild>` não existe** no `@blueprint/ui` (sem
   `@radix-ui/react-slot`). Tentativa inicial de `<Button asChild>
   <Link>` foi substituída por `<Link>` estilizado direto com classes
   Tailwind equivalentes ao botão.
2. **Badge variant `info` não existia** — trocado por `default`.
3. **`ProductMockup` não aceita `className`** — `<ProductMockup
className="mx-auto" />` foi simplificado para `<ProductMockup />`.
4. **`useParams()` retornava `undefined`** no test renderer porque
   o helper `renderWithRouter` não criava `<Route>`. Adicionei o
   parâmetro `path?: string` opcional ao helper que monta um `<Routes>
<Route path={path} element={ui} /> </Routes>` quando precisa.

---

## 8 (F4) — Import de Terraform existente

**Por quê?** Captura o maior segmento de potenciais usuários — todos
que **já têm Terraform escrito**. O parser já é robusto (100% round-trip
em 75 fixtures), o trabalho é literalmente uma dropzone alimentando o
fluxo existente.

### O que foi feito

- **`apps/web/src/features/import/layout.ts`** — `applyAutoLayout(ir)`
  via `dagre` (já era dep). `LR` por default, atribui x/y e centraliza
  cada nó com base em width/height fixos.
- **`apps/web/src/features/import/tfstate.ts`** — `tfstateToIR(state)`:
  - Filtra apenas `mode === 'managed'` (data sources viram ruído).
  - Whitelist `SAFE_ATTRS` para não despejar 200 atributos computados
    (ARNs, IDs, etc).
  - Reconstrói edges via `instances[].dependencies`.
  - `looksLikeTerraformState` como type-guard liberal.
- **`apps/web/src/features/import/parseUploads.ts`** — orchestrador:
  - Classifica por extensão (`.tf` / `.tfstate` / `.zip`).
  - Expande zip via `JSZip`, pulando `.git/`, `node_modules/`,
    `.terraform/`, `__MACOSX/`.
  - Despacha HCL para o worker, tfstate para o parser interno.
  - Faz merge via `applyPatch` (não `applyOps`!) preservando
    providers/variables/outputs.
  - Cap de 5 MB por arquivo (`MAX_FILE_BYTES`).
- **`apps/web/src/features/import/Dropzone.tsx`** — dropzone acessível
  com input file escondido + área visual de drop. Não dispara `onFiles`
  no hover, só no `drop` ou `change`.
- **`apps/web/src/routes/import.tsx`** — rota `/import`:
  - Spawn de Worker on-demand, terminate no unmount.
  - Status: `idle` → `parsing` → `success` | `error`.
  - Após sucesso, `setIR` + navigate para `/editor/imported`.
- **`apps/web/src/router.tsx`** — registra `/import`.
- **`apps/web/src/routes/landing.tsx`** — adiciona "Import existing
  Terraform" como CTA secundário no hero + microcopy.
- **3 testes**: `layout.test.ts`, `tfstate.test.ts`,
  `parseUploads.test.ts`.

### Escolha-chave: dagre vs ELK

`dagre` (~25 KB sync) vence `ELK` (~600 KB worker) porque:

- Já era dep do `@blueprint/web`.
- Resultado bate com a "Tidy up" futura do canvas.
- Velocidade: layouts triviais terminam em <10 ms.

ELK dá rotas mais bonitas em grafos densos mas o trade não vale para a
fase de import.

### Escolha-chave: merge via `applyPatch`, não loop de `Op`

A primeira tentativa fazia `for r of resources: applyOps([{kind:
'add_resource', node: r}])`. Funcionava para resources mas perdia
`modules`, `providers`, `variables` e `outputs`. A função `applyPatch`
do `@blueprint/ir` aceita um `IRPatch` com tudo isso — uma chamada,
zero campos perdidos.

### Bugs que esbarramos

1. **Não existe `Op` `add_module`** — descoberto na primeira tentativa
   (ver acima). Resolvido com `applyPatch`.
2. **ESLint no apostrofo da microcopy** — `editor's "Tidy up"` virou
   `editor&apos;s &ldquo;Tidy up&rdquo;` para passar
   `react/no-unescaped-entities`.
3. **Test typecheck reclamava de `fork[0].getAttribute(...)`** —
   `fork[0]` é `HTMLElement | undefined`. Fix: optional chaining
   (`fork[0]?.getAttribute(...)`).

---

## 9 (F5) — Plugin API para providers e templates

**Por quê?** O que diferencia projetos que chegam a 5k estrelas dos que
chegam a 50k. Kubernetes avançado, VMware, Oracle, Cloudflare — a
comunidade implementa se houver API limpa. O `defineResource` em
`packages/resources/src/aws/*.ts` já é praticamente uma plugin API;
faltava exportar como pública.

### O que foi feito

- **`packages/resources/src/registry.ts`** — registry de providers
  comunitários:
  - `registerProvider({ provider, resources, displayName? })` — idempotente
    em `(provider, type)`, append-only por default.
  - `setProviderResources` — replace wholesale (escape hatch).
  - `unregisterProvider`, `clearProviderRegistry`.
  - `getRegisteredProviders`, `getRegisteredCatalog`.
- **`packages/resources/src/index.ts`** — atualizado:
  - `coreResources` (frozen) substitui semanticamente `allResources`.
  - `getAllResources()` é a view ao vivo (core + registry).
  - `findResourceDef(type)` consulta core + registry.
  - **Backwards-compat preservada:** `allResources`, `resourcesByType`,
    `resourcesByProvider` continuam apontando para o core, então
    nenhum caller existente quebra.
- **`packages/templates/src/registry.ts`** — análogo para templates,
  chaveado por `slug` (last-write-wins).
- **`packages/templates/src/index.ts`** — análogo (`coreTemplates`,
  `getAllTemplates`, `findTemplate`).
- **`packages/resources/src/registry.test.ts`** + **`packages/templates/src/registry.test.ts`** — 13 testes.
- **`docs/CREATING-A-PROVIDER.md`** — tutorial passo-a-passo:
  TL;DR Cloudflare, naming conventions
  (`@blueprint-provider/<name>`, `@blueprint-template/<slug>`),
  checklist de resource e template, tabela de stability promise.
- **`docs/adr/0006-plugin-api.md`** — ADR documentando a decisão entre
  codegen build-time, DI container e runtime registry (e por que
  escolhemos o último).
- **`.changeset/plugin-api.md`** — changeset minor para os dois
  packages.

### Escolha-chave: runtime registry (não codegen)

Três opções consideradas:

1. **Status quo** — vendors forkam o monorepo. Hostil a contribuição.
2. **Codegen build-time** — `blueprint.config.ts` lista plugins, CLI
   gera `allResources.generated.ts`. Adiciona dep de CLI, impossibilita
   plugin de browser extension.
3. **Runtime registry** — `registerProvider({})` mutates Map global.

Escolhemos #3. Idempotência em `(provider, type)` cuida do HMR. Custo:
plugins precisam rodar **antes** do canvas montar (documentado).

### Escolha-chave: backwards-compat 100%

`allResources`, `resourcesByType`, `templatesBySlug`, `allTemplates`
foram **mantidos** apontando para o core. Quem importa esses não
precisa mudar nada. O sinal "use isso para novo código" fica nos
helpers `getAllResources()` / `getAllTemplates()` / `findResourceDef`
/ `findTemplate`.

### Bug que esbarramos

`registerProvider({ resources: [a, a] })` (duplicata na mesma chamada)
ainda registrava 2 entries — o filtro de `knownTypes` só cobria entries
existentes. Fix: marcar tipos vistos _durante_ a iteração também.

---

## 10 (F5) — Estimativa de custo via Infracost CLI

**Por quê?** Muda a proposta de valor de "ferramenta visual" para
"ferramenta de decisão". O CLI `infracost breakdown` é Apache 2.0 e
roda local — zero custo e zero dependência de SaaS (a Infracost Cloud
é o produto pago deles, mas não é necessária para preços públicos
AWS/Azure/GCP).

### O que foi feito

**Backend (`@blueprint/api`):**

- **`apps/api/src/modules/cost/cost.types.ts`** — tipos do contrato
  HTTP: `CostEstimateResponse`, `ResourceCost`, `bucketForMonthlyCost`
  (free / low / medium / high — espelhado no front).
- **`apps/api/src/modules/cost/cost.service.ts`** — `CostService`:
  - Dois modos via env: **disabled** (default) e **local-binary**
    (`BLUEPRINT_COST_ENABLED=1`).
  - Disabled retorna response estruturalmente válido com `warning`
    explicando como ligar.
  - Enabled spawna `infracost breakdown --path <tmp> --format json`
    com timeout de 30 s, stdio piped, kill em SIGTERM no timeout.
  - Cap de 500 resources por request.
  - Falhas (binário não existe, exit code != 0, JSON malformado)
    degradam para warning sem propagar exceção — UI nunca quebra.
  - Limpa o tmp dir no `finally`.
- **`apps/api/src/modules/cost/cost.module.ts`** — controller `POST
/cost-estimate` com Zod schema permissivo (passthrough) na entrada.
- **`apps/api/src/app.module.ts`** — registra `CostModule`.
- **`apps/api/src/modules/cost/cost.service.test.ts`** — 6 testes:
  modos disabled/enabled, binário inexistente, parsing de JSON do
  Infracost com componentes, classificação em buckets.

**Frontend (`@blueprint/web`):**

- **`apps/web/src/features/cost/costSchema.ts`** — Zod schema espelhando
  o contrato + `bucketForMonthlyCost` + `addressFor`.
- **`apps/web/src/features/cost/useCostEstimate.ts`** — hook:
  - Debounce 800 ms.
  - `AbortController` por request, cancela inflight quando IR muda.
  - `requestId` monotônico para descartar respostas tardias de IRs
    velhas.
  - `ApiError` com `code === 'network_unavailable'` → mensagem
    amigável; outros erros mostram `err.message`.
- **`apps/web/src/features/cost/CostBadge.tsx`** — `CostBadge` (por
  resource) e `CostTotalBadge` (topbar). Color-coded por bucket,
  formatação `Intl.NumberFormat` USD, tooltip nativo + `aria-label`.
- **`apps/web/src/features/cost/index.ts`** — barrel.
- **`apps/web/src/features/topbar/Topbar.tsx`** — adiciona `useCostEstimate`
  - `<CostTotalBadge>` que só renderiza quando o provider é
    `'infracost'` (não polui UI quando desligado).
- **3 arquivos de teste** (`costSchema.test.ts`,
  `useCostEstimate.test.ts`, `CostBadge.test.tsx`) — 16 testes.

**Infra:**

- **`infra/docker-compose.yml`** — serviço opcional `infracost` no
  profile `cost`. Pinned em `infracost/infracost:ci-0.10`. Comando
  `tail -f /dev/null` mantém container vivo para `docker exec`. Volume
  `infracost-workspace` compartilhado.
- **`infra/README.md`** — seção "Estimativa de custo (opcional)" com
  passo-a-passo.
- **`package.json`** root — scripts `infra:up:cost` e `infra:down`
  inclui profile `cost` e `tools` para shutdown limpo.

**Docs:**

- **`docs/adr/0007-cost-via-infracost.md`** — ADR documentando: por
  que CLI binária e não SaaS, alternativas descartadas (AWS Pricing
  API, Vantage, banco próprio, Infracost SaaS), trade-offs assumidos
  (process-spawn por request, sem cache).

### Escolha-chave: process-spawn vs HTTP sidecar

Sidecar HTTP precisaria de wrapper custom em volta do CLI — Infracost
não tem servidor HTTP nativo. Process-spawn por request é stateless,
testável (mockável via spy em `runInfracost`), e a latência (~2-3 s
para 50 resources) é compatível com o debounce de 800 ms já no front.

### Escolha-chave: dois modos via env

`BLUEPRINT_COST_ENABLED=1` para acender, default desligado. Permite que
**todo o código sempre rode** em produção e dev — quem não quer custo
nunca vê o feature, e a regressão "esqueci o env" produz só um warning
amigável, não um 500.

### Bugs que esbarramos

1. **Tests com `vi.useFakeTimers()` + `waitFor()` deram timeout em 5s.**
   `waitFor` usa real time enquanto fake timers congela `setTimeout`.
   Conflito clássico. Fix: rewrote os testes com `flushMicrotasks()`
   helper que faz `await Promise.resolve()` 4-10x para drenar a
   resolution chain depois de `vi.advanceTimersByTime`.
2. **`import/order` warnings** depois de mover `ApiError` para baixo
   do `import type` — ordenação ficou: `react`, locais relativos,
   `import type from npm`, `import type from alias`, `import value
from alias`. Itera 2x até estabilizar.
3. **`@nestjs/common` `Body()` body any** — escolhi `unknown` + Zod
   `.parse()` no controller para ter validação real e mensagem de erro
   estruturada se um caller mandar garbage.

---

## Padrões cross-cutting

Coisas que aprendemos durante a rodada e valem para qualquer PR futuro:

### Convenção de imports

ESLint `import/order` enforça este grupo:

1. Builtin Node (`node:fs/promises`)
2. Externo (`@blueprint/ir`, `react`, `vitest`)
3. Local relativo (`./registry`, `../types`)
4. Tipo local (`type X from`) e tipo externo (`type IR from
'@blueprint/ir'`) **vão para o final**, separados por linha em
   branco.
5. Alias root (`@/lib/api`) vai logo após os locais relativos.

Quando bater warning, `pnpm lint --fix` resolve a maioria; os restantes
são casos onde tipo + valor do mesmo módulo precisam ser desambiguados
manualmente.

### Convenção de teste

- **Vitest 2.1.9** em todos os pacotes.
- Tests ficam **adjacentes ao arquivo testado** (`foo.ts` ↔
  `foo.test.ts`).
- Testes de rota usam `renderWithRouter(ui, { route, path })` —
  passar `path` quando o componente usa `useParams()`.
- Testes que esperam timer + promise: `vi.useFakeTimers()` +
  `flushMicrotasks(n)` em `act()`. **Nunca** `waitFor` em conjunto
  com fake timers.
- Mock de fetch deve usar `global.fetch = vi.fn().mockImplementation(()
=> Promise.reject(...))` no `beforeEach`, restaurando no `afterEach`.

### Convenção de nomes

- **Packages publicados:** `@blueprint/<name>`.
- **Plugins de provider:** `@blueprint-provider/<name>`.
- **Plugins de template:** `@blueprint-template/<slug>`.
- **ADRs:** `NNNN-kebab-case-title.md` em `docs/adr/`.
- **Workflows:** `kebab-case.yml` em `.github/workflows/`.

### Convenção de error handling

Erros que o usuário vê → tipo próprio (`ShareTooLargeError`,
`ShareDecodeError`, `ApiError`) com mensagem útil + `code`.
Nada de `throw new Error('foo')` raso.

UI nunca dá pop em exceção: rotas decodificadoras (`/p/:hash`,
`/import`) sempre têm um state `'error'` com card amigável.

### Convenção de stability promise

Documentada em `docs/CREATING-A-PROVIDER.md` e
`docs/RELEASING.md`. Resumo:

| Surface                                         | Stability                     |
| ----------------------------------------------- | ----------------------------- |
| `defineResource` / `defineTemplate` field shape | **public** — major bumps only |
| `registerProvider` / `registerTemplate`         | **public**                    |
| `getAllResources` / `getAllTemplates`           | **public**                    |
| `clearProviderRegistry`                         | **test-only**                 |

---

## O que ficou de fora (e por quê)

Items da roadmap original que **não** entraram nos top 10:

- **Diff visual de mudanças HCL** — bom complemento do item 6 (npm
  publish), mas não move o ponteiro sozinho. F3.
- **Módulos Terraform visuais** — IR já tem `ModuleNode` e `parentId`.
  Sai naturalmente quando o canvas F2 amadurecer.
- **Grafo de dependências interativo** — valor didático real, mas não
  é porta de entrada de novos usuários. F3.
- **Hardening de segurança da API** — só importa quando houver beta
  público real. Antes é over-engineering. F4.
- **Security policy + SBOM + OpenSSF Scorecard** — badges grátis, vale
  fazer junto com o item 6 quando estabilizar. F4.
- **RFC process via GitHub Discussions** — gratuito. Faz sentido quando
  a Plugin API começar a receber propostas. F3.
- **all-contributors bot** — 30 minutos, vale clipar junto do
  Storybook. F3.
- **Showcase gallery** — depende do Playground (item 7) existir
  primeiro. F5.
- **Docusaurus docs site** — depende dos ADRs (item 1) estabilizarem.
  Por enquanto `docs/` no repo + render do GitHub funciona.

---

## Métricas finais

```
$ pnpm lint
0 warnings, 0 errors

$ pnpm typecheck
13/13 turbo tasks ok  (~5s after cache hit)

$ pnpm test
11/11 turbo tasks ok
  ├─ @blueprint/ir          → 60 tests   (incluindo invert round-trip)
  ├─ @blueprint/hcl         → 112 tests  (roundtrip 88 + property + bench + incremental)
  ├─ @blueprint/resources   → 29 tests   (catalog 22 + registry 7)
  ├─ @blueprint/templates   → 6 tests    (registry)
  ├─ @blueprint/web         → 84 tests   (theme/store/share/cost/import/routes/ui)
  └─ @blueprint/api         → 6 tests    (cost service)
```

Bench da rodada:

```
incremental bench: full median=33.7ms  incremental median=0.0ms  speedup=337.5x
```

Cobertura visível na CI (`.github/workflows/ci.yml`):

- `lint` (eslint, prettier-check)
- `typecheck` (tsc --noEmit)
- `test` matrix Node 20.10 + 22 (Postgres + Redis services)
- `changeset-check` (block PRs sem changeset em packages públicos)
- `build` (turbo build com upload de artefato `web-dist`)
- `e2e` (Playwright + axe)

Cobertura release (`.github/workflows/release.yml`):

- Em todo push na `main`, abre/atualiza "Version PR".
- Merge da Version PR publica os 5 packages no npm + tag git.

---

## Como continuar a roadmap

Próximos passos naturais, agora que os 10 estão fechados:

1. **Habilitar GitHub Pages** no repo settings → Source: GitHub
   Actions. Storybook vai aparecer em
   `https://cloud-blueprint.github.io/cloud-blueprint/`.
2. **Criar o secret `NPM_TOKEN`** (Automation scope) para
   `release.yml` poder publicar.
3. **Criar a org `@blueprint`** no npm e adicionar o token-owner como
   Developer.
4. **Mergear a primeira Version PR** que vai aparecer ao primeiro push
   na `main` — isso publica `@blueprint/ir`, `/hcl`, `/resources`,
   `/templates`, `/ui` 0.1.0 no npm.
5. **Abrir o backlog `docs/GOOD-FIRST-ISSUES.md`** como issues reais
   no GitHub, marcando com `good first issue`.
6. **Subir a primeira community provider** (sugestão: Cloudflare) no
   repo paralelo `cloud-blueprint/community-providers`.
7. **Fazer um vídeo de 90 s** mostrando o sync bidirecional para o
   "Show HN" / Product Hunt do F6.

Cada um desses é menor que cada item desta rodada.
