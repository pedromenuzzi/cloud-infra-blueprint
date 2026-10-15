import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { collectRefs, refTargetAddress } from '@/ir/expr';
import { AWS_HEADER } from '../content/shared';
import { getLesson } from '../lessons';
import type { SimState } from '../types';
import { evaluate, UNKNOWN, type Scope } from './eval';
import { initFingerprint, simulate } from './simulate';

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

  it('is unknown when it reads something only an apply knows', () => {
    expect(ev('"${aws_vpc.main.id}-x"')).toBe(UNKNOWN);
    expect(ev('length([aws_vpc.main.id])')).toBe(1);
  });
});
