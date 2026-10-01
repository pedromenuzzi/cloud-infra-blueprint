/**
 * The Aurora cluster (`aws_rds_cluster`) in the catalog — built from its own
 * HCL, no template: drawn inside its DB subnet group like an RDS instance,
 * the canvas's "create a DB subnet group" fix (and its security-group tip),
 * its cost by use, its name rule and its Portuguese text.
 */
import { describe, expect, it } from 'vitest';
import { computeAbsoluteRects } from '@/components/ProjectThumbnail';
import { estimateResource } from '@/cost/estimate';
import { TEST_BOOK } from '@/cost/testing';
import { fixOps } from '@/features/editor/dropFixes';
import { dropVerdict } from '@/features/editor/dropRules';
import { buildNewNode } from '@/features/editor/newNode';
import { parseProject } from '@/hcl/parser';
import { nameProblem } from '@/ir/checks/names';
import { lit } from '@/ir/expr';
import { deriveStructure } from '@/ir/graph';
import { autoLayout } from '@/ir/layout';
import { applyOps, type Op } from '@/ir/ops';
import type { IR } from '@/ir/types';
import { fieldHelp, resourceName, resourceShortName } from './i18n';
import { getDef, isContainerType } from './registry';

const NETWORK = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "us-east-1b"
}
`;

function project(hcl: string): IR {
  const { ir } = parseProject({ 'main.tf': hcl });
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

describe('aws_rds_cluster (Aurora)', () => {
  it('is in the catalog, in both languages', () => {
    const def = getDef('aws_rds_cluster')!;
    expect(def).toMatchObject({ provider: 'aws', category: 'database', nameArg: 'cluster_identifier' });
    expect(resourceName('aws_rds_cluster', 'en')).toBe('Aurora Cluster');
    expect(resourceName('aws_rds_cluster', 'pt-BR')).toBe('Cluster Aurora');
    expect(resourceShortName('aws_rds_cluster', 'pt-BR')).toBe('Aurora');
    expect(fieldHelp('aws_rds_cluster', 'db_subnet_group_name', 'pt-BR').label).toBe('Grupo de sub-redes do banco');
  });

  it('is dropped with a valid identifier, an encrypted store and a managed password', () => {
    const def = getDef('aws_rds_cluster')!;
    const { node: n } = buildNewNode(project(NETWORK), def, { x: 0, y: 0 }, undefined, { name: 'orders_db' });
    expect(n.args).toMatchObject({
      cluster_identifier: lit('orders-db'),
      engine: lit('aurora-postgresql'),
      manage_master_user_password: lit(true),
      storage_encrypted: lit(true),
    });
    expect(n.args.master_password).toBeUndefined();
    expect(nameProblem(def, 'orders-db')).toBeUndefined();
    expect(nameProblem(def, 'Orders_DB')).toBeDefined();
    expect(nameProblem(def, 'a'.repeat(64))).toMatch(/63/);
  });

  it('is drawn in its DB subnet group, which is drawn in the VPC of its subnets', () => {
    const ir = project(`${NETWORK}
