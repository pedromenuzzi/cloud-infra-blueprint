# @blueprint/ui

[![npm version](https://img.shields.io/npm/v/@blueprint/ui.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/@blueprint/ui)
[![npm downloads](https://img.shields.io/npm/dm/@blueprint/ui.svg?logo=npm)](https://www.npmjs.com/package/@blueprint/ui)
[![license](https://img.shields.io/npm/l/@blueprint/ui.svg?color=blue)](../../LICENSE)
[![types](https://img.shields.io/npm/types/@blueprint/ui.svg?logo=typescript)](https://www.npmjs.com/package/@blueprint/ui)
[![Storybook](https://img.shields.io/badge/storybook-live-ff4785?logo=storybook&logoColor=white)](https://cloud-blueprint.github.io/cloud-blueprint/)

Design-system seed compartilhado entre os apps. Construído sobre Tailwind + convenções shadcn/ui.

```bash
npm install @blueprint/ui
# or
pnpm add @blueprint/ui
```

> Veja todos os componentes ao vivo no [Storybook publicado](https://cloud-blueprint.github.io/cloud-blueprint/).

- `cn(...)` — combina classNames com `clsx` + `tailwind-merge`.
- `Button`, `Card`, `Input` — primitivas com variantes via `class-variance-authority`.
- `tailwind-preset.cjs` — preset Tailwind com tokens (cores, radius, container).
- `styles.css` — variáveis CSS para light/dark + reset.

## Uso

```tsx
import { Button, Card, CardContent, cn } from '@blueprint/ui';
import '@blueprint/ui/styles.css';
```

No `tailwind.config.js` do app:

```js
module.exports = {
  presets: [require('@blueprint/ui/tailwind-preset')],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};
```

## Roadmap pós-MVP

À medida que o canvas/inspector crescerem, adicionamos: `Dialog`, `Tabs`, `Tooltip`, `Toast`, `Select`, `Switch`, `Slider`, `Sheet` (todos seguindo o estilo shadcn).
