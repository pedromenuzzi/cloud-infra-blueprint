import { describe, expect, it } from 'vitest';
import { computeAbsoluteRects } from '@/components/ProjectThumbnail';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { autoLayout } from '@/ir/layout';
import { applyOps, type Op } from '@/ir/ops';
import type { IR } from '@/ir/types';
import { getDef, isContainerType } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import { placeNewNode } from './newNode';
import { boxOf, makeRoomOps, settleOps, slotIn } from './placement';

function seed(slug = 'aws-web-app'): IR {
  const { ir } = parseProject(TEMPLATES.find((t) => t.slug === slug)!.build('production-web'));
  deriveStructure(ir, getDef);
  autoLayout(ir, isContainerType);
  return ir;
}

/** what the store does with canvas ops: apply, derive containment, lay out anything unplaced */
function apply(ir: IR, ops: Op[]): IR {
  const next = applyOps(ir, ops).ir;
  deriveStructure(next, getDef);
  autoLayout(next, isContainerType);
  return next;
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** nothing overlaps a sibling, every child sits inside its parent (as saved, not grown in memory) */
function expectNoMess(ir: IR) {
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  for (const r of ir.resources) {
    const box = boxOf(r);
    if (r.parentId) {
      const parent = boxOf(byId.get(r.parentId)!);
      expect(box.x + box.w, `${r.id} spills out of ${r.parentId}`).toBeLessThanOrEqual(parent.w);
      expect(box.y + box.h, `${r.id} spills out of ${r.parentId}`).toBeLessThanOrEqual(parent.h);
    }
    for (const o of ir.resources) {
      if (o.id <= r.id || o.parentId !== r.parentId) continue;
      expect(overlaps(box, boxOf(o)), `${r.id} overlaps ${o.id}`).toBe(false);
    }
  }
}

/** drop a palette resource at the middle of a container, the way the canvas does */
function dropInto(ir: IR, type: string, containerId: string) {
  const rect = computeAbsoluteRects(ir).get(containerId)!;
  const { node, ops } = placeNewNode(ir, getDef(type)!, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, {
    node: rect.node,
    x: rect.x,
    y: rect.y,
  });
  return { node, ir: apply(ir, ops) };
}

describe('adding resources into a container', () => {
  it('three EC2 instances dropped on the middle of a subnet land in free cells, and the subnet grows', () => {
    let ir = seed();
    const subnetBefore = boxOf(ir.resources.find((r) => r.id === 'aws_subnet.public_a')!);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const drop = dropInto(ir, 'aws_instance', 'aws_subnet.public_a');
      ir = drop.ir;
      ids.push(drop.node.id);
      expect(ir.resources.find((r) => r.id === drop.node.id)?.parentId).toBe('aws_subnet.public_a');
      expectNoMess(ir);
    }
    // web + the three new ones: a 2×2 grid lined up with the instance already there
    const cells = ['aws_instance.web', ...ids].map((id) => boxOf(ir.resources.find((r) => r.id === id)!));
    expect(new Set(cells.map((c) => c.x)).size).toBe(2);
    expect(new Set(cells.map((c) => c.y)).size).toBe(2);
    const subnet = boxOf(ir.resources.find((r) => r.id === 'aws_subnet.public_a')!);
    expect(subnet.w).toBeGreaterThan(subnetBefore.w);
    expect(subnet.h).toBeGreaterThan(subnetBefore.h);
  });

  it('keeps a drop spot that is free', () => {
    const ir = seed();
    const rect = computeAbsoluteRects(ir).get('aws_subnet.public_b')!;
    const at = { x: rect.x + 40 + 104, y: rect.y + 64 + 38 };
    const { node } = placeNewNode(ir, getDef('aws_instance')!, at, { node: rect.node, x: rect.x, y: rect.y });
    expect(node.position).toEqual({ x: 40, y: 64 });
  });

  it('a subnet added to the VPC is sized like a container and overlaps nothing', () => {
    const { ir, node } = dropInto(seed(), 'aws_subnet', 'aws_vpc.main');
    expect(node.position?.w).toBeDefined();
    expectNoMess(ir);
  });
});

describe('making room', () => {
  it('pushes the siblings to the right and below of a container that grows, up the parent chain', () => {
    const ir = seed();
    const vpc = ir.resources.find((r) => r.id === 'aws_vpc.main')!;
    const role = ir.resources.find((r) => r.id === 'aws_iam_role.web')!;
    // something 400px past the VPC's right edge
    const ops = makeRoomOps(ir, 'aws_subnet.public_b', { x: 600, y: 64, w: 208, h: 76 });
    const next = apply(ir, ops);
    const grown = boxOf(next.resources.find((r) => r.id === 'aws_vpc.main')!);
    expect(grown.w).toBeGreaterThan(boxOf(vpc).w);
    const pushed = boxOf(next.resources.find((r) => r.id === 'aws_iam_role.web')!);
    expect(pushed.x - boxOf(role).x).toBe(grown.w - boxOf(vpc).w);
    expectNoMess(next);
  });

  it('first free cell: left to right, then the next row', () => {
    const ir = seed();
    const subnet = ir.resources.find((r) => r.id === 'aws_subnet.public_a')!;
    const spot = slotIn(ir, subnet, { w: 208, h: 76 });
    expect(spot).toEqual({ x: 44 + 208 + 36, y: 64 });
  });

  it('settles a resource in the container a change puts it in', () => {
    const ir = apply(seed('aws-secure-3tier'), []);
    const db = ir.resources.find((r) => r.id === 'aws_db_instance.main')!;
    expect(db.parentId).toBe('aws_db_subnet_group.main');
    // detach it: it stays where it was drawn, on the top level
    const ops = settleOps(ir, [{ kind: 'unset_arg', nodeId: db.id, field: 'db_subnet_group_name' }], db.id);
    const next = apply(ir, ops);
    expect(next.resources.find((r) => r.id === db.id)?.parentId).toBeUndefined();
    expectNoMess(next);
  });
});
