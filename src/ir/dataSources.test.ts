import { describe, expect, it } from 'vitest';
import { emitProject } from '@/hcl/emitter';
import { applyOpsWithPatches } from '@/hcl/patch';
import { parseProject } from '@/hcl/parser';
import { dataEdges, dataReaders, dataRef, dataReferrers, isDataId } from './dataSources';
import { lit, ref } from './expr';
import { deriveStructure } from './graph';
import { findNode, nodeIds, withModuleNodes } from './modules';
import { repeatOf } from './repeat';
import type { DataNode } from './types';

const MAIN = `# Lookups
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

# @blueprint:pos=40,40
data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [aws_vpc.main.id]
  }
}

resource "aws_instance" "web" {
  ami               = data.aws_ami.ubuntu.id
  instance_type     = "t3.micro"
  availability_zone = data.aws_availability_zones.available.names[0]
  subnet_id         = data.aws_subnets.private.ids[0]
}

locals {
  account = data.aws_caller_identity.current.account_id
  zones   = length(data.aws_availability_zones.available.names)
  note    = "data.aws_ami.ubuntu is text"
}

data "aws_caller_identity" "current" {}
`;

const OUTPUTS = `output "ami" {
  value = "\${data.aws_ami.ubuntu.id}"
}
`;

const files = { 'main.tf': MAIN, 'outputs.tf': OUTPUTS };

describe('data blocks in the IR', () => {
  it('parse into ir.data with their address, type, name, arguments and position', () => {
    const { ir, diagnostics } = parseProject(files);
    expect(diagnostics).toEqual([]);
    expect(ir.data.map((d) => d.id)).toEqual([
      'data.aws_ami.ubuntu',
      'data.aws_availability_zones.available',
      'data.aws_subnets.private',
      'data.aws_caller_identity.current',
    ]);
    const ami = ir.data[0];
    expect(ami).toMatchObject({ type: 'aws_ami', name: 'ubuntu', provider: 'aws' });
    expect(ami.args.most_recent).toEqual({ kind: 'literal', value: true });
    expect(ami.args.filter.kind).toBe('block');
    expect(ami.trivia.leadingComments).toEqual(['# Lookups']);
    expect(ir.data[1].position).toEqual({ x: 40, y: 40 });
    // no longer verbatim: only `locals` is left there
    expect(ir.extras).toHaveLength(1);
  });

  it('round-trip byte for byte through the patcher and the emitter', () => {
    const { ir } = parseProject(files);
    const out = applyOpsWithPatches(files, ir, []);
    expect(out.files).toEqual(files);
    // the emitter re-orders nothing it parsed
    expect(emitProject(ir)['outputs.tf']).toBe(OUTPUTS);
  });

  it('flags a duplicate address', () => {
    const { diagnostics } = parseProject({ 'a.tf': 'data "aws_region" "r" {}\n', 'b.tf': 'data "aws_region" "r" {}\n' });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', file: 'b.tf', nodeId: 'data.aws_region.r' });
  });

  it('are canvas nodes: found by id, laid out with the resources', () => {
    const { ir } = parseProject(files);
    expect(isDataId('data.aws_ami.ubuntu')).toBe(true);
    expect(findNode(ir, 'data.aws_ami.ubuntu')?.name).toBe('ubuntu');
    expect(nodeIds(ir).has('data.aws_caller_identity.current')).toBe(true);
    const laid = withModuleNodes(ir).resources.find((r) => r.id === 'data.aws_ami.ubuntu');
    expect(laid).toMatchObject({ type: 'data', name: 'ubuntu' });
  });

  it('a block with count gets the repetition badge like a resource', () => {
    const { ir } = parseProject({ 'main.tf': 'data "aws_vpc" "x" {\n  count = 2\n  id    = "vpc-1"\n}\n' });
    expect(repeatOf(ir.data[0], ir)).toMatchObject({ kind: 'count', size: 2 });
  });
});

describe('references to data sources', () => {
  it('reads the address and the attribute of a reference', () => {
    expect(dataRef('data.aws_availability_zones.available.names[0]')).toEqual({
      type: 'aws_availability_zones',
      name: 'available',
      address: 'data.aws_availability_zones.available',
      attribute: 'names',
    });
    expect(dataRef('data.aws_vpc.x[0].id')).toMatchObject({ address: 'data.aws_vpc.x', attribute: 'id' });
    expect(dataRef('data.terraform_remote_state.net')).toEqual({
      type: 'terraform_remote_state',
      name: 'net',
      address: 'data.terraform_remote_state.net',
    });
    expect(dataRef('aws_vpc.main.id')).toBeNull();
    expect(dataRef('var.x')).toBeNull();
  });

  it('edges: readers point at the data source, a data source at what it is filtered by', () => {
    const { ir } = parseProject(files);
    const edges = dataEdges(ir).map((e) => `${e.source} -> ${e.target} (${e.field})`);
    expect(edges.sort()).toEqual([
      'aws_instance.web -> data.aws_ami.ubuntu (ami)',
      'aws_instance.web -> data.aws_availability_zones.available (availability_zone)',
      'aws_instance.web -> data.aws_subnets.private (subnet_id)',
      'data.aws_subnets.private -> aws_vpc.main (filter)',
    ]);
    // deriveStructure carries them, so every canvas (a module view too) draws them
    const all = deriveStructure(ir, () => undefined).map((e) => e.id);
    expect(all).toContain('aws_instance.web->data.aws_ami.ubuntu:ami');
  });

  it('module calls that read a data source point at it', () => {
    const { ir } = parseProject({
      'main.tf': 'data "aws_region" "current" {}\n\nmodule "vpc" {\n  source = "./vpc"\n  region = data.aws_region.current.name\n}\n',
    });
    expect(dataEdges(ir).map((e) => e.id)).toEqual(['module.vpc->data.aws_region.current:region']);
  });

  it('readers: resources, locals and outputs, attribute by attribute (text and comments skipped)', () => {
    const { ir } = parseProject(files);
    const zones = dataReaders(ir, 'data.aws_availability_zones.available');
    expect(Object.fromEntries(zones)).toEqual({ names: ['aws_instance.web', 'raw.main.tf#0'] });
    expect(dataReferrers(ir, 'data.aws_ami.ubuntu').sort()).toEqual(['aws_instance.web', 'output.ami']);
    expect(dataReferrers(ir, 'data.aws_caller_identity.current')).toEqual(['raw.main.tf#0']);
  });
});

