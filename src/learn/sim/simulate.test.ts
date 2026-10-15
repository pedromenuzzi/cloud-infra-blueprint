import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { collectRefs, refTargetAddress } from '@/ir/expr';
import { AWS_HEADER } from '../content/shared';
import { getLesson } from '../lessons';
import type { SimState } from '../types';
import { evaluate, UNKNOWN, type Scope } from './eval';
import { outputCommand, showCommand, workspaceCommand, workspaceOf } from './commands';
import { initFingerprint, simulate, type VarArg } from './simulate';

const main = (body: string, more: Record<string, string> = {}) => ({ 'main.tf': `${AWS_HEADER}\n${body}`, ...more });
const text = (r: { lines: Array<{ text: string }> }) => r.lines.map((l) => l.text).join('\n');
const auto = { initialized: true, autoApprove: true };

/** apply `files` on top of `state` and hand back what it left */
function applied(files: Record<string, string>, state: SimState | null = null): SimState {
  const r = simulate('apply', files, state, auto);
  expect(r.ok, text(r)).toBe(true);
  return r.state!;
}

const NETWORK = `variable "azs" {
  default = ["us-east-1a", "us-east-1b"]
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  tags = {
    Name = "main"
  }
}

resource "aws_subnet" "public" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = var.azs[count.index]
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "subnet_cidrs" {
  value = aws_subnet.public[*].cidr_block
}
`;

describe('terraform init', () => {
  it('downloads the providers the configuration needs', () => {
    const r = simulate('init', main(''), null, { initialized: false });
    expect(r.ok).toBe(true);
    expect(text(r)).toContain('- Finding hashicorp/aws versions matching "~> 5.0"...');
    expect(text(r)).toContain('- Installed hashicorp/aws v5.100.0 (signed by HashiCorp)');
    expect(text(r)).toContain('Terraform has been successfully initialized!');
  });

  it('finds providers from resource types too, and fails on a version nobody released', () => {
    const r = simulate('init', { 'main.tf': 'resource "random_id" "x" {\n  byte_length = 4\n}\n' }, null, { initialized: false });
    expect(text(r)).toContain('- Finding latest version of hashicorp/random...');
    const bad = simulate('init', { 'main.tf': AWS_HEADER.replace('~> 5.0', '~> 99.0') }, null, { initialized: false });
    expect(bad.ok).toBe(false);
    expect(text(bad)).toContain('│ releases match the given constraints ~> 99.0');
  });

  it('reuses the installed providers the second time', () => {
    expect(text(simulate('init', main(''), null, { initialized: true }))).toContain('- Reusing previous version of hashicorp/aws');
  });

  it('changes its fingerprint when the providers change', () => {
    expect(initFingerprint(main(''))).toBe(initFingerprint(main('resource "aws_s3_bucket" "b" {}\n')));
    expect(initFingerprint(main(''))).not.toBe(initFingerprint(main('resource "random_id" "x" {\n  byte_length = 4\n}\n')));
  });
});

describe('before init', () => {
  it('every other command asks for terraform init, as the real CLI does', () => {
    for (const command of ['plan', 'apply', 'destroy'] as const) {
      const r = simulate(command, main(NETWORK), null, { initialized: false });
      expect(r.ok).toBe(false);
      expect(text(r)).toContain('Error: Inconsistent dependency lock file');
      expect(text(r)).toContain('  terraform init');
    }
    const v = simulate('validate', main(NETWORK), null, { initialized: false });
    expect(text(v)).toContain('Error: Missing required provider');
  });
});

describe('terraform validate', () => {
  it('says so when the configuration is valid', () => {
    expect(text(simulate('validate', main(NETWORK), null))).toContain('Success! The configuration is valid.');
  });

  it('points at an undeclared reference with its file and line', () => {
    const r = simulate('validate', main('resource "aws_subnet" "x" {\n  vpc_id     = aws_vpc.mian.id\n  cidr_block = "10.0.1.0/24"\n}\n'), null);
    expect(r.ok).toBe(false);
    const out = text(r);
    expect(out).toContain('│ Error: Reference to undeclared resource');
    expect(out).toContain('│   on main.tf line 15, in resource "aws_subnet" "x":');
    expect(out).toContain('│   15:   vpc_id     = aws_vpc.mian.id');
    expect(out).toContain('A managed resource "aws_vpc" "mian" has not been declared in the root module.');
  });

  it('fails on a parse error and on a missing required argument', () => {
    expect(simulate('validate', main('resource "aws_vpc" "x" {\n  cidr_block = "10.0.0.0/16"\n'), null).ok).toBe(false);
    const r = simulate('validate', main('resource "aws_subnet" "x" {\n  cidr_block = "10.0.1.0/24"\n}\n'), null);
    expect(text(r)).toContain('The argument "vpc_id" is required, but no definition was found.');
  });
});

describe('terraform plan', () => {
  it('creates everything on an empty state, count expanded to instance addresses', () => {
    const r = simulate('plan', main(NETWORK), null);
    expect(r.ok).toBe(true);
    const out = text(r);
    expect(out).toContain('  # aws_subnet.public[0] will be created\n  + resource "aws_subnet" "public" {');
    expect(out).toContain('  # aws_subnet.public[1] will be created');
    expect(out).toContain('      + cidr_block        = "10.0.1.0/24"');
    expect(out).toContain('      + vpc_id            = (known after apply)');
    expect(out).toContain('      + tags                      = {\n          + "Name" = "main"\n        }');
    expect(out).toContain('Plan: 3 to add, 0 to change, 0 to destroy.');
    expect(out).toContain('Changes to Outputs:\n  + subnet_cidrs = [\n      + "10.0.0.0/24",\n      + "10.0.1.0/24",\n    ]\n  + vpc_id       = (known after apply)');
    expect(r.plan?.changes.map((c) => [c.address, c.action])).toEqual([
      ['aws_subnet.public[0]', 'create'],
      ['aws_subnet.public[1]', 'create'],
      ['aws_vpc.main', 'create'],
    ]);
  });

  it('expands for_each to keyed addresses', () => {
    const r = simulate('plan', main('resource "aws_s3_bucket" "b" {\n  for_each = toset(["logs", "assets"])\n  bucket   = "acme-${each.key}"\n}\n'), null);
    expect(r.plan?.changes.map((c) => c.address)).toEqual(['aws_s3_bucket.b["assets"]', 'aws_s3_bucket.b["logs"]']);
    expect(text(r)).toContain('+ bucket                      = "acme-logs"');
  });

  it('updates in place when an argument that can change in place changes', () => {
    const state = applied(main(NETWORK));
    const r = simulate('plan', main(NETWORK.replace('Name = "main"', 'Name = "primary"')), state);
    const out = text(r);
    expect(out).toContain('  # aws_vpc.main will be updated in-place\n  ~ resource "aws_vpc" "main" {');
    expect(out).toContain('          ~ "Name" = "main" -> "primary"');
    expect(out).toContain('Plan: 0 to add, 1 to change, 0 to destroy.');
    expect(r.plan?.changes).toEqual([{ address: 'aws_vpc.main', action: 'update', attributes: { tags: ['{"Name":"main"}', '{"Name":"primary"}'] } }]);
  });

  it('replaces when an argument that forces it changes, and what depends on the new id too', () => {
    const state = applied(main(NETWORK));
    const out = text(simulate('plan', main(NETWORK.replace('10.0.0.0/16', '10.1.0.0/16')), state));
    expect(out).toContain('  # aws_vpc.main must be replaced\n-/+ resource "aws_vpc" "main" {');
    expect(out).toContain('~ cidr_block                = "10.0.0.0/16" -> "10.1.0.0/16" # forces replacement');
    expect(out).toContain('~ vpc_id     = "vpc-');
    expect(out).toContain('-> (known after apply) # forces replacement');
    expect(out).toContain('Plan: 3 to add, 0 to change, 3 to destroy.');
  });

  it('destroys what left the configuration, and the instances a smaller count drops', () => {
    const state = applied(main(NETWORK));
    const fewer = simulate('plan', main(NETWORK.replace('["us-east-1a", "us-east-1b"]', '["us-east-1a"]')), state);
    expect(text(fewer)).toContain('  # aws_subnet.public[1] will be destroyed\n  # (because index [1] is out of range for count)');
    const gone = simulate('plan', main(NETWORK.replace(/resource "aws_subnet"[\s\S]*?\n}\n/, '').replace(/output "subnet_cidrs"[\s\S]*?\n}\n/, '')), state);
    expect(text(gone)).toContain('# (because aws_subnet.public is not in configuration)');
    expect(gone.plan?.destroy).toBe(2);
  });

  it('says there is nothing to do once applied', () => {
    const state = applied(main(NETWORK));
    expect(text(simulate('plan', main(NETWORK), state))).toContain('No changes. Your infrastructure matches the configuration.');
  });

  it('refuses to replace what prevent_destroy protects', () => {
    const code = 'resource "aws_s3_bucket" "b" {\n  bucket = "a"\n  lifecycle {\n    prevent_destroy = true\n  }\n}\n';
    const state = applied(main(code));
    const r = simulate('plan', main(code.replace('"a"', '"b"')), state);
    expect(r.ok).toBe(false);
    expect(text(r)).toContain('Error: Instance cannot be destroyed');
  });
});

