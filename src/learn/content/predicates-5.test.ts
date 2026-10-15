/**
 * The level 5 goals against what learners really write: `cidrsubnet` or a
 * template, a data source for zones, `toset`, a renamed iterator, `try()`
 * instead of `one()`, a whole-resource move chained with per-instance ones;
 * and what they must still catch (overlapping ranges, a copied rule left
 * behind, `[0]` in an output, a move that changes the range).
 */
import { describe, expect, it } from 'vitest';
import { checkGoals, lessonContext } from '../goals';
import { getLesson } from '../lessons';
import { simulate } from '../sim/simulate';
import type { Files, SimCommand, SimState } from '../types';
import { aws } from './shared';

/** goal id → met */
function met(slug: string, files: Files, ran: SimCommand[] = [], state: SimState | null = null): Record<string, boolean> {
  const lesson = getLesson(slug)!;
  const results = checkGoals(lesson.goals, lessonContext(files, { ran, state }));
  return Object.fromEntries(lesson.goals.map((g, i) => [g.id, results[i]]));
}

/** the state a simulated apply of `files` leaves */
function appliedState(files: Files): SimState {
  const result = simulate('apply', files, null, { initialized: true, autoApprove: true });
  expect(result.ok).toBe(true);
  return result.state!;
}

const VPC = 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n';

describe('5.1 count', () => {
  const subnets = (count: string, cidr: string, zone: string, extra = '') =>
    aws(`${VPC}
locals {
  zones = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_subnet" "app" {
  count             = ${count}
  vpc_id            = aws_vpc.main.id
  cidr_block        = ${cidr}
  availability_zone = ${zone}
}
${extra}`);

  it('accepts cidrsubnet, length() and a list comprehension output', () => {
    const files = subnets(
      'length(local.zones)',
      'cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)',
      'element(local.zones, count.index)',
      'output "ids" {\n  value = [for s in aws_subnet.app : s.id]\n}\n',
    );
    expect(met('count', files)).toMatchObject({ count: true, ranges: true, zones: true, output: true });
  });

  it('accepts zones from a data source', () => {
    expect(met('count', subnets('3', '"10.0.${count.index + 1}.0/24"', 'data.aws_availability_zones.available.names[count.index]')).zones).toBe(true);
  });

  it('wants a range and a zone of its own for each subnet', () => {
    expect(met('count', subnets('3', '"10.0.1.0/24"', '"us-east-1a"'))).toMatchObject({ count: true, ranges: false, zones: false });
    expect(met('count', subnets('3', '"10.1.${count.index}.0/24"', 'local.zones[count.index]')).ranges).toBe(false);
  });

  it('counts the instances the apply left', () => {
    const files = subnets('3', '"10.0.${count.index + 1}.0/24"', 'local.zones[count.index]');
    expect(met('count', files, ['apply'], appliedState(files)).apply).toBe(true);
    expect(met('count', getLesson('count')!.start, ['apply'], appliedState(getLesson('count')!.start)).apply).toBe(false);
  });
});

describe('5.2 for_each', () => {
  const lesson = getLesson('for-each')!;

  it('sees api removed from the count list, before any for_each', () => {
    const removed = { 'main.tf': lesson.start['main.tf'].replace('"web", "api", "data"', '"web", "data"') };
    expect(met('for-each', removed, ['apply', 'plan'], appliedState(lesson.start))).toMatchObject({
      apply: true,
      shift: true,
      'for-each': false,
    });
    expect(met('for-each', lesson.start, ['apply', 'plan']).shift).toBe(false);
  });

  it('accepts an inline map and a templated name', () => {
    const files = aws(`${VPC}
resource "aws_subnet" "app" {
  for_each   = { web = "10.0.1.0/24", data = "10.0.3.0/24" }
  vpc_id     = aws_vpc.main.id
  cidr_block = each.value

  tags = {
    Name = "\${each.key}-subnet"
  }
}
`);
    expect(met('for-each', files, ['plan'])).toMatchObject({ shift: true, 'for-each': true, name: true });
  });

  it('wants the state addressed by exactly the keys of the code', () => {
    expect(met('for-each', lesson.solution, [], appliedState(lesson.solution)).keys).toBe(true);
    expect(met('for-each', lesson.solution, [], appliedState(lesson.start)).keys).toBe(false);
  });
});

describe('5.3 dynamic blocks', () => {
  const group = (body: string, variable = 'variable "ports" {\n  default = [80, 443, 8080]\n}\n') =>
    aws(`${VPC}
${variable}
resource "aws_security_group" "app" {
  vpc_id = aws_vpc.main.id

${body}
}
`);

  it('accepts toset() and a renamed iterator', () => {
    const files = group(`  dynamic "ingress" {
    for_each = toset(var.ports)
    iterator = port

    content {
      from_port   = port.value
      to_port     = port.value
      protocol    = "tcp"
      cidr_blocks = ["10.0.0.0/16"]
    }
  }`);
    expect(met('dynamic-blocks', files, ['plan'])).toEqual({ variable: true, dynamic: true, ports: true, copies: true, plan: true });
  });

  it('accepts a list of objects', () => {
    const files = group(
      `  dynamic "ingress" {
    for_each = var.rules
    content {
      from_port   = ingress.value.port
      to_port     = ingress.value.port
      protocol    = "tcp"
      cidr_blocks = [ingress.value.cidr]
    }
  }`,
      'variable "rules" {\n  default = [{ port = 80, cidr = "10.0.0.0/16" }, { port = 443, cidr = "10.0.0.0/16" }, { port = 8080, cidr = "10.0.0.0/16" }]\n}\n',
    );
    expect(met('dynamic-blocks', files)).toMatchObject({ variable: true, dynamic: true, ports: true, copies: true });
  });

  it('catches a copied rule left behind and a port not read from the loop', () => {
    const files = group(`  dynamic "ingress" {
    for_each = var.ports
    content {
      from_port   = 80
      to_port     = 80
      protocol    = "tcp"
      cidr_blocks = ["10.0.0.0/16"]
    }
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }`);
    expect(met('dynamic-blocks', files)).toMatchObject({ dynamic: true, ports: false, copies: false });
  });
});

