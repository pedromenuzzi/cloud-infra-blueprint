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
  type Viewport,
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
  LayoutTemplate,
  Maximize,
  PencilLine,
  Plus,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu, type MenuEntry } from '@/components/ContextMenu';
import { showToast } from '@/components/Toast';
import { Button, Kbd } from '@/components/ui';
import { MOD, usePalette } from '@/features/command/paletteStore';
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
import { removeReferencesOps } from './connections';
import { ProjectOverview } from './Inspector';
import { useLayout } from './layoutStore';
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
        width: r.position?.w ?? CONTAINER_MIN_W,
        height: r.position?.h ?? CONTAINER_MIN_H,
        style: {
          width: r.position?.w ?? CONTAINER_MIN_W,
          height: r.position?.h ?? CONTAINER_MIN_H,
        },
      } satisfies FlowNode;
    }
    return {
      ...common,
      width: NODE_W,
      height: NODE_H,
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
  const [overview, setOverview] = useState(false);
  const panelsInspector = useLayout((s) => s.panels.inspector);
  const compact = useLayout((s) => s.compact);
  const drawer = useLayout((s) => s.drawer);

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

  // React Flow can drop a node's measurement when its size changes (a container
  // growing around a moved child) and hidden tabs skip the first pass; re-measure
  // anything unmeasured so edges, fitView and export use real sizes.
  useEffect(() => {
    const t = setTimeout(() => {
      const unmeasured = rf.getNodes().filter((n) => !n.measured?.width);
      if (unmeasured.length > 0) updateNodeInternals(unmeasured.map((n) => n.id));
    }, 250);
    return () => clearTimeout(t);
  }, [nodes, rf, updateNodeInternals]);

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
        const { w, h } = internal ? sizeOf(internal) : { w: NODE_W, h: NODE_H };
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

  /** Delete key: nodes (with children + refs to them) and/or edges — always one undo step */
  const onDelete = useCallback(
    ({ nodes: deletedNodes, edges: deletedEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const state = useEditor.getState();
      if (deletedNodes.length > 0) {
        const count = state.deleteResources(deletedNodes.map((n) => n.id));
        if (count > 1) showToast(`Deleted ${count} resources — ${MOD} Z to undo`, 'info');
        return;
      }
      const refs = deletedEdges.map((e) => ({
        source: e.source,
        target: e.target,
        field: (e.data as { field?: string } | undefined)?.field ?? '',
      }));
      const ops = removeReferencesOps(state.ir, refs);
      if (ops.length < new Set(refs.map((r) => `${r.source}:${r.field}`)).size) {
        showToast('Some connections are complex expressions — edit them in code', 'info');
      }
      if (ops.length > 0) applyCanvasOps(ops);
    },
    [applyCanvasOps],
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
      // capture a clean diagram: no selection glow, resize handles or animated edges
      const { selection: previous, setSelection: select } = useEditor.getState();
      select(null);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        // bounds from absolute positions + measured sizes of every node (children included)
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const n of flowNodes) {
          const internal = rf.getInternalNode(n.id);
          if (!internal) continue;
          const { x, y } = internal.internals.positionAbsolute;
          const { w, h } = sizeOf(internal);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + w);
          maxY = Math.max(maxY, y + h);
        }
        const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        await exportDiagramImage(bounds, format, useEditor.getState().projectName);
        showToast(`Diagram exported as ${format.toUpperCase()}`, 'success');
      } catch (err) {
        showToast(`Export failed: ${(err as Error).message}`, 'error');
      } finally {
        if (previous) select(previous);
      }
    },
    [rf],
  );

  const autoPan = useRef<{ before: Viewport; after: Viewport } | null>(null);

  // inspector closed: undo our automatic pan, unless the user moved the canvas since
  useEffect(() => {
    if (selection !== null || !autoPan.current) return;
    const { before, after } = autoPan.current;
    autoPan.current = null;
    const vp = rf.getViewport();
    if (Math.abs(vp.x - after.x) < 2 && Math.abs(vp.y - after.y) < 2 && vp.zoom === after.zoom) {
      void rf.setViewport(before, { duration: 300 });
    }
  }, [selection, rf]);

  /** width the floating inspector covers on the right while a resource is selected */
  const inspectorInset = useCallback(() => {
    const layout = useLayout.getState();
    const open = layout.panels.inspector && useEditor.getState().selection && !(layout.compact && layout.drawer === 'code');
    const width = wrapper.current?.clientWidth ?? 0;
    return open ? Math.min(300, width - 24) + 20 : 0;
  }, []);

  /** pan (keeping the zoom) by the smallest amount that puts a node in the visible area */
  const focusNode = useCallback(
    (nodeId: string) => {
      const internal = rf.getInternalNode(nodeId);
      const rect = wrapper.current?.getBoundingClientRect();
      if (!internal || !rect) return;
      const { x, y } = internal.internals.positionAbsolute;
      const { w, h } = sizeOf(internal);
      const tl = rf.flowToScreenPosition({ x, y });
      const br = rf.flowToScreenPosition({ x: x + w, y: y + h });
      const pad = 16;
      const left = rect.left + pad;
      const right = rect.right - inspectorInset() - pad;
      const top = rect.top + pad;
      const bottom = rect.bottom - pad;
      if (br.x - tl.x > right - left || br.y - tl.y > bottom - top) {
        void rf.setCenter(x + w / 2, y + h / 2, { zoom: rf.getZoom(), duration: 350 });
        return;
      }
      const dx = br.x > right ? right - br.x : tl.x < left ? left - tl.x : 0;
      const dy = br.y > bottom ? bottom - br.y : tl.y < top ? top - tl.y : 0;
      if (dx === 0 && dy === 0) return;
      const vp = rf.getViewport();
      const next = { x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom };
      // remember where the user was, to slide back when the inspector closes
      autoPan.current = { before: autoPan.current?.before ?? vp, after: next };
      void rf.setViewport(next, { duration: 300 });
    },
    [rf, inspectorInset],
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
          onSelect: () => useEditor.getState().deleteResources([node.id]),
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

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const stats = `${plural(ir.resources.length, 'resource')}, ${plural(irEdges.length, 'connection')}`;
  const inspectorOpen = panelsInspector && selection !== null && !(compact && drawer === 'code');

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
        onNodeClick={(_e, node) => requestAnimationFrame(() => focusNode(node.id))}
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
        onDelete={onDelete}
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
            style={inspectorOpen ? { marginRight: inspectorInset() + 4 } : undefined}
            className="!h-28 !w-44 transition-[margin]"
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
          className="flex w-max max-w-[calc(100%-2rem)] flex-col items-center gap-1.5 transition-[left]"
          style={inspectorOpen ? { left: `max(calc(50% - ${inspectorInset() / 2}px), 120px)` } : undefined}
        >
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOverview((v) => !v)}
              aria-expanded={overview}
              aria-label={`${stats} — project overview`}
              className="rounded-full border bg-surface-1/85 px-3 py-1 text-[11.5px] font-medium text-muted shadow-xs backdrop-blur-md transition-colors hover:border-border-strong hover:text-foreground"
            >
              {stats}
            </button>
            {warnings.length > 0 ? (
              <button
                type="button"
                onClick={() => setOverview(true)}
                title="Show warnings"
                className="flex items-center gap-1 rounded-full border border-warning/40 bg-surface-1/85 px-2 py-1 text-[11.5px] font-semibold text-warning shadow-xs backdrop-blur-md"
              >
                <AlertTriangle className="h-3 w-3" /> {warnings.length}
              </button>
            ) : null}
          </span>
          {overview ? <OverviewPopover onClose={() => setOverview(false)} /> : null}
          {codeErrored ? (
            <span
              role="status"
              className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-[color-mix(in_srgb,var(--color-warning)_10%,var(--surface-1))] px-3 py-1 text-center text-[11.5px] font-semibold text-warning shadow-xs"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Code has errors — canvas shows the last valid state
            </span>
          ) : null}
          {!overview ? <EditorTips /> : null}
        </Panel>
        {ir.resources.length === 0 && !codeErrored ? <EmptyCanvas /> : null}
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