resource "aws_db_subnet_group" "db" {
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

resource "aws_rds_cluster" "orders" {
  engine               = "aurora-postgresql"
  db_subnet_group_name = aws_db_subnet_group.db.name
}
`);
    expect(node(ir, 'aws_rds_cluster.orders').parentId).toBe('aws_db_subnet_group.db');
    expect(node(ir, 'aws_db_subnet_group.db').parentId).toBe('aws_vpc.main');
  });

  it('dropped on a subnet: refused with the subnet-group reason, and the fix creates the group (with a security-group tip)', () => {
    const ir = project(`${NETWORK}
resource "aws_rds_cluster" "orders" {
  engine = "aurora-postgresql"
}
`);
    const rect = computeAbsoluteRects(ir).get('aws_subnet.private_a')!;
    const cluster = node(ir, 'aws_rds_cluster.orders');
    const verdict = dropVerdict(ir, computeAbsoluteRects(ir), { id: cluster.id, type: cluster.type }, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 + 20 }, 'en');
    if (verdict.kind !== 'refuse' || !verdict.fix) throw new Error(`expected a refusal with a fix, got ${verdict.kind}`);
    expect(verdict.reason).toBe(
      "An Aurora cluster isn't placed in one subnet: it runs in a DB subnet group that spans two or more availability zones",
    );
    expect(verdict.fix).toMatchObject({ kind: 'create-group', groupType: 'aws_db_subnet_group' });

    const result = fixOps(ir, cluster.id, verdict.fix, 'en')!;
    expect(result.message).toBe('Created aws_db_subnet_group.orders with private_a and private_b — aws_rds_cluster.orders is drawn inside it');
    expect(result.hint).toBeUndefined();
    expect(result.note).toBe("Tip: connect aws_rds_cluster.orders to a security group — without one it gets the VPC's default group");
    expect(fixOps(ir, cluster.id, verdict.fix, 'pt-BR')!.note).toBe(
      'Dica: conecte aws_rds_cluster.orders a um grupo de segurança — sem um, ele fica com o grupo padrão da VPC',
    );
    const next = apply(ir, result.ops);
    expect(node(next, 'aws_rds_cluster.orders').parentId).toBe('aws_db_subnet_group.orders');
    expect(node(next, 'aws_db_subnet_group.orders').parentId).toBe('aws_vpc.main');
    // no security group was made for it
    expect(next.resources.filter((r) => r.type === 'aws_security_group')).toEqual([]);
  });

  it('no tip once it has a security group (and the same for an RDS instance)', () => {
    const withSg = project(`${NETWORK}
resource "aws_security_group" "db" {
  vpc_id = aws_vpc.main.id
}

resource "aws_rds_cluster" "orders" {
  engine                 = "aurora-mysql"
  vpc_security_group_ids = [aws_security_group.db.id]
}

resource "aws_db_instance" "legacy" {
  instance_class = "db.t3.micro"
}
`);
    const fix = { kind: 'create-group' as const, groupType: 'aws_db_subnet_group', vpc: node(withSg, 'aws_vpc.main') };
    expect(fixOps(withSg, 'aws_rds_cluster.orders', fix, 'en')!.note).toBeUndefined();
    expect(fixOps(withSg, 'aws_db_instance.legacy', fix, 'en')!.note).toMatch(/^Tip: connect aws_db_instance\.legacy to a security group/);
  });

  it('is priced by use: storage and I/O (Standard), or storage with I/O included (I/O-Optimized)', () => {
    const ir = project(`provider "aws" {
  region = "us-east-1"
}

resource "aws_rds_cluster" "standard" {
  engine = "aurora-postgresql"
}

resource "aws_rds_cluster" "optimized" {
  engine       = "aurora-mysql"
  storage_type = "aurora-iopt1"
}

resource "aws_rds_cluster" "serverless" {
  engine = "aurora-postgresql"

  serverlessv2_scaling_configuration {
    min_capacity = 0.5
    max_capacity = 4
  }
}
`);
    const standard = estimateResource(node(ir, 'aws_rds_cluster.standard'), ir, TEST_BOOK, 'en');
    expect(standard).toMatchObject({ kind: 'usage', monthly: null });
    expect(standard.note).toBe('Billed by use: $0.10 per GB-month of storage and $0.20 per million I/O requests (Aurora Standard).');
    expect(standard.assumptions).toContain('Its instances (aws_rds_cluster_instance) are billed per hour on their own');
    const optimized = estimateResource(node(ir, 'aws_rds_cluster.optimized'), ir, TEST_BOOK, 'en');
    expect(optimized.note).toBe('Billed by use: $0.225 per GB-month of storage, I/O included (Aurora I/O-Optimized).');
    const serverless = estimateResource(node(ir, 'aws_rds_cluster.serverless'), ir, TEST_BOOK, 'pt-BR');
    // (money is written with a no-break space: "US$ 0,10")
    expect(serverless.note?.replace(/\u00a0/g, ' ')).toBe(
      'Cobrado pelo uso: US$ 0,10 por GB-mês de armazenamento e US$ 0,20 por milhão de requisições de E/S (Aurora Standard).',
    );
    expect(serverless.assumptions).toContain('A capacidade sem servidor (ACUs) é cobrada por hora de uso, à parte');
  });
});
