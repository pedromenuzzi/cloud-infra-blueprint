/**
 * Mounted once by the canvas: the "Add module" dialog (loaded on first
 * use), and the opened module's bar (`ModuleViewBar`, which the canvas
 * puts above its pills). A project switch closes the opened module.
 */
import { Suspense, useEffect } from 'react';
import { useEditor } from '@/features/editor/store';
import { lazyWithReload } from '@/lib/chunkReload';
import { useAddModule } from './addModuleStore';
import { closeModuleView, useModuleView } from './moduleViewStore';

const ModuleView = lazyWithReload(() => import('./ModuleView'));
const AddModuleDialog = lazyWithReload(() => import('./AddModuleDialog'));

export function ModulesHost() {
  const adding = useAddModule((s) => s.open);
  const session = useAddModule((s) => s.session);
  const projectId = useEditor((s) => s.projectId);
  useEffect(() => closeModuleView, [projectId]);
  return <Suspense fallback={null}>{adding ? <AddModuleDialog key={session} /> : null}</Suspense>;
}

/** The opened module's breadcrumb bar; nothing on the root module's canvas. */
export function ModuleViewBar() {
  const opened = useModuleView((s) => s.path.length > 0);
  return opened ? (
    <Suspense fallback={null}>
      <ModuleView />
    </Suspense>
  ) : null;
}
