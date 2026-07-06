import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { showToast } from '@/components/Toast';
import { computeAbsoluteRects, type AbsRect } from '@/components/ProjectThumbnail';
import { lit, ref } from '@/ir/expr';
import { CONTAINER_MIN_H, CONTAINER_MIN_W, NODE_H, NODE_W } from '@/ir/layout';
import type { Op } from '@/ir/ops';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { resourceAddress } from '@/ir/types';
import { PROVIDER_COLORS } from '@/resources/icons';
import { getDef, isContainerType } from '@/resources/registry';
import type { ResourceDef } from '@/resources/types';
import { ContainerNodeView, ResourceNodeView, type FlowNode } from './nodes';
import { useEditor } from './store';

const nodeTypes = { resource: ResourceNodeView, container: ContainerNodeView };

export const PALETTE_MIME = 'application/x-blueprint-type';

/** terraform-style default name: last word of the type, made unique */
export function uniqueResourceName(ir: IR, def: ResourceDef): string {
  const base =
    def.type
      .replace(/^(aws|azurerm|google)_/, '')
      .split('_')
      .pop() || 'main';
  const taken = new Set(ir.resources.map((r) => r.id));
  if (!taken.has(resourceAddress(def.type, base))) return base;
  for (let i = 2; i < 100; i++) {
    if (!taken.has(resourceAddress(def.type, `${base}_${i}`))) return `${base}_${i}`;
  }
  return `${base}_${Date.now() % 1000}`;
}

export function buildNewNode(
  ir: IR,
  def: ResourceDef,
  position: { x: number; y: number; w?: number; h?: number },
  parent?: ResourceNode,
): { node: ResourceNode; ops: Op[] } {
  const name = uniqueResourceName(ir, def);
  const args: Record<string, Expression> = {};
  // defaults in field order for a tidy block
  for (const field of def.fields) {
    const dflt = def.defaults?.[field.name];
    if (dflt) args[field.name] = structuredClone(dflt);
  }
  if (def.defaults) {
    for (const [k, v] of Object.entries(def.defaults)) {
      if (!args[k]) args[k] = structuredClone(v);
    }
  }
  // name-ish fields get a helpful default
  if (def.fields.some((f) => f.name === 'name') && !args.name) args.name = lit(name);
  if (parent) {
    const rule = def.connections?.find((c) => c.targetTypes.includes(parent.type));
    if (rule && rule.mode === 'set') args[rule.arg] = ref(`${parent.id}.${rule.attr}`);
  }
  const node: ResourceNode = {
    id: resourceAddress(def.type, name),
    provider: def.provider,
    type: def.type,
    name,
    args,
    position,
    trivia: { leadingComments: [] },
  };
  return { node, ops: [{ kind: 'add_resource', node }] };
}

function edgeColor(kind: string): string {
  return kind === 'security' ? '#f59e0b' : '#3b82f6';
}

function buildFlow(
  state: Pick<ReturnType<typeof useEditor.getState>, 'ir' | 'edges' | 'warnings' | 'selection'>,
): { nodes: FlowNode[]; edges: Edge[] } {
  const { ir, edges, warnings, selection } = state;
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const warned = new Set(warnings.map((w) => w.nodeId).filter(Boolean));

  const depthOf = (r: ResourceNode): number => {
    let d = 0;
    let cur = r.parentId;
    while (cur && d < 12) {
      d++;
      cur = byId.get(cur)?.parentId;
    }
    return d;
  };

  const sorted = [...ir.resources].sort((a, b) => depthOf(a) - depthOf(b));

  const nodes: FlowNode[] = sorted.map((r) => {
    const def = getDef(r.type);
    const container = isContainerType(r.type);
    const common = {
      id: r.id,
      position: { x: r.position?.x ?? 0, y: r.position?.y ?? 0 },
      parentId: r.parentId,
      extent: r.parentId ? ('parent' as const) : undefined,
      selected: selection === r.id,
    };
    if (container) {
      return {
        ...common,
        type: 'container',
        data: {
          title: `${def?.shortName ?? r.type}: ${r.name}`,
          subtitle: def?.subtitle?.(r.args),
          provider: r.provider,
          category: def?.category ?? 'network',
          warn: warned.has(r.id),
        },
        style: {
          width: r.position?.w ?? CONTAINER_MIN_W,
          height: r.position?.h ?? CONTAINER_MIN_H,
        },
      } satisfies FlowNode;
    }
    return {
      ...common,
      type: 'resource',
      data: {
        title: r.name,
        subtitle: def?.subtitle?.(r.args) ?? def?.displayName ?? r.type,
        typeLabel: def?.shortName ?? r.type.replace(/^(aws|azurerm|google)_/, ''),
        provider: r.provider,
        category: def?.category ?? 'compute',
        warn: warned.has(r.id),
      },
    } satisfies FlowNode;
  });

  const rfEdges: Edge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.kind === 'security' ? e.field : undefined,
    style: {
      stroke: edgeColor(e.kind),
      strokeWidth: 1.5,
      strokeDasharray: e.kind === 'security' ? '7 5' : undefined,
      opacity: 0.75,
    },
    labelStyle: { fontSize: 10, fill: 'var(--muted-foreground)' },
    labelBgStyle: { fill: 'var(--surface-1)', fillOpacity: 0.9 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: edgeColor(e.kind) },
    data: { field: e.field },
  }));

  return { nodes, edges: rfEdges };
}

