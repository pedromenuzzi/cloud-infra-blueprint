/**
 * Auto-arrange ("tidy up"). Returns plain move ops (positions relative to
 * the parent, the IR's convention), so the result is one undo step and lives
 * in the code as the usual position comments.
 *
 * Inside a container, bottom-up:
 * - resources sit in a square-ish grid (1, 2, 2×2, 3×2…), connected ones
 *   next to each other;
 * - sub-containers (subnets) sit in a row, or in a tier × availability-zone
 *   matrix when their names / AZs say so (public_a public_b / app_a app_b);
 *   siblings of a row share a height and same-type ones a width, so subnets
 *   line up;
 * - the resources go above the sub-containers, or beside them when that keeps
 *   the container closer to a landscape shape;
 * - every container is sized to its content.
 *
 * The top level is a left-to-right flow (ELK layered) of those blocks, edges
 * between their insides counted, each connected group packed in rows.
 *
 * Nothing depends on current positions — only on the code (resource order,
 * names, references) — so arranging twice changes nothing.
 */
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import { isDataId } from '@/ir/dataSources';
import { literalString } from '@/ir/expr';
import { ARRANGE, CONTAINER_MIN_H, CONTAINER_MIN_W, leafColumns, NODE_H, NODE_W } from '@/ir/layout';
import type { Op } from '@/ir/ops';
import type { CanvasPosition, IR, IREdge, ResourceNode } from '@/ir/types';
import { resizeOps } from './placement';

const ORIGIN = 40;
/** between connected groups on the top level */
const PACK_GAP = 80;
/** containers aim for a landscape shape, like the screen they're drawn on */
const TARGET_RATIO = 1.6;

interface Size {
  w: number;
  h: number;
}

interface Cell extends Size {
  x: number;
  y: number;
  col: number;
}

/** "public_a" → tier "public", zone "a"; "db-1b" → "db", "1b" */
const ZONE_SUFFIX = /^(.+?)[_-](\d?[a-f]|az\d+|\d)$/i;

/** a subnet's availability zone: its literal `availability_zone`, else its name's suffix */
export const subnetZone = (r: ResourceNode): string | undefined =>
  literalString(r.args.availability_zone) ?? ZONE_SUFFIX.exec(r.name)?.[2];

/** a subnet's tier: its name without the zone suffix (public_a → public) */
export const subnetTier = (r: ResourceNode): string => ZONE_SUFFIX.exec(r.name)?.[1] ?? r.name;

class Arranger {
  readonly byId: Map<string, ResourceNode>;
  readonly children = new Map<string, ResourceNode[]>();
  readonly roots: ResourceNode[] = [];
  /** decided positions: relative to the parent, containers with their size */
  readonly out = new Map<string, CanvasPosition>();
  private readonly order: Map<string, number>;
  private readonly links = new Map<string, Set<string>>();

  constructor(
    ir: IR,
    readonly edges: IREdge[],
    private readonly isContainerType: (type: string) => boolean,
  ) {
    this.byId = new Map(ir.resources.map((r) => [r.id, r] as const));
    this.order = new Map(ir.resources.map((r, i) => [r.id, i] as const));
    for (const r of ir.resources) {
      if (r.parentId && this.byId.has(r.parentId)) {
        const list = this.children.get(r.parentId) ?? [];
        list.push(r);
        this.children.set(r.parentId, list);
      } else {
        this.roots.push(r);
      }
    }
    for (const e of edges) {
      if (!this.byId.has(e.source) || !this.byId.has(e.target) || e.source === e.target) continue;
      for (const [a, b] of [
        [e.source, e.target],
        [e.target, e.source],
      ] as const) {
        const set = this.links.get(a) ?? new Set<string>();
        set.add(b);
        this.links.set(a, set);
      }
    }
  }

  isGroup(r: ResourceNode): boolean {
    return this.isContainerType(r.type) || (this.children.get(r.id)?.length ?? 0) > 0;
  }

