import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOpsWithPatches } from '@/hcl/patch';
import { parseProject } from '@/hcl/parser';
import { readLocalModule } from '@/ir/localModules';
import { withModuleNodes } from '@/ir/modules';
import { createProject } from '@/lib/storage';
import { removeConnectionOps } from '@/features/editor/connections';
import { useEditor } from '@/features/editor/store';
import { computeTidyOps } from '@/features/editor/tidy';
import { applyOpsInModule } from '@/features/modules/scopedPatch';
import { isContainerType } from '@/resources/registry';
import { presetByKey } from './catalog';
import { buildDataNode, dataSlot, uniqueDataName } from './newData';

const answer = vi.hoisted(() => ({ ok: true, asked: [] as Array<{ title: string; body?: string }> }));
vi.mock('@/components/Confirm', () => ({
  confirmAction: (req: { title: string; body?: string }) => {
    answer.asked.push(req);
    return Promise.resolve(answer.ok);
  },
}));

const MAIN = `data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
}

data "aws_caller_identity" "current" {}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
}
`;

beforeEach(() => {
  vi.useFakeTimers();
  answer.ok = true;
  answer.asked = [];
  useEditor.getState().load(createProject({ name: 'data', files: { 'main.tf': MAIN } }));
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('data sources in the editor', () => {
  it('are canvas nodes: laid out, wired to their readers', () => {
    const { ir, edges } = useEditor.getState();
    expect(ir.data.map((d) => d.id)).toEqual(['data.aws_ami.ubuntu', 'data.aws_caller_identity.current']);
    expect(ir.data.every((d) => d.position !== undefined)).toBe(true);
    expect(edges.map((e) => e.id)).toEqual(['aws_instance.web->data.aws_ami.ubuntu:ami']);
  });

  it('stay selected through a move (one undo step) and follow a rename', () => {
    useEditor.getState().setSelection('data.aws_ami.ubuntu');
    useEditor.getState().applyCanvasOps([{ kind: 'move_node', nodeId: 'data.aws_ami.ubuntu', position: { x: -240, y: 40 } }]);
    expect(useEditor.getState().files['main.tf']).toBe(`# @blueprint:pos=-240,40\n${MAIN}`);
    expect(useEditor.getState().selection).toBe('data.aws_ami.ubuntu');
    useEditor.getState().applyCanvasOps([{ kind: 'rename_resource', nodeId: 'data.aws_ami.ubuntu', newName: 'noble' }]);
    const { files, selection, past } = useEditor.getState();
    expect(selection).toBe('data.aws_ami.noble');
    expect(files['main.tf']).toContain('ami           = data.aws_ami.noble.id');
    expect(files['main.tf']).not.toContain('moved');
    expect(past).toHaveLength(2);
  });

  it('delete at once when nothing reads them', () => {
    expect(useEditor.getState().deleteResources(['data.aws_caller_identity.current'])).toBe(1);
    expect(answer.asked).toEqual([]);
    expect(useEditor.getState().files['main.tf']).not.toContain('aws_caller_identity');
  });

  it('ask before deleting one that is read, then keep the references', async () => {
    expect(useEditor.getState().deleteResources(['data.aws_ami.ubuntu'])).toBe(0);
    expect(answer.asked.map((a) => a.title)).toEqual(['Delete data.aws_ami.ubuntu?']);
    expect(answer.asked[0].body).toMatch(/^Still read by aws_instance\.web\./);
    await vi.waitFor(() => expect(useEditor.getState().ir.data.map((d) => d.id)).toEqual(['data.aws_caller_identity.current']));
    expect(useEditor.getState().files['main.tf']).toContain('ami           = data.aws_ami.ubuntu.id');
    expect(useEditor.getState().past).toHaveLength(1);
  });

  it('cancelling keeps it', async () => {
    answer.ok = false;
    useEditor.getState().deleteResources(['data.aws_ami.ubuntu']);
    await Promise.resolve();
    expect(useEditor.getState().ir.data).toHaveLength(2);
  });

  it('removing the edge drops the reference', () => {
    const { ir, edges } = useEditor.getState();
    const ops = removeConnectionOps(ir, edges[0]);
    expect(ops).toEqual([{ kind: 'unset_arg', nodeId: 'aws_instance.web', field: 'ami' }]);
  });

  it('are refused in a read-only view', () => {
    useEditor.getState().load(createProject({ name: 'view', files: { 'main.tf': MAIN } }), { readOnly: true });
    useEditor.getState().applyCanvasOps([{ kind: 'move_node', nodeId: 'data.aws_ami.ubuntu', position: { x: 1, y: 1 } }]);
    expect(useEditor.getState().files['main.tf']).toBe(MAIN);
  });
});

describe('adding a data source', () => {
  it('takes the preset arguments and a unique name, in a column left of the diagram', () => {
    const { ir } = useEditor.getState();
    expect(uniqueDataName(ir, 'aws_ami', 'ubuntu')).toBe('ubuntu_2');
    const { node, ops } = buildDataNode(ir, presetByKey('aws_ami.ubuntu')!);
    expect(node.id).toBe('data.aws_ami.ubuntu_2');
    // under the column the data sources form
    const column = Math.min(...ir.data.map((d) => d.position!.x));
    expect(node.position!.x).toBe(column);
    useEditor.getState().applyCanvasOps(ops, node.id);
    const text = useEditor.getState().files['main.tf'];
    expect(text).toContain('data "aws_ami" "ubuntu_2" {\n  most_recent = true\n  owners      = ["099720109477"]\n\n  filter {');
    expect(text).toContain('values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]');
    expect(useEditor.getState().selection).toBe('data.aws_ami.ubuntu_2');
  });

  it('subnets look up the VPC the project has, else the default ones', () => {
    const subnets = presetByKey('aws_subnets')!;
    const empty = parseProject({}).ir;
    expect(JSON.stringify(subnets.args(empty))).toContain('default-for-az');
    const withVpc = parseProject({ 'main.tf': 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n' }).ir;
    const { node } = buildDataNode(withVpc, subnets);
    const out = applyOpsWithPatches({ 'main.tf': 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n' }, withVpc, [{ kind: 'add_data', node }]);
    expect(out.files['main.tf']).toContain('values = [aws_vpc.main.id]');
    expect(out.ir.data[0].id).toBe('data.aws_subnets.selected');
  });

  it('an empty canvas starts the column at the top left', () => {
    expect(dataSlot(parseProject({}).ir)).toEqual({ x: 40, y: 40 });
  });
});

describe('Auto-arrange with data sources', () => {
  it('puts a data source left of what reads it, clear of everything', { timeout: 20_000 }, async () => {
    vi.useRealTimers(); // ELK schedules its own work
    const { ir, edges } = useEditor.getState();
    const ops = await computeTidyOps(withModuleNodes(ir), edges, isContainerType);
    vi.useFakeTimers();
    const moves = new Map(ops.flatMap((op) => (op.kind === 'move_node' ? [[op.nodeId, op.position] as const] : [])));
    expect([...moves.keys()].sort()).toEqual(['aws_instance.web', 'data.aws_ami.ubuntu', 'data.aws_caller_identity.current']);
    expect(moves.get('data.aws_ami.ubuntu')!.x).toBeLessThan(moves.get('aws_instance.web')!.x);
    useEditor.getState().applyCanvasOps(ops);
    expect(useEditor.getState().files['main.tf']).toMatch(/# @blueprint:pos=\d+,\d+\ndata "aws_ami" "ubuntu"/);
  });
});

describe('data sources inside a local module', () => {
  it('come out of the same parse and move like the root ones', () => {
    const files = {
      'main.tf': 'module "net" {\n  source = "./modules/net"\n}\n',
      'modules/net/main.tf': 'data "aws_availability_zones" "available" {}\n\nresource "aws_subnet" "a" {\n  availability_zone = data.aws_availability_zones.available.names[0]\n}\n',
    };
    const child = readLocalModule(files, 'modules/net')!;
    expect(child.ir.data.map((d) => d.id)).toEqual(['data.aws_availability_zones.available']);
    const out = applyOpsInModule(files, 'modules/net', [{ kind: 'move_node', nodeId: 'data.aws_availability_zones.available', position: { x: 8, y: 16 } }]);
    expect(out.ok && out.files['modules/net/main.tf']).toBe(`# @blueprint:pos=8,16\n${files['modules/net/main.tf']}`);
  });
});
