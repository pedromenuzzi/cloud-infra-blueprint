# @blueprint/ir

[![npm version](https://img.shields.io/npm/v/@blueprint/ir.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/@blueprint/ir)
[![npm downloads](https://img.shields.io/npm/dm/@blueprint/ir.svg?logo=npm)](https://www.npmjs.com/package/@blueprint/ir)
[![license](https://img.shields.io/npm/l/@blueprint/ir.svg?color=blue)](../../LICENSE)
[![types](https://img.shields.io/npm/types/@blueprint/ir.svg?logo=typescript)](https://www.npmjs.com/package/@blueprint/ir)

> Canonical Intermediate Representation for Cloud Infra Blueprint.

```bash
npm install @blueprint/ir
# or
pnpm add @blueprint/ir
```

A IR é a **única fonte de verdade** do projeto. Tanto o canvas quanto o editor Monaco são projeções dessa estrutura. Esse pacote contém:

- **`types.ts`** — `IR`, `ResourceNode`, `IREdge`, `Expression`, `Trivia`, `Op`, `IRPatch`.
- **`factory.ts`** — helpers (`newResource`, `edge`, `lit`, `ref`, `obj`, `list`, `raw`, `emptyIR`).
- **`graph.ts`** — `applyOp`, `applyOps`, `applyPatch`, `detectCycle`, lookups.
- **`defineResource.ts`** — DSL para declarar recursos no catálogo (`packages/resources`).

Sem dependências runtime além do `zod` (re-exportado para conveniência).

## Exemplo

```ts
import { applyOps, edge, emptyIR, lit, newResource } from '@blueprint/ir';

const vpc = newResource('aws_vpc', 'main', { cidr_block: '10.0.0.0/16' });
const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });

const ir = applyOps(emptyIR(), [
  { kind: 'add_resource', node: vpc },
  { kind: 'add_resource', node: ec2 },
  { kind: 'add_edge', edge: edge(vpc, ec2, 'network') },
  { kind: 'set_arg', nodeId: ec2.id, field: 'instance_type', value: lit('t3.small') },
]);
```

## Princípios

1. **Imutabilidade.** `applyOp` retorna um novo IR. Não muta in-place.
2. **Trivia preservada.** Comentários, posições e ranges textuais sobrevivem ao round-trip.
3. **Escape hatch sempre.** Qualquer expressão complexa pode ser `{ kind: 'raw', hcl: '...' }`.
4. **Provider-agnostic.** AWS / Azure / GCP / Kubernetes compartilham a mesma estrutura.

## Testes

```bash
pnpm --filter @blueprint/ir test
```