describe('terraform apply', () => {
  it('creates the resources with deterministic ids and resolves the outputs', () => {
    const r = simulate('apply', main(NETWORK), null, auto);
    const out = text(r);
    expect(out).toMatch(/aws_vpc\.main: Creation complete after 2s \[id=vpc-0[0-9a-f]{16}\]/);
    expect(out).toContain('Apply complete! Resources: 3 added, 0 changed, 0 destroyed.');
    const state = r.state!;
    expect(Object.keys(state.resources)).toEqual(['aws_vpc.main', 'aws_subnet.public[0]', 'aws_subnet.public[1]']);
    expect(state.resources['aws_subnet.public[0]'].vpc_id).toBe(state.resources['aws_vpc.main'].id);
    expect(state.outputs.vpc_id).toBe(state.resources['aws_vpc.main'].id);
    expect(out).toContain(`Outputs:\n\nsubnet_cidrs = [\n  "10.0.0.0/24",\n  "10.0.1.0/24",\n]\nvpc_id = "${state.outputs.vpc_id}"`);
    // the same history, the same ids
    expect(simulate('apply', main(NETWORK), null, auto).state).toEqual(state);
  });

  it('asks before applying unless auto-approved', () => {
    const r = simulate('apply', main(NETWORK), null);
    expect(r.confirmAt).toBeDefined();
    expect(r.lines[r.confirmAt!].text).toBe('  Enter a value: yes');
    expect(r.lines[r.confirmAt! - 4].text).toBe('Do you want to perform these actions?');
    expect(simulate('apply', main(NETWORK), null, auto).confirmAt).toBeUndefined();
  });

  it('is idempotent: a second apply changes nothing', () => {
    const state = applied(main(NETWORK));
    const r = simulate('apply', main(NETWORK), state, auto);
    expect(text(r)).toContain('No changes. Your infrastructure matches the configuration.');
    expect(text(r)).toContain('Apply complete! Resources: 0 added, 0 changed, 0 destroyed.');
    expect(r.confirmAt).toBeUndefined();
    expect(r.state).toEqual(state);
  });

  it('gives a replaced resource a new id, and its dependents the new one', () => {
    const state = applied(main(NETWORK));
    const next = applied(main(NETWORK.replace('10.0.0.0/16', '10.1.0.0/16')), state);
    expect(next.resources['aws_vpc.main'].id).not.toBe(state.resources['aws_vpc.main'].id);
    expect(next.resources['aws_subnet.public[1]'].vpc_id).toBe(next.resources['aws_vpc.main'].id);
    expect(next.resources['aws_subnet.public[1]'].cidr_block).toBe('10.1.1.0/24');
    expect(next.serial).toBe(2);
  });

  it('keeps sensitive outputs out of the output', () => {
    const r = simulate('apply', main('output "secret" {\n  value     = "hunter2"\n  sensitive = true\n}\n'), null, auto);
    expect(text(r)).toContain('secret = <sensitive>');
    expect(r.state?.outputs.secret).toBe('hunter2');
  });
});

describe('terraform destroy', () => {
  it('removes everything in the state, dependents first', () => {
    const state = applied(main(NETWORK));
    const r = simulate('destroy', main(NETWORK), state, auto);
    const out = text(r);
    expect(r.ok).toBe(true);
    expect(r.state).toBeNull();
    expect(out).toContain('Plan: 0 to add, 0 to change, 3 to destroy.');
    expect(out.indexOf('aws_subnet.public[0]: Destroying')).toBeLessThan(out.indexOf('aws_vpc.main: Destroying'));
    expect(out).toContain('Destroy complete! Resources: 3 destroyed.');
  });

  it('has nothing to do on an empty state', () => {
    expect(text(simulate('destroy', main(NETWORK), null, auto))).toContain('Destroy complete! Resources: 0 destroyed.');
  });
});

describe('modules', () => {
  const files = {
    ...main('module "net" {\n  source = "./modules/net"\n  cidr   = "10.0.0.0/16"\n}\n\noutput "vpc_id" {\n  value = module.net.vpc_id\n}\n'),
    'modules/net/main.tf': 'variable "cidr" {}\n\nresource "aws_vpc" "this" {\n  cidr_block = var.cidr\n}\n\noutput "vpc_id" {\n  value = aws_vpc.this.id\n}\n',
  };

  it('plans a local module resource by resource, and reads its outputs', () => {
    expect(text(simulate('init', files, null, { initialized: false }))).toContain('- net in modules/net');
    const r = simulate('apply', files, null, auto);
    expect(text(r)).toContain('  # module.net.aws_vpc.this will be created');
    expect(r.state?.resources['module.net.aws_vpc.this'].cidr_block).toBe('10.0.0.0/16');
    expect(r.state?.outputs.vpc_id).toBe(r.state?.resources['module.net.aws_vpc.this'].id);
  });

  it('leaves a Registry module out, with a note', () => {
    const r = simulate('plan', main('module "vpc" {\n  source  = "terraform-aws-modules/vpc/aws"\n  version = "5.8.1"\n}\n'), null);
    expect(text(r)).toContain('module.vpc: not simulated');
  });

  const NET = 'variable "cidr" {\n  type = string\n}\n\nvariable "name" {\n  default = "net"\n}\n\nresource "aws_vpc" "this" {\n  cidr_block = var.cidr\n  tags = {\n    Name = var.name\n  }\n}\n\noutput "vpc_id" {\n  value = aws_vpc.this.id\n}\n';
  const envs = (body: string) => ({ ...main(body), 'modules/net/main.tf': NET });
  const EACH = 'module "env" {\n  for_each = toset(["prod", "staging"])\n  source   = "./modules/net"\n  cidr     = each.key == "prod" ? "10.1.0.0/16" : "10.0.0.0/16"\n  name     = each.key\n}\n\nresource "aws_subnet" "a" {\n  vpc_id     = module.env["prod"].vpc_id\n  cidr_block = "10.1.1.0/24"\n}\n\noutput "ids" {\n  value = { for k, m in module.env : k => m.vpc_id }\n}\n';

  it('repeats a module with for_each, and resolves its outputs in the root after apply', () => {
    const plan = text(simulate('plan', envs(EACH), null));
    expect(plan).toContain('  # module.env["prod"].aws_vpc.this will be created');
    expect(plan).toContain('  # module.env["staging"].aws_vpc.this will be created');
    expect(plan).toContain('+ vpc_id            = (known after apply)');
    expect(plan).toContain('Plan: 3 to add, 0 to change, 0 to destroy.');
    const state = applied(envs(EACH));
    const prod = state.resources['module.env["prod"].aws_vpc.this'];
    expect(prod.cidr_block).toBe('10.1.0.0/16');
    expect(state.resources['aws_subnet.a'].vpc_id).toBe(prod.id);
    expect(JSON.parse(state.outputs.ids)).toEqual({ prod: prod.id, staging: state.resources['module.env["staging"].aws_vpc.this'].id });
    expect(text(simulate('plan', envs(EACH), state))).toContain('No changes.');
  });

  it('repeats a module with count', () => {
    const r = simulate('plan', envs('module "net" {\n  count  = 2\n  source = "./modules/net"\n  cidr   = "10.${count.index}.0.0/16"\n}\n'), null);
    expect(r.plan?.changes.map((c) => c.address)).toEqual(['module.net[0].aws_vpc.this', 'module.net[1].aws_vpc.this']);
    expect(text(r)).toContain('+ cidr_block                = "10.1.0.0/16"');
  });

  it('destroys what a module instance held when its key goes', () => {
    const state = applied(envs(EACH));
    const out = text(simulate('plan', envs(EACH.replace('toset(["prod", "staging"])', 'toset(["prod"])')), state));
    expect(out).toContain('  # module.env["staging"].aws_vpc.this will be destroyed\n  # (because module.env["staging"] is not in configuration)');
    expect(out).toContain('Plan: 0 to add, 0 to change, 1 to destroy.');
  });

  it('validate holds a call to its module: required inputs, unknown arguments, unknown outputs', () => {
    const missing = simulate('validate', envs('module "net" {\n  source = "./modules/net"\n}\n'), null);
    expect(missing.ok).toBe(false);
    expect(text(missing)).toContain('│ Error: Missing required argument\n│\n│   on main.tf line 14, in module "net":');
    expect(text(missing)).toContain('│ The argument "cidr" is required, but no definition was found.');
    const extra = text(simulate('validate', envs('module "net" {\n  source = "./modules/net"\n  cidr   = "10.0.0.0/16"\n  cdir   = "x"\n}\n'), null));
    expect(extra).toContain('│ Error: Unsupported argument');
    expect(extra).toContain('│   17:   cdir   = "x"');
    expect(extra).toContain('│ An argument named "cdir" is not expected here.');
    const output = text(simulate('validate', envs('module "net" {\n  source = "./modules/net"\n  cidr   = "10.0.0.0/16"\n}\n\noutput "id" {\n  value = module.net.vpc\n}\n'), null));
    expect(output).toContain('│ This object does not have an attribute named "vpc".');
    // the default of an input that has one is used
    expect(simulate('validate', envs('module "net" {\n  source = "./modules/net"\n  cidr   = "10.0.0.0/16"\n}\n'), null).ok).toBe(true);
    expect(simulate('plan', envs('module "net" {\n  source = "./modules/net"\n}\n'), null).ok).toBe(false);
  });

  it('validate looks inside the modules too: their references and required arguments', () => {
    const call = main('module "net" {\n  source = "./modules/net"\n  cidr   = "10.0.0.0/16"\n}\n');
    const broken = `${NET.replace('cidr_block = var.cidr', 'cidr_block = var.cdir')}\nresource "aws_subnet" "a" {\n  cidr_block = "10.0.1.0/24"\n}\n\noutput "typo" {\n  value = aws_vpc.thsi.id\n}\n`;
    const out = text(simulate('validate', { ...call, 'modules/net/main.tf': broken }, null));
    expect(out).toContain('│ Error: Reference to undeclared input variable\n│\n│   on modules/net/main.tf line 10, in resource "aws_vpc" "this":');
    expect(out).toContain('│ A managed resource "aws_vpc" "thsi" has not been declared in module.net.');
    expect(out).toContain('│   on modules/net/main.tf line 20, in resource "aws_subnet" "a":');
    expect(out).toContain('│ The argument "vpc_id" is required, but no definition was found.');
  });

  it('a module added since the last init is not installed, as Terraform says', () => {
    const before = main('');
    const after = envs('module "net" {\n  source = "./modules/net"\n  cidr   = "10.0.0.0/16"\n}\n');
    const r = simulate('plan', after, null, { initialized: false, installed: initFingerprint(before) });
    expect(r.ok).toBe(false);
    expect(text(r)).toContain('│ Error: Module not installed\n│\n│   on main.tf line 14:\n│   14: module "net" {');
    expect(text(r)).toContain('│ This module is not yet installed. Run "terraform init" to install all modules');
    // a provider changed too: the lock file is what's out of date
    const both = { ...after, 'main.tf': `${after['main.tf']}\nresource "random_id" "x" {\n  byte_length = 4\n}\n` };
    expect(text(simulate('plan', both, null, { initialized: false, installed: initFingerprint(before) }))).toContain('Error: Inconsistent dependency lock file');
  });
});