/** Node size: measured when available, else the dimensions we gave React Flow. */
export function sizeOf(internal: { measured: { width?: number; height?: number }; width?: number; height?: number }) {
  return {
    w: internal.measured.width ?? internal.width ?? NODE_W,
    h: internal.measured.height ?? internal.height ?? NODE_H,
  };
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
  );
}

/** Stats pill popover: name, counts, clickable files and warnings. */
function OverviewPopover({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest('[aria-label$="project overview"]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Project overview"
      className="bp-pop-in max-h-[70vh] w-[320px] overflow-y-auto rounded-[14px] border bg-surface-1 shadow-xl"
    >
      <ProjectOverview onNavigate={onClose} />
    </div>
  );
}

/** Blank project: say what to do instead of showing an empty grid. */
function EmptyCanvas() {
  const navigate = useNavigate();
  return (
    <Panel position="top-center" className="!top-1/2 !-translate-y-1/2">
      <div className="bp-pop-in flex w-[340px] flex-col items-center rounded-[18px] border border-dashed border-border-strong bg-surface-1/80 px-6 py-7 text-center backdrop-blur-md">
        <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-primary-soft text-primary">
          <Plus className="h-5 w-5" />
        </span>
        <h2 className="mt-3 text-[15px] font-semibold">Start your blueprint</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Drag a resource from the palette, double-click anywhere on the canvas, or type Terraform in
          the code editor.
        </p>
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => usePalette.getState().setOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add resource
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/dashboard?new=1')}>
            <LayoutTemplate className="h-3.5 w-3.5" /> Use a template
          </Button>
        </div>
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
