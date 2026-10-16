/**
 * The editor's side of the plan and the state: draws the open plan with the
 * learning terminal's plan marks (a ring and a badge per node, the destroyed
 * ones without a node listed on the canvas), takes a plan or a state dropped
 * anywhere on the editor, opens the panel from `?panel=plan|state` (a stable
 * link, the lessons use it), and forgets both when the editor goes away.
 */
import { FileJson } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useEditor } from '@/features/editor/store';
import { usePlanMarks } from '@/features/learn/terminal/planMarks';
import { useMessages } from '@/i18n/messages';
import { nodeIds } from '@/ir/modules';
import { planMarks } from '@/deploy/plan';
import { deployMessages } from './messages';
import { forgetDeploy, openDeployFile, setDeployPanel, useDeploy } from './store';

let hosts = 0;

const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;

export function DeployHost() {
  const m = useMessages(deployMessages);
  const plan = useDeploy((s) => s.plan?.plan);
  // the root module's blocks: a plan's addresses are the root's (an opened module shows none of them)
  const ir = useEditor((s) => s.rootIr);
  const projectId = useEditor((s) => s.projectId);
  const [params, setParams] = useSearchParams();
  const [dragging, setDragging] = useState(false);

  // the plan on the canvas, following the blocks as they change
  useEffect(() => {
    usePlanMarks.setState(plan ? planMarks(plan.changes, nodeIds(ir)) : { nodes: {}, gone: [] });
  }, [plan, ir]);

  // another project: its own plan and state, or none
  useEffect(() => {
    const owner = useDeploy.getState().projectId;
    if (projectId && owner && owner !== projectId) forgetDeploy();
  }, [projectId]);

  // leaving the editor forgets both (a dev remount, StrictMode's, doesn't)
  useEffect(() => {
    hosts++;
    return () => {
      hosts--;
      setTimeout(() => {
        if (hosts > 0) return;
        forgetDeploy();
        usePlanMarks.setState({ nodes: {}, gone: [] });
      }, 0);
    };
  }, []);

  // `?panel=plan` / `?panel=state`: the panel open on that tab (then the parameter goes)
  const panel = params.get('panel');
  useEffect(() => {
    if (panel !== 'plan' && panel !== 'state') return;
    setDeployPanel(true, panel);
    setParams(
      (p) => {
        p.delete('panel');
        return p;
      },
      { replace: true },
    );
  }, [panel, setParams]);

  // a file dropped anywhere on the editor
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file && !useEditor.getState().readOnly) void openDeployFile(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  if (!dragging) return null;
  return (
    <div className="bp-fade-in pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/30 p-6 backdrop-blur-[2px]" data-testid="deploy-drop">
      <div className="bp-modal-in flex max-w-sm flex-col items-center gap-2 rounded-[18px] border-2 border-dashed border-primary bg-surface-1 px-8 py-7 text-center shadow-xl">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
          <FileJson className="h-6 w-6" />
        </span>
        <p className="text-[15px] font-semibold">{m.dropTitle}</p>
        <p className="text-[12.5px] leading-relaxed text-muted">{m.dropHint}</p>
      </div>
    </div>
  );
}
