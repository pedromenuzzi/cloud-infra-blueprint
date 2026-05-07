import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

// Variable fonts: one woff2 file per family covers every weight 100-900,
// ships ~50-70 KB compressed and loads asynchronously via Vite's CSS pipeline.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

import '@blueprint/ui/styles.css';

import { router } from './router';
import { ThemeProvider } from './theme';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in index.html');

createRoot(rootEl).render(
  <React.StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </React.StrictMode>,
);
