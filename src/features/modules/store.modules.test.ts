import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@/lib/storage';
import { orderedFiles, useEditor } from '@/features/editor/store';

const answer = vi.hoisted(() => ({ ok: true, asked: [] as Array<{ title: string; body?: string }> }));
vi.mock('@/components/Confirm', () => ({
  confirmAction: (req: { title: string; body?: string }) => {
    answer.asked.push(req);
    return Promise.resolve(answer.ok);
  },
}));

const MAIN = `module "net" {
  source = "./modules/net"
  cidr   = "10.0.0.0/16"
}

module "bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "4.1.0"
}

resource "aws_instance" "web" {
  ami       = "ami-1"
  subnet_id = module.net.subnet_id
}
`;

const FILES = {
  'main.tf': MAIN,
  'modules/net/main.tf': 'variable "cidr" {}\n\nresource "aws_vpc" "this" {\n  cidr_block = var.cidr\n}\n\noutput "subnet_id" {\n  value = aws_vpc.this.id\n}\n',
};

beforeEach(() => {
  vi.useFakeTimers();
  answer.ok = true;
  answer.asked = [];
  useEditor.getState().load(createProject({ name: 'modules', files: FILES }));
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('module calls in the editor', () => {
  it('are canvas nodes: laid out, wired by edges, root module only', () => {
    const { ir, edges, warnings } = useEditor.getState();
    expect(ir.modules.map((m) => m.id)).toEqual(['module.net', 'module.bucket']);
    expect(ir.modules.every((m) => m.position !== undefined)).toBe(true);
    expect(ir.resources.map((r) => r.id)).toEqual(['aws_instance.web']);
    expect(edges.map((e) => e.id)).toEqual(['aws_instance.web->module.net:subnet_id']);
    expect(warnings).toEqual([]);
  });

  it('lists the root module files first, then each child module folder', () => {
    expect(orderedFiles({ 'z.tf': '', 'modules/b/main.tf': '', 'main.tf': '', 'modules/a/x.tf': '', 'variables.tf': '' })).toEqual([
      'main.tf',
      'variables.tf',
      'z.tf',
      'modules/a/x.tf',
      'modules/b/main.tf',
    ]);
  });

  it('stay selected through edits, and a move is one undo step', () => {
    useEditor.getState().setSelection('module.net');
    useEditor.getState().applyCanvasOps([{ kind: 'move_node', nodeId: 'module.net', position: { x: 400, y: 48 } }]);
    const { files, selection, past } = useEditor.getState();
    expect(selection).toBe('module.net');
    expect(files['main.tf']).toBe(`# @blueprint:pos=400,48\n${MAIN}`);
    expect(past).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().files['main.tf']).toBe(MAIN);
    expect(useEditor.getState().selection).toBe('module.net');
  });

  it('follow a rename (selection included)', () => {
    useEditor.getState().setSelection('module.net');
    useEditor.getState().applyCanvasOps([{ kind: 'rename_resource', nodeId: 'module.net', newName: 'network' }]);
    const { files, selection } = useEditor.getState();
    expect(selection).toBe('module.network');
    expect(files['main.tf']).toContain('subnet_id = module.network.subnet_id');
    expect(files['main.tf']).toContain('moved {\n  from = module.net\n  to   = module.network\n}');
  });

  it('warn about a required input left out', () => {
    useEditor.getState().applyCanvasOps([{ kind: 'unset_arg', nodeId: 'module.net', field: 'cidr' }]);
    expect(useEditor.getState().warnings.map((w) => w.message)).toEqual([
      'module.net: required input "cidr" is missing (modules/net gives it no default)',
    ]);
  });

  it('delete at once when nothing reads them', () => {
    expect(useEditor.getState().deleteResources(['module.bucket'])).toBe(1);
    expect(answer.asked).toEqual([]);
    expect(useEditor.getState().ir.modules.map((m) => m.id)).toEqual(['module.net']);
  });

  it('ask before deleting one other blocks read, then delete it (one undo step), leaving the references', async () => {
    expect(useEditor.getState().deleteResources(['module.net'])).toBe(0);
    expect(answer.asked.map((a) => a.title)).toEqual(['Delete module.net?']);
    expect(answer.asked[0].body).toMatch(/^Still read by aws_instance\.web\./);
    await vi.waitFor(() => expect(useEditor.getState().ir.modules.map((m) => m.id)).toEqual(['module.bucket']));
    expect(useEditor.getState().files['main.tf']).toContain('subnet_id = module.net.subnet_id');
    expect(useEditor.getState().warnings.map((w) => w.message)).toEqual([
      'aws_instance.web: "subnet_id" references unknown module module.net',
    ]);
    expect(useEditor.getState().past).toHaveLength(1);
  });

  it('keep them when the deletion is cancelled', async () => {
    answer.ok = false;
    useEditor.getState().deleteResources(['module.net', 'aws_instance.web']);
    // the only reader goes too: nothing to ask
    expect(answer.asked).toEqual([]);
    expect(useEditor.getState().ir.modules.map((m) => m.id)).toEqual(['module.bucket']);
    useEditor.getState().undo();
    useEditor.getState().deleteResources(['module.net']);
    await Promise.resolve();
    expect(useEditor.getState().ir.modules.map((m) => m.id)).toEqual(['module.net', 'module.bucket']);
  });

  it('never parse the child module into the root', () => {
    useEditor.getState().onCodeChange('modules/net/main.tf', 'resource "aws_s3_bucket" "b" {}\n');
    vi.advanceTimersByTime(400);
    expect(useEditor.getState().ir.resources.map((r) => r.id)).toEqual(['aws_instance.web']);
    // the module lost its variable and output: the call's input and the reference now point at nothing
    expect(useEditor.getState().warnings.map((w) => w.message)).toEqual([
      'module.net: "cidr" isn\'t an input of modules/net (no variable "cidr")',
      'aws_instance.web: "subnet_id" reads output "subnet_id", which module.net doesn\'t have',
    ]);
  });
});
