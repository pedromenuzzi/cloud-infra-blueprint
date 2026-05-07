import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

/**
 * Performance notes:
 *
 *   - `optimizeDeps.include` lists the dependencies we KNOW we'll hit on
 *     first paint (router, zustand, lucide). Listing them up-front lets Vite
 *     pre-bundle them into a single ESM module on cold start instead of
 *     resolving N small files lazily. The result is cached in
 *     `node_modules/.vite/` and reused across dev runs.
 *
 *   - `optimizeDeps.exclude` keeps `@cdktf/hcl2json` (WASM) out of the bundler
 *     because esbuild can't process it.
 *
 *   - `manualChunks` is only used by `vite build` (prod). In dev, Vite serves
 *     ESM on demand and these chunks are irrelevant. The split keeps the big
 *     "future" deps (Monaco / React Flow / Yjs) in their own files so the
 *     landing chunk stays small and routes can lazy-load the heavy stuff
 *     only when visited (see `src/router.tsx`).
 */
export default defineConfig({
  plugins: [react(), wasm()],
  resolve: {
    // Custom export condition keeps Vite/Vitest reading the TypeScript
    // sources of @blueprint/* packages directly, so HMR and type errors hit
    // the original files without a rebuild step. Production runs of the API
    // ignore this condition and fall back to dist/ output.
    conditions: ['blueprint:source', 'import', 'module', 'browser', 'default'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.VITE_WS_URL ?? 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1200, // Monaco is ~1MB on its own; legitimate big chunk.
    rollupOptions: {
      output: {
        // Function form so we can match transitive deps (cva/clsx/tailwind-merge
        // come from @blueprint/ui and aren't direct entry points for Rollup).
        // Returning `undefined` lets Rollup keep its default behavior.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](monaco-editor|@monaco-editor)[\\/]/.test(id)) return 'monaco';
          if (/[\\/](@xyflow|dagre)[\\/]/.test(id)) return 'flow';
          if (/[\\/](yjs|y-monaco|y-websocket|y-protocols)[\\/]/.test(id)) return 'yjs';
          if (/[\\/]react-router/.test(id) || /[\\/](react|react-dom)[\\/]/.test(id))
            return 'react-vendor';
          if (/[\\/](zustand)[\\/]/.test(id)) return 'state';
          if (/[\\/](lucide-react|class-variance-authority|clsx|tailwind-merge)[\\/]/.test(id))
            return 'ui';
          if (/[\\/]@fontsource-variable[\\/]/.test(id)) return 'fonts';
          return undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Pre-bundled on cold start. Only direct deps of @blueprint/web —
    // transitive ones (clsx, tailwind-merge, cva) aren't hoisted by pnpm.
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-router-dom',
      'zustand',
      'zustand/middleware',
      'lucide-react',
    ],
    exclude: ['@cdktf/hcl2json'],
  },
});
