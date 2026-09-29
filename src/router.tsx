import { Suspense } from 'react';
import { createBrowserRouter, Outlet, useLocation, useMatch } from 'react-router-dom';
import { AppErrorScreen } from '@/components/AppErrorScreen';
import { ToastViewport } from '@/components/Toast';
import { ConfirmHost } from '@/components/Confirm';
import { ShareLinkHost } from '@/components/ShareLinkHost';
import { StorageNotices } from '@/components/StorageNotices';
import { CommandHost } from '@/features/command/CommandHost';
import { GithubImportHost } from '@/features/import/GithubImportHost';
import { lazyWithReload } from '@/lib/chunkReload';
import { isEmbedHash, isViewHash } from '@/lib/share';

const LandingPage = lazyWithReload(() => import('./routes/LandingPage'));
const ViewPage = lazyWithReload(() => import('./routes/ViewPage'));
const DashboardPage = lazyWithReload(() => import('./routes/DashboardPage'));
const EditorPage = lazyWithReload(() => import('./routes/EditorPage'));
const TutorialsPage = lazyWithReload(() => import('./routes/TutorialsPage'));
const TutorialPlayerPage = lazyWithReload(() => import('./routes/TutorialPlayerPage'));
const NotFoundPage = lazyWithReload(() => import('./routes/NotFoundPage'));
// shares the editor store's chunk — only loaded on /editor
const ProjectConflictHost = lazyWithReload(() => import('@/components/ProjectConflictHost'));

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}

/**
 * `/#view=<project>` is a read-only viewer link: served from the site root
 * (HTTP 200 on every static host, GitHub Pages included) and kept in the
 * fragment, so the server never sees the project.
 */
function IndexRoute() {
  return isViewHash(useLocation().hash) ? <ViewPage /> : <LandingPage />;
}

function Root() {
  const inEditor = useMatch('/editor/:id') !== null;
  // an embedded view (iframe): the diagram only — no palette, no storage banners
  const embed = isEmbedHash(useLocation().hash);
  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
      <ToastViewport />
      {embed ? null : (
        <>
          <StorageNotices />
          <CommandHost />
          <GithubImportHost />
        </>
      )}
      <ConfirmHost />
      <ShareLinkHost />
      {inEditor ? (
        <Suspense fallback={null}>
          <ProjectConflictHost />
        </Suspense>
      ) : null}
    </>
  );
}

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <Root />,
      // a crash in the shell itself
      errorElement: <AppErrorScreen />,
      children: [
        {
          // a crash in any page (or a chunk gone after a deploy) keeps the shell
          errorElement: <AppErrorScreen />,
          children: [
            { index: true, element: <IndexRoute /> },
            { path: 'dashboard', element: <DashboardPage /> },
            { path: 'editor/:id', element: <EditorPage /> },
            { path: 'tutorials', element: <TutorialsPage /> },
            { path: 'tutorials/:slug', element: <TutorialPlayerPage /> },
            { path: '*', element: <NotFoundPage /> },
          ],
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
