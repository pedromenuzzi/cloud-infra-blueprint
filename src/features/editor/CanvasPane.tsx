import {
  Background,
  BackgroundVariant,
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
import {
  AlertTriangle,
  ArrowUpRight,
  Code2,
  Copy,
  CopyPlus,
  FileImage,
  ImageDown,
  Maximize,
  PencilLine,
  Plus,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu, type MenuEntry } from '@/components/ContextMenu';
import { showToast } from '@/components/Toast';
import { Kbd } from '@/components/ui';
import { MOD } from '@/features/command/paletteStore';
import { computeAbsoluteRects, type AbsRect } from '@/components/ProjectThumbnail';
import { ref } from '@/ir/expr';
import { CONTAINER_MIN_H, CONTAINER_MIN_W, NODE_H, NODE_W } from '@/ir/layout';
import type { Op } from '@/ir/ops';
import type { Expression, ResourceNode } from '@/ir/types';
import { copyText } from '@/lib/download';
import { detectProviders } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS } from '@/resources/icons';
import { docsUrl, getDef, isContainerType } from '@/resources/registry';
import type { ResourceDef } from '@/resources/types';
import { registerCanvasApi } from './canvasApi';
import { CanvasToolbar } from './CanvasToolbar';
import { exportDiagramImage } from './exportImage';
import { buildNewNode, duplicateNode } from './newNode';
import { ResourcePicker } from './ResourcePicker';
import { computeTidyOps } from './tidy';
import {
  ContainerNodeView,
  FlowEdge,
  ResourceNodeView,
  type FlowEdgeType,
  type FlowNode,
} from './nodes';
import { useEditor } from './store';

const nodeTypes = { resource: ResourceNodeView, container: ContainerNodeView };
const edgeTypes = { flow: FlowEdge };

export const PALETTE_MIME = 'application/x-blueprint-type';

function buildFlow(
  state: Pick<ReturnType<typeof useEditor.getState>, 'ir' | 'edges' | 'warnings' | 'selection'>,
): { nodes: FlowNode[]; edges: FlowEdgeType[] } {
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
          title: r.name,
          subtitle: def?.subtitle?.(r.args),
          typeLabel: def?.shortName ?? r.type.replace(/^(aws|azurerm|google)_/, ''),
          resourceType: r.type,
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
        resourceType: r.type,
        provider: r.provider,
        category: def?.category ?? 'compute',
        warn: warned.has(r.id),
      },
    } satisfies FlowNode;
  });

  const rfEdges: FlowEdgeType[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'flow',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: e.kind === 'security' ? 'var(--edge-security)' : 'var(--edge-ref)',
    },
    data: { field: e.field, kind: e.kind, active: selection === e.source || selection === e.target },
  }));

  return { nodes, edges: rfEdges };
}