function CanvasInner() {
  const ir = useEditor((s) => s.ir);
  const irEdges = useEditor((s) => s.edges);
  const warnings = useEditor((s) => s.warnings);
  const selection = useEditor((s) => s.selection);
  const codeErrored = useEditor((s) => s.codeErrored);
  const setSelection = useEditor((s) => s.setSelection);
  const applyCanvasOps = useEditor((s) => s.applyCanvasOps);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const wrapper = useRef<HTMLDivElement>(null);

  if (import.meta.env.DEV) {
    (window as unknown as { __rf: unknown }).__rf = rf;
  }

  useEffect(() => {
    const built = buildFlow({ ir, edges: irEdges, warnings, selection });
    setNodes(built.nodes);
    setEdges(built.edges);
  }, [ir, irEdges, warnings, selection, setNodes, setEdges]);

  // DEV: hidden-tab verification environments miss the initial measurement
  // pass; nudge React Flow to measure so edges/fitView work there too.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const t = setTimeout(() => {
      const unmeasured = rf.getNodes().filter((n) => !n.measured?.width);
      if (unmeasured.length > 0) updateNodeInternals(unmeasured.map((n) => n.id));
    }, 400);
    return () => clearTimeout(t);
  }, [nodes.length, rf, updateNodeInternals]);

  const byId = useMemo(() => new Map(ir.resources.map((r) => [r.id, r] as const)), [ir]);
  const absRects = useMemo(() => computeAbsoluteRects(ir), [ir]);

  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      const id = params.nodes[0]?.id ?? null;
      if (id !== useEditor.getState().selection) setSelection(id);
    },
    [setSelection],
  );

  /** containers that may adopt `node`, deepest first */
  const findContainerAt = useCallback(
    (nodeId: string | null, def: ResourceDef | undefined, cx: number, cy: number) => {
      if (!def?.containment) return undefined;
      const accepted = new Set(def.containment.flatMap((c) => c.parentTypes));
      // exclude self and descendants
      const isDescendantOfNode = (r: ResourceNode): boolean => {
        let cur: ResourceNode | undefined = r;
        let guard = 0;
        while (cur && guard++ < 12) {
          if (cur.id === nodeId) return true;
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return false;
      };
      let best: AbsRect | undefined;
      for (const rect of absRects.values()) {
        if (!rect.isContainer) continue;
        if (!accepted.has(rect.node.type)) continue;
        if (nodeId && (rect.node.id === nodeId || isDescendantOfNode(rect.node))) continue;
        const inside =
          cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
        if (!inside) continue;
        if (!best || rect.depth > best.depth) best = rect;
      }
      return best;
    },
    [absRects, byId],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node, dragged: Node[]) => {
      const ops: Op[] = [];
      const group = dragged.length > 0 ? dragged : [node];

      for (const n of group) {
        const irNode = byId.get(n.id);
        if (!irNode) continue;
        const def = getDef(irNode.type);
        const internal = rf.getInternalNode(n.id);
        const abs = internal?.internals.positionAbsolute ?? n.position;
        const w = internal?.measured?.width ?? NODE_W;
        const h = internal?.measured?.height ?? NODE_H;
        const keepSize =
          irNode.position?.w !== undefined
            ? { w: irNode.position.w, h: irNode.position.h }
            : {};

        // only the primary node may reparent, and only when it's a single-drag
        const canReparent = group.length === 1 && n.id === node.id;
        if (canReparent && def?.containment) {
          const target = findContainerAt(n.id, def, abs.x + w / 2, abs.y + h / 2);
          const currentParent = irNode.parentId;
          const nextParent = target?.node.id;
          if (nextParent !== currentParent) {
            if (nextParent && target) {
              const rule = def.connections?.find((c) => c.targetTypes.includes(target.node.type));
              if (rule && rule.mode === 'set') {
                ops.push({
                  kind: 'set_arg',
                  nodeId: n.id,
                  field: rule.arg,
                  value: ref(`${target.node.id}.${rule.attr}`),
                });
                ops.push({
                  kind: 'move_node',
                  nodeId: n.id,
                  position: {
                    x: Math.round(abs.x - target.x),
                    y: Math.round(abs.y - target.y),
                    ...keepSize,
                  },
                });
                continue;
              }
              showToast(`Can't nest here — connect it in code instead`, 'info');
            } else if (currentParent) {
              // dropped outside: detach from the parent that a containment arg points at
              const parent = byId.get(currentParent);
              const rule = def.containment.find((c) =>
                parent ? c.parentTypes.includes(parent.type) : false,
              );
              if (rule) {
                ops.push({ kind: 'unset_arg', nodeId: n.id, field: rule.arg });
                ops.push({
                  kind: 'move_node',
                  nodeId: n.id,
                  position: { x: Math.round(abs.x), y: Math.round(abs.y), ...keepSize },
                });
                continue;
              }
            }
          }
        }

        ops.push({
          kind: 'move_node',
          nodeId: n.id,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y), ...keepSize },
        });
      }
      if (ops.length > 0) applyCanvasOps(ops);
    },
    [applyCanvasOps, byId, findContainerAt, rf],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = connection.source ? byId.get(connection.source) : undefined;
      const target = connection.target ? byId.get(connection.target) : undefined;
      if (!source || !target || source.id === target.id) return;

      if (
        source.provider !== target.provider &&
        source.provider !== 'other' &&
        target.provider !== 'other'
      ) {
        showToast('Cross-cloud connections are not allowed', 'error');
        return;
      }

      const tryRule = (from: ResourceNode, to: ResourceNode): Op | null => {
        const def = getDef(from.type);
        const rule = def?.connections?.find((c) => c.targetTypes.includes(to.type));
        if (!rule) return null;
        const path = `${to.id}.${rule.attr}`;
        if (rule.mode === 'set') {
          return { kind: 'set_arg', nodeId: from.id, field: rule.arg, value: ref(path) };
        }
        const existing = from.args[rule.arg];
        const items: Expression[] =
          existing?.kind === 'list' ? [...existing.items] : existing ? [existing] : [];
        if (items.some((i) => i.kind === 'ref' && i.path.startsWith(`${to.id}.`))) return null;
        items.push(ref(path));
        return { kind: 'set_arg', nodeId: from.id, field: rule.arg, value: { kind: 'list', items } };
      };

      const op = tryRule(source, target) ?? tryRule(target, source);
      if (!op) {
        showToast('These resources have no direct attribute to connect', 'info');
        return;
      }
      applyCanvasOps([op]);
    },
    [applyCanvasOps, byId],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const ops: Op[] = deleted.map((n) => ({ kind: 'remove_resource', nodeId: n.id }));
      if (ops.length > 0) applyCanvasOps(ops, null);
    },
    [applyCanvasOps],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const ops: Op[] = [];
      for (const e of deleted) {
        const field = (e.data as { field?: string } | undefined)?.field;
        if (!field) continue;
        const source = byId.get(e.source);
        if (!source) continue;
        const expr = source.args[field];
        if (!expr) continue;
        if (expr.kind === 'ref') {
          ops.push({ kind: 'unset_arg', nodeId: source.id, field });
        } else if (expr.kind === 'list') {
          const items = expr.items.filter(
            (i) => !(i.kind === 'ref' && i.path.startsWith(`${e.target}.`)),
          );
          ops.push(
            items.length > 0
              ? { kind: 'set_arg', nodeId: source.id, field, value: { kind: 'list', items } }
              : { kind: 'unset_arg', nodeId: source.id, field },
          );
        } else {
          showToast(`"${field}" is a complex expression — edit it in code`, 'info');
        }
      }
      if (ops.length > 0) applyCanvasOps(ops);
    },
    [applyCanvasOps, byId],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(PALETTE_MIME);
      if (!type) return;
      const def = getDef(type);
      if (!def) return;
      const state = useEditor.getState();
      const flowPos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const container = findContainerAt(null, def, flowPos.x, flowPos.y);
      const size = isContainerType(type) ? { w: CONTAINER_MIN_W, h: CONTAINER_MIN_H } : {};
      const position = container
        ? {
            x: Math.max(12, Math.round(flowPos.x - container.x - NODE_W / 2)),
            y: Math.max(36, Math.round(flowPos.y - container.y - NODE_H / 2)),
            ...size,
          }
        : {
            x: Math.round(flowPos.x - NODE_W / 2),
            y: Math.round(flowPos.y - NODE_H / 2),
            ...size,
          };
      const { node, ops } = buildNewNode(state.ir, def, position, container?.node);
      applyCanvasOps(ops, node.id);
    },
    [applyCanvasOps, findContainerAt, rf],
  );

  const stats = `${ir.resources.length} resources, ${irEdges.length} connections`;

  return (
    <div ref={wrapper} className="relative h-full w-full" data-testid="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        deleteKeyCode={['Delete', 'Backspace']}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="!bg-canvas"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.4}
          color="var(--canvas-grid)"
        />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          className="!h-28 !w-40 !bg-surface-1"
          maskColor="color-mix(in srgb, var(--background) 55%, transparent)"
          nodeColor={(n) => {
            const r = byId.get(n.id);
            return r ? PROVIDER_COLORS[r.provider] : '#94a3b8';
          }}
        />
        <Panel position="top-center">
          <span className="rounded-full border bg-surface-1 px-3 py-1 text-[11.5px] font-medium text-muted shadow-xs">
            {stats}
          </span>
        </Panel>
        {codeErrored ? (
          <Panel position="top-right">
            <span className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-[11.5px] font-semibold text-warning shadow-xs">
              <AlertTriangle className="h-3.5 w-3.5" />
              Code has errors — canvas shows the last valid state
            </span>
          </Panel>
        ) : null}
      </ReactFlow>
    </div>
  );
}

export function CanvasPane() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
