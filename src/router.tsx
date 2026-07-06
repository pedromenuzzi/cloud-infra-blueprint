import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, Outlet, useNavigate } from 'react-router-dom';
import { ToastViewport, showToast } from '@/components/Toast';
import { createProject } from '@/lib/storage';
import { readShareFromLocation } from '@/lib/share';

const LandingPage = lazy(() => import('./routes/LandingPage'));
const DashboardPage = lazy(() => import('./routes/DashboardPage'));
const EditorPage = lazy(() => import('./routes/EditorPage'));
const TutorialsPage = lazy(() => import('./routes/TutorialsPage'));
const TutorialPlayerPage = lazy(() => import('./routes/TutorialPlayerPage'));
const NotFoundPage = lazy(() => import('./routes/NotFoundPage'));

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}

function Root() {
  const navigate = useNavigate();

  // serverless share links: #share=<deflated project>
  useEffect(() => {
    const shared = readShareFromLocation();
    if (!shared) return;
    history.replaceState(null, '', location.pathname + location.search);
    const project = createProject({
      name: shared.name,
      files: shared.files,
      description: 'Imported from a share link.',
    });
    showToast(`Imported “${shared.name}” from share link`, 'success');
    navigate(`/editor/${project.id}`, { replace: true });
  }, [navigate]);

  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
      <ToastViewport />
    </>
  );
}

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <Root />,
      children: [
        { index: true, element: <LandingPage /> },
        { path: 'dashboard', element: <DashboardPage /> },
        { path: 'editor/:id', element: <EditorPage /> },
        { path: 'tutorials', element: <TutorialsPage /> },
        { path: 'tutorials/:slug', element: <TutorialPlayerPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
