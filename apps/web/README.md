# @blueprint/web

Frontend do Cloud Infra Blueprint — React 18 + Vite 5 + TypeScript + Tailwind + shadcn.

## Estrutura

```
src/
├── main.tsx                 entry, monta RouterProvider
├── router.tsx               rotas (landing, dashboard, /editor/:id)
├── routes/
│   ├── landing.tsx          marketing
│   ├── dashboard.tsx        lista de projetos
│   ├── editor.tsx           split-pane (palette / canvas / monaco / inspector)
│   └── not-found.tsx
├── features/
│   ├── canvas/              React Flow + custom nodes (F2)
│   ├── editor/              Monaco + y-monaco binding (F3)
│   ├── palette/             paleta drag-from-source
│   ├── inspector/           form gerado do schema Zod
│   ├── topbar/              save / share / export / git
│   └── templates/           galeria de patterns prontos
├── store/
│   └── useIRStore.ts        zustand para a IR atual
├── workers/
│   └── hcl.worker.ts        WebWorker que carrega @cdktf/hcl2json (WASM)
├── lib/
│   └── api.ts               cliente do backend NestJS
└── vite-env.d.ts
```

## Rotas

- `/` — landing page open source.
- `/dashboard` — lista de projetos do user (placeholder até F4).
- `/editor/:projectId` — split-pane com canvas + Monaco.
- `*` — 404.

## Comandos

```bash
pnpm --filter @blueprint/web dev          # vite em :5173
pnpm --filter @blueprint/web build
pnpm --filter @blueprint/web preview
pnpm --filter @blueprint/web test:e2e     # Playwright
```

## Roadmap por fase

- **F0 (atual):** estrutura, rotas, paleta funcional, store IR.
- **F2:** Canvas com React Flow + drag-from-palette + dagre.
- **F3:** Monaco + Yjs + worker HCL ligados via diff IR.
- **F4:** Persistência (autosave, presença).
- **F5:** Galeria de templates + export + GitHub.
- **F6:** Onboarding tour, Sentry, PostHog, Lighthouse > 90.