describe('data sources', () => {
  const READS = `data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*"]
  }
  filter {
    name   = "architecture"
    values = ["arm64"]
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "me" {}

data "aws_region" "here" {}

data "aws_partition" "p" {}

data "aws_vpc" "default" {
  default = true
}

resource "aws_instance" "web" {
  ami               = data.aws_ami.ubuntu.id
  instance_type     = "t4g.micro"
  availability_zone = data.aws_availability_zones.available.names[1]
  tags = {
    Arch    = data.aws_ami.ubuntu.architecture
    Account = data.aws_caller_identity.me.account_id
    Region  = data.aws_region.here.description
    Arn     = "arn:\${data.aws_partition.p.partition}:s3:::x"
  }
}

output "default_cidr" {
  value = data.aws_vpc.default.cidr_block
}

output "ami_name" {
  value = data.aws_ami.ubuntu.name
}
`;

  it('reads them during plan, and what references them is known in the plan', () => {
    const r = simulate('plan', main(READS), null);
    const out = text(r);
    expect(out).toMatch(/data\.aws_ami\.ubuntu: Reading\.\.\.\ndata\.aws_ami\.ubuntu: Read complete after 0s \[id=ami-0[0-9a-f]{16}\]/);
    expect(out).toContain('data.aws_caller_identity.me: Read complete after 0s [id=123456789012]');
    expect(out).toMatch(/\+ ami +?= "ami-0[0-9a-f]{16}"/);
    expect(out).toContain('+ availability_zone            = "us-east-1b"');
    expect(out).toContain('+ "Arch"    = "arm64"');
    expect(out).toContain('+ "Account" = "123456789012"');
    expect(out).toContain('+ "Region"  = "US East (N. Virginia)"');
    expect(out).toContain('+ "Arn"     = "arn:aws:s3:::x"');
    expect(out).toContain('+ ami_name     = "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-20260901"');
    expect(out).toContain('+ default_cidr = "172.31.0.0/16"');
    expect(r.plan?.changes.map((c) => c.address)).toEqual(['aws_instance.web']);
  });

  it('follows the provider region, and a plan after apply reads them again with nothing to change', () => {
    const west = { 'main.tf': main(READS)['main.tf'].replace('region = "us-east-1"', 'region = "us-west-2"') };
    expect(text(simulate('plan', west, null))).toContain('+ availability_zone            = "us-west-2b"');
    const state = applied(main(READS));
    const again = text(simulate('plan', main(READS), state));
    expect(again).toContain('data.aws_ami.ubuntu: Reading...');
    expect(again).toContain('No changes. Your infrastructure matches the configuration.');
  });

  it('gives the default VPC one id whatever the block is called, and its subnets', () => {
    const r = simulate('apply', main('data "aws_vpc" "a" {\n  default = true\n}\n\ndata "aws_vpc" "b" {\n  default = true\n}\n\ndata "aws_subnet" "s" {\n  availability_zone = "us-east-1b"\n  default_for_az    = true\n}\n\noutput "same" {\n  value = data.aws_vpc.a.id == data.aws_vpc.b.id && data.aws_subnet.s.vpc_id == data.aws_vpc.a.id\n}\n\noutput "subnet" {\n  value = data.aws_subnet.s.cidr_block\n}\n'), null, auto);
    expect(r.state?.outputs).toEqual({ same: 'true', subnet: '172.31.16.0/20' });
  });

  it('renders a policy document from its statements', () => {
    const r = simulate('plan', main('data "aws_iam_policy_document" "assume" {\n  statement {\n    actions = ["sts:AssumeRole"]\n    principals {\n      type        = "Service"\n      identifiers = ["ec2.amazonaws.com"]\n    }\n  }\n}\n\nresource "aws_iam_role" "r" {\n  name               = "r"\n  assume_role_policy = data.aws_iam_policy_document.assume.json\n}\n'), null);
    expect(text(r)).toContain('+ assume_role_policy = jsonencode(\n            {\n              + Statement = [\n                  + {\n                      + Action    = "sts:AssumeRole"');
  });

  const DEFERRED = 'resource "aws_s3_bucket" "b" {\n  bucket = "acme-logs"\n}\n\ndata "aws_iam_policy_document" "read" {\n  statement {\n    actions   = ["s3:GetObject"]\n    resources = ["${aws_s3_bucket.b.arn}/*"]\n  }\n}\n\nresource "aws_s3_bucket_policy" "p" {\n  bucket = aws_s3_bucket.b.id\n  policy = data.aws_iam_policy_document.read.json\n}\n';

  it('reads during apply when its arguments wait on the apply (<=)', () => {
    const r = simulate('plan', main(DEFERRED), null);
    const out = text(r);
    expect(out).toContain('  + create\n <= read (data resources)');
    expect(out).toContain('  # data.aws_iam_policy_document.read will be read during apply\n  # (config refers to values not yet known)\n <= data "aws_iam_policy_document" "read" {');
    expect(out).toContain('      + json          = (known after apply)');
    expect(out).toContain('      + statement {');
    expect(out).toContain('Plan: 2 to add, 0 to change, 0 to destroy.');
    expect(r.plan?.changes.map((c) => c.address).sort()).toEqual(['aws_s3_bucket.b', 'aws_s3_bucket_policy.p']);
    const done = simulate('apply', main(DEFERRED), null, auto);
    const log = text(done);
    expect(log.indexOf('aws_s3_bucket.b: Creation complete')).toBeLessThan(log.indexOf('data.aws_iam_policy_document.read: Reading...'));
    expect(log.indexOf('data.aws_iam_policy_document.read: Read complete after 0s')).toBeLessThan(log.indexOf('aws_s3_bucket_policy.p: Creating...'));
    expect(Object.keys(done.state!.resources)).not.toContain('data.aws_iam_policy_document.read');
    expect(done.state!.resources['aws_s3_bucket_policy.p'].policy).toContain('arn:aws:s3:::acme-logs/*');
    // the bucket exists now: the next plan reads it right away
    const again = text(simulate('plan', main(DEFERRED), done.state!));
    expect(again).toContain('data.aws_iam_policy_document.read: Read complete after 0s');
    expect(again).toContain('No changes.');
  });

  it('reads one filter block like two (an Ubuntu lookup gets an Ubuntu name)', () => {
    const code = 'data "aws_ami" "ubuntu" {\n  most_recent = true\n  owners      = ["099720109477"]\n  filter {\n    name   = "name"\n    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]\n  }\n}\n\noutput "name" {\n  value = data.aws_ami.ubuntu.name\n}\n';
    expect(text(simulate('plan', main(code), null))).toContain('+ name = "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-20260901"');
  });

  it('depends_on something with changes pending: read during apply, then in plan once applied', () => {
    const code = 'resource "aws_s3_bucket" "b" {\n  bucket = "acme-logs"\n}\n\ndata "aws_caller_identity" "me" {\n  depends_on = [aws_s3_bucket.b]\n}\n\noutput "account" {\n  value = data.aws_caller_identity.me.account_id\n}\n';
    const r = simulate('plan', main(code), null);
    const out = text(r);
    expect(out).toContain('  # data.aws_caller_identity.me will be read during apply\n  # (depends on a resource or a module with changes pending)\n <= data "aws_caller_identity" "me" {');
    expect(out).toContain('  + account = (known after apply)');
    expect(out).toContain('Plan: 1 to add, 0 to change, 0 to destroy.');
    const done = simulate('apply', main(code), null, auto);
    const log = text(done);
    expect(log.indexOf('aws_s3_bucket.b: Creation complete')).toBeLessThan(log.indexOf('data.aws_caller_identity.me: Reading...'));
    expect(done.state?.outputs.account).toBe('123456789012');
    expect(Object.keys(done.state!.resources)).toEqual(['aws_s3_bucket.b']);
    const again = text(simulate('plan', main(code), done.state!));
    expect(again).toContain('data.aws_caller_identity.me: Read complete after 0s [id=123456789012]');
    expect(again).toContain('No changes.');
  });

  it('leaves a type it knows nothing about unknown until apply', () => {
    const code = 'data "aws_ec2_managed_prefix_list" "p" {\n  name = "com.amazonaws.global.cloudfront.origin-facing"\n}\n\nresource "aws_instance" "web" {\n  ami           = data.aws_ec2_managed_prefix_list.p.id\n  instance_type = "t3.micro"\n}\n';
    const plan = text(simulate('plan', main(code), null));
    expect(plan).not.toContain('data.aws_ec2_managed_prefix_list.p: Reading...');
    expect(plan).toContain('+ ami                          = (known after apply)');
    expect(text(simulate('apply', main(code), null, auto))).toContain('data.aws_ec2_managed_prefix_list.p: Read complete after 0s');
  });
});

