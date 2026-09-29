/**
 * Dragging resources on the canvas and dropping them in from the palette,
 * following the drop rules (./dropRules.ts): a hint while dragging, then
 * nest / redirect (with a note) / refuse (snap back, the reason, and a fix
 * when there is one). New resources land in free cells (./placement.ts).
 * Everything a drop changes is one `applyCanvasOps` — one undo step.
 */
import { useReactFlow, type Node, type XYPosition } from '@xyflow/react';
import { useCallback, useRef } from 'react';
import { computeAbsoluteRects, type AbsRect } from '@/components/ProjectThumbnail';
import { showToast } from '@/components/Toast';
import { MOD } from '@/features/command/paletteStore';
import { messagesFor } from '@/i18n/messages';
import type { Op } from '@/ir/ops';
import type { IR, ResourceNode } from '@/ir/types';
import { connectionOp, findConnectionRule } from '@/resources/connect';
import { getDef, isContainerType } from '@/resources/registry';
import type { ResourceDef } from '@/resources/types';
import { dropMessages } from './drop.messages';
import { fixLabel, fixOps } from './dropFixes';
import { draggedPaletteType, useDropHint, type DropHint } from './dropHint';
import { dropVerdict, nounOf, type DropFix, type DropVerdict } from './dropRules';
import { placeNewNode } from './newNode';
import { boxOf, makeRoomOps, sizeFor, slotIn } from './placement';
import { useEditor } from './store';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const keepSize = (r: ResourceNode) => (r.position?.w !== undefined ? { w: r.position.w, h: r.position.h } : {});

/** the card shown next to the pointer for a verdict; null when there's nothing to say */
function hintFor(verdict: DropVerdict, subject: ResourceNode | undefined, at: { x: number; y: number }): DropHint | null {
  const m = messagesFor(dropMessages);
  switch (verdict.kind) {
    case 'nest':
      return verdict.current
        ? null
        : { targetId: verdict.parent.id, tone: 'ok', title: m.into(nounOf(verdict.parent.type), verdict.parent.name), ...at };
    case 'redirect':
      return {
        targetId: verdict.parent.id,
        tone: 'ok',
        title: m.goes(nounOf(verdict.parent.type), verdict.parent.name),
        reason: verdict.reason,
        ...at,
      };
    case 'stay':
      return { targetId: null, tone: 'no', title: m.stays(nounOf(verdict.parent.type), verdict.parent.name), reason: verdict.reason, ...at };
    case 'refuse':
      return {
        targetId: verdict.over.id,
        tone: 'no',
        title: m.cant(nounOf(verdict.over.type), verdict.over.name),
        reason: verdict.reason,
        fix: verdict.fix !== undefined && !useEditor.getState().readOnly,
        ...at,
      };
    case 'free': {
      const parent = subject?.parentId ? useEditor.getState().ir.resources.find((r) => r.id === subject.parentId) : undefined;
      const rule = parent && getDef(subject!.type)?.containment?.find((c) => !c.via && c.parentTypes.includes(parent.type));
      return parent && rule
        ? { targetId: null, tone: 'ok', title: m.leaves(nounOf(parent.type), parent.name, rule.arg), ...at }
        : null;
    }
  }
}

/** a refused drop's explanation, with its fix as the toast's button */
function explain(title: string, reason: string, fix?: { label: string; run(): void }) {
  showToast(title, 'warning', {
    hint: reason,
    ...(fix ? { action: { label: fix.label, onClick: fix.run } } : {}),
    duration: fix ? 12000 : 7000,
  });
}

