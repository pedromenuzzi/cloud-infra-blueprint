# @blueprint/config

Configurações compartilhadas (ESLint flat config + TSConfig) para todos os pacotes do monorepo.

## Uso — ESLint

`eslint.config.js` no consumer:

```js
import config from '@blueprint/config/eslint/react';
export default config;
```

Variantes:

- `@blueprint/config/eslint/base` — TS puro, sem React, sem Node-globals.
- `@blueprint/config/eslint/react` — herda da base + React + Hooks + Refresh.
- `@blueprint/config/eslint/node` — herda da base + globals de Node.

## Uso — TSConfig

```jsonc
{
  "extends": "@blueprint/config/tsconfig/react.json",
  "compilerOptions": { "outDir": "dist" },
}
```

Variantes:

- `@blueprint/config/tsconfig/base.json`
- `@blueprint/config/tsconfig/react.json` (DOM lib + JSX + Vite)
- `@blueprint/config/tsconfig/node.json` (decorators on, NodeNext)