describe('moved blocks', () => {
  const OLD = 'resource "aws_s3_bucket" "old" {\n  bucket = "acme-logs"\n}\n';
  const NEW = 'resource "aws_s3_bucket" "new" {\n  bucket = "acme-logs"\n}\n';
  const MOVED = (from: string, to: string) => `\nmoved {\n  from = ${from}\n  to   = ${to}\n}\n`;

  it('a rename with moved: no destroy, no create, the state re-keyed', () => {
    const state = applied(main(OLD));
    const files = main(NEW + MOVED('aws_s3_bucket.old', 'aws_s3_bucket.new'));
    const out = text(simulate('plan', files, state));
    expect(out).toContain('aws_s3_bucket.new: Refreshing state... [id=acme-logs]');
    expect(out).toContain('  # aws_s3_bucket.old has moved to aws_s3_bucket.new\n    resource "aws_s3_bucket" "new" {\n        id = "acme-logs"\n        # (5 unchanged attributes hidden)\n    }');
    expect(out).toContain('Plan: 0 to add, 0 to change, 0 to destroy.');
    const r = simulate('apply', files, state, auto);
    expect(text(r)).toContain('Apply complete! Resources: 0 added, 0 changed, 0 destroyed.');
    expect(r.state?.resources).toEqual({ 'aws_s3_bucket.new': state.resources['aws_s3_bucket.old'] });
    expect(text(simulate('plan', files, r.state!))).toContain('No changes.');
    // without the moved block a rename is destroy and create
    expect(text(simulate('plan', main(NEW), state))).toContain('Plan: 1 to add, 0 to change, 1 to destroy.');
  });

  it('a move and a change together: the change says where it moved from', () => {
    const state = applied(main(OLD));
    const out = text(simulate('plan', main(NEW.replace('}\n', '  tags = {\n    Team = "data"\n  }\n}\n') + MOVED('aws_s3_bucket.old', 'aws_s3_bucket.new')), state));
    expect(out).toContain('  # aws_s3_bucket.new will be updated in-place\n  # (moved from aws_s3_bucket.old)\n  ~ resource "aws_s3_bucket" "new" {');
    expect(out).toContain('Plan: 0 to add, 1 to change, 0 to destroy.');
  });

  const COUNT = 'variable "names" {\n  default = ["a", "b"]\n}\n\nresource "aws_s3_bucket" "b" {\n  count  = length(var.names)\n  bucket = "acme-${var.names[count.index]}"\n}\n';
  const EACH = 'resource "aws_s3_bucket" "b" {\n  for_each = toset(["a", "b"])\n  bucket   = "acme-${each.key}"\n}\n';

  it('count to for_each: moved keeps each object under its new key', () => {
    const state = applied(main(COUNT));
    const files = main(EACH + MOVED('aws_s3_bucket.b[0]', 'aws_s3_bucket.b["a"]') + MOVED('aws_s3_bucket.b[1]', 'aws_s3_bucket.b["b"]'));
    const out = text(simulate('plan', files, state));
    expect(out).toContain('  # aws_s3_bucket.b[0] has moved to aws_s3_bucket.b["a"]');
    expect(out).toContain('  # aws_s3_bucket.b[1] has moved to aws_s3_bucket.b["b"]');
    expect(out).toContain('Plan: 0 to add, 0 to change, 0 to destroy.');
    expect(Object.keys(applied(files, state).resources)).toEqual(['aws_s3_bucket.b["a"]', 'aws_s3_bucket.b["b"]']);
    // without them: every object destroyed and created again
    const bare = text(simulate('plan', main(EACH), state));
    expect(bare).toContain('  # aws_s3_bucket.b[0] will be destroyed\n  # (because resource does not use count)');
    expect(bare).toContain('Plan: 2 to add, 0 to change, 2 to destroy.');
  });

  it('adding count keeps the object as [0] (an implied move), and into a module with moved', () => {
    const state = applied(main(OLD));
    const counted = text(simulate('plan', main(OLD.replace('{\n', '{\n  count  = 1\n')), state));
    expect(counted).toContain('  # aws_s3_bucket.old has moved to aws_s3_bucket.old[0]');
    expect(counted).toContain('Plan: 0 to add, 0 to change, 0 to destroy.');
    const files = { ...main('module "logs" {\n  source = "./modules/logs"\n}\n' + MOVED('aws_s3_bucket.old', 'module.logs.aws_s3_bucket.this')), 'modules/logs/main.tf': OLD.replace('"old"', '"this"') };
    const out = text(simulate('plan', files, state));
    expect(out).toContain('  # aws_s3_bucket.old has moved to module.logs.aws_s3_bucket.this');
    expect(out).toContain('Plan: 0 to add, 0 to change, 0 to destroy.');
  });

  it('a move to an address nothing declares destroys the object, and says why', () => {
    const state = applied(main(OLD));
    const out = text(simulate('plan', main('resource "aws_s3_bucket" "other" {\n  bucket = "x"\n}\n' + MOVED('aws_s3_bucket.old', 'aws_s3_bucket.new')), state));
    expect(out).toContain('  # aws_s3_bucket.new will be destroyed\n  # (because aws_s3_bucket.old was moved to aws_s3_bucket.new, which is not in configuration)');
  });
});

describe('dynamic blocks', () => {
  const SG = `variable "ports" {
  default = [80, 443]
}

resource "aws_security_group" "web" {
  name = "web"

  dynamic "ingress" {
    for_each = var.ports
    iterator = port
    content {
      from_port   = port.value
      to_port     = port.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }
}
`;

  it('expands into one block per item, shown in the plan as written blocks would be', () => {
    const out = text(simulate('plan', main(SG), null));
    expect(out).toContain('      + ingress {\n          + cidr_blocks = [\n              + "0.0.0.0/0",\n            ]\n          + from_port   = 80');
    expect(out).toContain('          + from_port   = 443');
    expect(out).not.toContain('dynamic');
  });

  it('applies, plans no changes after, and an item more changes it in place', () => {
    const state = applied(main(SG));
    expect(JSON.parse(state.resources['aws_security_group.web'].ingress)).toHaveLength(2);
    expect(text(simulate('plan', main(SG), state))).toContain('No changes.');
    const more = text(simulate('plan', main(SG.replace('[80, 443]', '[80, 443, 22]')), state));
    expect(more).toContain('  # aws_security_group.web will be updated in-place');
    expect(more).toContain('      + ingress {');
    expect(more).toContain('          + from_port   = 22');
  });

  it('reads a map with the label as iterator (.key and .value), next to written blocks', () => {
    const code = 'resource "aws_security_group" "web" {\n  name = "web"\n\n  egress {\n    from_port = 0\n    to_port   = 0\n    protocol  = "-1"\n  }\n\n  dynamic "ingress" {\n    for_each = { http = 80, https = 443 }\n    content {\n      description = ingress.key\n      from_port   = ingress.value\n      to_port     = ingress.value\n      protocol    = "tcp"\n    }\n  }\n}\n';
    const out = text(simulate('plan', main(code), null));
    expect(out).toContain('+ description = "http"');
    expect(out).toContain('+ description = "https"');
    expect(out).toContain('      + egress {');
  });
});

