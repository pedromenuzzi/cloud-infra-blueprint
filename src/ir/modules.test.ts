import { describe, expect, it } from 'vitest';
import { emitProject } from '@/hcl/emitter';
import { parseProject } from '@/hcl/parser';
import { applyOpsWithPatches } from '@/hcl/patch';
import { lit, ref } from './expr';
import {
  exactVersion,
  findNode,
  moduleEdges,
  moduleInputs,
  moduleMetaArgs,
  moduleRef,
  moduleReferrers,
  parseModuleSource,
  referencedOutputs,
  registryUrl,
  resolveModuleDir,
  versionLabel,
  withModuleNodes,
} from './modules';
import { movedAddresses } from './moduleOps';
import type { ModuleNode } from './types';

/** the shapes found in real projects: registry + version, git, local folders, meta-arguments, comments */
const MAIN = `# Network
# @blueprint:pos=40,40
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"

  name            = "main"
  cidr            = "10.0.0.0/16"
  azs             = ["us-east-1a", "us-east-1b"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"] # two AZs
  enable_nat      = true
}

module "ecr" {
  source = "../../modules/ecr-repository"
  count  = var.create ? 1 : 0

  repository_name = "\${var.project}-api"
  tags            = merge(local.tags, { Service = "api" })
}

module "sg" {
  source     = "git::https://github.com/acme/tf-modules.git//security-group?ref=v1.4.2"
  vpc_id     = module.vpc.vpc_id
  depends_on = [module.vpc]
}

resource "aws_instance" "web" {
  ami       = "ami-123"
  subnet_id = module.vpc.private_subnets[0]
}

resource "aws_subnet" "extra" {
  vpc_id     = module.vpc.vpc_id
  cidr_block = "10.0.9.0/24"
}

module "app" {
  source     = "./modules/app"
  subnet_ids = aws_subnet.extra[*].id
}

output "vpc_id" {
  value = module.vpc.vpc_id
}
`;

const files = { 'main.tf': MAIN };

const mod = (id: string, ir = parseProject(files).ir) => ir.modules.find((m) => m.id === id)!;

describe('module blocks in the IR', () => {
  it('are first-class: name, args, position, trivia', () => {
    const { ir, diagnostics } = parseProject(files);
    expect(diagnostics).toEqual([]);
    expect(ir.modules.map((m) => m.id)).toEqual(['module.vpc', 'module.ecr', 'module.sg', 'module.app']);
    expect(ir.extras).toEqual([]);
    const vpc = mod('module.vpc', ir);
    expect(vpc.position).toEqual({ x: 40, y: 40 });
    expect(vpc.trivia.leadingComments).toEqual(['# Network']);
    expect(vpc.trivia.argTrailing).toEqual({ private_subnets: '# two AZs' });
    expect(moduleInputs(vpc).map(([k]) => k)).toEqual(['name', 'cidr', 'azs', 'private_subnets', 'enable_nat']);
    const ecr = mod('module.ecr', ir);
    expect(moduleMetaArgs(ecr).map(([k]) => k)).toEqual(['count']);
    expect(ecr.args.count).toEqual({ kind: 'raw', hcl: 'var.create ? 1 : 0' });
    expect(moduleMetaArgs(mod('module.sg', ir)).map(([k]) => k)).toEqual(['depends_on']);
  });

  it('flags a duplicate module name', () => {
    const { diagnostics } = parseProject({ 'main.tf': 'module "a" {\n  source = "./a"\n}\n\nmodule "a" {\n  source = "./b"\n}\n' });
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Duplicate module "a" (already declared at main.tf:1): Terraform requires unique module names — rename one of them',
    ]);
  });

  it('parse → emit → parse keeps every module', () => {
    const first = parseProject(files).ir;
    const second = parseProject(emitProject(first)).ir;
    expect(second.modules.map((m) => [m.id, Object.keys(m.args)])).toEqual(first.modules.map((m) => [m.id, Object.keys(m.args)]));
    expect(mod('module.vpc', second).position).toEqual({ x: 40, y: 40 });
  });

  it('child module files are not the root module', () => {
    const { ir } = parseProject({ ...files, 'modules/app/main.tf': 'resource "aws_s3_bucket" "inside" {}\n' });
    expect(ir.resources.map((r) => r.id)).toEqual(['aws_instance.web', 'aws_subnet.extra']);
  });
});

