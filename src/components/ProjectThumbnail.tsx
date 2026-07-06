import { useMemo } from 'react';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { autoLayout, CONTAINER_MIN_H, CONTAINER_MIN_W, NODE_H, NODE_W } from '@/ir/layout';
import type { IR, ResourceNode } from '@/ir/types';
import { PROVIDER_COLORS } from '@/resources/icons';
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

  if (!data) {
    return (
      <div className={className}>
        <div className="flex h-full items-center justify-center text-[11px] text-faint">
          empty blueprint
        </div>
      </div>
    );
  }

  return (
    <svg
      viewBox={data.viewBox}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={interactiveTitle ?? 'Architecture preview'}
    >
      {data.edges.map((e) => {
        const a = data.map.get(e.source);
        const b = data.map.get(e.target);
        if (!a || !b) return null;
        return (
          <line
            key={e.id}
            x1={a.x + a.w / 2}
            y1={a.y + a.h / 2}
            x2={b.x + b.w / 2}
            y2={b.y + b.h / 2}
            stroke="currentColor"
            strokeOpacity={0.22}
            strokeWidth={3}
            strokeDasharray={e.kind === 'security' ? '8 6' : undefined}
          />
        );
      })}
      {data.rects.map((r) => {
        const color = PROVIDER_COLORS[r.node.provider];
        const def = getDef(r.node.type);
        return r.isContainer ? (
          <rect
            key={r.node.id}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx={10}
            fill={color}
            fillOpacity={0.06}
            stroke={color}
            strokeOpacity={0.55}
            strokeWidth={2.5}
            strokeDasharray="10 7"
          />
        ) : (
          <g key={r.node.id}>
            <rect
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx={9}
              fill={color}
              fillOpacity={0.9}
            />
            {def ? (
              <rect
                x={r.x + 8}
                y={r.y + r.h / 2 - 14}
                width={28}
                height={28}
                rx={6}
                fill="#fff"
                fillOpacity={0.28}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