describe('conditional resources', () => {
  const EIP = (on: boolean) => `variable "public" {\n  default = ${on}\n}\n\nresource "aws_eip" "ip" {\n  count  = var.public ? 1 : 0\n  domain = "vpc"\n}\n\noutput "ip" {\n  value = one(aws_eip.ip[*].public_ip)\n}\n\noutput "ip_or_none" {\n  value = try(aws_eip.ip[0].public_ip, "none")\n}\n`;

  it('count = cond ? 1 : 0 creates it or not, and one() / try() read it either way', () => {
    const off = simulate('plan', main(EIP(false)), null);
    expect(off.plan?.changes).toEqual([]);
    expect(text(off)).toContain('  + ip         = null\n  + ip_or_none = "none"');
    const on = simulate('apply', main(EIP(true)), null, auto);
    expect(text(on)).toContain('aws_eip.ip[0]: Creation complete');
    expect(on.state?.outputs.ip).toBe(on.state?.resources['aws_eip.ip[0]'].public_ip);
    expect(on.state?.outputs.ip_or_none).toBe(on.state?.outputs.ip);
    const gone = text(simulate('plan', main(EIP(false)), on.state!));
    expect(gone).toContain('  # aws_eip.ip[0] will be destroyed\n  # (because index [0] is out of range for count)');
  });
});

