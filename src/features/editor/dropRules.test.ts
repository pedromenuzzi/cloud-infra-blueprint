import { describe, expect, it } from 'vitest';
import { computeAbsoluteRects } from '@/components/ProjectThumbnail';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { autoLayout } from '@/ir/layout';
import { applyOps, type Op } from '@/ir/ops';
import type { IR, ResourceNode } from '@/ir/types';
import { findConnectionRule } from '@/resources/connect';
import { FAMILY, NOUNS, reasonMessages } from '@/resources/dropReasons';
import { allDefs, getDef, isContainerType } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import { messagesFor } from '@/i18n/messages';
import { chooseSubnets, fixLabel, fixOps } from './dropFixes';
import { dropVerdict, nounOf, refusalReason, verdictOver } from './dropRules';
import { boxOf } from './placement';

function project(slug = 'aws-web-app', extra = ''): IR {
  const files = TEMPLATES.find((t) => t.slug === slug)!.build('production-web');
  files['main.tf'] += extra;
  const { ir } = parseProject(files);
  deriveStructure(ir, getDef);
  autoLayout(ir, isContainerType);
  return ir;
}

function apply(ir: IR, ops: Op[]): IR {
  const next = applyOps(ir, ops).ir;
  deriveStructure(next, getDef);
  autoLayout(next, isContainerType);
  return next;
}

const node = (ir: IR, id: string) => ir.resources.find((r) => r.id === id)!;

/** the verdict for dropping `id` (or a palette `type`) at the middle of a container's free area */
function verdictAt(ir: IR, subject: { id?: string; type?: string }, point: { x: number; y: number }) {
  const n = subject.id ? node(ir, subject.id) : undefined;
  return dropVerdict(ir, computeAbsoluteRects(ir), { id: n?.id, type: n?.type ?? subject.type!, parentId: n?.parentId }, point, 'en');
}

const center = (ir: IR, id: string) => {
  const r = computeAbsoluteRects(ir).get(id)!;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 + 20 };
};

/** a point inside the seed's VPC but outside both subnets */
const vpcOnly = (ir: IR) => {
  const r = computeAbsoluteRects(ir).get('aws_vpc.main')!;
  return { x: r.x + r.w - 20, y: r.y + r.h - 20 };
};

const containers = allDefs().filter((d) => d.container);

describe('a drop on a known container (the palette clicked with a container selected)', () => {
  it('gives the same verdict as a drop at a free spot inside it', () => {
    const ir = project();
    const subnet = node(ir, 'aws_subnet.public_b');
    expect(verdictOver(ir, { type: 'aws_instance' }, subnet, 'en')).toMatchObject({ kind: 'nest', parent: { id: 'aws_subnet.public_b' } });
    // a security group goes to the subnet's VPC, and says why
    const sg = verdictOver(ir, { type: 'aws_security_group' }, subnet, 'en');
    expect(sg).toMatchObject({ kind: 'redirect', parent: { id: 'aws_vpc.main' } });
    expect(sg).toEqual(verdictAt(ir, { type: 'aws_security_group' }, center(ir, 'aws_subnet.public_b')));
    // a database can't go in a subnet: refused, with the DB subnet group fix
    const db = verdictOver(ir, { type: 'aws_db_instance' }, subnet, 'en');
    expect(db).toMatchObject({ kind: 'refuse', over: { id: 'aws_subnet.public_b' } });
    expect(db.kind === 'refuse' && db.fix?.kind).toBe('create-group');
    // an S3 bucket can't go in a VPC at all
    expect(verdictOver(ir, { type: 'aws_s3_bucket' }, node(ir, 'aws_vpc.main'), 'en').kind).toBe('refuse');
  });
});

