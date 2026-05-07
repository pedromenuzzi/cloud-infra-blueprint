# @blueprint/hcl

[![npm version](https://img.shields.io/npm/v/@blueprint/hcl.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/@blueprint/hcl)
[![npm downloads](https://img.shields.io/npm/dm/@blueprint/hcl.svg?logo=npm)](https://www.npmjs.com/package/@blueprint/hcl)
[![license](https://img.shields.io/npm/l/@blueprint/hcl.svg?color=blue)](../../LICENSE)
[![types](https://img.shields.io/npm/types/@blueprint/hcl.svg?logo=typescript)](https://www.npmjs.com/package/@blueprint/hcl)

> HCL parser e emitter para a IR canônica do Cloud Infra Blueprint.

```bash
npm install @blueprint/hcl @blueprint/ir
# or
pnpm add @blueprint/hcl @blueprint/ir
```

## Visão geral

| Função           | Quem implementa                                           |
| ---------------- | --------------------------------------------------------- |
| **HCL → IR**     | `@cdktf/hcl2json` (WASM, em WebWorker)                    |
| **IR → HCL**     | Emitter próprio com indentação estável + escape correto   |
| **Patch mínimo** | Re-emite só o range textual do bloco editado (Yjs aplica) |
| **Round-trip**   | Property-based via `fast-check` (≥ 1000 iterações em CI)  |

## API pública

```ts
import {
  parse, // (files, adapter) -> Promise<IR>
  emitIR, // (ir) -> { 'main.tf': '...', ... }
  emitResource,
  expr,
  createWorkerAdapter, // browser
  createNodeAdapter, // tests / API
} from '@blueprint/hcl';
```

## Uso no browser

```ts
import { parse, createWorkerAdapter } from '@blueprint/hcl';

const worker = new Worker(new URL('@blueprint/hcl/worker', import.meta.url), {
  type: 'module',
});
const adapter = createWorkerAdapter(worker);

const ir = await parse({ 'main.tf': source }, adapter);
```

> O worker carrega o WASM `@cdktf/hcl2json` na primeira chamada. Mantenha-o vivo entre edições para evitar re-init.

## Uso em Node

```ts
import { parse, createNodeAdapter } from '@blueprint/hcl';

const adapter = await createNodeAdapter();
const ir = await parse({ 'main.tf': source }, adapter);
```

## Garantias do round-trip

- **Trivia preservada.** Comentários `# ...` e `//` ficam nas listas `leadingComments` / `trailingComments`. Posições x,y do canvas são serializadas como comentário especial `# @blueprint:pos=120,340`.
- **Patch mínimo.** Edições no canvas reescrevem só o range textual do bloco afetado (`trivia.rawTextRange`). Resto do arquivo intacto.
- **Escape hatch.** Qualquer expressão que o parser não modela vira `{ kind: 'raw', hcl: '...' }` e é emitida verbatim.

> ⚠️ **Linha vermelha:** todo PR que toque neste pacote precisa rodar `pnpm test -- --runs 1000` (1000 iterações de property-based) — ver `CONTRIBUTING.md`.
