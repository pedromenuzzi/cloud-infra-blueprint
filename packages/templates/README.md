# @blueprint/templates

[![npm version](https://img.shields.io/npm/v/@blueprint/templates.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/@blueprint/templates)
[![npm downloads](https://img.shields.io/npm/dm/@blueprint/templates.svg?logo=npm)](https://www.npmjs.com/package/@blueprint/templates)
[![license](https://img.shields.io/npm/l/@blueprint/templates.svg?color=blue)](../../LICENSE)
[![types](https://img.shields.io/npm/types/@blueprint/templates.svg?logo=typescript)](https://www.npmjs.com/package/@blueprint/templates)

> Patterns prontos que despejam uma IR pré-conectada no projeto.

```bash
npm install @blueprint/templates @blueprint/resources @blueprint/ir
# or
pnpm add @blueprint/templates @blueprint/resources @blueprint/ir
```

Templates **não são bibliotecas**. Eles são macros que geram nós/edges normais que o usuário pode editar livremente depois. O recurso instanciado é igual ao que ele teria criado manualmente arrastando da paleta.

## Templates do MVP

| Slug                  | Nome                   | Provider |
| --------------------- | ---------------------- | -------- |
| `web-app-aws`         | Web App on AWS         | aws      |
| `static-site-aws`     | Static Site on AWS     | aws      |
| `container-stack-aws` | Container Stack on AWS | aws      |
| `web-app-azure`       | Web App on Azure       | azure    |
| `static-site-gcp`     | Static Site on GCP     | gcp      |

## Definindo um template

```ts
import { defineTemplate } from '@blueprint/templates';
import { newResource, edge, ref } from '@blueprint/ir';
import { z } from 'zod';

export const myTemplate = defineTemplate({
  slug: 'my-pattern',
  name: 'My Pattern',
  description: '...',
  provider: 'aws',
  thumbnail: '/templates/my-pattern.png',
  params: z.object({ appName: z.string().default('my-app') }),
  build({ appName }) {
    const a = newResource('aws_vpc', `${appName}-vpc`, { cidr_block: '10.0.0.0/16' });
    return { addResources: [a], addEdges: [] };
  },
});
```

## Critério da Fase 5

> Aplicar template Web App AWS gera 5 recursos válidos com `terraform validate` (testado em CI).

Cada novo template precisa de um teste em `__tests__/` que rode `terraform fmt` + `terraform validate` no `emitIR()` do patch resultante.