describe('refusal reasons', () => {
  it('names every catalog resource in both languages', () => {
    for (const def of allDefs()) expect(NOUNS[def.type], def.type).toBeDefined();
  });

  it('gives every resource that is never nested a family with its own reason', () => {
    for (const def of allDefs()) {
      if (def.containment?.length) continue;
      expect(FAMILY[def.type], `${def.type} has no family`).toBeDefined();
    }
  });

  it('explains, specifically, every parent type a containment rule refuses', () => {
    for (const def of allDefs()) {
      const accepted = new Set((def.containment ?? []).flatMap((c) => c.parentTypes));
      if (accepted.size === 0) continue;
      for (const c of containers) {
        if (accepted.has(c.type) || c.type === def.type) continue;
        const over = { id: `${c.type}.x`, type: c.type, name: 'x' } as ResourceNode;
        const generic = messagesFor(reasonMessages, 'en').notInside(nounOf(def.type), nounOf(c.type));
        for (const locale of ['en', 'pt-BR'] as const) {
          const reason = refusalReason(def.type, over, locale);
          expect(reason, `${def.type} in ${c.type} (${locale})`).not.toBe(generic);
          expect(reason.length, `${def.type} in ${c.type} (${locale})`).toBeGreaterThan(20);
          if (locale === 'en') expect(reason, `${def.type} in ${c.type}`).toMatch(/\p{Lu}/u);
        }
        expect(refusalReason(def.type, over, 'pt-BR')).not.toBe(refusalReason(def.type, over, 'en'));
      }
    }
  });

  it('can set every containment it accepts on a drop (never a silent refusal)', () => {
    for (const def of allDefs()) {
      for (const rule of def.containment ?? []) {
        if (rule.via) continue;
        for (const parent of rule.parentTypes) {
          expect(findConnectionRule(def, parent)?.mode, `${def.type} dropped in ${parent}`).toBe('set');
        }
      }
    }
  });

  it('reads naturally', () => {
    const subnet = { id: 'aws_subnet.a', type: 'aws_subnet', name: 'a' } as ResourceNode;
    const vpc = { id: 'aws_vpc.a', type: 'aws_vpc', name: 'a' } as ResourceNode;
    expect(refusalReason('aws_security_group', subnet, 'en')).toBe('A security group belongs to the whole VPC, not to one subnet');
    expect(refusalReason('aws_security_group', subnet, 'pt-BR')).toBe(
      'Um grupo de segurança pertence à VPC inteira, não a uma sub-rede',
    );
    expect(refusalReason('aws_instance', vpc, 'en')).toBe(
      'An EC2 instance goes inside a subnet, not directly in the VPC — drop it on a subnet',
    );
    expect(refusalReason('aws_instance', vpc, 'pt-BR')).toBe(
      'Uma instância EC2 fica dentro de uma sub-rede, não direto na VPC — solte-a sobre uma sub-rede',
    );
    expect(refusalReason('aws_db_instance', subnet, 'en')).toBe(
      "An RDS database isn't placed in one subnet — it runs in a DB subnet group that spans two or more availability zones",
    );
    const rg = { id: 'azurerm_resource_group.a', type: 'azurerm_resource_group', name: 'a' } as ResourceNode;
    expect(refusalReason('aws_s3_bucket', rg, 'en')).toBe(
      "An S3 bucket is an AWS resource — it can't go inside an Azure resource group",
    );
  });
});

describe('drop verdicts', () => {
  it('nests an EC2 instance dropped on a subnet', () => {
    const ir = project();
    const v = verdictAt(ir, { type: 'aws_instance' }, center(ir, 'aws_subnet.public_b'));
    expect(v).toMatchObject({ kind: 'nest', current: false });
    if (v.kind === 'nest') expect(v.parent.id).toBe('aws_subnet.public_b');
  });

  it('sends a security group dropped on a subnet to the VPC, saying why', () => {
    const ir = project();
    const v = verdictAt(ir, { type: 'aws_security_group' }, center(ir, 'aws_subnet.public_b'));
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.parent.id).toBe('aws_vpc.main');
      expect(v.reason).toMatch(/whole VPC/);
    }
  });

  it('refuses an EC2 instance dropped on the VPC outside its subnets', () => {
    const ir = project();
    const v = verdictAt(ir, { id: 'aws_instance.web' }, vpcOnly(ir));
    expect(v).toMatchObject({ kind: 'refuse', reason: expect.stringMatching(/goes inside a subnet/) });
  });

  it('refuses the RDS database on a subnet and offers to create a DB subnet group', () => {
    const ir = project();
    const v = verdictAt(ir, { id: 'aws_db_instance.main' }, center(ir, 'aws_subnet.public_a'));
    expect(v.kind).toBe('refuse');
    if (v.kind !== 'refuse') return;
    expect(v.reason).toMatch(/DB subnet group/);
    expect(v.fix).toMatchObject({ kind: 'create-group', groupType: 'aws_db_subnet_group' });
    expect(fixLabel(v.fix!, 'en')).toBe('Create a DB subnet group in main');
    expect(fixLabel(v.fix!, 'pt-BR')).toBe('Criar um grupo de sub-redes do banco em main');
  });

  it('offers to connect a load balancer to the subnet it was dropped on', () => {
    const ir = project();
    const v = verdictAt(ir, { type: 'aws_lb' }, center(ir, 'aws_subnet.public_a'));
    expect(v).toMatchObject({ kind: 'refuse', fix: { kind: 'connect' }, reason: expect.stringMatching(/spans several subnets/) });
  });

  it('keeps a subnet group in the VPC of its subnets', () => {
    const ir = project('aws-secure-3tier');
    const group = node(ir, 'aws_db_subnet_group.main');
    expect(group.parentId).toBe('aws_vpc.main');
    const outside = computeAbsoluteRects(ir).get('aws_vpc.main')!;
    const v = verdictAt(ir, { id: group.id }, { x: outside.x + outside.w + 400, y: outside.y });
    expect(v.kind).toBe('stay');
  });
});

