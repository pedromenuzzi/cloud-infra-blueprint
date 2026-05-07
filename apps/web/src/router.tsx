import {
  createBrowserRouter,
  Outlet,
  type RouteObject,
  type RouterProviderProps,
} from 'react-router-dom';

import { RouteProgress } from './components/RouteFallback';
import { ShortcutsLayer } from './components/ShortcutsLayer';
import { LandingRoute } from './routes/landing';

/**
 * Routes are split into separate chunks via `lazy:`. The landing page stays
 * eager because it's the most common entry point and we want it visible
 * immediately. Heavy routes (`/editor` will eventually pull Monaco + React
 * Flow + Yjs) only download their JS when actually visited.
 *
 * `RouteProgress` is mounted at the layout level so every navigation gets a
 * tiny top progress bar after a 200ms debounce.
 */
const routes: RouteObject[] = [
  {
    element: (
      <ShortcutsLayer>
        <RouteProgress />
        <Outlet />
      </ShortcutsLayer>
    ),
    children: [
      { path: '/', element: <LandingRoute /> },
      {
        path: '/dashboard',
        lazy: async () => {
          const { DashboardRoute } = await import('./routes/dashboard');
          return { Component: DashboardRoute };
        },
      },
      {
        path: '/editor/:projectId',
        lazy: async () => {
          const { EditorRoute } = await import('./routes/editor');
          return { Component: EditorRoute };
        },
      },
      {
        path: '/p/:hash',
        lazy: async () => {
          const { PlaygroundRoute } = await import('./routes/playground');
          return { Component: PlaygroundRoute };
        },
      },
      {
        path: '/import',
        lazy: async () => {
          const { ImportRoute } = await import('./routes/import');
          return { Component: ImportRoute };
        },
      },
      {
        path: '*',
        lazy: async () => {
          const { NotFoundRoute } = await import('./routes/not-found');
          return { Component: NotFoundRoute };
        },
      },
    ],
  },
];

// Explicit type avoids TS2742 (router builder pulls types from a deeply nested
// @remix-run/router package that isn't a direct dependency of this app).
export const router: RouterProviderProps['router'] = createBrowserRouter(routes);
