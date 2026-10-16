import { Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, useMatch, useParams } from 'react-router-dom';
import { AppErrorScreen } from '@/components/AppErrorScreen';
import { ToastViewport } from '@/components/Toast';
import { ConfirmHost } from '@/components/Confirm';
import { ShareLinkHost } from '@/components/ShareLinkHost';
import { StorageNotices } from '@/components/StorageNotices';
import { CommandHost } from '@/features/command/CommandHost';
import { AutoUpdate } from '@/features/data/AutoUpdate';
import { GithubImportHost } from '@/features/import/GithubImportHost';
import { FromStateHost } from '@/features/deploy/FromStateHost';
import { lazyWithReload } from '@/lib/chunkReload';
import { routeChunk } from '@/lib/routeChunks';
import { isEmbedHash, isViewHash } from '@/lib/share';

const LandingPage = lazyWithReload(routeChunk.landing);
const ViewPage = lazyWithReload(() => import('./routes/ViewPage'));
const DashboardPage = lazyWithReload(routeChunk.dashboard);
const EditorPage = lazyWithReload(routeChunk.editor);
const LearnPage = lazyWithReload(routeChunk.learn);
const LessonPage = lazyWithReload(routeChunk.lesson);
// XP, badges and finished lessons: only on the learning side
const CelebrationHost = lazyWithReload(() => import('@/features/learn/CelebrationHost'));
const NotFoundPage = lazyWithReload(() => import('./routes/NotFoundPage'));
// shares the editor store's chunk — only loaded on /editor
const ProjectConflictHost = lazyWithReload(() => import('@/components/ProjectConflictHost'));

/**
 * A page's chunk on its way (the first load; later navigations keep the
 * current page on screen until the next one is ready). The app's pages keep
 * the rail's place, so nothing jumps when they arrive, and the spinner only
 * fades in when the wait is long enough to notice.
 */
function RouteFallback() {
  const { pathname } = useLocation();
  const railed = /^\/(dashboard|learn)\/?$/.test(pathname);
  return (
    <div className="flex h-full" aria-busy="true">
      {railed ? <div className="w-14 shrink-0 border-r bg-surface-1" aria-hidden="true" /> : null}
      <div className="bp-late flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
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

/** the retired tutorials, each now a lesson of the learning map (old links and bookmarks keep working) */
const TUTORIAL_LESSONS = new Map([
  ['first-vpc-ec2', 'your-vpc'],
  ['static-site-cdn', 's3-bucket-tags'],
  ['refs-become-connections', 'references'],
  ['azure-nesting', 'azure-resource-groups'],
]);

function TutorialRedirect() {
  const lesson = TUTORIAL_LESSONS.get(useParams().slug ?? '');
  return <Navigate to={lesson ? `/learn/${lesson}` : '/learn'} replace />;
}

function Root() {
  const inEditor = useMatch('/editor/:id') !== null;
  const learning = useMatch('/learn/*') !== null;
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
          <FromStateHost />
        </>
      )}
      <ConfirmHost />
      <ShareLinkHost />
      {/* a new version on a screen with nothing in progress: applied without asking */}
      <AutoUpdate />
      {learning ? (
        <Suspense fallback={null}>
          <CelebrationHost />
        </Suspense>
      ) : null}
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
            { path: 'tutorials', element: <Navigate to="/learn" replace /> },
            { path: 'tutorials/:slug', element: <TutorialRedirect /> },
            { path: 'learn', element: <LearnPage /> },
            { path: 'learn/:slug', element: <LessonPage /> },
            { path: '*', element: <NotFoundPage /> },
          ],
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