describe('the DB subnet group fix', () => {
  it('creates a group from subnets in two zones, puts the database in it, all in one change', () => {
    const ir = project();
    const v = verdictAt(ir, { id: 'aws_db_instance.main' }, center(ir, 'aws_subnet.public_a'));
    if (v.kind !== 'refuse' || !v.fix) throw new Error('no fix');
    const result = fixOps(ir, 'aws_db_instance.main', v.fix, 'en')!;
    expect(result.message).toBe(
      'Created aws_db_subnet_group.main with public_a and public_b. aws_db_instance.main is drawn inside it',
    );
    expect(result.hint).toBeUndefined();
    const next = apply(ir, result.ops);
    const group = node(next, 'aws_db_subnet_group.main');
    expect(group.parentId).toBe('aws_vpc.main');
    expect(node(next, 'aws_db_instance.main').parentId).toBe(group.id);
    expect(group.args.subnet_ids).toEqual({
      kind: 'list',
      items: [
        { kind: 'ref', path: 'aws_subnet.public_a.id' },
        { kind: 'ref', path: 'aws_subnet.public_b.id' },
      ],
    });
    // nothing overlaps inside the VPC, and the group sits inside it
    const kids = next.resources.filter((r) => r.parentId === 'aws_vpc.main').map((r) => boxOf(r));
    const vpc = boxOf(node(next, 'aws_vpc.main'));
    for (const [i, k] of kids.entries()) {
      expect(k.x + k.w).toBeLessThanOrEqual(vpc.w);
      expect(k.y + k.h).toBeLessThanOrEqual(vpc.h);
      for (const o of kids.slice(i + 1)) {
        expect(k.x < o.x + o.w && o.x < k.x + k.w && k.y < o.y + o.h && o.y < k.y + k.h).toBe(false);
      }
    }
    // then a second database dropped on a subnet is offered that group
    const withDb = apply(next, [
      {
        kind: 'add_resource',
        node: { ...node(ir, 'aws_db_instance.main'), id: 'aws_db_instance.replica', name: 'replica', args: {}, position: { x: 900, y: 900 } },
      },
    ]);
    const again = verdictAt(withDb, { id: 'aws_db_instance.replica' }, center(withDb, 'aws_subnet.public_b'));
    expect(again).toMatchObject({ kind: 'refuse', fix: { kind: 'use-group' } });
  });

  it('picks the tier dropped on, across zones, or a private subnet', () => {
    const ir = project('aws-secure-3tier');
    const vpc = node(ir, 'aws_vpc.main');
    expect(chooseSubnets(ir, vpc, node(ir, 'aws_subnet.db_b')).map((s) => s.name)).toEqual(['db_b', 'db_a']);
    expect(chooseSubnets(ir, vpc, node(ir, 'aws_subnet.app_a')).map((s) => s.name)).toEqual(['app_a', 'app_b']);
    expect(chooseSubnets(ir, vpc).map((s) => s.name)).toEqual(['app_a', 'app_b']);
  });

  it('warns when there is only one zone', () => {
    const ir = project(
      'aws-web-app',
      'resource "aws_vpc" "solo" {\n  cidr_block = "10.9.0.0/16"\n}\nresource "aws_subnet" "only" {\n  vpc_id            = aws_vpc.solo.id\n  availability_zone = "us-east-1a"\n}\n',
    );
    const vpc = node(ir, 'aws_vpc.solo');
    const result = fixOps(ir, 'aws_db_instance.main', { kind: 'create-group', groupType: 'aws_db_subnet_group', vpc }, 'en')!;
    expect(result.hint).toMatch(/two availability zones/);
  });
});