  /** lay out everything inside `node`; returns its size */
  interior(node: ResourceNode): Size {
    const kids = this.children.get(node.id) ?? [];
    if (kids.length === 0) return { w: CONTAINER_MIN_W, h: CONTAINER_MIN_H };
    const subs = kids.filter((k) => this.isGroup(k));
    const leaves = this.linkOrder(kids.filter((k) => !this.isGroup(k)));
    const sizes = new Map(subs.map((s) => [s.id, this.interior(s)] as const));
    const block = this.arrangeGroups(subs, sizes);

    const n = leaves.length;
    type Plan = { cols: number; beside: boolean };
    const plans: Plan[] = [];
    if (n === 0 || subs.length === 0) {
      plans.push({ cols: leafColumns(n), beside: false });
    } else {
      // above: a band as wide as the sub-containers (or the square grid, if wider)
      // (up to half a resource wider: the sub-containers stretch to match)
      const fit = Math.floor((block.w + ARRANGE.gapX + NODE_W / 2) / (NODE_W + ARRANGE.gapX));
      plans.push({ cols: Math.min(n, Math.max(leafColumns(n), fit)), beside: false });
      // beside: a column block no taller than the sub-containers
      const rows = Math.max(1, Math.floor((block.h + ARRANGE.gapY) / (NODE_H + ARRANGE.gapY)));
      plans.push({ cols: Math.ceil(n / rows), beside: true });
    }
    const measure = (plan: Plan) => {
      const grid = gridSize(n, plan.cols);
      const both = n > 0 && subs.length > 0;
      const content = plan.beside
        ? { w: block.w + ARRANGE.bandGap + grid.w, h: Math.max(block.h, grid.h) }
        : { w: Math.max(block.w, grid.w), h: grid.h + (both ? ARRANGE.bandGap : 0) + block.h };
      const size = {
        w: Math.max(CONTAINER_MIN_W, content.w + 2 * ARRANGE.pad),
        h: Math.max(CONTAINER_MIN_H, ARRANGE.top + content.h + ARRANGE.pad),
      };
      return { plan, grid, size, score: Math.abs(size.w / size.h - TARGET_RATIO) };
    };
    const [above, beside] = plans.map(measure);
    // beside only when it's clearly the better shape: leaves on top read first
    const chosen = beside && beside.score + 0.2 < above.score ? beside : above;

    const leafOrigin = chosen.plan.beside
      ? { x: ARRANGE.pad + block.w + ARRANGE.bandGap, y: ARRANGE.top }
      : { x: ARRANGE.pad, y: ARRANGE.top };
    leaves.forEach((leaf, i) => {
      const col = i % chosen.plan.cols;
      const row = Math.floor(i / chosen.plan.cols);
      this.out.set(leaf.id, {
        x: leafOrigin.x + col * (NODE_W + ARRANGE.gapX),
        y: leafOrigin.y + row * (NODE_H + ARRANGE.gapY),
      });
    });
    const groupOrigin = chosen.plan.beside || n === 0
      ? { x: ARRANGE.pad, y: ARRANGE.top }
      : { x: ARRANGE.pad, y: ARRANGE.top + chosen.grid.h + ARRANGE.bandGap };
    // resources above a narrower row of sub-containers: widen the columns so both end together
    const stretch = !chosen.plan.beside && block.cols > 0 ? Math.max(0, chosen.grid.w - block.w) / block.cols : 0;
    for (const [id, cell] of block.cells) {
      this.out.set(id, {
        x: groupOrigin.x + cell.x + Math.round(cell.col * stretch),
        y: groupOrigin.y + cell.y,
        w: cell.w + Math.round((cell.col + 1) * stretch) - Math.round(cell.col * stretch),
        h: cell.h,
      });
    }
    return chosen.size;
  }

