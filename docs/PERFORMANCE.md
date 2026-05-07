# Performance budget

> Mantra: every kilobyte and every millisecond counts. The web app must feel
> instantaneous at every interaction, even on mid-tier hardware.

## Bundle budget (web)

Measured via `pnpm --filter @blueprint/web build` (Vite 5, Rollup minified +
gzipped). Numbers below are **upper bounds** — anything beyond requires a
documented justification in the PR.

| Bundle                                          | Budget (gzip)   | Current | Headroom |
| ----------------------------------------------- | --------------- | ------- | -------- |
| Initial route (`index` + `ui` + `react-vendor`) | **≤ 100 kB**    | ~88 kB  | 12%      |
| `react-vendor` chunk                            | ≤ 75 kB         | 67 kB   | 11%      |
| `ui` chunk (`@blueprint/ui` + lucide)           | ≤ 15 kB         | 10.8 kB | 28%      |
| Editor route (lazy)                             | ≤ 30 kB         | 21.7 kB | 28%      |
| Dashboard route (lazy)                          | ≤ 10 kB         | 6.1 kB  | 39%      |
| Total CSS                                       | ≤ 12 kB         | 7.1 kB  | 41%      |
| Fonts (subset, latin)                           | ≤ 60 kB initial | 48 kB   | 20%      |

> Editor + `react-vendor` are loaded on demand via React Router lazy routes.
> Landing and Dashboard never request the editor bundle.

## Runtime budget

| Metric                                   | Target            | Measured  |
| ---------------------------------------- | ----------------- | --------- |
| Time to Interactive (Landing, dev box)   | < 1.5 s           | ~700 ms   |
| First contentful paint                   | < 1.0 s           | ~400 ms   |
| Theme switch latency                     | < 16 ms (1 frame) | ~8 ms     |
| Command Palette open latency             | < 50 ms           | ~20 ms    |
| HCL parse + emit (~500 LOC)              | < 80 ms median    | 35–135 ms |
| Round-trip property test (1000 iter, CI) | < 30 s            | ~15 s     |

## Strategy

1. **Lazy route chunks.** Every route in `apps/web/src/router.tsx` is `lazy()`
   so the landing payload doesn't carry editor code.
2. **Manual chunking.** `vite.config.ts` splits `react-vendor` and `ui`
   explicitly to keep cache hits across navigations.
3. **Variable fonts subset.** Only `latin` + `latin-ext` load on initial paint;
   other subsets are loaded on demand by the browser when needed.
4. **No CSS-in-JS runtime.** Tailwind generates a single, tree-shaken stylesheet.
5. **Anti-flash theme.** A small inline script in `index.html` reads the saved
   theme before React hydrates so users never see a flicker.
6. **WASM HCL parser deferred.** `@cdktf/hcl2json` is `optimizeDeps.exclude`d
   and loaded inside a Web Worker on the editor route — landing is unaffected.
7. **Offline-first hooks.** `useTemplates` / `useProjects` show data in < 50 ms
   even with the API down, avoiding spinner pop-in.
8. **Avoid heavy dependencies for ergonomics.** No `cmdk`, no `radix` (yet) —
   our Command Palette / Modal / Theme menu are ~3 KB hand-rolled.

## How to audit

```bash
# Build and look at the chunk table.
pnpm --filter @blueprint/web build

# Visualise chunks with rollup-plugin-visualizer (one-off, dev dep).
pnpm --filter @blueprint/web add -D rollup-plugin-visualizer
# add to vite.config.ts -> plugins, then `pnpm build` and open dist/stats.html

# Lighthouse run (manual, Chrome DevTools).
pnpm --filter @blueprint/web preview
# open http://localhost:4173 in incognito + Lighthouse > Performance + A11y.
```

Targets for Lighthouse on Landing/Dashboard:

| Category       | Target |
| -------------- | ------ |
| Performance    | ≥ 95   |
| Accessibility  | ≥ 95   |
| Best practices | ≥ 95   |
| SEO            | ≥ 95   |

## When the budget breaks

- Open an issue with the bundle table (current vs. budget) and the suspected
  cause. Tag `perf`.
- Try the cheap fixes first:
  - Lazy-import the offending module (`const X = lazy(() => import('…'))`).
  - Split the chunk with a `manualChunks` rule.
  - Subset the asset (fonts, icons).
- If none works, raise the budget **with the table updated in this file** and
  call it out in the PR description.
