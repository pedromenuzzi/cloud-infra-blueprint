/**
 * An opened child module, over the canvas: its resources drawn like the
 * root module's (containment, edges, nested module calls — which open one
 * level deeper), read-only, with a breadcrumb back (`root › network`) and
 * its interface (inputs, required or not, and outputs). Esc goes back up.
 * Its files are edited in the code pane.
 */
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
} from '@xyflow/react';
import { ArrowLeft, ChevronRight, Code2, Eye, Maximize } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useLayer } from '@/components/ui';
import { buildFlow } from '@/features/editor/CanvasPane';
import { canvasMessages } from '@/features/editor/CanvasPane.messages';
import { useLayout } from '@/features/editor/layoutStore';
import { ContainerNodeView, FlowEdge, ResourceNodeView } from '@/features/editor/nodes';
import { useEditor } from '@/features/editor/store';
import { useLocale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
import { exprPreview } from '@/ir/expr';
import { deriveStructure } from '@/ir/graph';
import { readLocalModule, type LocalModule } from '@/ir/localModules';
import { layoutWithModules } from '@/ir/moduleLayout';
import { moduleEdges } from '@/ir/modules';
import type { IR } from '@/ir/types';
import { motionMs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { getDef, isContainerType } from '@/resources/registry';
import { ModuleNodeView } from './ModuleNode';
import { moduleViewMessages } from './ModuleView.messages';
import { moduleViewBack, moduleViewTo, useModuleView } from './moduleViewStore';

const nodeTypes = { resource: ResourceNodeView, container: ContainerNodeView, module: ModuleNodeView };
const edgeTypes = { flow: FlowEdge };

/** A copy of the module's IR the layout may write positions into (the parsed one is cached and shared). */
function layoutCopy(ir: IR): IR {
  return {
    ...ir,
    resources: ir.resources.map((r) => ({ ...r, parentId: undefined, position: r.position && { ...r.position } })),
    modules: ir.modules.map((m) => ({ ...m, position: m.position && { ...m.position } })),
  };
}

function ModuleCanvas({ child }: { child: LocalModule }) {
  const locale = useLocale((s) => s.locale);
  const m = useMessages(canvasMessages);
  const vm = useMessages(moduleViewMessages);
  const { nodes, edges } = useMemo(() => {
    const ir = layoutCopy(child.ir);
    const irEdges = deriveStructure(ir, getDef);
    irEdges.push(...moduleEdges(ir));
    layoutWithModules(ir, isContainerType);
    const built = buildFlow({ ir, edges: irEdges, warnings: [] }, null, locale);
    return {
      nodes: built.nodes.map(
        (n): Node =>
          n.type === 'module'
            ? { ...n, data: { ...n.data, nested: true }, draggable: false, connectable: false, deletable: false }
            : { ...n, draggable: false, connectable: false, deletable: false },
      ),
      edges: built.edges.map((e) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--edge-ref)' } })),
    };
  }, [child, locale]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      zoomOnDoubleClick={false}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      minZoom={0.05}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      ariaLabelConfig={m.flowAria}
      aria-label={vm.canvas}
      className="!bg-canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--canvas-grid)" />
    </ReactFlow>
  );
}

function FitButton() {
  const m = useMessages(canvasMessages);
  const rf = useReactFlow();
  return (
    <button
      type="button"
      aria-label={m.fitView}
      title={m.fitView}
      onClick={() => void rf.fitView({ padding: 0.2, maxZoom: 1, duration: motionMs(300) })}
      className="rounded-[7px] border bg-surface-2 p-1.5 text-muted transition-colors hover:border-primary/40 hover:text-primary"
    >
      <Maximize className="h-3.5 w-3.5" />
    </button>
  );
}

function Interface({ child }: { child: LocalModule }) {
  const m = useMessages(moduleViewMessages);
  return (
    <details className="group pointer-events-auto w-[min(300px,calc(100vw-40px))] rounded-[12px] border bg-surface-1/95 shadow-lg backdrop-blur-md" open={typeof window === 'undefined' || window.innerWidth >= 700}>
      <summary className="cursor-pointer select-none rounded-[12px] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-faint hover:text-muted">
        {m.interface}
      </summary>
      <div className="max-h-[50vh] space-y-3 overflow-y-auto border-t px-3 pb-3 pt-2">
        <section>
          <h3 className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.inputs(child.variables.length)}</h3>
          {child.variables.length === 0 ? <p className="text-[11.5px] text-faint">{m.none}</p> : null}
          <ul className="space-y-1">
            {child.variables.map((v) => (
              <li key={v.name} className="rounded-[7px] bg-surface-2 px-2 py-1">
                <span className="flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-semibold">{v.name}</code>
                  <span className={cn('text-[10px] font-semibold uppercase tracking-wide', v.required ? 'text-warning' : 'text-faint')}>
                    {v.required ? m.required : m.optional}
                  </span>
                </span>
                {v.type || v.default || v.description ? (
                  <span className="block truncate font-mono text-[10px] text-faint" title={v.description}>
                    {[v.type, v.default ? `= ${exprPreview(v.default)}` : '', v.description ? `· ${v.description}` : ''].filter(Boolean).join(' ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.outputs(child.outputs.length)}</h3>
          {child.outputs.length === 0 ? <p className="text-[11.5px] text-faint">{m.none}</p> : null}
          <p className="font-mono text-[11px] leading-relaxed text-muted">{child.outputs.map((o) => o.name).join(', ')}</p>
        </section>
      </div>
    </details>
  );
}

export default function ModuleView() {
  const m = useMessages(moduleViewMessages);
  const path = useModuleView((s) => s.path);
  const files = useEditor((s) => s.files);
  const ref = useRef<HTMLElement>(null);
  const current = path[path.length - 1];
  // Esc goes one level up (the layer stack gives it to the top-most layer)
  useLayer(true, moduleViewBack, { kind: 'panel', node: ref });
  if (!current) return null;
  const child = readLocalModule(files, current.dir);
  const up = path.length > 1 ? path[path.length - 2].name : m.root;

  const openCode = () => {
    if (!child) return;
    useEditor.getState().setActiveFile(child.files.find((f) => f.endsWith('/main.tf')) ?? child.files[0]);
    useLayout.getState().show('code');
  };

  return (
    <ReactFlowProvider key={current.dir}>
      <section
        ref={ref}
        aria-label={m.label(current.name)}
        className="bp-fade-in absolute inset-0 z-[15] flex flex-col bg-canvas"
        data-testid="module-view"
      >
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-surface-1/90 px-3 py-2 backdrop-blur-md">
          <button
            type="button"
            onClick={moduleViewBack}
            title={m.backTo(up)}
            className="inline-flex items-center gap-1 rounded-[7px] border bg-surface-1 px-2 py-1 text-[12px] font-semibold text-foreground transition-colors hover:bg-surface-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {m.back}
          </button>
          <nav aria-label={m.path} className="min-w-0">
            <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[12.5px]">
              <li>
                <button type="button" onClick={() => moduleViewTo(0)} className="rounded-[5px] px-1 font-medium text-primary hover:underline">
                  {m.root}
                </button>
              </li>
              {path.map((p, i) => (
                <li key={`${i}:${p.dir}`} className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
                  {i === path.length - 1 ? (
                    <span aria-current="page" className="truncate font-semibold text-foreground">
                      {p.name}
                    </span>
                  ) : (
                    <button type="button" onClick={() => moduleViewTo(i + 1)} className="truncate rounded-[5px] px-1 font-medium text-primary hover:underline">
                      {p.name}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <code className="hidden truncate font-mono text-[11px] text-faint sm:inline">{current.dir}</code>
          <span className="flex-1" />
          {child && !child.broken ? (
            <span className="text-[11.5px] text-muted">{m.counts(child.ir.resources.length, child.ir.modules.length)}</span>
          ) : null}
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-muted" title={m.readOnlyHint}>
            <Eye className="h-3 w-3" /> {m.readOnly}
          </span>
          {child && !child.broken ? <FitButton /> : null}
          {child ? (
            <button
              type="button"
              onClick={openCode}
              className="inline-flex items-center gap-1 rounded-[7px] border bg-surface-2 px-2 py-1 text-[11.5px] font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Code2 className="h-3.5 w-3.5" /> {m.openCode}
            </button>
          ) : null}
        </header>
        <div className="relative min-h-0 flex-1">
          {child && !child.broken ? <ModuleCanvas child={child} /> : null}
          {child && !child.broken ? (
            <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-2">
              <Interface child={child} />
              {child.ir.resources.length === 0 && child.ir.modules.length === 0 ? (
                <p className="pointer-events-auto rounded-[10px] border bg-surface-1/90 px-3 py-2 text-[12px] text-muted">{m.empty}</p>
              ) : null}
            </div>
          ) : (
            <p role="status" className="m-6 rounded-[12px] border border-dashed bg-surface-1/80 px-4 py-6 text-center text-[13px] text-muted">
              {child ? m.broken : m.gone}
            </p>
          )}
        </div>
      </section>
    </ReactFlowProvider>
  );
}
