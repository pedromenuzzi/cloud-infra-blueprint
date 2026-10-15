/**
 * The Aurora cluster (`aws_rds_cluster`) and its instances
 * (`aws_rds_cluster_instance`) in the catalog — built from their own HCL, no
 * template: the cluster drawn inside its DB subnet group like an RDS instance,
 * the instances inside their cluster, the canvas's "create a DB subnet group"
 * fix (and the security group step after it), drop reasons, cost, name rules and their
 * Portuguese text.
 */
import { describe, expect, it } from 'vitest';
import { computeAbsoluteRects } from '@/components/ProjectThumbnail';
import { estimateProject, estimateResource } from '@/cost/estimate';
import { PRICE_BOOK } from '@/cost/prices/prices';
import { TEST_BOOK } from '@/cost/testing';
import { fixOps, securityGroupLabel, securityGroupNeed, securityGroupOps } from '@/features/editor/dropFixes';
import { dropVerdict, refusalReason } from '@/features/editor/dropRules';
import { buildNewNode } from '@/features/editor/newNode';
import { parseProject } from '@/hcl/parser';
import { nameProblem } from '@/ir/checks/names';
import { lit } from '@/ir/expr';
import { deriveStructure } from '@/ir/graph';
import { autoLayout } from '@/ir/layout';
import { applyOps, type Op } from '@/ir/ops';
import { exprText } from '@/ir/repeat';
import { blocksOf } from '@/security/model';
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
    expect(result.message).toBe('Created aws_db_subnet_group.orders with private_a and private_b. aws_rds_cluster.orders is drawn inside it');
    expect(result.hint).toBeUndefined();
    expect(result.note).toBe('aws_rds_cluster.orders has no security group of its own, so it gets the default group of main');
    expect(fixOps(ir, cluster.id, verdict.fix, 'pt-BR')!.note).toBe(
      'aws_rds_cluster.orders não tem grupo de segurança próprio, então fica com o grupo padrão de main',
    );
    // offered as the next step, not done with the fix
    expect(result.securityGroup).toEqual({ vpcId: 'aws_vpc.main', fix: { kind: 'create' } });
    const next = apply(ir, result.ops);
    expect(node(next, 'aws_rds_cluster.orders').parentId).toBe('aws_db_subnet_group.orders');
    expect(node(next, 'aws_db_subnet_group.orders').parentId).toBe('aws_vpc.main');
    expect(next.resources.filter((r) => r.type === 'aws_security_group')).toEqual([]);

    // the step: a group of its own in the VPC, with no way in yet
    const step = securityGroupOps(next, cluster.id, 'aws_vpc.main', { kind: 'create' }, 'en')!;
    expect(step.message).toBe('Created aws_security_group.orders in main for aws_rds_cluster.orders');
    expect(step.note).toBe('It lets nothing in yet: add an inbound rule for what connects to the database');
    const done = apply(next, step.ops);
    expect(node(done, 'aws_security_group.orders').parentId).toBe('aws_vpc.main');
    expect(exprText(node(done, 'aws_rds_cluster.orders').args.vpc_security_group_ids)).toBe('[aws_security_group.orders.id]');
    expect(blocksOf(node(done, 'aws_security_group.orders').args.ingress)).toEqual([]);
    expect(securityGroupNeed(done, node(done, cluster.id), node(done, 'aws_vpc.main'))).toBeUndefined();
  });

  it('a security group of another VPC is replaced: by the group the VPC’s databases share, else a new one', () => {
    const text = `${NETWORK}
resource "aws_vpc" "old" {
  cidr_block = "10.9.0.0/16"
}

resource "aws_security_group" "old_db" {
  vpc_id = aws_vpc.old.id
}

resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
}

resource "aws_rds_cluster" "orders" {
  engine                 = "aurora-mysql"
  vpc_security_group_ids = [aws_security_group.old_db.id, aws_security_group.web.id]
}
`;
    const ir = project(text);
    const vpc = node(ir, 'aws_vpc.main');
    const fix = { kind: 'create-group' as const, groupType: 'aws_db_subnet_group', vpc };
    const result = fixOps(ir, 'aws_rds_cluster.orders', fix, 'en')!;
    expect(result.note).toBe("aws_security_group.old_db is in another VPC, and AWS only takes security groups of main, the database's VPC");
    // the web group isn't a database's: not offered
    expect(result.securityGroup?.fix).toEqual({ kind: 'create' });
    const step = securityGroupOps(apply(ir, result.ops), 'aws_rds_cluster.orders', vpc.id, { kind: 'create' }, 'pt-BR')!;
    expect(step.note).toBe(
      'Ele não lista mais aws_security_group.old_db (outra VPC). Ele ainda não deixa nada entrar: adicione uma regra de entrada para o que se conecta ao banco',
    );
    const done = apply(apply(ir, result.ops), step.ops);
    expect(exprText(node(done, 'aws_rds_cluster.orders').args.vpc_security_group_ids)).toBe(
      '[aws_security_group.web.id, aws_security_group.orders.id]',
    );

    // with a database group in the VPC already (another database uses it), that one is offered
    const shared = project(`${text}
resource "aws_security_group" "db" {
  vpc_id = aws_vpc.main.id
}

resource "aws_db_instance" "legacy" {
  instance_class         = "db.t3.micro"
  vpc_security_group_ids = [aws_security_group.db.id]
}
`);
    const offered = fixOps(shared, 'aws_rds_cluster.orders', { ...fix, vpc: node(shared, 'aws_vpc.main') }, 'en')!.securityGroup!;
    expect(offered.fix).toMatchObject({ kind: 'use', group: { id: 'aws_security_group.db' } });
    expect(securityGroupLabel(offered.fix, 'main', 'en')).toBe('Use security group db');
    const used = securityGroupOps(shared, 'aws_rds_cluster.orders', 'aws_vpc.main', offered.fix, 'en')!;
    expect(used.message).toBe('aws_rds_cluster.orders now uses aws_security_group.db');
    expect(exprText(node(apply(shared, used.ops), 'aws_rds_cluster.orders').args.vpc_security_group_ids)).toBe(
      '[aws_security_group.web.id, aws_security_group.db.id]',
    );
  });

  it('nothing to offer once it has a security group of the VPC (and the same for an RDS instance)', () => {
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
    const cluster = fixOps(withSg, 'aws_rds_cluster.orders', fix, 'en')!;
    expect(cluster.note).toBeUndefined();
    expect(cluster.securityGroup).toBeUndefined();
    // the instance has none: the cluster's group is the VPC's database group, offered to it
    const legacy = fixOps(withSg, 'aws_db_instance.legacy', fix, 'en')!;
    expect(legacy.note).toBe('aws_db_instance.legacy has no security group of its own, so it gets the default group of main');
    expect(legacy.securityGroup?.fix).toMatchObject({ kind: 'use', group: { id: 'aws_security_group.db' } });
  });

  it('never offers a group open to the internet, even one another database uses', () => {
    const ir = project(`${NETWORK}
resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "legacy" {
  instance_class         = "db.t3.micro"
  vpc_security_group_ids = [aws_security_group.web.id]
}

resource "aws_rds_cluster" "orders" {
  engine = "aurora-mysql"
}
`);
    expect(securityGroupNeed(ir, node(ir, 'aws_rds_cluster.orders'), node(ir, 'aws_vpc.main'))?.fix).toEqual({ kind: 'create' });
  });

  it('leaves alone security groups the canvas cannot see', () => {
    const ir = project(`${NETWORK}
resource "aws_rds_cluster" "orders" {
  engine                 = "aurora-mysql"
  vpc_security_group_ids = var.db_security_groups
}
`);
    expect(securityGroupNeed(ir, node(ir, 'aws_rds_cluster.orders'), node(ir, 'aws_vpc.main'))).toBeUndefined();
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

const CLUSTER = `${NETWORK}
resource "aws_db_subnet_group" "db" {
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

resource "aws_rds_cluster" "orders" {
  engine               = "aurora-postgresql"
  engine_version       = "16.4"
  db_subnet_group_name = aws_db_subnet_group.db.name
}
`;

describe('aws_rds_cluster_instance (Aurora instance)', () => {
  it('is in the catalog, in both languages, with a glyph and a name rule', () => {
    const def = getDef('aws_rds_cluster_instance')!;
    expect(def).toMatchObject({ provider: 'aws', category: 'database', nameArg: 'identifier' });
    expect(resourceName('aws_rds_cluster_instance', 'en')).toBe('Aurora Instance');
    expect(resourceName('aws_rds_cluster_instance', 'pt-BR')).toBe('Instância Aurora');
    expect(fieldHelp('aws_rds_cluster_instance', 'cluster_identifier', 'pt-BR').label).toBe('Cluster Aurora');
    expect(nameProblem(def, 'orders-1')).toBeUndefined();
    expect(nameProblem(def, 'Orders_1')).toBeDefined();
    // the cluster holds its instances
    expect(isContainerType('aws_rds_cluster')).toBe(true);
    expect(isContainerType('aws_rds_cluster_instance')).toBe(false);
  });

  it('is drawn inside the cluster cluster_identifier names, inside its DB subnet group, inside the VPC', () => {
    const ir = project(`${CLUSTER}
resource "aws_rds_cluster_instance" "orders" {
  count              = 2
  cluster_identifier = aws_rds_cluster.orders.id
  instance_class     = "db.r6g.large"
  engine             = aws_rds_cluster.orders.engine
}
`);
    expect(node(ir, 'aws_rds_cluster_instance.orders').parentId).toBe('aws_rds_cluster.orders');
    expect(node(ir, 'aws_rds_cluster.orders').parentId).toBe('aws_db_subnet_group.db');
    expect(node(ir, 'aws_db_subnet_group.db').parentId).toBe('aws_vpc.main');
  });

  it('dropped in a cluster: nests, names it in cluster_identifier and takes its engine and version by reference', () => {
    const ir = project(CLUSTER);
    const def = getDef('aws_rds_cluster_instance')!;
    const cluster = node(ir, 'aws_rds_cluster.orders');
    const { node: n } = buildNewNode(ir, def, { x: 24, y: 56 }, cluster, { name: 'orders_writer' });
    expect(n.args).toMatchObject({
      identifier: lit('orders-writer'),
      cluster_identifier: { kind: 'ref', path: 'aws_rds_cluster.orders.id' },
      engine: { kind: 'ref', path: 'aws_rds_cluster.orders.engine' },
      engine_version: { kind: 'ref', path: 'aws_rds_cluster.orders.engine_version' },
      instance_class: lit('db.t4g.medium'),
    });
    const next = apply(ir, [{ kind: 'add_resource', node: n }]);
    expect(node(next, 'aws_rds_cluster_instance.orders_writer').parentId).toBe('aws_rds_cluster.orders');
    // nesting is the link: no edge drawn to its own cluster
    expect(deriveStructure(next, getDef).filter((e) => e.source === n.id)).toEqual([]);
  });

  it('dropped elsewhere: its cluster is where it goes, in both languages', () => {
    const ir = project(CLUSTER);
    const reason = (over: string, locale: 'en' | 'pt-BR' = 'en') => refusalReason('aws_rds_cluster_instance', node(ir, over), locale);
    expect(reason('aws_subnet.private_a')).toBe('An Aurora instance goes inside an Aurora cluster, not a subnet');
    expect(reason('aws_db_subnet_group.db')).toBe(
      'An Aurora instance goes inside an Aurora cluster, not directly in the DB subnet group. Drop it on an Aurora cluster',
    );
    expect(reason('aws_vpc.main')).toBe('An Aurora instance goes inside an Aurora cluster, not directly in the VPC. Drop it on an Aurora cluster');
    expect(reason('aws_subnet.private_a', 'pt-BR')).toBe('Uma instância Aurora fica dentro de um cluster Aurora, não na sub-rede');
    expect(reason('aws_db_subnet_group.db', 'pt-BR')).toBe(
      'Uma instância Aurora fica dentro de um cluster Aurora, não direto no grupo de sub-redes do banco. Solte-a sobre um cluster Aurora',
    );

    // the drop verdict over the subnet group: refused (no fix: only a cluster takes it)
    const rect = computeAbsoluteRects(ir).get('aws_db_subnet_group.db')!;
    const verdict = dropVerdict(ir, computeAbsoluteRects(ir), { type: 'aws_rds_cluster_instance' }, { x: rect.x + 8, y: rect.y + rect.h - 8 }, 'en');
    expect(verdict).toMatchObject({ kind: 'refuse', fix: undefined });
    // …and over the cluster: nest
    const c = computeAbsoluteRects(ir).get('aws_rds_cluster.orders')!;
    const inside = dropVerdict(ir, computeAbsoluteRects(ir), { type: 'aws_rds_cluster_instance' }, { x: c.x + c.w / 2, y: c.y + c.h / 2 }, 'en');
    expect(inside).toMatchObject({ kind: 'nest', parent: { id: 'aws_rds_cluster.orders' } });
  });

  it('is priced per instance-hour: a cluster with 2 instances has a real monthly estimate', () => {
    const ir = project(`provider "aws" {
  region = "us-east-1"
}
${CLUSTER}
resource "aws_rds_cluster_instance" "orders" {
  count              = 2
  cluster_identifier = aws_rds_cluster.orders.id
  instance_class     = "db.r6g.large"
  engine             = aws_rds_cluster.orders.engine
}
`);
    const one = estimateResource(node(ir, 'aws_rds_cluster_instance.orders'), ir, TEST_BOOK, 'en');
    expect(one).toMatchObject({ kind: 'fixed' });
    // 2 × 730 h × $0.26
    expect(one.monthly).toBeCloseTo(379.6, 5);
    expect(one.assumptions).toEqual(
      expect.arrayContaining(['Aurora PostgreSQL, on an Aurora Standard cluster', 'Storage and I/O are billed on the cluster (aws_rds_cluster)']),
    );
    const total = estimateProject(ir, TEST_BOOK, 'en');
    expect(total.total).toBeCloseTo(379.6, 5);
    // and with the shipped table (us-east-1 list prices)
    expect(estimateResource(node(ir, 'aws_rds_cluster_instance.orders'), ir, PRICE_BOOK, 'en').monthly).toBeGreaterThan(300);
    const pt = estimateResource(node(ir, 'aws_rds_cluster_instance.orders'), ir, TEST_BOOK, 'pt-BR');
    expect(pt.assumptions).toContain('Aurora PostgreSQL, em um cluster Aurora Standard');
  });

  it('on an I/O-Optimized cluster at that rate; Serverless v2 by ACU-hour; an unknown class unpriced', () => {
    const ir = project(`resource "aws_rds_cluster" "fast" {
  engine       = "aurora-mysql"
  storage_type = "aurora-iopt1"
}

resource "aws_rds_cluster" "elastic" {
  engine = "aurora-postgresql"

  serverlessv2_scaling_configuration {
    min_capacity = 0.5
    max_capacity = 4
  }
}

resource "aws_rds_cluster_instance" "fast" {
  cluster_identifier = aws_rds_cluster.fast.id
  instance_class     = "db.t4g.medium"
  engine             = "aurora-mysql"
}

resource "aws_rds_cluster_instance" "elastic" {
  cluster_identifier = aws_rds_cluster.elastic.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.elastic.engine
}

resource "aws_rds_cluster_instance" "odd" {
  cluster_identifier = "somewhere-else"
  instance_class     = "db.x9.huge"
  engine             = "aurora-mysql"
}
`);
    const fast = estimateResource(node(ir, 'aws_rds_cluster_instance.fast'), ir, TEST_BOOK, 'en');
    expect(fast.monthly).toBeCloseTo(730 * 0.095, 5);
    expect(fast.assumptions).toContain('Aurora MySQL, on an Aurora I/O-Optimized cluster');
    const elastic = estimateResource(node(ir, 'aws_rds_cluster_instance.elastic'), ir, TEST_BOOK, 'en');
    expect(elastic).toMatchObject({ kind: 'usage', note: 'Billed by use: $0.12 per ACU-hour (Aurora Serverless v2).' });
    expect(elastic.assumptions).toContain("Scales between 0.5 and 4 ACUs (the cluster's serverlessv2_scaling_configuration)");
    const elasticPt = estimateResource(node(ir, 'aws_rds_cluster_instance.elastic'), ir, TEST_BOOK, 'pt-BR');
    expect(elasticPt.assumptions).toContain('Escala entre 0,5 e 4 ACUs (serverlessv2_scaling_configuration do cluster)');
    const odd = estimateResource(node(ir, 'aws_rds_cluster_instance.odd'), ir, TEST_BOOK, 'en');
    expect(odd.kind).toBe('unknown');
  });

  it('every instance class the catalog offers has a price in the shipped table', () => {
    const field = getDef('aws_rds_cluster_instance')!.fields.find((f) => f.name === 'instance_class')!;
    for (const cls of field.options!.filter((o) => o !== 'db.serverless')) {
      expect(PRICE_BOOK.aws.rds.aurora[cls], cls).toBeDefined();
      expect(PRICE_BOOK.aws.rds.aurora[cls].ioOptimized, cls).toBeGreaterThan(PRICE_BOOK.aws.rds.aurora[cls].standard);
    }
  });
});
