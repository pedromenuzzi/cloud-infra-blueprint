# Design System — Cloud Infra Blueprint

> A linguagem visual que sustenta o produto inteiro: do canvas técnico ao
> marketing. Tudo o que você desenhar aqui já vai parecer parte do Blueprint.

Os tokens vivem em `packages/ui/src/styles.css` (CSS variables) + Tailwind preset
em `packages/ui/tailwind-preset.cjs`. Cada componente compartilhado mora em
`packages/ui/src/*.tsx` e é exportado por `@blueprint/ui`.

---

## Princípios

1. **Calmo por padrão, intenso quando precisa.** Superfícies neutras, brand
   reservado para ação primária, status colorido apenas para sinalização.
2. **Tipografia faz o trabalho pesado.** Inter Variable (UI) + JetBrains Mono
   Variable (código). Sem text-shadow, sem decoração visual desnecessária.
3. **Densidade semântica.** Os mesmos tokens (`--primary`, `--muted`,
   `--destructive`) carregam intenção tanto no canvas quanto na landing.
4. **Tema é uma feature de primeira classe.** Light, dark e system convivem;
   tudo é HSL em CSS vars para troca instantânea sem reflow.
5. **Acessível por construção.** Contraste WCAG AA, foco visível, landmarks
   semânticas, navegação por teclado em toda interação.

---

## Tokens — superfícies

| Token                  | Light     | Dark      | Uso                          |
| ---------------------- | --------- | --------- | ---------------------------- |
| `--background`         | `#FFFFFF` | `#0B1220` | Base do app, modais          |
| `--surface-1`          | `#F8FAFC` | `#0F172A` | App shell, sidebar, cards    |
| `--surface-2`          | `#F1F5F9` | `#1E293B` | Bandas sutis, chips elevados |
| `--foreground`         | `#0F172A` | `#F8FAFC` | Texto primário               |
| `--muted-foreground`   | `#475569` | `#94A3B8` | Texto secundário             |
| `--border` / `--input` | `#E2E8F0` | `#1F2A3A` | Linhas finas, contornos      |

> Dica: `bg-card` + `border` cobre 95% dos cartões. Quando precisar elevar,
> some `shadow-md` em hover; reserve `shadow-lg` para modais.

## Tokens — brand & status

| Token                        | Hex (light) | Quando usar                                |
| ---------------------------- | ----------- | ------------------------------------------ |
| `--primary`                  | `#2563EB`   | Botão primário, link, foco, "use template" |
| `--primary-hover`            | `#1D4ED8`   | Hover do primary                           |
| `--success`                  | `#10B981`   | Aplicado, conectado, ok                    |
| `--warning`                  | `#F59E0B`   | Drift, atenção, beta                       |
| `--danger` / `--destructive` | `#EF4444`   | Erro, deletar, falha                       |

### Cores de provider

| Token              | Hex       | Provider    |
| ------------------ | --------- | ----------- |
| `--provider-aws`   | `#FF9900` | AWS         |
| `--provider-azure` | `#0078D4` | Azure       |
| `--provider-gcp`   | `#4285F4` | GCP         |
| `--provider-multi` | `#7C3AED` | Multi-cloud |

Use `<ProviderIcon provider="aws" />` para o glifo oficial. Para badges
genéricas, `<Badge variant="aws">` aplica fundo + texto coerentes com a marca.

## Tipografia

```
Inter Variable          → UI / texto / títulos
JetBrains Mono Variable → código, kbds, props técnicos
```

- Importadas via `@fontsource-variable/inter` e `@fontsource-variable/jetbrains-mono` —
  zero dependência de Google Fonts em runtime.
- Features ativadas: `cv02`, `cv03`, `cv11`, `ss01`, `ss03`, `rlig`, `calt`.
- Escala: `text-xs` (12) · `text-sm` (14) · `text-base` (16) · `text-lg` (18) ·
  `text-xl` (20) · `text-2xl` (24) · `text-3xl` (30) · `text-4xl` (36).
- Pesos canônicos: 400 (corpo), 500 (UI), 600 (títulos), 700 (hero).