describe('5.4 conditional resources', () => {
  const lesson = getLesson('conditional-resources')!;
  const withOutput = (value: string) => ({
    ...lesson.solution,
    'main.tf': lesson.solution['main.tf'].replace('one(aws_nat_gateway.nat[*].public_ip)', value),
  });

  it('accepts try(), a conditional and a count that follows the NAT gateway', () => {
    expect(met('conditional-resources', withOutput('try(aws_nat_gateway.nat[0].public_ip, null)')).refs).toBe(true);
    expect(met('conditional-resources', withOutput('var.enable_nat ? aws_nat_gateway.nat[0].public_ip : null')).refs).toBe(true);
    const following = {
      ...lesson.solution,
      'main.tf': lesson.solution['main.tf'].replace(
        'count                  = var.enable_nat ? 1 : 0',
        'count                  = length(aws_nat_gateway.nat)',
      ),
    };
    expect(met('conditional-resources', following).together).toBe(true);
  });

  it('refuses [0] in the output and a reference without its key', () => {
    expect(met('conditional-resources', withOutput('aws_nat_gateway.nat[0].public_ip')).refs).toBe(false);
    const noKey = { ...lesson.solution, 'main.tf': lesson.solution['main.tf'].replace('aws_eip.nat[0].id', 'aws_eip.nat.id') };
    expect(met('conditional-resources', noKey).refs).toBe(false);
  });

  it('wants the apply done with the switch off', () => {
    const on = { ...lesson.solution, 'main.tf': lesson.solution['main.tf'].replace('default     = false', 'default     = true') };
    expect(met('conditional-resources', on, ['apply'], appliedState(on)).apply).toBe(false);
    expect(met('conditional-resources', lesson.solution, ['apply'], appliedState(lesson.solution)).apply).toBe(true);
  });
});

describe('5.5 moved blocks', () => {
  const lesson = getLesson('moved-blocks')!;
  const code = (body: string) => aws(`${VPC}\n${body}`);
  const RENAMED = `locals {
  zones = ["us-east-1a", "us-east-1b"]
}

resource "aws_subnet" "app" {
  count             = length(local.zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.\${count.index + 1}.0/24"
  availability_zone = local.zones[count.index]
}
`;
  const WHOLE = 'moved {\n  from = aws_subnet.this\n  to   = aws_subnet.app\n}\n';

  it('sees a rename only when a moved block keeps the state', () => {
    expect(met('moved-blocks', code(RENAMED))).toMatchObject({ rename: false, 'for-each': false });
    expect(met('moved-blocks', code(`${RENAMED}\n${WHOLE}`))).toMatchObject({ rename: true, 'for-each': false });
  });

  it('follows a whole-resource move chained with per-instance ones, and toset() keys', () => {
    const files = code(`locals {
  zones = ["us-east-1a", "us-east-1b"]
}

resource "aws_subnet" "app" {
  for_each          = toset(local.zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, index(local.zones, each.key) + 1)
  availability_zone = each.key
}

${WHOLE}
moved {
  from = aws_subnet.app[0]
  to   = aws_subnet.app["us-east-1a"]
}

moved {
  from = aws_subnet.app[1]
  to   = aws_subnet.app["us-east-1b"]
}
`);
    expect(met('moved-blocks', files)).toMatchObject({ rename: true, 'for-each': true, same: true });
  });

  it('catches a move that swaps the ranges', () => {
    const swapped = { 'main.tf': lesson.solution['main.tf'].replace('"us-east-1a" = "10.0.1.0/24"', '"us-east-1a" = "10.0.9.0/24"') };
    expect(met('moved-blocks', swapped)).toMatchObject({ 'for-each': true, same: false });
  });
});

describe('C5 a network from data', () => {
  const lesson = getLesson('challenge-subnets-from-map')!;

  it('accepts a local map and a NAT gateway placed with values()', () => {
    const main = lesson.solution['main.tf']
      .replace('for_each          = var.subnets', 'for_each          = local.subnets')
      .replace('aws_subnet.public["public_a"].id', 'values(aws_subnet.public)[0].id')
      .concat('\nlocals {\n  subnets = var.subnets\n}\n');
    expect(met('challenge-subnets-from-map', { ...lesson.solution, 'main.tf': main })).toMatchObject({
      map: true,
      spread: true,
      rules: true,
      nat: true,
      valid: true,
    });
  });

  it('wants two zones, no copied rules and a NAT gateway on the switch', () => {
    const main = lesson.solution['main.tf']
      .replace('az   = "us-east-1b"', 'az   = "us-east-1a"')
      .replace('  dynamic "ingress" {', '  ingress {\n    from_port   = 22\n    to_port     = 22\n    protocol    = "tcp"\n    cidr_blocks = ["10.0.0.0/16"]\n  }\n\n  dynamic "ingress" {')
      .replace('count         = var.enable_nat ? 1 : 0', 'count         = 1');
    expect(met('challenge-subnets-from-map', { ...lesson.solution, 'main.tf': main })).toMatchObject({ spread: false, rules: false, nat: false });
  });
});
