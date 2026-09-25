import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { NODE_H, NODE_W } from '@/ir/layout';
import { getDef, isContainerType } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import { buildNewNode, duplicateNode } from './newNode';
import { computeTidyOps } from './tidy';

describe('tidy layout', () => {
  for (const slug of ['aws-web-app', 'aws-container-stack', 'aws-serverless-api', 'azure-web-app']) {
    it(`${slug}: siblings don't overlap and children fit inside their containers`, async () => {
      const files = TEMPLATES.find((t) => t.slug === slug)!.build('demo');
      const { ir } = parseProject(files);
      const edges = deriveStructure(ir, getDef);
      const ops = await computeTidyOps(ir, edges, isContainerType);

      expect(ops).toHaveLength(ir.resources.length);
      const rect = new Map<string, { x: number; y: number; w: number; h: number }>();
      for (const op of ops) {
        if (op.kind !== 'move_node') throw new Error(`unexpected op ${op.kind}`);
        const p = op.position;
        rect.set(op.nodeId, { x: p.x, y: p.y, w: p.w ?? NODE_W, h: p.h ?? NODE_H });
      }

      const parentOf = new Map(ir.resources.map((r) => [r.id, r.parentId] as const));
      for (const [id, r] of rect) {
        const parent = parentOf.get(id);
        if (parent) {
          const pr = rect.get(parent)!;
          expect(r.x, `${id} inside ${parent} (x)`).toBeGreaterThanOrEqual(0);
          expect(r.y, `${id} below ${parent}'s title`).toBeGreaterThanOrEqual(40);
          expect(r.x + r.w, `${id} inside ${parent} (right)`).toBeLessThanOrEqual(pr.w);
          expect(r.y + r.h, `${id} inside ${parent} (bottom)`).toBeLessThanOrEqual(pr.h);
        }
        for (const [otherId, o] of rect) {
          if (otherId <= id || parentOf.get(otherId) !== parent) continue;
          const overlap = r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h;
          expect(overlap, `${id} overlaps ${otherId}`).toBe(false);
        }
      }
    });
  }
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
    expect(first.node.position).toMatchObject({ x: web.position!.x + 32, y: web.position!.y + 32 });

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