function CanvasInner() {
  const ir = useEditor((s) => s.ir);
  const irEdges = useEditor((s) => s.edges);
  const warnings = useEditor((s) => s.warnings);
  const selection = useEditor((s) => s.selection);
  const codeErrored = useEditor((s) => s.codeErrored);
  const selectionOrigin = useEditor((s) => s.selectionOrigin);
  const setSelection = useEditor((s) => s.setSelection);
  const applyCanvasOps = useEditor((s) => s.applyCanvasOps);
  const [minimap, setMinimap] = useState(readMinimapPref);
  const [tidying, setTidying] = useState(false);
  const [layoutAnim, setLayoutAnim] = useState(false);
  const [quickAdd, setQuickAdd] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdgeType>([]);
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

  /** add a catalog resource at a flow position, nesting it in the container under it */
  const placeResource = useCallback(
    (def: ResourceDef, flowPos: { x: number; y: number }) => {
      const state = useEditor.getState();
      const container = findContainerAt(null, def, flowPos.x, flowPos.y);
      const size = isContainerType(def.type) ? { w: CONTAINER_MIN_W, h: CONTAINER_MIN_H } : {};
      const position = container
        ? {
            x: Math.max(12, Math.round(flowPos.x - container.x - NODE_W / 2)),
            y: Math.max(48, Math.round(flowPos.y - container.y - NODE_H / 2)),
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
    [applyCanvasOps, findContainerAt],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const def = getDef(e.dataTransfer.getData(PALETTE_MIME));
      if (!def) return;
      placeResource(def, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [placeResource, rf],
  );

  const viewportCenter = useCallback(() => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, []);

  const duplicate = useCallback(
    (nodeId: string) => {
      const state = useEditor.getState();
      const source = state.ir.resources.find((r) => r.id === nodeId);
      if (!source) return;
      const { node, ops } = duplicateNode(state.ir, source, getDef(source.type));
      applyCanvasOps(ops, node.id);
      showToast(`Duplicated as ${node.id}`, 'success');
    },
    [applyCanvasOps],
  );

  const tidy = useCallback(async () => {
    const state = useEditor.getState();
    if (state.ir.resources.length === 0 || tidying) return;
    setTidying(true);
    try {
      const ops = await computeTidyOps(state.ir, state.edges, isContainerType);
      setLayoutAnim(true);
      applyCanvasOps(ops);
      setTimeout(() => void rf.fitView({ padding: 0.15, maxZoom: 1, duration: 450 }), 60);
      setTimeout(() => setLayoutAnim(false), 520);
    } catch (err) {
      showToast(`Couldn't tidy the layout: ${(err as Error).message}`, 'error');
    } finally {
      setTidying(false);
    }
  }, [applyCanvasOps, rf, tidying]);

  const exportImage = useCallback(
    async (format: 'png' | 'svg') => {
      const flowNodes = rf.getNodes();
      if (flowNodes.length === 0) {
        showToast('Nothing to export yet — add a resource first', 'info');
        return;
      }
      try {
        await exportDiagramImage(rf.getNodesBounds(flowNodes), format, useEditor.getState().projectName);
        showToast(`Diagram exported as ${format.toUpperCase()}`, 'success');
      } catch (err) {
        showToast(`Export failed: ${(err as Error).message}`, 'error');
      }
    },
    [rf],
  );

  /** pan (keeping the zoom) so a node is on screen */
  const focusNode = useCallback(
    (nodeId: string) => {
      const internal = rf.getInternalNode(nodeId);
      const rect = wrapper.current?.getBoundingClientRect();
      if (!internal || !rect) return;
      const { x, y } = internal.internals.positionAbsolute;
      const w = internal.measured.width ?? NODE_W;
      const h = internal.measured.height ?? NODE_H;
      const topLeft = rf.flowToScreenPosition({ x, y });
      const bottomRight = rf.flowToScreenPosition({ x: x + w, y: y + h });
      const visible =
        topLeft.x >= rect.left && topLeft.y >= rect.top && bottomRight.x <= rect.right && bottomRight.y <= rect.bottom;
      if (!visible) void rf.setCenter(x + w / 2, y + h / 2, { zoom: rf.getZoom(), duration: 350 });
    },
    [rf],
  );

  const toggleMinimap = useCallback(() => {
    setMinimap((v) => {
      try {
        localStorage.setItem(MINIMAP_KEY, v ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !v;
    });
  }, []);

  useEffect(() => {
    registerCanvasApi({
      fitView: () => void rf.fitView({ padding: 0.15, maxZoom: 1, duration: 350 }),
      zoomIn: () => void rf.zoomIn({ duration: 200 }),
      zoomOut: () => void rf.zoomOut({ duration: 200 }),
      tidy,
      exportImage,
      addResource: (type, screen) => {
        const def = getDef(type);
        if (def) placeResource(def, rf.screenToFlowPosition(screen ?? viewportCenter()));
      },
      duplicate,
      focusNode,
      toggleMinimap,
    });
    return () => registerCanvasApi(null);
  }, [duplicate, exportImage, focusNode, placeResource, rf, tidy, toggleMinimap, viewportCenter]);

  // code → canvas: a resource picked in the editor scrolls into view
  useEffect(() => {
    if (selection && selectionOrigin === 'code') focusNode(selection);
  }, [selection, selectionOrigin, focusNode]);

  const menuEntries = useMemo((): MenuEntry[] => {
    if (!menu) return [];
    if (menu.nodeId) {
      const node = byId.get(menu.nodeId);
      if (!node) return [];
      const docs = docsUrl(node.type);
      return [
        {
          id: 'code',
          label: 'Show in code',
          icon: Code2,
          onSelect: () => useEditor.getState().revealInCode(node.id),
        },
        {
          id: 'rename',
          label: 'Rename…',
          icon: PencilLine,
          shortcut: 'F2',
          onSelect: () => focusRenameInput(),
        },
        { id: 'duplicate', label: 'Duplicate', icon: CopyPlus, shortcut: '⌘D', onSelect: () => duplicate(node.id) },
        {
          id: 'copy',
          label: 'Copy address',
          icon: Copy,
          onSelect: () => void copyText(node.id).then(() => showToast(`Copied ${node.id}`, 'success')),
        },
        ...(docs
          ? [{ id: 'docs', label: 'Terraform docs', icon: ArrowUpRight, onSelect: () => window.open(docs, '_blank', 'noopener') }]
          : []),
        'separator',
        {
          id: 'delete',
          label: 'Delete',
          icon: Trash2,
          shortcut: 'Del',
          danger: true,
          onSelect: () => applyCanvasOps([{ kind: 'remove_resource', nodeId: node.id }], null),
        },
      ];
    }
    const at = { x: menu.x, y: menu.y };
    return [
      { id: 'add', label: 'Add resource here…', icon: Plus, shortcut: 'Dbl-click', onSelect: () => setQuickAdd(at) },
      'separator',
      { id: 'fit', label: 'Fit view', icon: Maximize, shortcut: '⇧1', onSelect: () => void rf.fitView({ padding: 0.15, maxZoom: 1, duration: 350 }) },
      { id: 'tidy', label: 'Tidy up layout', icon: WandSparkles, onSelect: () => void tidy() },
      'separator',
      { id: 'png', label: 'Export as PNG', icon: ImageDown, onSelect: () => void exportImage('png') },
      { id: 'svg', label: 'Export as SVG', icon: FileImage, onSelect: () => void exportImage('svg') },
    ];
  }, [menu, byId, duplicate, applyCanvasOps, rf, tidy, exportImage]);

  const stats = `${ir.resources.length} resources, ${irEdges.length} connections`;

  return (
    <div
      ref={wrapper}
      className={cn('relative h-full w-full', layoutAnim && 'bp-layout-anim')}
      data-testid="canvas"
      onDoubleClick={(e) => {
        const target = e.target as Element;
        if (target.closest('.react-flow__pane') && !target.closest('.react-flow__node')) {
          setQuickAdd({ x: e.clientX, y: e.clientY });
        }
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          setSelection(node.id);
          setMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, nodeId: null });
        }}
        zoomOnDoubleClick={false}
        snapToGrid
        snapGrid={[8, 8]}
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
        <CanvasToolbar
          minimap={minimap}
          tidying={tidying}
          onToggleMinimap={toggleMinimap}
          onTidy={() => void tidy()}
          onExport={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.top - 88, nodeId: null });
          }}
        />
        {minimap ? (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            className="!h-28 !w-44"
            bgColor="var(--surface-1)"
            maskColor="color-mix(in srgb, var(--background) 60%, transparent)"
            maskStrokeColor="var(--border-strong)"
            nodeBorderRadius={6}
            nodeColor={(n) => {
              const def = getDef(byId.get(n.id)?.type ?? '');
              if (!def) return '#94a3b8';
              const c = CATEGORY_COLORS[def.category].solid;
              return isContainerType(def.type) ? `color-mix(in srgb, ${c} 22%, transparent)` : c;
            }}
          />
        ) : null}
        {/* one stacked panel: separate top-center/top-right panels collide on narrow canvases */}
        <Panel
          position="top-center"
          className="flex w-max max-w-[calc(100%-2rem)] flex-col items-center gap-1.5"
        >
          <span className="rounded-full border bg-surface-1/85 px-3 py-1 text-[11.5px] font-medium text-muted shadow-xs backdrop-blur-md">
            {stats}
          </span>
          {codeErrored ? (
            <span
              role="status"
              className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-[color-mix(in_srgb,var(--color-warning)_10%,var(--surface-1))] px-3 py-1 text-center text-[11.5px] font-semibold text-warning shadow-xs"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Code has errors — canvas shows the last valid state
            </span>
          ) : null}
        </Panel>
        <EditorTips />
      </ReactFlow>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={menuEntries}
          label={menu.nodeId ? 'Resource actions' : 'Canvas actions'}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {quickAdd ? (
        <QuickAddPopover
          at={quickAdd}
          onClose={() => setQuickAdd(null)}
          onPick={(def) => {
            placeResource(def, rf.screenToFlowPosition(quickAdd));
            setQuickAdd(null);
          }}
        />
      ) : null}
    </div>
  );
}

