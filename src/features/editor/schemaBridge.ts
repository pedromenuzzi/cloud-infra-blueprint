/**
 * Connects the editor to the lazily loaded provider schemas: whenever the
 * project holds a resource of a provider whose schema isn't loaded, fetch it;
 * when one arrives, re-run validation so its warnings show up.
 */
import { validateProject } from '@/ir/validate';
import type { IR } from '@/ir/types';
import { getDef } from '@/resources/registry';
import { requestSchemasFor, useSchemas } from '@/schema/store';
import { useEditor } from './store';

let installed = false;

export function installSchemaBridge() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const request = (ir: IR) => requestSchemasFor(ir.resources.map((r) => r.type));
  request(useEditor.getState().ir);
  useEditor.subscribe((state, prev) => {
    if (state.ir !== prev.ir) request(state.ir);
  });
  useSchemas.subscribe((state, prev) => {
    if (state.revision === prev.revision) return;
    const { ir } = useEditor.getState();
    useEditor.setState({ warnings: validateProject(ir, getDef) });
  });
}
