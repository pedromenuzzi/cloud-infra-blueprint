# @blueprint/storybook

Public Storybook for the **`@blueprint/ui`** design system.

## Live deploy

Every push to `main` that touches `apps/storybook/**` or `packages/ui/**`
publishes a new build to GitHub Pages via
[`.github/workflows/deploy-storybook.yml`](../../.github/workflows/deploy-storybook.yml).

The deployed URL is:

```
https://<your-org>.github.io/cloud-blueprint/
```

(Pages must be enabled in the repository settings — `Settings → Pages →
Source: GitHub Actions`.)

## Local development

```bash
pnpm --filter @blueprint/storybook dev
# Storybook on http://localhost:6006
```

Hot reload picks up changes in:

- `apps/storybook/stories/**` — story files,
- `packages/ui/src/**` — design system source,
- `packages/ui/src/styles.css` — design tokens.

## Adding a story

Every component in `@blueprint/ui` should ship a story. Convention:

1. File at `apps/storybook/stories/<Name>.stories.tsx`.
2. Default story (`Default`) showing the most common usage.
3. `AllVariants` story enumerating every CVA variant.
4. Realistic usage in at least one named story (e.g. `WithIcons`,
   `Group`, `Recoloring`).
5. Pass the a11y panel — no critical or serious axe violations.

See [`docs/DESIGN-SYSTEM.md`](../../docs/DESIGN-SYSTEM.md) for token
conventions.

## What is **not** here

- The web app's editor / canvas / inspector lives in `apps/web` — those are
  full-app surfaces, not design-system primitives.
- Provider icons in `apps/web/public/icons/` are AWS / Azure / GCP brand
  assets and are out of scope for this Storybook.
