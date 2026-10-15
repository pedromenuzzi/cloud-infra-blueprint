/**
 * The level 4 goals against what learners really write: lookups read
 * through a local, `element()` instead of `[0]`, a conditional instead of
 * `lookup`, rule resources instead of inline blocks; and they still catch
 * a `depends_on` that repeats a reference, the wrong line deleted,
 * overlapping ranges and a zone pasted back in.
 */
import { describe, expect, it } from 'vitest';
import { checkGoals, lessonContext } from '../goals';
import { getLesson } from '../lessons';
import type { Files } from '../types';
import { aws } from './shared';

/** goal id → met, for a lesson's goals against these files */
function goals(slug: string, files: Files): Record<string, boolean> {
  const lesson = getLesson(slug)!;
  const met = checkGoals(lesson.goals, lessonContext(files));
  return Object.fromEntries(lesson.goals.map((g, i) => [g.id, met[i]]));
}

/** the lesson's solution with `main.tf` edited */
function edited(slug: string, edit: (main: string) => string, file = 'main.tf'): Files {
  const { solution } = getLesson(slug)!;
  return { ...solution, [file]: edit(solution[file]) };
}

describe('4.1 and 4.2: references and depends_on', () => {
  it('a pasted id keeps the subnet out of the VPC', () => {
    const pasted = edited('implicit-dependencies', (m) => m.replace(/(resource "aws_subnet"[\s\S]*?vpc_id\s+= )aws_vpc\.main\.id/, '$1"vpc-0a1b2c3d4e5f60718"'));
    expect(goals('implicit-dependencies', pasted)).toMatchObject({ subnet: false, route: true, association: true });
  });

  it('accepts waiting for an inline role policy', () => {
    const inline = edited('depends-on', (m) => m.replace('aws_iam_role_policy_attachment.read_config]', 'aws_iam_role_policy.read_config]'));
    const files = { ...inline, 'iam.tf': `${inline['iam.tf']}\nresource "aws_iam_role_policy" "read_config" {\n  role   = aws_iam_role.app.id\n  policy = "{}"\n}\n` };
    expect(goals('depends-on', files)).toMatchObject({ waits: true, redundant: true, profile: true });
  });

  it('catches a depends_on that repeats a reference, on any block', () => {
    const twice = edited('depends-on', (m) => m.replace('depends_on = [', 'depends_on = [aws_iam_instance_profile.app, '));
    expect(goals('depends-on', twice)).toMatchObject({ waits: true, redundant: false });
  });

  it('wants the reference kept when the depends_on goes', () => {
    const { start } = getLesson('depends-on')!;
    const wrongLine = { ...start, 'iam.tf': start['iam.tf'].replace(/\n {2}role = aws_iam_role\.app\.name/, '') };
    expect(goals('depends-on', wrongLine)).toMatchObject({ redundant: true, profile: false });
  });
});

describe('4.3 and 4.4: lookups', () => {
  it('reads a lookup through a local, and a zone picked with element()', () => {
    const viaLocal = edited('data-sources', (m) =>
      m
        .replace('ami           = data.aws_ami.ubuntu.id', 'ami           = local.image')
        .replace('names[0]', 'names[0]\n}\n\nlocals {\n  image = data.aws_ami.ubuntu.id')
        .replace('data.aws_availability_zones.available.names[0]', 'element(data.aws_availability_zones.available.names, 0)'),
    );
    expect(goals('data-sources', viaLocal)).toMatchObject({ ami: true, instance: true, zone: true, output: true });
  });

  it('wants the newest image, and an output that reads it', () => {
    const anyImage = edited('data-sources', (m) => m.replace('most_recent = true', 'most_recent = false').replace('data.aws_ami.ubuntu.name', 'data.aws_ami.ubuntu.id'));
    expect(goals('data-sources', anyImage)).toMatchObject({ ami: false, instance: true, output: false });
  });

  it('accepts a rule resource, and a bucket name built in a local', () => {
    const files = edited('existing-infrastructure', (m) =>
      m
        .replace(/\n {2}ingress \{[\s\S]*?\n {2}\}\n/, '\n')
        .replace(/bucket = "app-logs-[^\n]*/, 'bucket = local.bucket_name')
        .concat(`
locals {
  bucket_name = "app-logs-\${data.aws_caller_identity.current.account_id}-\${data.aws_region.current.name}"
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.app.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = data.aws_vpc.default.cidr_block
}
`),
    );
    expect(goals('existing-infrastructure', files)).toMatchObject({ vpc: true, sg: true, range: true, bucket: true });
  });

  it('a VPC of your own is not the existing one', () => {
    const own = aws(`resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_security_group" "app" {
  vpc_id = aws_vpc.main.id
}
`);
    expect(goals('existing-infrastructure', own)).toMatchObject({ vpc: false, sg: false });
  });
});

describe('4.5 and C4: expressions', () => {
  it('accepts a conditional and a Name prefix from a local', () => {
    const files = edited('expressions-and-functions', (m) =>
      m
        .replace('lookup(local.instance_types, var.environment, "t3.micro")', 'var.environment == "prod" ? "t3.large" : "t3.micro"')
        .replace('"${var.environment}-web"', '"${local.prefix}-web"')
        .replace('locals {', 'locals {\n  prefix = var.environment\n'),
    );
    expect(goals('expressions-and-functions', files)).toMatchObject({ cidrsubnet: true, size: true, tags: true, name: true });
  });

  it('catches two subnets on the same range, and a literal Name', () => {
    const files = edited('expressions-and-functions', (m) => m.replace('cidrsubnet(aws_vpc.main.cidr_block, 8, 2)', 'cidrsubnet(aws_vpc.main.cidr_block, 8, 1)').replace('"${var.environment}-web"', '"dev-web"'));
    expect(goals('expressions-and-functions', files)).toMatchObject({ cidrsubnet: false, tags: true, name: false });
  });

  it('the challenge refuses a zone pasted back in', () => {
    const pasted = edited('challenge-data-driven', (m) =>
      m.replace(/(resource "aws_vpc"[\s\S]*?\n\}\n)/, '$1\nresource "aws_subnet" "spare" {\n  vpc_id            = aws_vpc.main.id\n  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 2)\n  availability_zone = "us-east-1b"\n  tags              = merge(local.common_tags, { Name = "spare" })\n}\n'),
    );
    expect(goals('challenge-data-driven', pasted)).toMatchObject({ ami: true, range: true, tags: true, pasted: false });
  });
});
