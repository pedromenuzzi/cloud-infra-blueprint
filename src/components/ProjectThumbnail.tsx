import { Plus } from 'lucide-react';
import { useId, useMemo } from 'react';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { autoLayout, CONTAINER_MIN_H, CONTAINER_MIN_W, NODE_H, NODE_W } from '@/ir/layout';
import type { IR, ResourceNode } from '@/ir/types';
import { CATEGORY_COLORS, CategoryGlyph } from '@/resources/icons';
import type { Category } from '@/resources/types';
import { getDef, isContainerType } from '@/resources/registry';

export interface AbsRect {
  x: number;
  y: number;
  w: number;
  h: number;
  node: ResourceNode;
  isContainer: boolean;
  depth: number;
}

/** Resolve relative (parent-anchored) positions into absolute canvas rects. */
export function computeAbsoluteRects(ir: IR): Map<string, AbsRect> {
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const rects = new Map<string, AbsRect>();

  const resolve = (node: ResourceNode, guard = 0): AbsRect => {
    const cached = rects.get(node.id);
    if (cached) return cached;
    const container = isContainerType(node.type);
    const pos = node.position ?? { x: 0, y: 0 };
    const w = container ? (pos.w ?? CONTAINER_MIN_W) : NODE_W;
    const h = container ? (pos.h ?? CONTAINER_MIN_H) : NODE_H;
    let x = pos.x;
    let y = pos.y;
    let depth = 0;
    if (node.parentId && guard < 10) {
      const parent = byId.get(node.parentId);
      if (parent) {
        const pr = resolve(parent, guard + 1);
        x += pr.x;
        y += pr.y;
        depth = pr.depth + 1;
      }
    }
    const rect: AbsRect = { x, y, w, h, node, isContainer: container, depth };
    rects.set(node.id, rect);
    return rect;
  };

  for (const r of ir.resources) resolve(r);
  return rects;
}

/** Mini architecture render used on project & template cards and the landing hero. */
export function ProjectThumbnail({
  files,
  className,
  interactiveTitle,
}: {
  files: Record<string, string>;
  className?: string;
  interactiveTitle?: string;
}) {
  const data = useMemo(() => {
    try {
      const { ir } = parseProject(files);
      const edges = deriveStructure(ir, getDef);
      autoLayout(ir, isContainerType);
      const rects = computeAbsoluteRects(ir);
      const all = [...rects.values()];
      if (all.length === 0) return null;
      const minX = Math.min(...all.map((r) => r.x)) - 24;
      const minY = Math.min(...all.map((r) => r.y)) - 24;
      const maxX = Math.max(...all.map((r) => r.x + r.w)) + 24;
      const maxY = Math.max(...all.map((r) => r.y + r.h)) + 24;
      return {
        rects: all.sort((a, b) => a.depth - b.depth || Number(b.isContainer) - Number(a.isContainer)),
        edges,
        map: rects,
        viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`,
      };
    } catch {
      return null;
    }
  }, [files]);
  const uid = useId().replace(/:/g, '');

  if (!data) {
    return (
      <div className={className}>
        <div className="flex h-full flex-col items-center justify-center gap-1.5 text-faint">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border-[1.5px] border-dashed border-border-strong">
            <Plus className="h-4 w-4" />
          </span>
          <span className="text-[11px] font-medium">Empty canvas</span>
        </div>
      </div>
    );
  }

  const categories = [
    ...new Set(data.rects.map((r) => getDef(r.node.type)?.category ?? 'compute')),
  ] as Category[];
  const gradId = (c: Category) => `${uid}-tile-${c}`;

  /** middle of the side of `a` facing `b` */
  const side = (a: AbsRect, b: AbsRect) => {
    const dx = b.x + b.w / 2 - (a.x + a.w / 2);
    const dy = b.y + b.h / 2 - (a.y + a.h / 2);
    if (Math.abs(dx) / a.w >= Math.abs(dy) / a.h) {
      return dx >= 0 ? { x: a.x + a.w, y: a.y + a.h / 2 } : { x: a.x, y: a.y + a.h / 2 };
    }
    return dy >= 0 ? { x: a.x + a.w / 2, y: a.y + a.h } : { x: a.x + a.w / 2, y: a.y };
  };

  return (
    <svg
      viewBox={data.viewBox}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={interactiveTitle ?? 'Architecture preview'}
    >
      <defs>
        {categories.map((c) => (
          <linearGradient key={c} id={gradId(c)} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={CATEGORY_COLORS[c].from} />
            <stop offset="1" stopColor={CATEGORY_COLORS[c].to} />
          </linearGradient>
        ))}
      </defs>
      {data.rects
        .filter((r) => r.isContainer)
        .map((r) => {
          const c = CATEGORY_COLORS[getDef(r.node.type)?.category ?? 'network'].solid;
          return (
            <g key={r.node.id}>
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx={16}
                fill={c}
                fillOpacity={0.07}
                stroke={c}
                strokeOpacity={0.5}
                strokeWidth={2.5}
                strokeDasharray="9 7"
              />
              <rect x={r.x + 14} y={r.y + 12} width={24} height={24} rx={7} fill={c} fillOpacity={0.85} />
              <rect x={r.x + 46} y={r.y + 18} width={Math.min(110, r.w - 70)} height={11} rx={5.5} fill="currentColor" fillOpacity={0.28} />
            </g>
          );
        })}
      {data.edges.map((e) => {
        const a = data.map.get(e.source);
        const b = data.map.get(e.target);
        if (!a || !b) return null;
        const p1 = side(a, b);
        const p2 = side(b, a);
        const mx = (p1.x + p2.x) / 2;
        return (
          <path
            key={e.id}
            d={`M${p1.x},${p1.y} C${mx},${p1.y} ${mx},${p2.y} ${p2.x},${p2.y}`}
            fill="none"
            stroke={e.kind === 'security' ? '#f59e0b' : '#3b82f6'}
            strokeOpacity={0.55}
            strokeWidth={3}
            strokeDasharray={e.kind === 'security' ? '9 7' : undefined}
          />
        );
      })}
      {data.rects
        .filter((r) => !r.isContainer)
        .map((r) => {
          const category = getDef(r.node.type)?.category ?? 'compute';
          const tile = 42;
          const tx = r.x + 14;
          const ty = r.y + (r.h - tile) / 2;
          return (
            <g key={r.node.id}>
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx={13}
                fill="var(--node-bg, #fff)"
                stroke="var(--node-border, #d5deea)"
                strokeWidth={2}
              />
              <rect x={tx} y={ty} width={tile} height={tile} rx={11} fill={`url(#${gradId(category)})`} />
              <g transform={`translate(${tx + 9} ${ty + 9}) scale(1)`} color="#fff">
                <CategoryGlyph category={category} type={r.node.type} strokeWidth={2.2} />
              </g>
              <rect x={tx + tile + 12} y={r.y + 22} width={Math.min(96, r.w - tile - 44)} height={11} rx={5.5} fill="currentColor" fillOpacity={0.62} />
              <rect x={tx + tile + 12} y={r.y + 42} width={Math.min(64, r.w - tile - 60)} height={9} rx={4.5} fill="currentColor" fillOpacity={0.24} />
            </g>
          );
        })}
    </svg>
  );
}
