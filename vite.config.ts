/// <reference types="vitest/config" />
import { readFile } from 'node:fs/promises';
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

/**
 * The page a visit starts on, fetched alongside the entry instead of after it
 * runs: an inline script in index.html adds modulepreload links for that
 * page's chunk and its imports (the landing, the dashboard or the map; a deep
 * link elsewhere, or a link with a fragment, loads as before). Those pages
 * preload the UI font's Latin subset too, so their first paint is in Inter.
 */
const FIRST_PAGES: Record<string, string> = {
  '': 'src/routes/LandingPage.tsx',
  dashboard: 'src/routes/DashboardPage.tsx',
  learn: 'src/routes/LearnPage.tsx',
};
const UI_FONT = /^assets\/inter-latin-wght-normal-[\w-]+\.woff2$/;

function firstPage(): Plugin {
  let base = '/';
  return {
    name: 'cb-first-page',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        if (!bundle) return;
        const chunks = Object.values(bundle).filter((file) => file.type === 'chunk');
        const closure = (from: string[], seen = new Set<string>()): Set<string> => {
          for (const name of from) {
            if (seen.has(name)) continue;
            seen.add(name);
            const chunk = bundle[name];
            if (chunk?.type === 'chunk') closure(chunk.imports, seen);
          }
          return seen;
        };
        const entry = chunks.find((chunk) => chunk.isEntry);
        const loaded = closure(entry ? [entry.fileName] : []);
        const pages: Record<string, string[]> = {};
        for (const [path, module] of Object.entries(FIRST_PAGES)) {
          const page = chunks.find((chunk) => chunk.moduleIds.some((id) => id.endsWith(module)));
          if (!page) this.error(`no chunk for ${module}: update FIRST_PAGES in vite.config.ts`);
          pages[path] = [...closure([page.fileName])].filter((name) => !loaded.has(name));
        }
        const font = Object.keys(bundle).find((name) => UI_FONT.test(name));
        if (!font) this.error('no Inter Latin font file: update UI_FONT in vite.config.ts');
        const script = `(function(){try{var b=${JSON.stringify(base)},p=location.pathname,f=${JSON.stringify(pages)},files=p.indexOf(b.replace(/\\/$/,''))===0&&location.hash.indexOf('=')<0&&f[p.slice(b.length).replace(/\\/$/,'')];if(!files)return;[${JSON.stringify(font)}].concat(files).forEach(function(h,i){var l=document.createElement('link');if(i){l.rel='modulepreload'}else{l.rel='preload';l.as='font';l.type='font/woff2'}l.crossOrigin='';l.href=b+h;document.head.appendChild(l)})}catch(e){}})()`;
        // ahead of the entry and its stylesheet: a classic script after a stylesheet waits for it to load
        const entryTag = /\n(\s*)<script type="module"/;
        if (!entryTag.test(html)) this.error('no entry <script type="module"> in index.html');
        return html.replace(
          entryTag,
          (tag, indent: string) =>
            `\n${indent}<script>${script}</script>${tag}`,
        );
      },
    },
  };
}

/**
 * Monaco's own words (find, suggestions, hovers, its context menu) in the UI
 * language. Monaco 0.52 ships no Portuguese, and its ESM `localize` returns
 * the English it is given: patched, it looks that English up first in the
 * table src/features/editor/monaco/nls.ts keeps on `globalThis`. Applied to
 * the build and to the dev server's pre-bundled copy of Monaco alike.
 */
const MONACO_NLS = /monaco-editor[\\/]esm[\\/]vs[\\/]nls\.js$/;

function localizeMonaco(code: string): string {
  const out = code
    // localize(key, message, ...args)
    .replace('return _format(message, args);', 'return _format(globalThis.__cbMonacoNls?.[message] ?? message, args);')
    // localize2(key, originalMessage, ...args): `original` stays English
    .replace('message = originalMessage;', 'message = globalThis.__cbMonacoNls?.[originalMessage] ?? originalMessage;');
  if (out.split('__cbMonacoNls').length !== 3) {
    throw new Error('monaco-editor/esm/vs/nls.js changed: update localizeMonaco in vite.config.ts');
  }
  return out;
}

function monacoNls(): Plugin {
  return {
    name: 'cb-monaco-nls',
    enforce: 'pre',
    transform(code, id) {
      return MONACO_NLS.test(id) ? localizeMonaco(code) : undefined;
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
    firstPage(),
    monacoNls(),
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
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: 'cb-monaco-nls',
          setup(build) {
            build.onLoad({ filter: MONACO_NLS }, async (args) => ({
              contents: localizeMonaco(await readFile(args.path, 'utf8')),
              loader: 'js',
            }));
          },
        },
      ],
    },
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
