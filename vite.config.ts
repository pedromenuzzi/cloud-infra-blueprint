/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Heavy lazy build files kept OUT of the service worker's precache (the app
 * shell), by name prefix under assets/: Monaco (the CodePane chunk, its CSS,
 * the codicon font, the editor worker) and ELK. They are runtime-cached the
 * first time the app loads them, and fetched while idle once the dashboard
 * or editor has been opened (src/features/data/pwa.ts, via lazy-assets.json),
 * so the editor works offline after one online visit.
 */
const LAZY_HEAVY = ['CodePane-', 'codicon-', 'editor.worker-', 'elk.bundled-'];
/**
 * The provider schemas (src/schema/data/*.json: resources, and data sources in
 * `<provider>.data.json`) are kept out of the precache too: a project only
 * needs its own provider's, which is
 * runtime-cached when first loaded. Offline without it the editor falls back
 * to the catalog (src/schema/store.ts).
 */
const SCHEMA_CHUNKS = ['aws-', 'azurerm-', 'google-', 'aws.data-', 'azurerm.data-', 'google.data-'];
/** Font subsets for scripts other than Latin: cached when a page first needs them. */
const RARE_FONT_SUBSETS = ['cyrillic', 'greek', 'vietnamese'];

/** Emits lazy-assets.json: the LAZY_HEAVY files of this build, for the idle cache warm-up. */
function lazyAssetsManifest(): Plugin {
  return {
    name: 'cb-lazy-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((file) => LAZY_HEAVY.some((prefix) => file.startsWith(`assets/${prefix}`)))
        .sort();
      // a renamed module must not silently drop Monaco or ELK from offline support
      for (const prefix of ['CodePane-', 'editor.worker-', 'elk.bundled-']) {
        if (!files.some((file) => file.startsWith(`assets/${prefix}`))) {
          this.error(`no build file starts with assets/${prefix} — update LAZY_HEAVY in vite.config.ts`);
        }
      }
      // …nor silently put a provider schema back into every visitor's precache
      for (const prefix of SCHEMA_CHUNKS) {
        if (!Object.keys(bundle).some((file) => file.startsWith(`assets/${prefix}`) && file.endsWith('.js'))) {
          this.error(`no build file starts with assets/${prefix} — update SCHEMA_CHUNKS in vite.config.ts`);
        }
      }
      this.emitFile({ type: 'asset', fileName: 'lazy-assets.json', source: `${JSON.stringify(files)}\n` });
    },
  };
}

// VITE_BASE lets CI (e.g. GitHub Pages) build under a sub-path.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    lazyAssetsManifest(),
    // build-time only: generates dist/sw.js (Workbox); the app registers it itself (pwa.ts)
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // public/manifest.webmanifest is the manifest (index.html links it)
      manifest: false,
      workbox: {
        // the app shell: every page, style and script except the heavy lazy ones and the schemas
        globPatterns: ['**/*.{html,js,css,svg,png,woff2,webmanifest}'],
        globIgnores: [
          ...LAZY_HEAVY.map((prefix) => `assets/${prefix}*`),
          ...SCHEMA_CHUNKS.map((prefix) => `assets/${prefix}*.js`),
          ...RARE_FONT_SUBSETS.map((subset) => `assets/*-${subset}-*.woff2`),
          'og-image.png',
          '404.html',
          '**/workbox-*.js',
        ],
        // deep links (/editor/…) open from the cached shell; files keep going to the network
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/[^/]+\.[a-z0-9]+$/i],
        // the first visit's lazy chunks already go through the worker (and into its cache)
        clientsClaim: true,
        // an update waits for the user's "Reload" (the open tab keeps its version)
        skipWaiting: false,
        cleanupOutdatedCaches: true,
        sourcemap: false,
        runtimeCaching: [
          {
            // hashed build files never change: cache first. Monaco, ELK and rare font subsets live here.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/assets\/[^/]+\.(?:js|css|woff2|ttf)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'cb-assets',
              expiration: { maxEntries: 60, purgeOnQuotaError: true },
              // hashed and immutable: a `Vary: Origin` must not split the idle warm-up's
              // fetch() from the module import that needs it later
              matchOptions: { ignoreVary: true },
              plugins: [
                {
                  // never keep an HTML page (a host's 404 or SPA fallback) as a script
                  cacheWillUpdate: async ({ response }) =>
                    response.status === 200 && !(response.headers.get('content-type') ?? '').includes('text/html')
                      ? response
                      : null,
                },
              ],
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