const MINIMAP_KEY = 'cb-minimap';
const TIPS_KEY = 'cb-tips-dismissed';

/** First-run hints, dismissed for good once closed. */
function EditorTips() {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(TIPS_KEY) !== '1';
    } catch {
      return false;
    }
  });
  if (!visible) return null;
  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(TIPS_KEY, '1');
    } catch {
      /* private mode */
    }
  };
  const tips: Array<[string, string]> = [
    ['Double-click', 'add a resource right there'],
    [`${MOD} K`, 'search, add, jump, export…'],
    ['Right-click', 'rename, duplicate, delete'],
    ['?', 'all keyboard shortcuts'],
  ];
  return (
    <Panel position="top-right">
      <div className="bp-pop-in w-64 rounded-[12px] border bg-surface-1/95 p-3 shadow-lg backdrop-blur-md" role="note" aria-label="Editor tips">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="flex-1 text-[12.5px] font-semibold">Pro tips</span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss tips"
            className="rounded-[5px] p-0.5 text-faint hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul className="mt-2 space-y-1.5">
          {tips.map(([key, text]) => (
            <li key={key} className="flex items-center gap-2 text-[11.5px] text-muted">
              <Kbd>{key}</Kbd>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function readMinimapPref(): boolean {
  try {
    return localStorage.getItem(MINIMAP_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Focus the inspector's "Terraform name" field (context menu / F2). */
export function focusRenameInput() {
  requestAnimationFrame(() => {
    const input = document.getElementById('inspector-tf-name') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  });
}

function QuickAddPopover({
  at,
  onClose,
  onPick,
}: {
  at: { x: number; y: number };
  onClose(): void;
  onPick(def: ResourceDef): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const preferred = useMemo(() => detectProviders(useEditor.getState().files), []);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as HTMLElement)) onClose();
    };
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, [onClose]);
  const left = Math.min(at.x, window.innerWidth - 360);
  const top = Math.min(at.y, window.innerHeight - 400);
  return (
    <div
      ref={ref}
      className="bp-pop-in fixed z-50 w-[340px] overflow-hidden rounded-[12px] border bg-surface-1 shadow-lg"
      style={{ left, top }}
      role="dialog"
      aria-label="Quick add resource"
    >
      <ResourcePicker onPick={onPick} onClose={onClose} preferred={preferred} />
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
