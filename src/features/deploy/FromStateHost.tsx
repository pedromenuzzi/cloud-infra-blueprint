import { Suspense } from 'react';
import { lazyWithReload } from '@/lib/chunkReload';
import { useFromState } from './fromStateStore';

// the dialog (and the HCL it writes) load on first use
const FromStateDialog = lazyWithReload(() => import('./FromStateDialog'));

/** Mounted once in the app shell; renders "Create a project from a state" while it's open. */
export function FromStateHost() {
  const open = useFromState((s) => s.open);
  const session = useFromState((s) => s.session);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <FromStateDialog key={session} />
    </Suspense>
  );
}