describe('canvas edits on data blocks patch only what changes', () => {
  const run = (ops: Parameters<typeof applyOpsWithPatches>[2]) => {
    const { ir } = parseProject(files);
    const out = applyOpsWithPatches(files, ir, ops);
    expect(out.refused).toBeUndefined();
    expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    return out;
  };

  it('a move writes the position comment, above the block and below its comments', () => {
    const out = run([{ kind: 'move_node', nodeId: 'data.aws_ami.ubuntu', position: { x: 8, y: 16 } }]);
    expect(out.files['main.tf']).toBe(MAIN.replace('# Lookups\n', '# Lookups\n# @blueprint:pos=8,16\n'));
    const moved = run([{ kind: 'move_node', nodeId: 'data.aws_availability_zones.available', position: { x: 1, y: 2 } }]);
    expect(moved.files['main.tf']).toBe(MAIN.replace('pos=40,40', 'pos=1,2'));
    expect(moved.files['outputs.tf']).toBe(OUTPUTS);
  });

  it('set and unset an argument touch one line (comments stay)', () => {
    const set = run([{ kind: 'set_arg', nodeId: 'data.aws_ami.ubuntu', field: 'most_recent', value: lit(false) }]);
    expect(set.files['main.tf']).toBe(MAIN.replace('most_recent = true', 'most_recent = false'));
    const unset = run([{ kind: 'unset_arg', nodeId: 'data.aws_availability_zones.available', field: 'state' }]);
    expect(unset.files['main.tf']).toBe(MAIN.replace('data "aws_availability_zones" "available" {\n  state = "available"\n}', 'data "aws_availability_zones" "available" {\n}'));
    const added = run([{ kind: 'set_arg', nodeId: 'data.aws_caller_identity.current', field: 'provider', value: ref('aws.west') }]);
    expect(added.files['main.tf']).toContain('data "aws_caller_identity" "current" {\n  provider = aws.west\n}\n');
  });

  it('a rename rewrites the label and every reference, in every file, without a moved block', () => {
    const out = run([{ kind: 'rename_resource', nodeId: 'data.aws_ami.ubuntu', newName: 'noble' }]);
    expect(out.files['main.tf']).toBe(
      MAIN.replace('data "aws_ami" "ubuntu"', 'data "aws_ami" "noble"').replace('= data.aws_ami.ubuntu.id', '= data.aws_ami.noble.id'),
    );
    expect(out.files['main.tf']).toContain('"data.aws_ami.ubuntu is text"');
    expect(out.files['outputs.tf']).toBe(OUTPUTS.replace('data.aws_ami.ubuntu.id', 'data.aws_ami.noble.id'));
    expect(out.files['main.tf']).not.toContain('moved');
    expect(out.renamed.get('data.aws_ami.ubuntu')).toBe('data.aws_ami.noble');
    expect(out.ir.data.map((d) => d.id)).toContain('data.aws_ami.noble');
  });

  it('a rename reaches locals and a data source read by another', () => {
    const out = run([{ kind: 'rename_resource', nodeId: 'data.aws_availability_zones.available', newName: 'zones' }]);
    expect(out.files['main.tf']).toContain('length(data.aws_availability_zones.zones.names)');
    expect(out.files['main.tf']).toContain('availability_zone = data.aws_availability_zones.zones.names[0]');
  });

  it("renaming a resource rewrites a data source's filter", () => {
    const out = run([{ kind: 'rename_resource', nodeId: 'aws_vpc.main', newName: 'core' }]);
    expect(out.files['main.tf']).toContain('values = [aws_vpc.core.id]');
  });

  it('a delete removes the block alone', () => {
    const out = run([{ kind: 'remove_resource', nodeId: 'data.aws_caller_identity.current' }]);
    expect(out.files['main.tf']).toBe(MAIN.replace('\ndata "aws_caller_identity" "current" {}\n', ''));
  });

  it('add_data appends a new block', () => {
    const node: DataNode = {
      id: 'data.aws_region.current',
      provider: 'aws',
      type: 'aws_region',
      name: 'current',
      args: {},
      position: { x: 0, y: 200 },
      trivia: { leadingComments: [] },
    };
    const out = run([{ kind: 'add_data', node }]);
    expect(out.files['main.tf']).toBe(`${MAIN}\n# @blueprint:pos=0,200\ndata "aws_region" "current" {}\n`);
    expect(out.ir.data.map((d) => d.id)).toContain('data.aws_region.current');
  });
});
