/**
 * Projects saved before `aws_rds_cluster` held its instances: the cluster
 * was a plain node (its `@blueprint:pos` has no size) and the instances were
 * top-level nodes beside it, in canvas coordinates. Opened now, the cluster
 * is drawn around them where they were, what it covers moves clear, and the
 * first edit writes those spots down: only theirs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAbsoluteRects } from '@/components/ProjectThumbnail';
import { parseProject } from '@/hcl/parser';
import { lit } from '@/ir/expr';
import { deriveStructure } from '@/ir/graph';
import { ARRANGE } from '@/ir/layout';
import { layoutWithModules } from '@/ir/moduleLayout';
import { createProject } from '@/lib/storage';
import { getDef, isContainerType } from '@/resources/registry';
import { useEditor } from './store';

/** "shop" as the editor saved it on 2026-09-30, Aurora instances dragged next to their cluster */
const SAVED = `# @blueprint:pos=40,60,920,600
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true

  tags = {
    Name = "shop-vpc"
  }
}

# @blueprint:pos=32,64,400,180
resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
}

# @blueprint:pos=468,64,400,180
resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "us-east-1b"
}

# @blueprint:pos=32,288,560,280
resource "aws_db_subnet_group" "aurora" {
  name       = "shop-aurora"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

# @blueprint:pos=32,600
resource "aws_security_group" "db" {
  name   = "shop-db"
  vpc_id = aws_vpc.main.id
}

# @blueprint:pos=28,56
resource "aws_rds_cluster" "shop" {
  cluster_identifier          = "shop-aurora"
  engine                      = "aurora-postgresql"
  engine_version              = "16.4"
  database_name               = "shop"
  master_username             = "dbadmin"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.aurora.name
  vpc_security_group_ids      = [aws_security_group.db.id]
  storage_encrypted           = true
  skip_final_snapshot         = true
}

# the writer
# @blueprint:pos=330,404
resource "aws_rds_cluster_instance" "writer" {
  identifier         = "shop-aurora-1"
  cluster_identifier = aws_rds_cluster.shop.id
  instance_class     = "db.r6g.large"
  engine             = aws_rds_cluster.shop.engine
  engine_version     = aws_rds_cluster.shop.engine_version
}

# @blueprint:pos=330,500
resource "aws_rds_cluster_instance" "reader" {
  identifier         = "shop-aurora-2"
  cluster_identifier = aws_rds_cluster.shop.id
  instance_class     = "db.r6g.large"
  engine             = aws_rds_cluster.shop.engine
  engine_version     = aws_rds_cluster.shop.engine_version
}

# @blueprint:pos=28,160
resource "aws_db_instance" "reporting" {
  identifier           = "shop-reporting"
  engine               = "postgres"
  instance_class       = "db.t4g.micro"
  allocated_storage    = 20
  db_subnet_group_name = aws_db_subnet_group.aurora.name
  skip_final_snapshot  = true
}

# @blueprint:pos=40,700
resource "aws_cloudwatch_log_group" "app" {
  name              = "/shop/app"
  retention_in_days = 30
}

# @blueprint:pos=1000,60
resource "aws_s3_bucket" "assets" {
  bucket = "shop-assets"
}
`;

const ADOPTED = [
  'aws_rds_cluster.shop',
  'aws_rds_cluster_instance.writer',
  'aws_rds_cluster_instance.reader',
  'aws_db_instance.reporting',
  'aws_security_group.db',
  'aws_cloudwatch_log_group.app',
];

/** each `@blueprint:pos` line, by the block below it */
function posLines(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/# @blueprint:pos=([\d.,-]+)\n(?:#[^\n]*\n)*resource "(\w+)" "(\w+)"/g)) out.set(`${m[2]}.${m[3]}`, m[1]);
  return out;
}

