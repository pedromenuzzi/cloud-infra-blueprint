import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { NODE_H, NODE_W } from '@/ir/layout';
import { applyOps, type Op } from '@/ir/ops';
import type { IR } from '@/ir/types';
import { getDef, isContainerType } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import { buildNewNode, duplicateNode } from './newNode';
import { computeArrangeInsideOps, computeTidyOps } from './tidy';

type Rect = { x: number; y: number; w: number; h: number };

function project(slug: string, extra = ''): IR {
  const files = TEMPLATES.find((t) => t.slug === slug)!.build('demo');
  files['main.tf'] += extra;
  const { ir } = parseProject(files);
  deriveStructure(ir, getDef);
  return ir;
}

/** the IR once `ops` are applied, containment derived again */
function after(ir: IR, ops: Op[]): IR {
  const next = applyOps(ir, ops).ir;
  deriveStructure(next, getDef);
  return next;
}

const rectOf = (ir: IR, id: string): Rect => {
  const p = ir.resources.find((r) => r.id === id)!.position!;
  return { x: p.x, y: p.y, w: p.w ?? NODE_W, h: p.h ?? NODE_H };
};

const overlaps = (r: Rect, o: Rect) => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h;

/** nothing overlaps a sibling, everything sits inside its parent below the title */
function expectTidy(ir: IR) {
  for (const r of ir.resources) {
    const box = rectOf(ir, r.id);
    if (r.parentId) {
      const pr = rectOf(ir, r.parentId);
      expect(box.x, `${r.id} inside ${r.parentId} (x)`).toBeGreaterThanOrEqual(0);
      expect(box.y, `${r.id} below ${r.parentId}'s title`).toBeGreaterThanOrEqual(40);
      expect(box.x + box.w, `${r.id} inside ${r.parentId} (right)`).toBeLessThanOrEqual(pr.w);
      expect(box.y + box.h, `${r.id} inside ${r.parentId} (bottom)`).toBeLessThanOrEqual(pr.h);
    }
    for (const o of ir.resources) {
      if (o.id <= r.id || o.parentId !== r.parentId) continue;
      expect(overlaps(box, rectOf(ir, o.id)), `${r.id} overlaps ${o.id}`).toBe(false);
    }
  }
}

/** three EC2 instances added to the seed's public_a subnet */
const THREE_EC2 = [1, 2, 3]
  .map((i) => `resource "aws_instance" "app_${i}" {\n  ami           = "ami-1"\n  instance_type = "t3.micro"\n  subnet_id     = aws_subnet.public_a.id\n}\n`)
  .join('');

describe('tidy layout', () => {
  for (const t of TEMPLATES) {
    it(`${t.slug}: nothing overlaps, children fit inside their containers, twice changes nothing`, async () => {
      const ir = project(t.slug);
      const edges = deriveStructure(ir, getDef);
      const ops = await computeTidyOps(ir, edges, isContainerType);
      expect(ops).toHaveLength(ir.resources.length);
      expect(ops.every((op) => op.kind === 'move_node')).toBe(true);
      const tidied = after(ir, ops);
      expectTidy(tidied);
      // idempotent: arranging the arranged diagram moves nothing
      const again = await computeTidyOps(tidied, deriveStructure(tidied, getDef), isContainerType);
      expect(again).toEqual(ops);
    });
  }

  it('three EC2 instances added to a subnet end up in a neat 2×2 grid, the subnets side by side', async () => {
    const ir = project('aws-web-app', THREE_EC2);
    const tidied = after(ir, await computeTidyOps(ir, deriveStructure(ir, getDef), isContainerType));
    expectTidy(tidied);
    const cells = ['aws_instance.web', 'aws_instance.app_1', 'aws_instance.app_2', 'aws_instance.app_3'].map((id) =>
      rectOf(tidied, id),
    );
    expect(new Set(cells.map((c) => c.x)).size, 'two columns').toBe(2);
    expect(new Set(cells.map((c) => c.y)).size, 'two rows').toBe(2);
    // sibling subnets: same row, same size, code order (public_a left of public_b)
    const a = rectOf(tidied, 'aws_subnet.public_a');
    const b = rectOf(tidied, 'aws_subnet.public_b');
    expect(a.y).toBe(b.y);
    expect([a.w, a.h]).toEqual([b.w, b.h]);
    expect(a.x).toBeLessThan(b.x);
  });

  it('lays subnets out as tiers × availability zones', async () => {
    const ir = project('aws-secure-3tier');
    const tidied = after(ir, await computeTidyOps(ir, deriveStructure(ir, getDef), isContainerType));
    const at = (name: string) => rectOf(tidied, `aws_subnet.${name}`);
    for (const tier of ['public', 'app', 'db']) expect(at(`${tier}_a`).y, tier).toBe(at(`${tier}_b`).y);
    for (const zone of ['a', 'b']) {
      expect(at(`public_${zone}`).x).toBe(at(`app_${zone}`).x);
      expect(at(`app_${zone}`).x).toBe(at(`db_${zone}`).x);
    }
    expect(at('public_a').y).toBeLessThan(at('app_a').y);
    expect(at('app_a').y).toBeLessThan(at('db_a').y);
    expect(at('public_a').x).toBeLessThan(at('public_b').x);
    // the database sits in its subnet group, inside the VPC
    expect(tidied.resources.find((r) => r.id === 'aws_db_instance.main')?.parentId).toBe('aws_db_subnet_group.main');
    expect(tidied.resources.find((r) => r.id === 'aws_db_subnet_group.main')?.parentId).toBe('aws_vpc.main');
  });
});

