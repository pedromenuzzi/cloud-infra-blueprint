/**
 * The level 2 and 3 goals accept the learner's own style (count or separate
 * blocks, inline or separate rules, a policy document) and still catch what
 * is wrong (same zone twice, overlapping ranges, SSH left open).
 */
import { describe, expect, it } from 'vitest';
import { checkGoals, lessonContext } from '../goals';
import { getLesson } from '../lessons';
import { aws } from './shared';

/** goal id → met, for a lesson's goals against these files */
function goals(slug: string, files: Record<string, string>): Record<string, boolean> {
  const lesson = getLesson(slug)!;
  const met = checkGoals(lesson.goals, lessonContext(files));
  return Object.fromEntries(lesson.goals.map((g, i) => [g.id, met[i]]));
}

const VPC_IGW = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.main.id
}
`;

const countNetwork = (publicZones: string, privateCidr: string) =>
  aws(`${VPC_IGW}
data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = element(${publicZones}, count.index)
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + ${privateCidr})
  availability_zone = data.aws_availability_zones.available.names[count.index]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
}

resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.gw.id
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
`);

describe('the two-zone network challenge', () => {
  it('accepts count, data-source zones and a separate aws_route', () => {
    expect(goals('challenge-two-az-network', countNetwork('["us-east-1a", "us-east-1b"]', '10'))).toMatchObject({
      igw: true,
      public: true,
      private: true,
      fit: true,
    });
  });

  it('wants two zones and ranges that do not overlap', () => {
    const met = goals('challenge-two-az-network', countNetwork('["us-east-1a", "us-east-1a"]', '1'));
    expect(met.public).toBe(false);
    expect(met.private).toBe(true);
    expect(met.fit).toBe(false);
  });

  it('reads the route from an aws_route resource', () => {
    expect(goals('internet-gateway-routes', countNetwork('["us-east-1a", "us-east-1b"]', '10')).route).toBe(true);
  });
});

const network = (instance: string, extra = '') => ({
  ...aws(`${instance}\n${extra}`),
  'network.tf': getLesson('challenge-web-server')!.start['network.tf'],
});

const SG_WITH_RULES = `resource "aws_security_group" "web" {
  description = "web"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
`;

const INSTANCE = `resource "aws_instance" "web" {
  ami                    = "ami-0c02fb55956c7d316"
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]

  metadata_options {
    http_tokens = "required"
  }
}
`;

describe('security goals', () => {
  it('accept rules written as separate resources', () => {
    expect(goals('security-groups', network(SG_WITH_RULES))).toMatchObject({ sg: true, https: true, egress: true });
  });

  it('see SSH opened by a group nobody uses, and accept SSH limited to one address', () => {
    const openSsh = `resource "aws_security_group" "debug" {
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["%s"]
  }
}
`;
    const open = goals('challenge-web-server', network(`${SG_WITH_RULES}\n${INSTANCE}`, openSsh.replace('%s', '0.0.0.0/0')));
    expect(open).toMatchObject({ public: true, 'https-only': true, 'no-ssh': false, imdsv2: true, grade: false });
    const mine = goals('challenge-web-server', network(`${SG_WITH_RULES}\n${INSTANCE}`, openSsh.replace('%s', '203.0.113.10/32')));
    expect(mine).toMatchObject({ 'https-only': true, 'no-ssh': true });
  });

  it('want 443 alone from the internet', () => {
    const wide = SG_WITH_RULES.replace('to_port           = 443', 'to_port           = 444');
    expect(goals('challenge-web-server', network(`${wide}\n${INSTANCE}`))['https-only']).toBe(false);
  });

  it('read an EC2 trust policy from a policy document', () => {
    const role = `data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "web" {
  assume_role_policy = data.aws_iam_policy_document.assume.json
}
`;
    expect(goals('iam-role-for-ec2', network(role)).role).toBe(true);
    expect(goals('iam-role-for-ec2', network(role.replace('ec2.', 'lambda.'))).role).toBe(false);
  });
});