describe('patches on module blocks touch only what changes', () => {
  const run = (ops: Parameters<typeof applyOpsWithPatches>[2], input = files) => {
    const { ir } = parseProject(input);
    const out = applyOpsWithPatches(input, ir, ops);
    expect(out.refused).toBeUndefined();
    return out;
  };

  it('a move rewrites the position comment (or adds one above the header)', () => {
    expect(run([{ kind: 'move_node', nodeId: 'module.vpc', position: { x: 80, y: 120 } }]).files['main.tf']).toBe(
      MAIN.replace('pos=40,40', 'pos=80,120'),
    );
    expect(run([{ kind: 'move_node', nodeId: 'module.ecr', position: { x: 300, y: 40 } }]).files['main.tf']).toBe(
      MAIN.replace('module "ecr" {', '# @blueprint:pos=300,40\nmodule "ecr" {'),
    );
  });

  it('editing an input changes one value; adding one keeps the alignment; removing one drops its line', () => {
    const out = run([{ kind: 'set_arg', nodeId: 'module.vpc', field: 'cidr', value: lit('10.1.0.0/16') }]);
    expect(out.files['main.tf']).toBe(MAIN.replace('"10.0.0.0/16"', '"10.1.0.0/16"'));
    expect(mod('module.vpc', out.ir).args.cidr).toEqual(lit('10.1.0.0/16'));

    const added = run([{ kind: 'set_arg', nodeId: 'module.sg', field: 'name', value: lit('web') }]);
    expect(added.files['main.tf']).toBe(MAIN.replace('  depends_on = [module.vpc]\n', '  depends_on = [module.vpc]\n  name       = "web"\n'));

    const removed = run([{ kind: 'unset_arg', nodeId: 'module.vpc', field: 'enable_nat' }]);
    expect(removed.files['main.tf']).toBe(MAIN.replace('  enable_nat      = true\n', ''));
  });

  it('delete removes the block (comments that belong to it too) and nothing else', () => {
    const out = run([{ kind: 'remove_resource', nodeId: 'module.app' }]);
    expect(out.files['main.tf']).toBe(MAIN.replace('module "app" {\n  source     = "./modules/app"\n  subnet_ids = aws_subnet.extra[*].id\n}\n\n', ''));
    expect(out.ir.modules.map((m) => m.id)).not.toContain('module.app');
  });

  it('rename rewrites the label and every module.old reference, and records a moved block', () => {
    const out = run([{ kind: 'rename_resource', nodeId: 'module.vpc', newName: 'network' }]);
    const expected =
      MAIN.replace('module "vpc" {', 'module "network" {').replace(/module\.vpc\b/g, 'module.network') +
      '\nmoved {\n  from = module.vpc\n  to   = module.network\n}\n';
    expect(out.files['main.tf']).toBe(expected);
    expect(out.renamed.get('module.vpc')).toBe('module.network');
    expect(out.ir.extras.map((x) => movedAddresses(x.text))).toEqual([{ from: 'module.vpc', to: 'module.network' }]);

    // renamed on: the moved chain grows; renamed back: the moved block goes away
    const again = applyOpsWithPatches(out.files, out.ir, [{ kind: 'rename_resource', nodeId: 'module.network', newName: 'core' }]);
    expect(again.ir.extras.map((x) => movedAddresses(x.text))).toEqual([
      { from: 'module.vpc', to: 'module.network' },
      { from: 'module.network', to: 'module.core' },
    ]);
    const back = applyOpsWithPatches(out.files, out.ir, [{ kind: 'rename_resource', nodeId: 'module.network', newName: 'vpc' }]);
    expect(back.files['main.tf']).toBe(MAIN);
  });

  it('renaming a resource rewrites references inside module inputs', () => {
    const out = run([{ kind: 'rename_resource', nodeId: 'aws_subnet.extra', newName: 'more' }]);
    expect(out.files['main.tf']).toBe(
      MAIN.replace('"aws_subnet" "extra"', '"aws_subnet" "more"').replace('aws_subnet.extra[*].id', 'aws_subnet.more[*].id'),
    );
  });

  it('add_module appends a new block to its file', () => {
    const node: ModuleNode = {
      id: 'module.bucket',
      name: 'bucket',
      args: { source: lit('terraform-aws-modules/s3-bucket/aws'), version: lit('~> 4.0'), bucket: lit('logs') },
      position: { x: 10, y: 20 },
      trivia: { leadingComments: [] },
    };
    const out = run([{ kind: 'add_module', node }]);
    expect(out.files['main.tf']).toBe(
      `${MAIN}\n# @blueprint:pos=10,20\nmodule "bucket" {\n  source  = "terraform-aws-modules/s3-bucket/aws"\n  version = "~> 4.0"\n  bucket  = "logs"\n}\n`,
    );
    expect(findNode(out.ir, 'module.bucket')?.position).toEqual({ x: 10, y: 20 });
  });

  it('a patch never writes into child module files', () => {
    const withChild = { ...files, 'modules/app/main.tf': 'variable "subnet_ids" {}\n' };
    const out = run([{ kind: 'move_node', nodeId: 'module.app', position: { x: 1, y: 2 } }], withChild);
    expect(out.files['modules/app/main.tf']).toBe(withChild['modules/app/main.tf']);
  });
});

