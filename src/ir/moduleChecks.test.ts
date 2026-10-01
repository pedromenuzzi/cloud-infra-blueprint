import { afterEach, describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { useLocale } from '@/i18n/locale';
import { moduleTarget, readLocalModule } from './localModules';
import { moduleDiagnostics } from './moduleChecks';

const files = {
  'main.tf': `module "net" {
  source = "./modules/net"
  cidr   = "10.0.0.0/16"
  colour = "blue"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"
}

module "nothing" {
  cidr = "x"
}

resource "aws_instance" "web" {
  ami       = "ami-1"
  subnet_id = module.net.subnet_ids[0]
  tags      = { Vpc = module.net.vpc_arn, Gone = module.ghost.id }
}

output "private" {
  value = module.vpc.private_subnets
}
`,
  'modules/net/variables.tf': `variable "cidr" {
  type        = string
  description = "The VPC range"
}

variable "name" {}

variable "az_count" {
  type    = number
  default = 2
}
`,
  'modules/net/main.tf': 'resource "aws_vpc" "this" {\n  cidr_block = var.cidr\n}\n',
  'modules/net/outputs.tf': 'output "subnet_ids" {\n  value = []\n}\n\noutput "vpc_id" {\n  value = aws_vpc.this.id\n}\n',
};

afterEach(() => useLocale.getState().setLocale('en'));

describe('local modules', () => {
  it('read their folder: variables (required or not), outputs, resources', () => {
    const net = readLocalModule(files, 'modules/net')!;
    expect(net.files).toEqual(['modules/net/main.tf', 'modules/net/outputs.tf', 'modules/net/variables.tf']);
    expect(net.variables.map((v) => [v.name, v.required, v.type])).toEqual([
      ['cidr', true, 'string'],
      ['name', true, undefined],
      ['az_count', false, 'number'],
    ]);
    expect(net.variables[0].description).toBe('The VPC range');
    expect(net.outputs.map((o) => o.name)).toEqual(['subnet_ids', 'vpc_id']);
    expect(net.ir.resources.map((r) => r.id)).toEqual(['aws_vpc.this']);
    expect(readLocalModule(files, 'modules/net')).toBe(net); // cached while the texts stay the same
    expect(readLocalModule({ ...files, 'modules/net/main.tf': '' }, 'modules/net')).not.toBe(net);
    expect(readLocalModule(files, 'modules/none')).toBeNull();
  });

  it('say what a call points at', () => {
    const { ir } = parseProject(files);
    const [net, vpc, nothing] = ir.modules;
    expect(moduleTarget(files, net)).toMatchObject({ kind: 'local', dir: 'modules/net', module: { dir: 'modules/net' } });
    expect(moduleTarget({ 'main.tf': files['main.tf'] }, net)).toMatchObject({ kind: 'local', module: null });
    expect(moduleTarget(files, vpc)).toMatchObject({ kind: 'remote', info: { kind: 'registry' } });
    expect(moduleTarget(files, nothing)).toEqual({ kind: 'none' });
  });
});

describe('module validation', () => {
  it('missing source, missing required inputs, unknown inputs, unknown modules and outputs', () => {
    const { ir } = parseProject(files);
    const warnings = moduleDiagnostics(ir, files);
    expect(warnings.map((w) => [w.nodeId, w.message, w.start?.line])).toEqual([
      ['module.net', 'module.net: required input "name" is missing (modules/net gives it no default)', 1],
      ['module.net', 'module.net: "colour" isn\'t an input of modules/net (no variable "colour")', 4],
      ['module.nothing', 'module.nothing: "source" is missing (Terraform can\'t find the module without it)', 12],
      ['aws_instance.web', 'aws_instance.web: "tags.Vpc" reads output "vpc_arn", which module.net doesn\'t have', 19],
      ['aws_instance.web', 'aws_instance.web: "tags.Gone" references unknown module module.ghost', 19],
    ]);
  });

  it('holds nothing against Registry modules, or local ones the project lacks', () => {
    const only = { 'main.tf': files['main.tf'] };
    const { ir } = parseProject(only);
    expect(moduleDiagnostics(ir, only).map((w) => w.nodeId)).toEqual(['module.nothing', 'aws_instance.web']);
  });

  it('speaks Portuguese', () => {
    useLocale.getState().setLocale('pt-BR');
    const { ir } = parseProject(files);
    expect(moduleDiagnostics(ir, files)[0].message).toBe(
      'module.net: a entrada obrigatória "name" está faltando (modules/net não tem valor padrão para ela)',
    );
  });
});