describe('what the lessons rely on', () => {
  const lesson = (slug: string) => {
    const l = getLesson(slug);
    expect(l, slug).toBeDefined();
    return l!;
  };

  it('0.1: a plan right after apply has nothing to do', () => {
    const { solution } = lesson('what-is-terraform');
    expect(text(simulate('plan', solution, applied(solution)))).toContain('No changes. Your infrastructure matches the configuration.');
  });

  it('0.5: apply creates what is referenced before what references it', () => {
    const { solution } = lesson('references');
    const out = text(simulate('apply', solution, null, auto));
    const { ir } = parseProject(solution);
    let pairs = 0;
    for (const r of ir.resources) {
      const refs: Array<{ field: string; path: string }> = [];
      for (const e of Object.values(r.args)) collectRefs(e, '', refs);
      for (const target of new Set(refs.map((x) => refTargetAddress(x.path)).filter((a) => a && a !== r.id))) {
        expect(out.indexOf(`${target}: Creating...`), `${target} before ${r.id}`).toBeLessThan(out.indexOf(`${r.id}: Creating...`));
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(0);
    // even when the referencing block comes first in the file
    const first = text(simulate('apply', main('resource "aws_s3_bucket_versioning" "v" {\n  bucket = aws_s3_bucket.b.id\n  versioning_configuration {\n    status = "Enabled"\n  }\n}\n\nresource "aws_s3_bucket" "b" {\n  bucket = "acme-b"\n}\n'), null, auto));
    expect(first.indexOf('aws_s3_bucket.b: Creating...')).toBeLessThan(first.indexOf('aws_s3_bucket_versioning.v: Creating...'));
  });

  it('0.6: a new bucket name replaces the bucket, new tags change it in place', () => {
    const code = 'resource "aws_s3_bucket" "b" {\n  bucket = "acme-a"\n  tags = {\n    Environment = "dev"\n  }\n}\n';
    const state = applied(main(code));
    const renamed = text(simulate('plan', main(code.replace('acme-a', 'acme-z')), state));
    expect(renamed).toContain('  # aws_s3_bucket.b must be replaced\n-/+ resource "aws_s3_bucket" "b" {');
    expect(renamed).toContain('~ bucket                      = "acme-a" -> "acme-z" # forces replacement');
    const retagged = text(simulate('plan', main(code.replace('"dev"', '"prod"')), state));
    expect(retagged).toContain('  # aws_s3_bucket.b will be updated in-place\n  ~ resource "aws_s3_bucket" "b" {');
    expect(retagged).toContain('~ "Environment" = "dev" -> "prod"');
    expect(retagged).not.toContain('forces replacement');
  });

  it('1.4: the plan shows arn and id as known after apply, apply prints the outputs', () => {
    const { solution } = lesson('outputs');
    const plan = text(simulate('plan', solution, null));
    expect(plan).toMatch(/\+ arn +=\s\(known after apply\)/);
    expect(plan).toMatch(/\+ id +=\s\(known after apply\)/);
    const r = simulate('apply', solution, null, auto);
    const out = text(r);
    expect(out).toContain('\nOutputs:\n\n');
    for (const [name, value] of Object.entries(r.state!.outputs)) {
      expect(value).not.toBe('');
      expect(out).toContain(`${name} = "${value}"`);
    }
    expect(Object.values(r.state!.outputs).some((v) => v.startsWith('arn:aws:s3:::'))).toBe(true);
  });

  it('1.3: moving literal values into locals (templates, maps from variables, merge) plans no changes', () => {
    const { start, solution } = lesson('locals');
    expect(text(simulate('plan', solution, applied(start)))).toContain('No changes. Your infrastructure matches the configuration.');
    const literal = main('resource "aws_s3_bucket" "b" {\n  bucket = "acme-dev-logs"\n  tags = {\n    Project     = "acme"\n    Environment = "dev"\n    Team        = "data"\n  }\n}\n');
    const withLocals = main(
      'variable "env" {\n  default = "dev"\n}\n\nlocals {\n  prefix = "acme-${var.env}"\n  common = {\n    Project     = "acme"\n    Environment = var.env\n  }\n}\n\nresource "aws_s3_bucket" "b" {\n  bucket = "${local.prefix}-logs"\n  tags   = merge(local.common, { Team = "data" })\n}\n',
    );
    expect(text(simulate('plan', withLocals, applied(literal)))).toContain('No changes.');
  });
});

describe('the evaluator', () => {
  const scope: Scope = {
    ref: (root, name) => ({ var: { env: 'dev', n: 3, azs: ['a', 'b'] }, local: {}, aws_vpc: { main: { id: UNKNOWN, cidr_block: '10.0.0.0/16' } } })[root]?.[name as never],
  };
  const ev = (hcl: string) => evaluate({ kind: 'raw', hcl }, scope);

  it('reads templates, conditionals, for expressions and functions', () => {
    expect(ev('"app-${var.env}"')).toBe('app-dev');
    expect(ev('var.env == "prod" ? 3 : 1')).toBe(1);
    expect(ev('[for z in var.azs : upper(z)]')).toEqual(['A', 'B']);
    expect(ev('{ for i, z in var.azs : z => i }')).toEqual({ a: 0, b: 1 });
    expect(ev('cidrsubnet(aws_vpc.main.cidr_block, 8, var.n)')).toBe('10.0.3.0/24');
    expect(ev('merge({ a = 1 }, { b = "x" })')).toEqual({ a: 1, b: 'x' });
    expect(ev('jsonencode({ b = 1, a = [true] })')).toBe('{"a":[true],"b":1}');
    expect(ev('format("%s-%03d", var.env, 7)')).toBe('dev-007');
  });

  it('has the functions repetition and conditionals lean on', () => {
    expect(ev('length(toset(["a", "b", "a"]))')).toBe(2);
    expect(ev('keys({ b = 1, a = 2 })')).toEqual(['a', 'b']);
    expect(ev('values({ b = 1, a = 2 })')).toEqual([2, 1]);
    expect(ev('lookup({ dev = "t3.micro" }, var.env, "t3.small")')).toBe('t3.micro');
    expect(ev('lookup({ prod = "m5.large" }, var.env, "t3.small")')).toBe('t3.small');
    expect(ev('upper(var.env)')).toBe('DEV');
    expect(ev('lower("DEV")')).toBe('dev');
    expect(ev('join("-", split(",", "a,b,c"))')).toBe('a-b-c');
    expect(ev('element(var.azs, 3)')).toBe('b');
    expect(ev('coalesce("", null, "x")')).toBe('x');
    expect(ev('one([])')).toBeNull();
    expect(ev('one(["x"])')).toBe('x');
    expect(ev('try(var.azs[5], "none")')).toBe('none');
    expect(ev('[for i in range(2) : cidrsubnet("10.0.0.0/16", 8, i)]')).toEqual(['10.0.0.0/24', '10.0.1.0/24']);
  });

  it('is unknown when it reads something only an apply knows', () => {
    expect(ev('"${aws_vpc.main.id}-x"')).toBe(UNKNOWN);
    expect(ev('length([aws_vpc.main.id])')).toBe(1);
  });
});

/* ------------------------------------------------------------------ production work */

const S3_BACKEND = `terraform {
  backend "s3" {
    bucket       = "acme-tfstate"
    key          = "app/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}
`;
const BUCKET = 'resource "aws_s3_bucket" "site" {\n  bucket = "acme-site"\n}\n';

describe('backends', () => {
  it('init configures the backend', () => {
    const r = simulate('init', main(BUCKET, { 'backend.tf': S3_BACKEND }), null, { initialized: false });
    expect(r.ok).toBe(true);
    expect(text(r)).toContain(
      'Initializing the backend...\n\nSuccessfully configured the backend "s3"! Terraform will automatically\nuse this backend unless the backend configuration changes.',
    );
    // a second init has nothing to say about it
    const installed = initFingerprint(main(BUCKET, { 'backend.tf': S3_BACKEND }));
    expect(text(simulate('init', main(BUCKET, { 'backend.tf': S3_BACKEND }), null, { initialized: true, installed }))).not.toContain('Successfully configured');
  });

  it('a backend added or changed since init asks for init again', () => {
    const installed = initFingerprint(main(BUCKET));
    const r = simulate('plan', main(BUCKET, { 'backend.tf': S3_BACKEND }), null, { initialized: false, installed });
    expect(r.ok).toBe(false);
    expect(text(r)).toContain('Error: Backend initialization required, please run "terraform init"');
    expect(text(r)).toContain('│ Reason: Initial configuration of the requested backend "s3"');
    const moved = simulate('plan', main(BUCKET, { 'backend.tf': S3_BACKEND.replace('app/', 'web/') }), null, {
      initialized: false,
      installed: initFingerprint(main(BUCKET, { 'backend.tf': S3_BACKEND })),
    });
    expect(text(moved)).toContain('│ Reason: Backend configuration block has changed');
  });

  it('init asks to copy the existing state into a new backend; no starts empty', () => {
    const state = applied(main(BUCKET));
    const r = simulate('init', main(BUCKET, { 'backend.tf': S3_BACKEND }), state, { initialized: true, installed: initFingerprint(main(BUCKET)) });
    expect(r.ok).toBe(true);
    expect(r.lines[r.confirmAt!].text).toBe('  Enter a value: yes');
    expect(text(r)).toContain('Do you want to copy existing state to the new backend?\n  Pre-existing state was found while migrating the previous "local" backend to the');
    expect(r.state).toBeUndefined();
    expect(r.declined?.state).toBeNull();
    expect(r.declined?.lines.map((l) => l.text).join('\n')).toContain('Successfully configured the backend "s3"!');
  });

  it('a backend that changed from another one wants -migrate-state or -reconfigure', () => {
    const state = applied(main(BUCKET));
    const before = initFingerprint(main(BUCKET, { 'backend.tf': S3_BACKEND }));
    const files = main(BUCKET, { 'backend.tf': S3_BACKEND.replace('acme-tfstate', 'acme-state') });
    const r = simulate('init', files, state, { initialized: true, installed: before });
    expect(r.ok).toBe(false);
    expect(text(r)).toContain('Error: Backend configuration changed');
    expect(simulate('init', files, state, { initialized: true, installed: before, backendFlag: 'migrate-state' }).confirmAt).toBeDefined();
    const re = simulate('init', files, state, { initialized: true, installed: before, backendFlag: 'reconfigure' });
    expect(re.confirmAt).toBeUndefined();
    expect(text(re)).toContain('Successfully configured the backend "s3"!');
  });

  it('a locking backend holds the state lock around plan and apply', () => {
    const files = main(BUCKET, { 'backend.tf': S3_BACKEND });
    const plan = text(simulate('plan', files, null));
    expect(plan.startsWith('Acquiring state lock. This may take a few moments...\n')).toBe(true);
    expect(plan.endsWith('Releasing state lock. This may take a few moments...')).toBe(true);
    const r = simulate('apply', files, null);
    expect(r.lines[r.confirmAt!].text).toBe('  Enter a value: yes');
    expect(text(r)).toContain('Releasing state lock. This may take a few moments...\n\nApply complete!');
    // without use_lockfile (nor a DynamoDB table), S3 doesn't lock
    expect(text(simulate('plan', main(BUCKET, { 'backend.tf': S3_BACKEND.replace('use_lockfile = true', '') }), null))).not.toContain('state lock');
  });
});

describe('input variables', () => {
  const VARS = 'variable "env" {\n  default = "dev"\n}\n\nresource "aws_s3_bucket" "b" {\n  bucket = "acme-${var.env}"\n}\n';
  const bucket = (files: Record<string, string>, vars: VarArg[] = []) => applied2(files, vars).resources['aws_s3_bucket.b'].bucket;
  const applied2 = (files: Record<string, string>, vars: VarArg[]) => {
    const r = simulate('apply', files, null, { ...auto, vars });
    expect(r.ok, text(r)).toBe(true);
    return r.state!;
  };

  it('reads terraform.tfvars, then *.auto.tfvars in order, then -var-file and -var as given', () => {
    expect(bucket(main(VARS))).toBe('acme-dev');
    expect(bucket(main(VARS, { 'terraform.tfvars': 'env = "qa"\n' }))).toBe('acme-qa');
    const files = main(VARS, { 'terraform.tfvars': 'env = "qa"\n', 'b.auto.tfvars': 'env = "b"\n', 'a.auto.tfvars': 'env = "a"\n', 'prod.tfvars': 'env = "prod"\n' });
    expect(bucket(files)).toBe('acme-b');
    expect(bucket(files, [{ kind: 'file', name: 'prod.tfvars' }])).toBe('acme-prod');
    expect(bucket(files, [{ kind: 'var', text: 'env=cli' }, { kind: 'file', name: 'prod.tfvars' }])).toBe('acme-prod');
    expect(bucket(files, [{ kind: 'file', name: 'prod.tfvars' }, { kind: 'var', text: 'env=cli' }])).toBe('acme-cli');
  });

  it('fails on a var file that does not exist, a variable nobody declared, a value that breaks a validation', () => {
    const missing = simulate('plan', main(VARS), null, { initialized: true, vars: [{ kind: 'file', name: 'staging.tfvars' }] });
    expect(text(missing)).toContain('Error: Failed to read variables file');
    expect(text(missing)).toContain('│ Given variables file staging.tfvars does not exist.');
    const undeclared = simulate('plan', main(VARS), null, { initialized: true, vars: [{ kind: 'var', text: 'region=us-east-2' }] });
    expect(text(undeclared)).toContain('Error: Value for undeclared variable');
    const checked = VARS.replace('default = "dev"', 'default = "dev"\n  validation {\n    condition     = contains(["dev", "prod"], var.env)\n    error_message = "env must be dev or prod."\n  }');
    const bad = simulate('plan', main(checked), null, { initialized: true, vars: [{ kind: 'var', text: 'env=qa' }] });
    expect(bad.ok).toBe(false);
    expect(text(bad)).toContain('Error: Invalid value for variable');
    expect(text(bad)).toContain('│ env must be dev or prod.');
  });

  it('reads a -var by the variable type: a number, a list', () => {
    const code = 'variable "n" {\n  type = number\n}\n\nvariable "names" {\n  type = list(string)\n}\n\nresource "aws_s3_bucket" "b" {\n  count  = var.n\n  bucket = var.names[count.index]\n}\n';
    const state = applied2(main(code), [
      { kind: 'var', text: 'n=2' },
      { kind: 'var', text: 'names=["a", "b"]' },
    ]);
    expect(Object.keys(state.resources)).toEqual(['aws_s3_bucket.b[0]', 'aws_s3_bucket.b[1]']);
    expect(state.resources['aws_s3_bucket.b[1]'].bucket).toBe('b');
  });
});

describe('workspaces', () => {
  const CODE = 'resource "aws_s3_bucket" "b" {\n  bucket = "acme-${terraform.workspace}"\n}\n';

  it('new, select, list, show and delete, each workspace with its own state', () => {
    const def = applied(main(CODE));
    expect(def.resources['aws_s3_bucket.b'].bucket).toBe('acme-default');
    const created = workspaceCommand(['new', 'dev'], def);
    expect(created.lines.map((l) => l.text)[0]).toBe('Created and switched to workspace "dev"!');
    const dev = created.state!;
    expect(workspaceOf(dev)).toBe('dev');
    expect(dev.resources).toEqual({});
    // terraform.workspace is the current one, and the plan starts from its (empty) state
    const plan = simulate('plan', main(CODE), dev);
    expect(text(plan)).toContain('+ bucket                      = "acme-dev"');
    expect(text(plan)).toContain('Plan: 1 to add, 0 to change, 0 to destroy.');
    const devApplied = applied(main(CODE), dev);
    expect(devApplied.workspace).toBe('dev');
    expect(devApplied.workspaces?.default.resources['aws_s3_bucket.b'].bucket).toBe('acme-default');
    expect(workspaceCommand(['list'], devApplied).lines.map((l) => l.text)).toEqual(['  default', '* dev', '']);
    expect(workspaceCommand(['show'], devApplied).lines[0].text).toBe('dev');
    // back to default: its state comes back, dev's is kept
    const back = workspaceCommand(['select', 'default'], devApplied).state!;
    expect(back.workspace).toBeUndefined();
    expect(back.resources['aws_s3_bucket.b'].bucket).toBe('acme-default');
    expect(back.workspaces?.dev.resources['aws_s3_bucket.b'].bucket).toBe('acme-dev');
    // dev still tracks a bucket: delete refuses unless forced
    expect(text(workspaceCommand(['delete', 'dev'], back))).toContain('Workspace "dev" is currently tracking the following resource instances:');
    expect(workspaceCommand(['delete', '-force', 'dev'], back).state?.workspaces).toEqual({});
    expect(text(workspaceCommand(['select', 'qa'], back))).toContain('Workspace "qa" doesn\'t exist.');
    expect(text(workspaceCommand(['delete', 'default'], back))).toContain('is your active workspace');
  });

  it('destroy in a workspace keeps the others', () => {
    const dev = applied(main(CODE), workspaceCommand(['new', 'dev'], applied(main(CODE))).state!);
    const r = simulate('destroy', main(CODE), dev, auto);
    expect(r.state?.resources).toEqual({});
    expect(r.state?.workspace).toBe('dev');
    expect(r.state?.workspaces?.default.resources['aws_s3_bucket.b']).toBeDefined();
  });
});

describe('import and removed blocks', () => {
  const IMPORT = 'import {\n  to = aws_s3_bucket.logs\n  id = "acme-logs"\n}\n\nresource "aws_s3_bucket" "logs" {\n  bucket = "acme-logs"\n}\n';

  it('plans an import, and apply adopts the object with the given id', () => {
    const plan = simulate('plan', main(IMPORT), null);
    const out = text(plan);
    expect(out).toContain('aws_s3_bucket.logs: Preparing import... [id=acme-logs]');
    expect(out).toContain('  # aws_s3_bucket.logs will be imported\n    resource "aws_s3_bucket" "logs" {');
    expect(out).toContain('        arn                         = "arn:aws:s3:::acme-logs"');
    expect(out).toContain('Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.');
    const r = simulate('apply', main(IMPORT), null, auto);
    expect(text(r)).toContain('aws_s3_bucket.logs: Importing... [id=acme-logs]\naws_s3_bucket.logs: Import complete [id=acme-logs]');
    expect(text(r)).toContain('Apply complete! Resources: 1 imported, 0 added, 0 changed, 0 destroyed.');
    expect(r.state?.resources['aws_s3_bucket.logs'].id).toBe('acme-logs');
    // once in the state, the import block has nothing left to do
    expect(text(simulate('plan', main(IMPORT), r.state!))).toContain('No changes.');
  });

  it('an import with no configuration fails, unless -generate-config-out writes it', () => {
    const code = 'import {\n  to = aws_s3_bucket.logs\n  id = "acme-logs"\n}\n';
    const r = simulate('plan', main(code), null);
    expect(r.ok).toBe(false);
    expect(text(r)).toContain('Error: Configuration for import target does not exist');
    const g = simulate('plan', main(code), null, { initialized: true, generateConfig: 'generated.tf' });
    expect(g.ok, text(g)).toBe(true);
    expect(g.generated?.file).toBe('generated.tf');
    expect(g.generated?.text).toContain('# __generated__ by Terraform from "acme-logs"\nresource "aws_s3_bucket" "logs" {\n  bucket = "acme-logs"\n}');
    expect(text(g)).toContain('  # aws_s3_bucket.logs will be imported\n  # (config will be generated)');
    expect(text(g)).toContain('Terraform has generated configuration and written it to generated.tf.');
    // the file is there now: an import like any other
    expect(text(simulate('plan', main(code, { 'generated.tf': g.generated!.text }), null))).toContain('Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.');
    expect(text(simulate('plan', main(code, { 'generated.tf': '' }), null, { initialized: true, generateConfig: 'generated.tf' }))).toContain(
      'Error: Target generated file already exists',
    );
  });

  it('removed with destroy = false forgets the object instead of destroying it', () => {
    const state = applied(main(`${BUCKET}\nresource "aws_s3_bucket" "old" {\n  bucket = "acme-old"\n}\n`));
    const code = `${BUCKET}\nremoved {\n  from = aws_s3_bucket.old\n\n  lifecycle {\n    destroy = false\n  }\n}\n`;
    const plan = text(simulate('plan', main(code), state));
    expect(plan).toContain('  # aws_s3_bucket.old will no longer be managed by Terraform\n . resource "aws_s3_bucket" "old" {');
    expect(plan).toContain('Plan: 0 to add, 0 to change, 0 to destroy, 1 to forget.');
    expect(plan).toContain('Warning: Some objects will no longer be managed by Terraform');
    const r = simulate('apply', main(code), state, auto);
    expect(text(r)).not.toContain('Destroying');
    expect(text(r)).toContain('Apply complete! Resources: 0 added, 0 changed, 0 destroyed, 1 forgotten.');
    expect(Object.keys(r.state!.resources)).toEqual(['aws_s3_bucket.site']);
    // still declared: Terraform refuses
    expect(text(simulate('plan', main(`${code}\nresource "aws_s3_bucket" "old" {\n  bucket = "acme-old"\n}\n`), state))).toContain('Error: Removed resource still exists');
  });
});

describe('lifecycle', () => {
  const INSTANCE = (ami: string, life = '') => `resource "aws_instance" "web" {\n  ami           = "${ami}"\n  instance_type = "t3.micro"\n${life}}\n`;

  it('prevent_destroy stops a destroy too', () => {
    const code = INSTANCE('ami-1', '  lifecycle {\n    prevent_destroy = true\n  }\n');
    const r = simulate('destroy', main(code), applied(main(code)), auto);
    expect(r.ok).toBe(false);
    expect(text(r)).toContain('Error: Instance cannot be destroyed');
    expect(text(r)).toContain('Resource aws_instance.web has lifecycle.prevent_destroy set');
  });

  it('create_before_destroy plans +/- and creates the new one before the old one goes', () => {
    const life = '  lifecycle {\n    create_before_destroy = true\n  }\n';
    const state = applied(main(INSTANCE('ami-1', life)));
    const plan = text(simulate('plan', main(INSTANCE('ami-2', life)), state));
    expect(plan).toContain('+/- create replacement and then destroy');
    expect(plan).toContain('+/- resource "aws_instance" "web" {');
    const out = text(simulate('apply', main(INSTANCE('ami-2', life)), state, auto));
    expect(out.indexOf('aws_instance.web: Creation complete')).toBeLessThan(out.indexOf('aws_instance.web (deposed object'));
  });

  it('ignore_changes leaves those arguments as the state has them', () => {
    const life = '  lifecycle {\n    ignore_changes = [ami]\n  }\n';
    const state = applied(main(INSTANCE('ami-1', life)));
    expect(text(simulate('plan', main(INSTANCE('ami-2', life)), state))).toContain('No changes.');
    const tagged = INSTANCE('ami-2', `  tags = {\n    Name = "web"\n  }\n${life}`);
    const r = simulate('apply', main(tagged), state, auto);
    expect(text(r)).toContain('1 changed');
    expect(r.state?.resources['aws_instance.web'].ami).toBe('ami-1');
  });

  it('replace_triggered_by replaces it when what it points at changes', () => {
    const code = (version: string) =>
      `resource "aws_ssm_parameter" "release" {\n  name  = "/app/release"\n  type  = "String"\n  value = "${version}"\n}\n\n${INSTANCE('ami-1', '  lifecycle {\n    replace_triggered_by = [aws_ssm_parameter.release.value]\n  }\n')}`;
    const state = applied(main(code('1')));
    const r = simulate('plan', main(code('2')), state);
    expect(text(r)).toContain('  # aws_instance.web will be replaced due to changes in replace_triggered_by');
    expect(r.plan?.changes.map((c) => [c.address, c.action])).toEqual([
      ['aws_instance.web', 'replace'],
      ['aws_ssm_parameter.release', 'update'],
    ]);
    expect(text(simulate('plan', main(code('1')), state))).toContain('No changes.');
  });

  it('a launch template change raises latest_version, and the group that follows it is replaced first', () => {
    const code = (type: string) => `resource "aws_launch_template" "web" {
  name_prefix   = "web-"
  image_id      = "ami-1"
  instance_type = "${type}"
}

resource "aws_autoscaling_group" "web" {
  name     = "web"
  min_size = 1
  max_size = 2

  launch_template {
    id      = aws_launch_template.web.id
    version = aws_launch_template.web.latest_version
  }

  lifecycle {
    create_before_destroy = true
    replace_triggered_by  = [aws_launch_template.web.latest_version]
  }
}
`;
    const state = applied(main(code('t3.micro')));
    const plan = text(simulate('plan', main(code('t3.small')), state));
    expect(plan).toContain('  # aws_autoscaling_group.web will be replaced due to changes in replace_triggered_by\n+/- resource "aws_autoscaling_group" "web" {');
    expect(plan).toContain('~ latest_version = "1" -> (known after apply)');
    const next = applied(main(code('t3.small')), state);
    expect(next.resources['aws_launch_template.web'].latest_version).toBe('2');
    expect(next.resources['aws_autoscaling_group.web'].launch_template).toContain('"version":2');
  });
});

describe('sensitive values', () => {
  const DB = `variable "db_password" {
  type      = string
  sensitive = true
}

resource "aws_ssm_parameter" "db" {
  name  = "/app/db"
  type  = "SecureString"
  value = var.db_password
}

resource "aws_s3_bucket" "b" {
  bucket = "acme"
  tags = {
    Secret = var.db_password
  }
}

output "password" {
  value     = var.db_password
  sensitive = true
}
`;
  const files = main(DB, { 'terraform.tfvars': 'db_password = "hunter2"\n' });

  it('the plan hides them, and what is made from them', () => {
    const out = text(simulate('plan', files, null));
    expect(out).not.toContain('hunter2');
    expect(out).toContain('+ value   = (sensitive value)');
    expect(out).toContain('+ tags                        = (sensitive value)');
    expect(out).toContain('+ password = (sensitive value)');
  });

  it('an output made from one must say sensitive = true', () => {
    const open = DB.replace('  value     = var.db_password\n  sensitive = true\n', '  value = var.db_password\n');
    const r = simulate('plan', main(open, { 'terraform.tfvars': 'db_password = "x"\n' }), null);
    expect(r.ok).toBe(false);
    expect(text(r)).toContain('Error: Output refers to sensitive values');
    // nonsensitive() says it's fine to show
    expect(simulate('plan', main(open.replace('"password" {\n  value = var.db_password', '"password" {\n  value = nonsensitive(var.db_password)'), { 'terraform.tfvars': 'db_password = "x"\n' }), null).ok).toBe(true);
  });

  it('terraform output hides it, by name (or -raw) shows it', () => {
    const r = simulate('apply', files, null, auto);
    expect(text(r)).toContain('password = <sensitive>');
    expect(text(outputCommand([], files, r.state!))).toBe('password = <sensitive>');
    expect(text(outputCommand(['password'], files, r.state!))).toBe('"hunter2"');
    expect(text(outputCommand(['-raw', 'password'], files, r.state!))).toBe('hunter2');
    expect(text(outputCommand(['nope'], files, r.state!))).toContain('Error: Output "nope" not found');
    expect(text(showCommand([], files, r.state!, () => undefined))).toContain('password = (sensitive value)');
  });
});

describe('saved plans', () => {
  it('plan -out saves it; apply runs exactly that plan without asking; show prints it', () => {
    const p = simulate('plan', main(BUCKET), null, { initialized: true, out: 'tfplan' });
    expect(text(p)).toContain('Saved the plan to: tfplan\n\nTo perform exactly these actions, run the following command to apply:\n    terraform apply "tfplan"');
    expect(text(p)).not.toContain("You didn't use the -out option");
    const saved = p.saved!;
    const r = simulate('apply', main(BUCKET), null, { initialized: true, saved: { name: 'tfplan', plan: saved } });
    expect(r.confirmAt).toBeUndefined();
    expect(text(r)).not.toContain('Terraform will perform the following actions');
    expect(text(r)).toContain('aws_s3_bucket.site: Creation complete');
    expect(text(r)).toContain('Apply complete! Resources: 1 added, 0 changed, 0 destroyed.');
    expect(text(showCommand(['tfplan'], main(BUCKET), r.state!, () => saved))).toContain('  # aws_s3_bucket.site will be created');
    // the state changed since: stale
    expect(text(simulate('apply', main(BUCKET), r.state!, { initialized: true, saved: { name: 'tfplan', plan: saved } }))).toContain('Error: Saved plan is stale');
  });

  it('a plan whose code changed is stale; a plan file nobody saved fails to load', () => {
    const saved = simulate('plan', main(BUCKET), null, { initialized: true, out: 'tfplan' }).saved!;
    expect(text(simulate('apply', main(BUCKET.replace('acme-site', 'acme-www')), null, { initialized: true, saved: { name: 'tfplan', plan: saved } }))).toContain(
      'Error: Saved plan is stale',
    );
    expect(text(simulate('apply', main(BUCKET), null, { initialized: true, saved: { name: 'other' } }))).toContain('Error: Failed to load "other" as a plan file');
  });
});

describe('the guided projects resources', () => {
  it('a static site: CloudFront, a certificate validated through Route 53', () => {
    const code = `resource "aws_route53_zone" "main" {
  name = "acme.dev"
}

resource "aws_acm_certificate" "site" {
  domain_name               = "acme.dev"
  subject_alternative_names = ["www.acme.dev"]
  validation_method         = "DNS"
}

resource "aws_route53_record" "validation" {
  for_each = {
    for dvo in aws_acm_certificate.site.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_cloudfront_distribution" "site" {
  enabled = true
}

output "url" {
  value = "https://\${aws_cloudfront_distribution.site.domain_name}"
}

output "name_servers" {
  value = aws_route53_zone.main.name_servers
}
`;
    const plan = simulate('plan', main(code), null);
    expect(plan.ok, text(plan)).toBe(true);
    expect(plan.plan?.changes.map((c) => c.address)).toContain('aws_route53_record.validation["www.acme.dev"]');
    const state = applied(main(code));
    expect(state.outputs.url).toMatch(/^https:\/\/d[a-z]{13}\.cloudfront\.net$/);
    expect(JSON.parse(state.outputs.name_servers)).toHaveLength(4);
    expect(state.resources['aws_route53_zone.main'].zone_id).toMatch(/^Z0[A-Z]{19}$/);
    expect(state.resources['aws_acm_certificate.site'].arn).toMatch(/^arn:aws:acm:us-east-1:123456789012:certificate\/[0-9a-f-]{36}$/);
    expect(state.resources['aws_route53_record.validation["acme.dev"]'].name).toMatch(/^_[0-9a-f]{32}\.acme\.dev\.$/);
  });

  it('an HTTP API in front of a Lambda over DynamoDB', () => {
    const code = `resource "aws_dynamodb_table" "items" {
  name         = "items"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
}

resource "aws_lambda_function" "api" {
  function_name = "items-api"
  role          = "arn:aws:iam::123456789012:role/lambda"
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = "lambda.zip"
}

resource "aws_apigatewayv2_api" "http" {
  name          = "items"
  protocol_type = "HTTP"
}

output "endpoint" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "invoke_arn" {
  value = aws_lambda_function.api.invoke_arn
}

output "table_arn" {
  value = aws_dynamodb_table.items.arn
}
`;
    const state = applied(main(code));
    expect(state.outputs.endpoint).toMatch(/^https:\/\/[a-z]{10}\.execute-api\.us-east-1\.amazonaws\.com$/);
    expect(state.outputs.invoke_arn).toBe(
      'arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:items-api/invocations',
    );
    expect(state.outputs.table_arn).toBe('arn:aws:dynamodb:us-east-1:123456789012:table/items');
    expect(state.resources['aws_apigatewayv2_api.http'].execution_arn).toMatch(/^arn:aws:execute-api:us-east-1:123456789012:[a-z]{10}$/);
  });

  it('a load balancer, a launch template, and a database whose password is a secret', () => {
    const code = `data "aws_secretsmanager_secret_version" "db" {
  secret_id = "prod/db"
}

data "aws_ssm_parameter" "ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_lb" "web" {
  name               = "web"
  load_balancer_type = "application"
}

resource "aws_launch_template" "web" {
  name_prefix   = "web-"
  image_id      = data.aws_ssm_parameter.ami.value
  instance_type = "t3.micro"
}

resource "aws_db_instance" "db" {
  identifier        = "app-db"
  engine            = "postgres"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  username          = "app"
  password          = jsondecode(data.aws_secretsmanager_secret_version.db.secret_string).password
}

output "alb" {
  value = aws_lb.web.dns_name
}

output "db_endpoint" {
  value = aws_db_instance.db.endpoint
}

output "template_version" {
  value = aws_launch_template.web.latest_version
}
`;
    const plan = text(simulate('plan', main(code), null));
    expect(plan).toMatch(/\+ password +=  ?\(sensitive value\)/);
    expect(plan).toContain('+ image_id        = (sensitive value)');
    const state = applied(main(code));
    expect(state.outputs.alb).toMatch(/^web-\d{10}\.us-east-1\.elb\.amazonaws\.com$/);
    expect(state.outputs.db_endpoint).toMatch(/^app-db\.c[0-9a-f]{11}\.us-east-1\.rds\.amazonaws\.com:5432$/);
    expect(state.outputs.template_version).toBe('1');
    expect(state.resources['aws_launch_template.web'].id).toMatch(/^lt-0[0-9a-f]{16}$/);
    expect(state.resources['aws_launch_template.web'].image_id).toMatch(/^ami-0[0-9a-f]{16}$/);
    expect(state.resources['aws_db_instance.db'].port).toBe('5432');
  });
});
