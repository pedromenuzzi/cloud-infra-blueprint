import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { type ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * Wraps `render` with a MemoryRouter so route components that use
 * `<Link>` / `useNavigate` work without a full RouterProvider.
 *
 * If `path` is provided, the UI is mounted under a real `<Route>` so
 * `useParams()` resolves correctly. Otherwise the UI is rendered in the
 * router's root, matching previous test ergonomics.
 */
export function renderWithRouter(
  ui: ReactElement,
  { route = '/', path, ...opts }: RenderOptions & { route?: string; path?: string } = {},
): RenderResult {
  const tree = path ? (
    <Routes>
      <Route path={path} element={ui} />
    </Routes>
  ) : (
    ui
  );
  return render(<MemoryRouter initialEntries={[route]}>{tree}</MemoryRouter>, opts);
}
