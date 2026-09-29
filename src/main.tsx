import './lib/devRafShim';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/global.css';
import './theme/useTheme';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { registerServiceWorker } from './features/data/pwa';
import { UpdatePrompt } from './features/data/UpdatePrompt';
import { installChunkRecovery } from './lib/chunkReload';
import { router } from './router';

// an old tab after a deploy: reload once for the new chunks instead of crashing
installChunkRecovery();
// offline app + "Update available" prompt (production builds only)
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
    <UpdatePrompt />
  </StrictMode>,
);