function drawn(files: Record<string, string>) {
  const { ir } = parseProject(files);
  deriveStructure(ir, getDef);
  const moved = layoutWithModules(ir, isContainerType);
  return { ir, moved, rects: computeAbsoluteRects(ir) };
}

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('a project saved before the Aurora cluster held its instances', () => {
  it('draws the cluster around its instances where they were, and moves only what it covers', () => {
    const { ir, moved, rects } = drawn({ 'main.tf': SAVED });
    expect([...moved].sort()).toEqual([...ADOPTED].sort());
    const cluster = rects.get('aws_rds_cluster.shop')!;
    for (const [id, saved] of [
      ['aws_rds_cluster_instance.writer', { x: 330, y: 404 }],
      ['aws_rds_cluster_instance.reader', { x: 330, y: 500 }],
    ] as const) {
      const r = rects.get(id)!;
      expect(r.node.parentId).toBe('aws_rds_cluster.shop');
      // inside the cluster, below its title bar
      expect(r.x).toBeGreaterThanOrEqual(cluster.x + ARRANGE.pad);
      expect(r.y).toBeGreaterThanOrEqual(cluster.y + ARRANGE.top);
      expect(r.x + r.w).toBeLessThanOrEqual(cluster.x + cluster.w);
      expect(r.y + r.h).toBeLessThanOrEqual(cluster.y + cluster.h);
      // where it was drawn (at most a title bar lower)
      expect(r.x).toBe(saved.x);
      expect(r.y - saved.y).toBeGreaterThanOrEqual(0);
      expect(r.y - saved.y).toBeLessThanOrEqual(ARRANGE.top);
    }
    // the cluster stays inside its subnet group, which stays inside the VPC
    const group = rects.get('aws_db_subnet_group.aurora')!;
    const vpc = rects.get('aws_vpc.main')!;
    expect(cluster.x + cluster.w).toBeLessThanOrEqual(group.x + group.w);
    expect(cluster.y + cluster.h).toBeLessThanOrEqual(group.y + group.h);
    expect(group.y + group.h).toBeLessThanOrEqual(vpc.y + vpc.h);
    // nothing overlaps on any level
    const all = [...rects.values()];
    for (const a of all) {
      for (const b of all) {
        if (a === b || a.node.parentId !== b.node.parentId) continue;
        expect(overlap(a, b), `${a.node.id} / ${b.node.id}`).toBe(false);
      }
    }
    // what wasn't in the way kept its spot
    const at = (id: string) => ir.resources.find((r) => r.id === id)!.position;
    expect(at('aws_subnet.private_a')).toEqual({ x: 32, y: 64, w: 400, h: 180 });
    expect(at('aws_subnet.private_b')).toEqual({ x: 468, y: 64, w: 400, h: 180 });
    expect(at('aws_s3_bucket.assets')).toEqual({ x: 1000, y: 60 });
    expect(at('aws_db_subnet_group.aurora')).toMatchObject({ x: 32, y: 288 });
    expect(at('aws_vpc.main')).toMatchObject({ x: 40, y: 60 });
  });

  it('a cluster on its own grows around the instances placed beside it', () => {
    const { ir, moved } = drawn({
      'main.tf': `# @blueprint:pos=100,100
resource "aws_rds_cluster" "solo" {
  engine = "aurora-mysql"
}

# @blueprint:pos=340,100
resource "aws_rds_cluster_instance" "one" {
  cluster_identifier = aws_rds_cluster.solo.id
  instance_class     = "db.t4g.medium"
  engine             = "aurora-mysql"
}

# @blueprint:pos=600,600
resource "aws_sqs_queue" "jobs" {
  name = "jobs"
}
`,
    });
    expect([...moved].sort()).toEqual(['aws_rds_cluster.solo', 'aws_rds_cluster_instance.one']);
    const cluster = ir.resources.find((r) => r.id === 'aws_rds_cluster.solo')!.position!;
    const one = ir.resources.find((r) => r.id === 'aws_rds_cluster_instance.one')!.position!;
    expect({ x: cluster.x + one.x, y: cluster.y + one.y }).toEqual({ x: 340, y: 100 });
    expect(cluster).toMatchObject({ x: 100, y: 100 - ARRANGE.top });
  });

  it('leaves projects saved with today’s layout alone', () => {
    const { moved } = drawn({
      'main.tf': `# @blueprint:pos=100,100,520,220
resource "aws_rds_cluster" "solo" {
  engine = "aurora-mysql"
}

# @blueprint:pos=28,56
resource "aws_rds_cluster_instance" "one" {
  cluster_identifier = aws_rds_cluster.solo.id
  instance_class     = "db.t4g.medium"
  engine             = "aurora-mysql"
}
`,
    });
    expect(moved.size).toBe(0);
  });
});

describe('the editor with such a project', () => {
  const editor = () => useEditor.getState();

  beforeEach(() => {
    vi.useFakeTimers();
    editor().load(createProject({ name: 'shop', files: { 'main.tf': SAVED } }));
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('opens it without touching the text, and writes the new spots with the first edit, in one undo step', () => {
    expect(editor().files['main.tf']).toBe(SAVED);
    const shown = new Map(editor().ir.resources.map((r) => [r.id, { ...r.position }]));

    editor().applyCanvasOps([{ kind: 'set_arg', nodeId: 'aws_s3_bucket.assets', field: 'bucket', value: lit('shop-static') }]);
    const text = editor().files['main.tf'];
    expect(text).toContain('bucket = "shop-static"');
    // only the moved blocks' position lines changed
    const before = posLines(SAVED);
    const after = posLines(text);
    const changed = [...after].filter(([id, p]) => before.get(id) !== p).map(([id]) => id);
    expect(changed.sort()).toEqual([...ADOPTED].sort());
    expect(text.replace(/# @blueprint:pos=[\d.,-]+\n/g, '')).toBe(
      SAVED.replace(/# @blueprint:pos=[\d.,-]+\n/g, '').replace('shop-assets', 'shop-static'),
    );
    expect(after.get('aws_rds_cluster.shop')).toMatch(/^\d+,\d+,\d+,\d+$/);

    // the drawing didn't move, and the written text draws the same from scratch
    for (const r of editor().ir.resources) expect(r.position, r.id).toEqual(shown.get(r.id));
    const again = drawn({ 'main.tf': text });
    expect(again.moved.size).toBe(0);
    for (const r of again.ir.resources) expect(r.position, r.id).toEqual(shown.get(r.id));

    // one undo step back to the file as it was saved
    editor().undo();
    expect(editor().files['main.tf']).toBe(SAVED);
  });

  it('a move of the cluster keeps its instances inside it', () => {
    const writer = () => computeAbsoluteRects(editor().ir).get('aws_rds_cluster_instance.writer')!;
    const cluster = editor().ir.resources.find((r) => r.id === 'aws_rds_cluster.shop')!;
    const was = writer();
    editor().applyCanvasOps([{ kind: 'move_node', nodeId: cluster.id, position: { ...cluster.position!, x: cluster.position!.x + 40 } }]);
    expect(writer().x).toBe(was.x + 40);
    expect(writer().y).toBe(was.y);
    expect(drawn(editor().files).moved.size).toBe(0);
  });
});
