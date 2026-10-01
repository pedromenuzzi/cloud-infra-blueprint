/**
 * Mounted once by the canvas: the opened-module view (over the canvas) and
 * the "Add module" dialog, each loaded on first use. A project switch closes
 * the view.
 */
import { Suspense, useEffect } from 'react';
import { useEditor } from '@/features/editor/store';
import { lazyWithReload } from '@/lib/chunkReload';
import { useAddModule } from './addModuleStore';
import { closeModuleView, useModuleView } from './moduleViewStore';

const ModuleView = lazyWithReload(() => import('./ModuleView'));
const AddModuleDialog = lazyWithReload(() => import('./AddModuleDialog'));

export function ModulesHost() {
  const opened = useModuleView((s) => s.path.length > 0);
  const adding = useAddModule((s) => s.open);
  const session = useAddModule((s) => s.session);
  const projectId = useEditor((s) => s.projectId);
  useEffect(() => closeModuleView, [projectId]);
  return (
    <Suspense fallback={null}>
      {opened ? <ModuleView /> : null}
      {adding ? <AddModuleDialog key={session} /> : null}
    </Suspense>
  );
}
