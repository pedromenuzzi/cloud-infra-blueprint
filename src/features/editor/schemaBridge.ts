/**
 * Connects the editor to the lazily loaded provider schemas: whenever the
 * project holds a resource (or a `data` block) of a provider whose schema
 * (or data-source schema) isn't loaded, fetch it; when one arrives, re-run
 * validation so its warnings show up.
 */
import { moduleDiagnostics } from '@/ir/moduleChecks';
import { validateProject } from '@/ir/validate';
import type { IR } from '@/ir/types';
import { getDef } from '@/resources/registry';
import { requestDataSchemasFor, requestSchemasFor, useSchemas } from '@/schema/store';
import { useEditor } from './store';

let installed = false;

export function installSchemaBridge() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const request = (ir: IR) => {
    requestSchemasFor(ir.resources.map((r) => r.type));
    if (ir.data.length > 0) requestDataSchemasFor(ir.data.map((d) => d.type));
  };
  request(useEditor.getState().ir);
  useEditor.subscribe((state, prev) => {
    if (state.ir !== prev.ir) request(state.ir);
  });
  useSchemas.subscribe((state, prev) => {
    if (state.revision === prev.revision) return;
    const { ir, files } = useEditor.getState();
    // the same warnings the store computes: resources and data blocks, then module calls
    const warnings = validateProject(ir, getDef);
    useEditor.setState({ warnings: ir.modules.length > 0 ? [...warnings, ...moduleDiagnostics(ir, files)] : warnings });
  });
}