describe('arrange inside a container', () => {
  it('only moves what is inside, keeps the container in place, and makes room for it', () => {
    const ir = project('aws-web-app', THREE_EC2);
    const subnet = rectOf(ir, 'aws_subnet.public_a');
    const ops = computeArrangeInsideOps(ir, deriveStructure(ir, getDef), isContainerType, 'aws_subnet.public_a');
    const touched = new Set(ops.map((op) => (op.kind === 'move_node' ? op.nodeId : '')));
    for (const id of ['aws_instance.web', 'aws_instance.app_1', 'aws_instance.app_2', 'aws_instance.app_3']) {
      expect(touched, id).toContain(id);
    }
    const next = after(ir, ops);
    const moved = rectOf(next, 'aws_subnet.public_a');
    expect([moved.x, moved.y]).toEqual([subnet.x, subnet.y]);
    // the subnet grew: its VPC grew with it (in place) and pushed the IAM role aside
    const vpc = [rectOf(ir, 'aws_vpc.main'), rectOf(next, 'aws_vpc.main')];
    expect([vpc[1].x, vpc[1].y]).toEqual([vpc[0].x, vpc[0].y]);
    expect(vpc[1].w).toBeGreaterThan(vpc[0].w);
    expectTidy(next);
    const inside = next.resources.filter((r) => r.parentId === 'aws_subnet.public_a').map((r) => rectOf(next, r.id));
    for (const [i, r] of inside.entries()) {
      expect(r.x + r.w).toBeLessThanOrEqual(moved.w);
      expect(r.y + r.h).toBeLessThanOrEqual(moved.h);
      for (const o of inside.slice(i + 1)) expect(overlaps(r, o)).toBe(false);
    }
    // and again: nothing changes
    const again = computeArrangeInsideOps(next, deriveStructure(next, getDef), isContainerType, 'aws_subnet.public_a');
    expect(after(next, again).resources.map((r) => r.position)).toEqual(next.resources.map((r) => r.position));
  });
});

describe('tidy packing', () => {
  // Regression: disconnected resources used to be stacked in one tall column.
  it('packs disconnected resources into rows instead of a column', async () => {
    const files = TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('demo');
    files['main.tf'] +=
      '\nresource "aws_s3_bucket" "logs" {}\nresource "aws_route53_zone" "zone" {\n  name = "x.com"\n}\n' +
      'resource "aws_sqs_queue" "jobs" {}\nresource "aws_kms_key" "k" {}\n';
    const { ir } = parseProject(files);
    const ops = await computeTidyOps(ir, deriveStructure(ir, getDef), isContainerType);
    const top = ops.flatMap((op) =>
      op.kind === 'move_node' && !ir.resources.find((r) => r.id === op.nodeId)?.parentId ? [op.position] : [],
    );
    const width = Math.max(...top.map((p) => p.x + (p.w ?? NODE_W)));
    const height = Math.max(...top.map((p) => p.y + (p.h ?? NODE_H)));
    expect(width / height).toBeGreaterThan(1.1);
  });
});

describe('duplicateNode', () => {
  it('copies arguments next to the original with unique names', () => {
    const files = TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('demo');
    const { ir } = parseProject(files);
    const web = ir.resources.find((r) => r.id === 'aws_security_group.web')!;

    const first = duplicateNode(ir, web, getDef(web.type));
    expect(first.node.id).toBe('aws_security_group.web_copy');
    expect(first.node.args.vpc_id).toEqual(web.args.vpc_id);
    expect(first.node.args.name).toEqual({ kind: 'literal', value: `${(web.args.name as { value: string }).value}-copy` });
    // next to the original, not on top of it
    const moved = first.node.position!;
    expect(Math.abs(moved.x - web.position!.x) >= NODE_W || Math.abs(moved.y - web.position!.y) >= NODE_H).toBe(true);

    const second = duplicateNode({ ...ir, resources: [...ir.resources, first.node] }, first.node);
    expect(second.node.id).toBe('aws_security_group.web_copy_2');
  });

  it('leaves the original untouched', () => {
    const { ir } = parseProject({ 'main.tf': '' });
    const { node } = buildNewNode(ir, getDef('aws_sqs_queue')!, { x: 0, y: 0 });
    const before = structuredClone(node.args);
    duplicateNode({ ...ir, resources: [node] }, node, getDef(node.type));
    expect(node.args).toEqual(before);
  });
});

describe('tidy nesting', () => {
  it('packs unconnected siblings into a block instead of one tall column', async () => {
    const instances = Array.from(
      { length: 30 },
      (_, i) => `resource "aws_instance" "app_${i}" {\n  ami           = "ami-1"\n  instance_type = "t3.micro"\n  subnet_id     = aws_subnet.app.id\n}\n`,
    ).join('');
    const { ir } = parseProject({
      'main.tf': `resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\nresource "aws_subnet" "app" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.0.1.0/24"\n}\n${instances}`,
    });
    const edges = deriveStructure(ir, getDef);
    const ops = await computeTidyOps(ir, edges, isContainerType);
    const subnet = ops.find((op) => op.kind === 'move_node' && op.nodeId === 'aws_subnet.app');
    if (subnet?.kind !== 'move_node') throw new Error('subnet not laid out');
    const { w = 0, h = 0 } = subnet.position;
    expect(h / w, `subnet is ${w}×${h}`).toBeLessThan(1.5);
  });
});