describe('module sources', () => {
  it('registry, private registry, git, GitHub shorthand, local', () => {
    expect(parseModuleSource('terraform-aws-modules/vpc/aws')).toMatchObject({
      kind: 'registry',
      short: 'terraform-aws-modules/vpc',
      registry: { namespace: 'terraform-aws-modules', name: 'vpc', provider: 'aws' },
    });
    expect(parseModuleSource('terraform-aws-modules/iam/aws//modules/iam-role').short).toBe('terraform-aws-modules/iam//iam-role');
    expect(parseModuleSource('app.terraform.io/acme/network/aws')).toMatchObject({ kind: 'registry', registry: { host: 'app.terraform.io' } });
    expect(parseModuleSource('git::https://github.com/acme/tf-modules.git//security-group?ref=v1.4.2')).toMatchObject({
      kind: 'git',
      short: 'acme/tf-modules//security-group',
      ref: 'v1.4.2',
    });
    expect(parseModuleSource('github.com/hashicorp/example')).toMatchObject({ kind: 'git', short: 'hashicorp/example' });
    expect(parseModuleSource('git@github.com:acme/infra.git')).toMatchObject({ kind: 'git', short: 'acme/infra' });
    expect(parseModuleSource('./modules/network')).toMatchObject({ kind: 'local', short: './modules/network' });
    expect(parseModuleSource('../../modules/ecr-repository').kind).toBe('local');
    expect(parseModuleSource('s3::https://s3.amazonaws.com/bucket/vpc.zip').kind).toBe('other');
  });

  it('Registry links: exact versions pinned, constraints and other sources → latest / none', () => {
    const vpc = parseModuleSource('terraform-aws-modules/vpc/aws');
    expect(registryUrl(vpc, '5.0.0')).toBe('https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws/5.0.0');
    expect(registryUrl(vpc, '~> 5.0')).toBe('https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws/latest');
    expect(registryUrl(parseModuleSource('app.terraform.io/acme/network/aws'), '1.0.0')).toBeNull();
    expect(registryUrl(parseModuleSource('./modules/x'))).toBeNull();
    expect(exactVersion('= 5.1.2')).toBe('5.1.2');
    expect(versionLabel('5.0.0')).toBe('v5.0.0');
    expect(versionLabel('~> 5.0')).toBe('~> 5.0');
    expect(versionLabel('')).toBeUndefined();
  });

  it('local folders resolve inside the project (.. stops at the top)', () => {
    expect(resolveModuleDir('', './modules/net')).toBe('modules/net');
    expect(resolveModuleDir('', '../../modules/vpc')).toBe('modules/vpc');
    expect(resolveModuleDir('modules/service', '../ecr')).toBe('modules/ecr');
    expect(resolveModuleDir('modules/a', './sub/')).toBe('modules/a/sub');
  });
});

describe('references and edges', () => {
  it('reads module refs, indexed and splat included', () => {
    expect(moduleRef('module.vpc.private_subnets[0]')).toEqual({ name: 'vpc', output: 'private_subnets' });
    expect(moduleRef('module.ecr[0].url')).toEqual({ name: 'ecr', output: 'url' });
    expect(moduleRef('module.x["a"].id')).toEqual({ name: 'x', output: 'id' });
    expect(moduleRef('module.vpc')).toEqual({ name: 'vpc' });
    expect(moduleRef('aws_vpc.main.id')).toBeNull();
  });

  it('draws resource → module, module → module and module → resource edges', () => {
    const { ir } = parseProject(files);
    expect(moduleEdges(ir).map((e) => e.id).sort()).toEqual([
      'aws_instance.web->module.vpc:subnet_id',
      'aws_subnet.extra->module.vpc:vpc_id',
      'module.app->aws_subnet.extra:subnet_ids',
      'module.sg->module.vpc:depends_on',
      'module.sg->module.vpc:vpc_id',
    ]);
  });

  it('knows which outputs are read, and by whom', () => {
    const { ir } = parseProject(files);
    expect(Object.fromEntries(referencedOutputs(ir, 'module.vpc'))).toEqual({
      vpc_id: ['aws_subnet.extra', 'module.sg', 'output.vpc_id'],
      private_subnets: ['aws_instance.web'],
      '': ['module.sg'],
    });
    expect(moduleReferrers(ir, 'module.vpc').sort()).toEqual(['aws_instance.web', 'aws_subnet.extra', 'module.sg', 'output.vpc_id']);
    expect(moduleReferrers(ir, 'module.app')).toEqual([]);
  });

  it('lays modules out with the resources (shared position objects)', () => {
    const { ir } = parseProject(files);
    const laid = withModuleNodes(ir);
    expect(laid.resources.map((r) => r.id)).toContain('module.vpc');
    expect(laid.resources.find((r) => r.id === 'module.vpc')!.position).toBe(mod('module.vpc', ir).position);
    expect(ref('x')).toEqual({ kind: 'ref', path: 'x' });
  });
});