  /** sibling containers in a matrix or rows, sizes evened out so they line up */
  private arrangeGroups(subs: ResourceNode[], sizes: Map<string, Size>): Size & { cells: Map<string, Cell>; cols: number } {
    const cells = new Map<string, Cell>();
    if (subs.length === 0) return { w: 0, h: 0, cells, cols: 0 };
    // the most common kind (subnets) may form a tier × zone matrix; the rest follow in a row
    const counts = new Map<string, number>();
    for (const s of subs) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
    const main = [...counts].sort((x, y) => y[1] - x[1])[0][0];
    const alike = subs.filter((s) => s.type === main);
    const others = subs.filter((s) => s.type !== main);
    const grid = this.matrix(alike);
    const rows = grid
      ? [...grid, ...chunk(others, Math.max(1, grid[0].length))]
      : chunk(subs, subs.length <= 3 ? subs.length : leafColumns(subs.length));
    const cols = Math.max(...rows.map((r) => r.length));
    const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...rows.map((r) => (r[c] ? sizes.get(r[c]!.id)!.w : 0))));
    const rowH = rows.map((r) => Math.max(...r.map((s) => (s ? sizes.get(s.id)!.h : 0))));
    const typeW = new Map<string, number>();
    for (const s of subs) typeW.set(s.type, Math.max(typeW.get(s.type) ?? 0, sizes.get(s.id)!.w));
    let y = 0;
    let width = 0;
    rows.forEach((row, r) => {
      let x = 0;
      row.forEach((s, c) => {
        // several rows: columns line up; one row: same-type siblings share a width
        const w = rows.length > 1 ? colW[c] : (typeW.get(s?.type ?? '') ?? 0);
        if (s) cells.set(s.id, { x, y, w: Math.max(w, sizes.get(s.id)!.w), h: rowH[r], col: c });
        x += (s ? Math.max(w, sizes.get(s.id)!.w) : w) + ARRANGE.groupGap;
      });
      width = Math.max(width, x - ARRANGE.groupGap);
      y += rowH[r] + ARRANGE.groupGap;
    });
    return { w: width, h: y - ARRANGE.groupGap, cells, cols };
  }

  /**
   * Subnets named by tier and availability zone (public_a, public_b, app_a…)
   * or with literal zones: one row per tier, one column per zone. Null when
   * the names don't form such a grid.
   */
  private matrix(subs: ResourceNode[]): Array<Array<ResourceNode | undefined>> | null {
    if (subs.length < 2) return null;
    const keys = subs.map((s) => ({ s, zone: subnetZone(s), tier: subnetTier(s) }));
    if (keys.some((k) => !k.zone)) return null;
    const zones = [...new Set(keys.map((k) => k.zone!))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const tiers = [...new Set(keys.map((k) => k.tier))];
    if (zones.length < 2) return null;
    const cell = new Map<string, ResourceNode>();
    for (const k of keys) {
      const key = `${k.tier}\u0000${k.zone}`;
      if (cell.has(key)) return null;
      cell.set(key, k.s);
    }
    // a tier spans zones; otherwise it's just a row of differently named subnets
    if (tiers.some((t) => keys.filter((k) => k.tier === t).length < 2)) return null;
    return tiers.map((t) => zones.map((z) => cell.get(`${t}\u0000${z}`)));
  }

  /** code order, but a resource's connected siblings follow it (short edges in the grid) */
  private linkOrder(leaves: ResourceNode[]): ResourceNode[] {
    const ids = new Set(leaves.map((l) => l.id));
    const seen = new Set<string>();
    const out: ResourceNode[] = [];
    for (const start of leaves) {
      if (seen.has(start.id)) continue;
      const queue = [start];
      seen.add(start.id);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        out.push(cur);
        const next = [...(this.links.get(cur.id) ?? [])]
          .filter((id) => ids.has(id) && !seen.has(id))
          .sort((a, b) => this.order.get(a)! - this.order.get(b)!);
        for (const id of next) {
          seen.add(id);
          queue.push(this.byId.get(id)!);
        }
      }
    }
    return out;
  }

  rootOf(id: string): string {
    let cur = id;
    for (let guard = 0; guard < 20; guard++) {
      const parent = this.byId.get(cur)?.parentId;
      if (!parent || !this.byId.has(parent)) return cur;
      cur = parent;
    }
    return cur;
  }

  sizeOf(r: ResourceNode): Size {
    const p = this.out.get(r.id);
    return this.isGroup(r) ? { w: p?.w ?? CONTAINER_MIN_W, h: p?.h ?? CONTAINER_MIN_H } : { w: NODE_W, h: NODE_H };
  }
}

function gridSize(n: number, cols: number): Size {
  if (n === 0) return { w: 0, h: 0 };
  const c = Math.min(n, cols);
  const rows = Math.ceil(n / c);
  return { w: c * NODE_W + (c - 1) * ARRANGE.gapX, h: rows * NODE_H + (rows - 1) * ARRANGE.gapY };
}

