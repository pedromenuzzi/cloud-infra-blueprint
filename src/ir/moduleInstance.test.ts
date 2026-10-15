import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { lit } from './expr';
import { flattenInstances, inModuleLabel, instantiatePath, moduleInstances } from './moduleInstance';

const MODULE = `variable "cidr" {}
variable "ports" {
  default = [22, 443]
}
variable "tags" {
  default = { team = "core" }
}
variable "name" {}

resource "aws_security_group" "web" {
  name = "\${var.name}-web"
  ingress {
    from_port   = var.ports[1]
    to_port     = var.ports[1]
    protocol    = "tcp"
    cidr_blocks = [var.cidr]
  }
  tags = var.tags
}

resource "aws_instance" "app" {
  provider      = aws
  instance_type = "t3.micro"
  team          = var.tags.team
}
`;

function project(main: string, extra: Record<string, string> = {}) {
  const files = { 'main.tf': main, 'modules/web/main.tf': MODULE, ...extra };
  return { files, ir: parseProject(files).ir };
}

describe('a call to a local module, instantiated', () => {
  it('puts literal inputs (and the defaults it leaves alone) into the module', () => {
    const { files, ir } = project(`variable "office" {
  default = "203.0.113.0/24"
}

module "web" {
  source = "./modules/web"
  cidr   = var.office
  name   = local.name
}
`);
    const [web] = moduleInstances(ir, files);
    expect(web.id).toBe('module.web');
    expect(web.count).toBe(1);
    const sg = web.ir.resources.find((r) => r.id === 'aws_security_group.web')!;
    const ingress = sg.args.ingress.kind === 'block' ? sg.args.ingress.body : {};
    expect(ingress.cidr_blocks).toEqual({ kind: 'list', items: [lit('203.0.113.0/24')] });
    expect(ingress.from_port).toEqual(lit(443));
    expect(sg.args.tags.kind).toBe('object');
    expect(web.ir.resources.find((r) => r.id === 'aws_instance.app')!.args.team).toEqual(lit('core'));
    // an expression at the call: the module still reads var.name, which says where it comes from
    expect(web.fromInputs).toEqual(new Map([['name', 'local.name']]));
    expect(web.ir.variables.find((v) => v.name === 'name')!.args.default).toBeUndefined();
    // the raw interpolation is left as written
    expect(sg.args.name).toEqual({ kind: 'raw', hcl: '"${var.name}-web"' });
    expect(inModuleLabel(web.path, 'aws_security_group.web')).toBe('module.web › aws_security_group.web');
  });

  it('inherits the caller’s providers, remapped by `providers = { … }`', () => {
    const { files, ir } = project(`provider "aws" {
  region = "us-east-1"
}

provider "aws" {
  alias  = "eu"
  region = "eu-west-1"
}

module "here" {
  source = "./modules/web"
}

module "there" {
  source    = "./modules/web"
  providers = { aws = aws.eu }
}
`);
    const [here, there] = moduleInstances(ir, files);
    const region = (m: typeof here) => m.ir.providers.map((p) => [p.name, p.args.region, p.args.alias]);
    expect(region(here)).toEqual([['aws', lit('us-east-1'), undefined]]);
    expect(region(there)).toEqual([['aws', lit('eu-west-1'), undefined]]);
  });

  it('counts the instances of a repeated call, nests calls, and skips what it can’t read', () => {
    const { files, ir } = project(
      `module "many" {
  source   = "./modules/outer"
  for_each = toset(["a", "b"])
}

module "registry" {
  source  = "terraform-aws-modules/vpc/aws"
}

module "missing" {
  source = "./modules/nope"
}

module "broken" {
  source = "./modules/broken"
}
`,
      {
        'modules/outer/main.tf': 'module "inner" {\n  source = "../web"\n  cidr   = "10.0.0.0/8"\n}\n\nmodule "self" {\n  source = "."\n}\n',
        'modules/broken/main.tf': 'resource "aws_vpc" "x" {\n',
      },
    );
    const list = moduleInstances(ir, files);
    expect(list.map((m) => [m.id, m.count, m.repeat])).toEqual([['module.many', 2, 'for_each']]);
    // a module that calls itself stops there
    expect(flattenInstances(list).map((m) => m.label)).toEqual(['module.many', 'module.many › module.inner']);
    expect(list[0].nested[0].steps).toEqual([
      { dir: 'modules/outer', name: 'many' },
      { dir: 'modules/web', name: 'inner' },
    ]);
  });

  it('puts in the module’s locals that are literal once the inputs are in, and follows the caller’s locals', () => {
    const LOCALS = `variable "env" {}
variable "office" {}

locals {
  cidrs     = [var.office]
  ports     = { ssh = 22, tls = "\${var.env}" }
  type      = local.base_type
  base_type = "t3.large"
  name      = "\${var.env}-app"
  a         = local.b
  b         = local.a
}

resource "aws_security_group" "web" {
  ingress {
    from_port   = local.ports.ssh
    to_port     = local.ports.tls
    cidr_blocks = local.cidrs
  }
}

resource "aws_instance" "app" {
  instance_type = local.type
  name          = local.name
  loop          = local.a
}

data "aws_ami" "base" {
  owners = local.cidrs
}
`;
    const files = {
      'main.tf': `locals {\n  office = "203.0.113.0/24"\n}\n\nmodule "web" {\n  source = "./modules/locals"\n  env    = "prod"\n  office = local.office\n}\n`,
      'modules/locals/main.tf': LOCALS,
    };
    const [web] = moduleInstances(parseProject(files).ir, files);
    expect(web.fromInputs.size).toBe(0);
    const sg = web.ir.resources.find((r) => r.id === 'aws_security_group.web')!;
    const ingress = sg.args.ingress.kind === 'block' ? sg.args.ingress.body : {};
    expect(ingress.cidr_blocks).toEqual({ kind: 'list', items: [lit('203.0.113.0/24')] });
    expect(ingress.from_port).toEqual(lit(22));
    // a field of a local that isn't a literal stays as written
    expect(ingress.to_port).toEqual({ kind: 'ref', path: 'local.ports.tls' });
    const app = web.ir.resources.find((r) => r.id === 'aws_instance.app')!;
    expect(app.args.instance_type).toEqual(lit('t3.large'));
    expect(app.args.name).toEqual({ kind: 'ref', path: 'local.name' });
    // locals that read each other in a circle stay as written
    expect(app.args.loop).toEqual({ kind: 'ref', path: 'local.a' });
    expect(web.ir.data[0].args.owners).toEqual({ kind: 'list', items: [lit('203.0.113.0/24')] });
    // the opened module's view reads the same
    const view = parseProject({ 'main.tf': LOCALS }).ir;
    const inst = instantiatePath(parseProject(files).ir, files, ['web'], view)!;
    expect(inst.resources.find((r) => r.id === 'aws_instance.app')!.args.instance_type).toEqual(lit('t3.large'));
  });

  it('follows a path of calls to an opened module, with that view as its blocks', () => {
    const { files, ir } = project(`module "web" {\n  source = "./modules/web"\n  cidr   = "10.1.0.0/16"\n}\n`);
    const view = parseProject({ 'main.tf': MODULE }).ir;
    const inst = instantiatePath(ir, files, ['web'], view)!;
    const sg = inst.resources.find((r) => r.id === 'aws_security_group.web')!;
    expect(sg.args.ingress.kind === 'block' && sg.args.ingress.body.cidr_blocks).toEqual({ kind: 'list', items: [lit('10.1.0.0/16')] });
    expect(sg.trivia).toBe(view.resources[0].trivia);
    expect(instantiatePath(ir, files, ['gone'], view)).toBeNull();
  });
});
