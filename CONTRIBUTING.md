# Contributing to Cloud Infra Blueprint

Obrigado por considerar contribuir! Esse documento descreve como propor mudanças, abrir PRs e o que é aceito.

## Resumo rápido

1. Abra uma **issue** descrevendo o problema/ideia antes de mexer em código não trivial.
2. Faça um **fork** e crie um branch a partir de `main`: `feat/<descricao-curta>` ou `fix/<descricao-curta>`.
3. Faça commits seguindo [Conventional Commits](#conventional-commits).
4. Garanta que `pnpm lint && pnpm typecheck && pnpm test` passa localmente.
5. Abra o PR usando o template e preencha **todos** os campos.

## Antes de mexer em decisões arquiteturais

Leia os [ADRs em `docs/adr/`](docs/adr/README.md). Eles documentam o **porquê** de cada decisão técnica não-óbvia (parsing no browser, IR canônica, patch mínimo via `rawTextRange`, Yjs vs OT, Fastify vs Express). Mudanças que contradigam um ADR aceito precisam de um novo ADR antes da implementação.

## Setup de desenvolvimento

Veja [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) para o passo a passo completo.

```bash
nvm use            # Node 20.10
corepack enable    # ativa pnpm
pnpm install
cp .env.example .env
pnpm infra:up      # postgres + redis
pnpm db:migrate
pnpm dev
```

## Fluxo de trabalho

### Branches

- `main` — sempre verde, deploy automático para staging.
- `feat/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*`, `test/*` — branches de trabalho.
- Não force-push em `main`. Pode em seu próprio branch de feature.

### PRs pequenos, focados, mergeáveis

Cada PR deve:

- Ter **um único propósito** (não misture refactor com nova feature).
- Caber em **menos de 500 linhas trocadas** quando possível. Se passar muito disso, divida.
- Referenciar a issue/critério de aceite que cumpre (`Closes #42`).
- Passar **lint + typecheck + test** no CI.
- Ter pelo menos **1 review** aprovando antes do merge.

### Conventional Commits

Use o formato `<tipo>(<escopo opcional>): <descrição>`:

```
feat(canvas): add subflow rendering for VPC containers
fix(hcl): preserve trailing comments on round-trip
docs(readme): clarify pnpm install steps
chore(deps): bump @xyflow/react to 12.4.1
refactor(ir): extract Trivia into separate module
test(hcl): add fast-check property test for resource roundtrip
```

Tipos aceitos: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

Escopos sugeridos: `web`, `api`, `ir`, `hcl`, `resources`, `templates`, `ui`, `infra`, `deps`.

### Definition of Done (geral)

Aplicado a qualquer PR que toque em código:

- [ ] Tipagem estrita TypeScript (sem `any` sem comentário justificando).
- [ ] Testes unitários cobrindo o caminho feliz e ao menos um caso de borda.
- [ ] Sem warnings novos no `pnpm lint`.
- [ ] Acessibilidade: contraste AA, navegação por teclado em componentes interativos.
- [ ] README do package atualizado se a API pública mudou.
- [ ] Sem segredos/credenciais no código (use `.env.example`).
- [ ] **Changeset adicionado** se o PR muda comportamento público de `@blueprint/ir`, `@blueprint/hcl`, `@blueprint/resources`, `@blueprint/templates` ou `@blueprint/ui` — rode `pnpm changeset` e commit o `.changeset/*.md` gerado. Veja [`docs/RELEASING.md`](docs/RELEASING.md).

### Testes

| Camada         | Ferramenta              | Onde rodar                          |
| -------------- | ----------------------- | ----------------------------------- |
| Unit           | Vitest                  | `pnpm test`                         |
| Property-based | fast-check (round-trip) | `pnpm --filter @blueprint/hcl test` |
| E2E            | Playwright              | `pnpm test:e2e`                     |
| Lint           | ESLint                  | `pnpm lint`                         |
| Typecheck      | tsc --noEmit            | `pnpm typecheck`                    |

> **Linha vermelha:** todo PR que toque em `packages/hcl` precisa rodar a suite de property-based tests com **1000 iterações** (`pnpm --filter @blueprint/hcl test -- --runs 1000`).

## Por onde começar

Olhe primeiro as issues marcadas como [`good first issue`](https://github.com/cloud-blueprint/cloud-blueprint/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22). Cada uma tem critérios de aceite claros e um ponto de entrada no código.

O backlog estruturado fica em [`docs/GOOD-FIRST-ISSUES.md`](docs/GOOD-FIRST-ISSUES.md) — se a issue que te interessa não está aberta no GitHub, pode ser que esteja esperando alguém pedir. Comente lá ou abra a issue direto.

### Sistema de labels

Toda issue triada recebe três labels:

- **`type:*`** — bug, enhancement, chore, docs, question, rfc.
- **`area:*`** — onde no código (`area:web`, `area:hcl`, `area:resources`, …).
- **`effort:*`** — chute inicial de tamanho (XS < 1h, S 1-4h, M 4-8h, L 1-3d, XL > 3d).

Bugs ganham também `severity:*`. Issues prontas para alguém pegar ganham `good first issue` ou `help wanted`.

O catálogo declarativo de labels vive em [`.github/labels.yml`](.github/labels.yml) — modificar lá, não pelo UI do GitHub.

## Adicionando recursos ao catálogo

`packages/resources/{aws,azure,gcp}/<arquivo>.ts` define recursos via `defineResource()`. Modelo:

```ts
import { z } from 'zod';
import { defineResource } from '@blueprint/ir';

export const awsExample = defineResource({
  provider: 'aws',
  type: 'aws_example',
  category: 'Compute',
  displayName: 'Example',
  icon: '/icons/aws/example.svg',
  schema: z.object({
    name: z.string(),
  }),
  defaults: {},
  ports: { in: [], out: [] },
  emit(res, ctx) {
    return ctx.block('resource', ['aws_example', res.name], { name: res.args.name });
  },
});
```

Cheque [`docs/RESOURCES.md`](docs/RESOURCES.md) para a especificação completa.

## Reportando bugs

Use o template **Bug report**. Inclua:

- Versão do Cloud Blueprint (commit SHA ou tag).
- SO + browser/Node.
- Passos mínimos para reproduzir.
- Esperado vs. observado.
- Logs/screenshots se relevantes.

Bugs de segurança seguem [`SECURITY.md`](SECURITY.md) — **não abra issues públicas**.

## Boas práticas de revisão

Como reviewer:

- Seja gentil. Ataque a ideia, nunca a pessoa.
- Indique severidade: `nit:`, `suggestion:`, `question:`, `blocker:`.
- Aprove com ressalvas se forem nits; exija mudanças só para issues reais.

Como autor:

- Não tome reviews pessoalmente.
- Responda a cada comentário (`done`, `won't fix porque…`, `discussão pendente`).
- Faça squash/cleanup nos commits antes do merge se pedirem.

## Código de Conduta

Este projeto adota o [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Ao participar, você concorda em segui-lo.

## Licença

Ao contribuir, você concorda em licenciar sua contribuição sob a [Apache License 2.0](LICENSE) — a mesma licença do projeto.