function chunk<T>(items: T[], size: number): Array<Array<T | undefined>> {
  const rows: Array<Array<T | undefined>> = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

function toOps(out: Map<string, CanvasPosition>): Op[] {
  return [...out].map(([nodeId, p]) => ({
    kind: 'move_node' as const,
    nodeId,
    position: {
      x: Math.round(p.x),
      y: Math.round(p.y),
      ...(p.w !== undefined ? { w: Math.round(p.w), h: Math.round(p.h ?? CONTAINER_MIN_H) } : {}),
    },
  }));
}

export async function computeTidyOps(
  ir: IR,
  edges: IREdge[],
  isContainerType: (type: string) => boolean,
): Promise<Op[]> {
  const a = new Arranger(ir, edges, isContainerType);
  for (const r of a.roots) {
    if (a.isGroup(r)) a.out.set(r.id, { x: 0, y: 0, ...a.interior(r) });
  }

  // edges between the insides of two top-level blocks shape the top-level flow; a data source
  // leads it (the flow runs from it to what reads it), so data sources sit left of their readers
  const lifted = new Map<string, ElkExtendedEdge>();
  for (const e of edges) {
    if (!a.byId.has(e.source) || !a.byId.has(e.target)) continue;
    const [from, to] = isDataId(e.target) ? [e.target, e.source] : [e.source, e.target];
    const s = a.rootOf(from);
    const t = a.rootOf(to);
    if (s === t || lifted.has(`${s}>${t}`) || lifted.has(`${t}>${s}`)) continue;
    lifted.set(`${s}>${t}`, { id: `${s}>${t}`, sources: [s], targets: [t] });
  }

  // connected groups of top-level blocks, each laid out on its own
  const leader = new Map(a.roots.map((r) => [r.id, r.id] as const));
  const find = (id: string): string => {
    let cur = id;
    while (leader.get(cur) !== cur) cur = leader.get(cur)!;
    return cur;
  };
  for (const e of lifted.values()) {
    const x = find(e.sources[0]);
    const y = find(e.targets[0]);
    if (x !== y) leader.set(x, y);
  }
  const components = new Map<string, ResourceNode[]>();
  for (const r of a.roots) {
    const key = find(r.id);
    components.set(key, [...(components.get(key) ?? []), r]);
  }

  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();
  const layoutOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '40',
    'elk.layered.spacing.nodeNodeBetweenLayers': '80',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.padding': '[top=0,left=0,bottom=0,right=0]',
  };
  const laidOut = await Promise.all(
    [...components.values()].map((group) => {
      const ids = new Set(group.map((r) => r.id));
      const graph: ElkNode = {
        id: '__root__',
        children: group.map((r) => ({ id: r.id, width: a.sizeOf(r).w, height: a.sizeOf(r).h })),
        edges: [...lifted.values()].filter((e) => ids.has(e.sources[0]) && ids.has(e.targets[0])),
        layoutOptions,
      };
      return elk.layout(graph);
    }),
  );

  // shelf-pack the groups into rows of a roughly landscape area, biggest first
  const sized = laidOut
    .map((g) => ({ g, w: g.width ?? 0, h: g.height ?? 0 }))
    .sort((x, y) => y.w * y.h - x.w * x.h);
  const area = sized.reduce((sum, c) => sum + (c.w + PACK_GAP) * (c.h + PACK_GAP), 0);
  const rowWidth = Math.max(...sized.map((c) => c.w), Math.sqrt(area * 1.8));
  let cx = 0;
  let cy = 0;
  let rowH = 0;
  for (const c of sized) {
    if (cx > 0 && cx + c.w > rowWidth) {
      cx = 0;
      cy += rowH + PACK_GAP;
      rowH = 0;
    }
    for (const n of c.g.children ?? []) {
      const r = a.byId.get(n.id);
      if (!r) continue;
      const size = a.isGroup(r) ? a.sizeOf(r) : {};
      a.out.set(r.id, { x: ORIGIN + cx + (n.x ?? 0), y: ORIGIN + cy + (n.y ?? 0), ...size });
    }
    cx += c.w + PACK_GAP;
    rowH = Math.max(rowH, c.h);
  }
  return toOps(a.out);
}

/**
 * "Arrange inside": only `containerId`'s contents, re-laid out the same way;
 * the container keeps its spot, takes the size its content needs, and pushes
 * its neighbours aside when it grows.
 */
export function computeArrangeInsideOps(
  ir: IR,
  edges: IREdge[],
  isContainerType: (type: string) => boolean,
  containerId: string,
): Op[] {
  const a = new Arranger(ir, edges, isContainerType);
  const container = a.byId.get(containerId);
  if (!container) return [];
  const size = a.interior(container);
  const inside = toOps(a.out);
  const positions = new Map(inside.flatMap((op) => (op.kind === 'move_node' ? [[op.nodeId, op.position] as const] : [])));
  return [...inside, ...resizeOps(ir, containerId, size, positions)];
}
