import { Suspense } from 'react';
import { lazyWithReload } from '@/lib/chunkReload';
import { useGithubImport } from './githubImportStore';

// the dialog (and the GitHub client) load on first use
const GithubImportDialog = lazyWithReload(() => import('./GithubImportDialog'));

/** Mounted once in the app shell; renders the import dialog while it's open. */
export function GithubImportHost() {
  const open = useGithubImport((s) => s.open);
  const session = useGithubImport((s) => s.session);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <GithubImportDialog key={session} />
    </Suspense>
  );
}
