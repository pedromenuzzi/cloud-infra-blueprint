/**
 * The level 6 goals against what learners really write: their own names,
 * `for_each` on the module instead of two calls, other subnet styles, every
 * way to pin a version; and the slips they should catch (copied ranges,
 * one zone, an unpinned module).
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

/** the lesson's solution with `main.tf` (after the AWS header) replaced */
const withMain = (slug: string, body: string): Files => ({ ...getLesson(slug)!.solution, ...aws(body) });

describe('6.1 and 6.2: calls, inputs and outputs under any name', () => {
  it('accepts a trailing slash and another call name, not a source without ./', () => {
    expect(goals('what-is-a-module', withMain('what-is-a-module', 'module "net" {\n  source = "./modules/network/"\n}\n')).call).toBe(true);
    expect(goals('what-is-a-module', withMain('what-is-a-module', 'module "network" {\n  source = "modules/network"\n}\n')).call).toBe(false);
  });

  it('follows the learner\'s variable and output names', () => {
    const lesson = getLesson('module-inputs-outputs')!;
    const files: Files = {
      ...lesson.solution,
      'modules/network/main.tf': lesson.solution['modules/network/main.tf'].replace('var.cidr_block', 'var.vpc_cidr'),
      'modules/network/variables.tf': 'variable "vpc_cidr" {\n  type = string\n}\n\nvariable "name" {\n  type = string\n}\n',
      'modules/network/outputs.tf': 'output "id" {\n  value = aws_vpc.this.id\n}\n',
      ...aws('module "net" {\n  source   = "./modules/network"\n  name     = "x"\n  vpc_cidr = "10.0.0.0/16"\n}\n\nresource "aws_security_group" "web" {\n  vpc_id = module.net.id\n}\n'),
    };
    expect(goals('module-inputs-outputs', files)).toEqual({ input: true, pass: true, output: true, use: true, apply: false });
  });

  it('wants the input passed and the output that returns the VPC', () => {
    const lesson = getLesson('module-inputs-outputs')!;
    const unpassed = { ...lesson.solution, ...aws('module "network" {\n  source = "./modules/network"\n  name   = "x"\n}\n\nresource "aws_security_group" "web" {\n  vpc_id = module.network.public_subnet_ids[0]\n}\n') };
    expect(goals('module-inputs-outputs', unpassed)).toMatchObject({ input: true, pass: false, output: true, use: false });
  });
});

const FOR_EACH_ENVS = `module "network" {
  source   = "./modules/network"
  for_each = {
    staging    = { cidr = "10.0.0.0/16", zones = ["us-east-1a", "us-east-1b"] }
    production = { cidr = "10.1.0.0/16", zones = ["us-east-1a", "us-east-1b", "us-east-1c"] }
  }

  name       = each.key
  cidr_block = each.value.cidr
  zones      = each.value.zones
}
`;

describe('6.3: environments read from the plan', () => {
  it('accepts for_each on the module', () => {
    expect(goals('module-reuse', withMain('module-reuse', FOR_EACH_ENVS))).toEqual({ twice: true, apart: true, names: true, zones: true, apply: false });
  });

  it('catches a copied block that kept the range and the name', () => {
    const lesson = getLesson('module-reuse')!;
    const staging = lesson.start['main.tf'].split('# TODO')[0].replace(/^[\s\S]*?(module "staging")/, '$1');
    const copied = withMain('module-reuse', `${staging}\n${staging.replace('module "staging"', 'module "production"')}`);
    expect(goals('module-reuse', copied)).toMatchObject({ twice: true, apart: false, names: false, zones: false });
  });
});

describe('6.4: pinning a Registry module', () => {
  const pinned = (version: string | null, source = 'terraform-aws-modules/vpc/aws') =>
    goals(
      'registry-modules',
      withMain(
        'registry-modules',
        `module "network" {\n  source = "${source}"\n${version === null ? '' : `  version = "${version}"\n`}  cidr = "10.0.0.0/16"\n  azs = ["us-east-1a"]\n  public_subnets = ["10.0.1.0/24"]\n}\n\nresource "aws_security_group" "web" {\n  vpc_id = module.network.vpc_id\n}\n`,
      ),
    );

  it('accepts an exact version, ~> and a bounded range', () => {
    for (const v of ['5.21.0', '= 5.21.0', '~> 5.21', '~> 5.0', '>= 5.0, < 6.0']) expect(pinned(v).version, v).toBe(true);
    expect(pinned('5.21.0', 'registry.terraform.io/terraform-aws-modules/vpc/aws')).toMatchObject({ source: true, version: true, inputs: true, use: true });
  });

  it('refuses no version, an open range and the wrong major', () => {
    for (const v of [null, '>= 5.0', '~> 6.0', '6.0.0', '~> 4.0']) expect(pinned(v).version, String(v)).toBe(false);
  });
});

/** a learner's own take on the challenge: for_each subnets, zones looked up, a separate route, other names */
const OWN_MODULE: Files = {
  'modules/net/vpc.tf': `data "aws_availability_zones" "here" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block = var.range
}

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "pub" {
  for_each          = toset(slice(data.aws_availability_zones.here.names, 0, %ZONES%))
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.range, 8, index(data.aws_availability_zones.here.names, each.key))
  availability_zone = each.key
}

resource "aws_route_table" "pub" {
  vpc_id = aws_vpc.main.id
}

resource "aws_route" "out" {
  route_table_id         = aws_route_table.pub.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.gw.id
}

resource "aws_route_table_association" "pub" {
  for_each       = aws_subnet.pub
  subnet_id      = each.value.id
  route_table_id = aws_route_table.pub.id
}
`,
  'modules/net/io.tf': `variable "range" {
  type = string
}

output "vpc" {
  value = aws_vpc.main.id
}

output "subnets" {
  value = [for s in aws_subnet.pub : s.id]
}
`,
};

const OWN_ROOT = `module "env" {
  source   = "./modules/net"
  for_each = { dev = "10.10.0.0/16", prod = "10.20.0.0/16" }
  range    = each.value
}

resource "aws_instance" "app" {
  ami           = "ami-0c02fb55956c7d316"
  instance_type = "t3.micro"
  subnet_id     = module.env["dev"].subnets[0]
}
`;

describe('C6: the challenge in the learner\'s own style', () => {
  const own = (zones: number, root = OWN_ROOT): Files => ({
    ...aws(root),
    ...Object.fromEntries(Object.entries(OWN_MODULE).map(([p, t]) => [p, t.replace('%ZONES%', String(zones))])),
  });

  it('accepts for_each everywhere, looked-up zones and other names', () => {
    expect(goals('challenge-network-module', own(2))).toEqual({ module: true, public: true, outputs: true, envs: true, server: true, apply: false });
  });

  it('wants two zones per environment and ranges apart', () => {
    expect(goals('challenge-network-module', own(1)).public).toBe(false);
    const noRoute = own(2);
    noRoute['modules/net/vpc.tf'] = noRoute['modules/net/vpc.tf'].replace(/resource "aws_route" "out" \{[^}]*\}/, '');
    expect(goals('challenge-network-module', noRoute).public).toBe(false);
    const overlapping = OWN_ROOT.replace('10.20.0.0/16', '10.10.128.0/17');
    expect(goals('challenge-network-module', own(2, overlapping))).toMatchObject({ public: true, envs: false });
  });

  it('wants the server placed through the module, not a pasted id', () => {
    const pasted = OWN_ROOT.replace('module.env["dev"].subnets[0]', '"subnet-0123456789abcdef0"');
    expect(goals('challenge-network-module', own(2, pasted)).server).toBe(false);
  });
});