## Espaçamento, raio e sombra

| Categoria    | Token           | Valor                   |
| ------------ | --------------- | ----------------------- |
| Raio padrão  | `--radius`      | 10px                    |
| Raio pequeno | `--radius-sm`   | 6px                     |
| Raio grande  | `--radius-lg`   | 14px                    |
| Sombra `xs`  | `--shadow-xs`   | hairline elevation      |
| Sombra `sm`  | `--shadow-sm`   | cards default           |
| Sombra `md`  | `--shadow-md`   | hover, popovers         |
| Sombra `lg`  | `--shadow-lg`   | modais, command palette |
| Glow brand   | `--shadow-glow` | foco em CTA primário    |

Espaçamento segue Tailwind (`space-*`, `gap-*`); densidade preferida é `4` para
listas e `6` para seções.

## Componentes (`@blueprint/ui`)

| Componente               | Variantes                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `Button`                 | `primary`, `secondary`, `ghost`, `outline`, `destructive` · `sm`, `md`, `lg`, `icon` |
| `Card`                   | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`    |
| `Input`                  | Texto + `aria-invalid` ready, `prefix`, `suffix`                                     |
| `Badge`                  | `default`, `success`, `warning`, `danger`, `outline`, `aws`, `azure`, `gcp`, `multi` |
| `Avatar` / `AvatarGroup` | Iniciais coloridas determinísticas, ring opcional, overflow `+N`                     |
| `Logo`                   | `mark`, `wordmark`, `full` em qualquer tamanho                                       |
| `ProviderIcon`           | Marca oficial AWS/Azure/GCP em tamanhos uniformes                                    |
| `Modal`                  | Trap de foco, fecha com `Esc` / overlay, `aria-labelledby` automático                |

Todos os componentes:

- Exportam refs (`forwardRef`).
- Recebem `className` via `cn(...)` para merge ergonômico.
- Adotam `focus-visible` em vez de `focus`.
- São testados em `apps/web/src/test/ui.test.tsx` (Testing Library + axe básico).

## Padrões de interação

### Atalhos globais

| Tecla              | Ação                      |
| ------------------ | ------------------------- |
| `Ctrl+K` / `Cmd+K` | Abrir Command Palette     |
| `?`                | Mostrar Cheat Sheet       |
| `/`                | Focar na busca            |
| `Esc`              | Fechar palette/modal/help |

Tudo emparelhado em `apps/web/src/components/ShortcutsLayer.tsx` para que a
intenção fique clara em um arquivo só.

### Empty states

- Sempre com ícone neutro + uma frase humana + 1 CTA primário.
- Exemplo canônico: "Nenhum projeto ainda — comece de um template" no Dashboard.

### Estado offline

- Banner discreto (`Badge variant="warning"`) explicando "Offline mode" quando a
  API não responder. Os hooks (`useTemplates`, `useProjects`) caem para dados
  embutidos.

### Hierarquia de heading

```
landing/dashboard/templates : h1 → h2 → h3
editor                      : h1 sr-only (na main) → h2 (paneis)
```

Manter essa ordem é o que mantém o axe-core verde nos testes E2E.

## Como adicionar um componente novo

1. Crie `packages/ui/src/MyThing.tsx`. Use `forwardRef`, `cn(...)`, tokens.
2. Exporte em `packages/ui/src/index.ts`.
3. Cubra com testes em `apps/web/src/test/ui.test.tsx` (render + props +
   acessibilidade).
4. Documente o componente acima na tabela "Componentes".
5. Se o componente introduzir uma cor nova, prefira derivar da paleta de tokens
   existentes (`primary`, `accent`, etc); só adicione token novo se realmente
   for um conceito de produto distinto.

## Referência visual

A paleta, tipografia, raios, sombras e estilos de componente foram desenhados
para casar com as referências do produto:

- **01 / 02** — split editor (canvas + Monaco)
- **03** — dashboard com listagem de projetos
- **04** — modal de templates
- **05** — landing
- **06** — design system canônico (este documento é a tradução em código)