export function useCanvasDrops({ animate }: { animate(): void }) {
  const rf = useReactFlow();
  const applyCanvasOps = useEditor((s) => s.applyCanvasOps);
  const starts = useRef(new Map<string, XYPosition>());
  const cache = useRef<{ ir: IR; rects: Map<string, AbsRect> } | null>(null);

  const rectsOf = useCallback((ir: IR) => {
    if (cache.current?.ir !== ir) cache.current = { ir, rects: computeAbsoluteRects(ir) };
    return cache.current.rects;
  }, []);

  /** a node's box on the canvas right now (mid-drag too) */
  const liveBox = useCallback(
    (id: string, fallback: ResourceNode): Box => {
      const internal = rf.getInternalNode(id);
      const size = boxOf(fallback);
      if (!internal) return { ...size, ...(rectsOf(useEditor.getState().ir).get(id) ?? {}) };
      const { x, y } = internal.internals.positionAbsolute;
      return { x, y, w: internal.measured.width ?? size.w, h: internal.measured.height ?? size.h };
    },
    [rectsOf, rf],
  );

  const runFix = useCallback(
    (nodeId: string, fix: DropFix) => {
      const m = messagesFor(dropMessages);
      const state = useEditor.getState();
      const result = fixOps(state.ir, nodeId, fix);
      if (!result) {
        showToast(m.fixGone, 'info');
        return;
      }
      const before = state.filesRevision;
      animate();
      state.applyCanvasOps(result.ops, nodeId);
      if (useEditor.getState().filesRevision === before) return;
      showToast(result.message, result.hint ? 'warning' : 'success', { hint: result.hint ?? m.undoHint(MOD) });
    },
    [animate],
  );

  const refuseNotice = useCallback(
    (verdict: Extract<DropVerdict, { kind: 'refuse' }>, nodeId: string) => {
      const m = messagesFor(dropMessages);
      const fix = verdict.fix && !useEditor.getState().readOnly ? verdict.fix : undefined;
      explain(
        m.cant(nounOf(verdict.over.type), verdict.over.name),
        verdict.reason,
        fix ? { label: fixLabel(fix), run: () => runFix(nodeId, fix) } : undefined,
      );
    },
    [runFix],
  );

  const snapBack = useCallback(
    (id: string) => {
      const start = starts.current.get(id);
      if (!start) return;
      animate();
      rf.setNodes((nodes) => nodes.map((n) => (n.id === id ? { ...n, position: start } : n)));
    },
    [animate, rf],
  );

  const onNodeDragStart = useCallback((_e: unknown, _node: Node, nodes: Node[]) => {
    starts.current = new Map(nodes.map((n) => [n.id, { ...n.position }] as const));
  }, []);

  const onNodeDrag = useCallback(
    (e: MouseEvent | TouchEvent, node: Node, nodes: Node[]) => {
      const hints = useDropHint.getState();
      // group drags only move: no nesting, no hint
      const irNode = useEditor.getState().ir.resources.find((r) => r.id === node.id);
      if (nodes.length > 1 || !irNode) return hints.clear();
      const { ir } = useEditor.getState();
      const box = liveBox(node.id, irNode);
      const verdict = dropVerdict(ir, rectsOf(ir), irNode, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
      const point = 'touches' in e ? e.touches[0] : e;
      const hint = point ? hintFor(verdict, irNode, { x: point.clientX, y: point.clientY }) : null;
      if (hint) hints.show(hint);
      else hints.clear();
    },
    [liveBox, rectsOf],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node, dragged: Node[]) => {
      useDropHint.getState().clear();
      const { ir } = useEditor.getState();
      const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
      const group = dragged.length > 0 ? dragged : [node];
      const plainMove = (n: Node): Op[] => {
        const r = byId.get(n.id);
        return r
          ? [{ kind: 'move_node', nodeId: n.id, position: { x: Math.round(n.position.x), y: Math.round(n.position.y), ...keepSize(r) } }]
          : [];
      };
      // only a single drag may change what a resource is in
      if (group.length > 1) {
        const ops = group.flatMap(plainMove);
        if (ops.length > 0) applyCanvasOps(ops);
        return;
      }
      const irNode = byId.get(node.id);
      if (!irNode) return;
      const def = getDef(irNode.type);
      const rects = rectsOf(ir);
      const box = liveBox(node.id, irNode);
      const verdict = dropVerdict(ir, rects, irNode, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
      const m = messagesFor(dropMessages);

      switch (verdict.kind) {
        case 'nest':
        case 'redirect': {
          const parent = verdict.parent;
          const size = { w: box.w, h: box.h };
          const staying = parent.id === irNode.parentId;
          let position: { x: number; y: number };
          const ops: Op[] = [];
          if (verdict.kind === 'nest' && staying) {
            position = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
          } else {
            const pr = rects.get(parent.id)!;
            position = slotIn(ir, parent, size, { preferred: { x: box.x - pr.x, y: box.y - pr.y }, except: irNode.id });
            if (!staying) {
              const rule = findConnectionRule(def, parent.type);
              const link = rule && rule.mode === 'set' ? connectionOp(irNode, parent, rule) : null;
              if (!link) {
                snapBack(node.id);
                return;
              }
              ops.push(link);
            }
          }
          const moved = { ...position, ...keepSize(irNode) };
          ops.push({ kind: 'move_node', nodeId: node.id, position: moved });
          // the container grows to hold it, pushing its neighbours aside
          ops.push(...makeRoomOps(ir, parent.id, { ...position, ...size }, new Map([[irNode.id, moved]])));
          applyCanvasOps(ops);
          if (verdict.kind === 'redirect') {
            showToast(m.placedIn(nounOf(parent.type), parent.name), 'info', { hint: verdict.reason, duration: 6000 });
          }
          return;
        }
        case 'stay':
          snapBack(node.id);
          explain(m.stays(nounOf(verdict.parent.type), verdict.parent.name), verdict.reason);
          return;
        case 'refuse':
          snapBack(node.id);
          refuseNotice(verdict, node.id);
          return;
        case 'free': {
          const parent = irNode.parentId ? byId.get(irNode.parentId) : undefined;
          const rule = parent && def?.containment?.find((c) => !c.via && c.parentTypes.includes(parent.type));
          if (parent && rule) {
            // dropped outside: detach from the parent that a containment arg points at
            applyCanvasOps([
              { kind: 'unset_arg', nodeId: node.id, field: rule.arg },
              { kind: 'move_node', nodeId: node.id, position: { x: Math.round(box.x), y: Math.round(box.y), ...keepSize(irNode) } },
            ]);
            showToast(`Removed ${rule.arg} from ${node.id} — it's no longer in ${parent.id} (${MOD} Z to undo)`, 'info');
            return;
          }
          const ops = plainMove(node);
          if (ops.length > 0) applyCanvasOps(ops);
        }
      }
    },
    [applyCanvasOps, liveBox, rectsOf, refuseNotice, snapBack],
  );

  /** add a catalog resource at a canvas point, following the drop rules */
  const placeResource = useCallback(
    (def: ResourceDef, at: { x: number; y: number }) => {
      const { ir } = useEditor.getState();
      const rects = rectsOf(ir);
      const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
      const verdict = dropVerdict(ir, rects, { type: def.type }, at);
      let placed: ReturnType<typeof placeNewNode>;
      if (verdict.kind === 'nest' || verdict.kind === 'redirect') {
        const pr = rects.get(verdict.parent.id)!;
        placed = placeNewNode(ir, def, at, { node: verdict.parent, x: pr.x, y: pr.y });
      } else if (verdict.kind === 'refuse') {
        // beside the whole container tree it was dropped on, not over it
        let root = verdict.over;
        for (let guard = 0; root.parentId && byId.get(root.parentId) && guard < 16; guard++) root = byId.get(root.parentId)!;
        const r = rects.get(root.id)!;
        placed = placeNewNode(ir, def, { x: r.x + r.w + 48 + sizeFor(def.type).w / 2, y: at.y });
      } else {
        placed = placeNewNode(ir, def, at);
      }
      const before = useEditor.getState().filesRevision;
      applyCanvasOps(placed.ops, placed.node.id);
      if (useEditor.getState().filesRevision === before) return;
      const m = messagesFor(dropMessages);
      if (verdict.kind === 'redirect') {
        showToast(m.placedIn(nounOf(verdict.parent.type), verdict.parent.name), 'info', { hint: verdict.reason, duration: 6000 });
      } else if (verdict.kind === 'refuse') {
        refuseNotice(verdict, placed.node.id);
      }
    },
    [applyCanvasOps, rectsOf, refuseNotice],
  );

  /**
   * ⌘K "Add resource" with a container selected that can hold it: into its
   * next free cell. Returns the new resource's id, or null when it doesn't apply.
   */
  const addToSelection = useCallback(
    (def: ResourceDef): string | null => {
      const { ir, selection } = useEditor.getState();
      const container = selection ? ir.resources.find((r) => r.id === selection) : undefined;
      if (!container || !isContainerType(container.type)) return null;
      const accepts = def.containment?.some((c) => !c.via && c.parentTypes.includes(container.type));
      if (!accepts) return null;
      const r = rectsOf(ir).get(container.id)!;
      const placed = placeNewNode(ir, def, null, { node: container, x: r.x, y: r.y });
      applyCanvasOps(placed.ops, placed.node.id);
      return placed.node.id;
    },
    [applyCanvasOps, rectsOf],
  );

  /** a resource dragged from the palette over the canvas: the same hint as a node drag */
  const onPaletteDragOver = useCallback(
    (e: React.DragEvent) => {
      const type = draggedPaletteType();
      if (!type) return;
      const { ir } = useEditor.getState();
      const verdict = dropVerdict(ir, rectsOf(ir), { type }, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      const hint = hintFor(verdict, undefined, { x: e.clientX, y: e.clientY });
      if (hint) useDropHint.getState().show(hint);
      else useDropHint.getState().clear();
    },
    [rectsOf, rf],
  );

  const onPaletteDragLeave = useCallback((e: React.DragEvent) => {
    const next = e.relatedTarget as globalThis.Node | null;
    if (!next || !(e.currentTarget as HTMLElement).contains(next)) useDropHint.getState().clear();
  }, []);

  return { onNodeDragStart, onNodeDrag, onNodeDragStop, placeResource, addToSelection, onPaletteDragOver, onPaletteDragLeave };
}
