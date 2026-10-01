import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renameOps } from '@/features/editor/repeatOps';
import { isHistoryMove, keepStateFor } from '@/features/editor/movedSession';
import { useEditor } from '@/features/editor/store';
import { lit } from '@/ir/expr';
import { createProject } from '@/lib/storage';
import { duplicateModuleOps } from './duplicateModule';
import { moduleViewBack, moduleViewTo, openModuleView, openModulePath, useModuleView } from './moduleViewStore';
import { analysisIr } from './viewAnalysis';

const MAIN = `module "net" {
  source = "./modules/net"
  cidr   = "10.0.0.0/16"
}

resource "aws_instance" "web" {
  ami       = "ami-1"
  subnet_id = module.net.subnet_id
}
`;

const NET = `# the module's network
resource "aws_vpc" "this" {
  cidr_block = var.cidr # from the call
}

resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.this.id
  cidr_block = "10.0.1.0/24"
}

module "edge" {
  source = "../edge"
}
`;

const VARS = `variable "cidr" {
  type = string
}
`;

const OUTS = `output "subnet_id" {
  value = aws_subnet.a.id
}
`;

const EDGE = `resource "aws_s3_bucket" "logs" {
  bucket = "logs"
}
`;

const FILES = {
  'main.tf': MAIN,
  'modules/net/main.tf': NET,
  'modules/net/variables.tf': VARS,
  'modules/net/outputs.tf': OUTS,
  'modules/edge/main.tf': EDGE,
};

const editor = () => useEditor.getState();

beforeEach(() => {
  vi.useFakeTimers();
  useModuleView.setState({ path: [] });
  editor().load(createProject({ name: 'scope', files: FILES }));
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('an opened local module', () => {
  it('is what the canvas works on: its blocks with project paths, the root kept aside', () => {
    editor().setSelection('module.net');
    openModuleView('modules/net', 'net');
    const { ir, rootIr, scope, selection, activeFile, edges } = editor();
    expect(scope).toEqual({ dir: 'modules/net', path: ['net'] });
    expect(ir.resources.map((r) => r.id)).toEqual(['aws_vpc.this', 'aws_subnet.a']);
    expect(ir.modules.map((m) => m.id)).toEqual(['module.edge']);
    expect(ir.resources.every((r) => r.trivia.sourceFile === 'modules/net/main.tf' && r.position)).toBe(true);
    expect(rootIr.modules.map((m) => m.id)).toEqual(['module.net']);
    // containment and edges are the module's own
    expect(ir.resources.find((r) => r.id === 'aws_subnet.a')?.parentId).toBe('aws_vpc.this');
    expect(edges.every((e) => !e.source.startsWith('aws_instance'))).toBe(true);
    expect(selection).toBeNull();
    expect(activeFile).toBe('modules/net/main.tf');
    // back to the root: the module call selected again, the root's file shown
    moduleViewBack();
    expect(editor().scope).toBeNull();
    expect(editor().ir).toBe(editor().rootIr);
    expect(editor().selection).toBe('module.net');
    expect(editor().activeFile).toBe('main.tf');
  });

  it('patches only the lines an edit changes, in the module’s own files', () => {
    openModuleView('modules/net', 'net');
    editor().applyCanvasOps([{ kind: 'set_arg', nodeId: 'aws_subnet.a', field: 'cidr_block', value: lit('10.0.2.0/24') }], 'aws_subnet.a');
    const { files, past, selection } = editor();
    expect(files['modules/net/main.tf']).toBe(NET.replace('10.0.1.0/24', '10.0.2.0/24'));
    for (const f of ['main.tf', 'modules/net/variables.tf', 'modules/net/outputs.tf', 'modules/edge/main.tf']) expect(files[f]).toBe(FILES[f as keyof typeof FILES]);
    expect(past).toHaveLength(1);
    expect(selection).toBe('aws_subnet.a');
    expect(editor().ir.resources.find((r) => r.id === 'aws_subnet.a')?.args.cidr_block).toEqual(lit('10.0.2.0/24'));
  });

  it('shares one undo history with the root module', () => {
    editor().applyCanvasOps([{ kind: 'set_arg', nodeId: 'aws_instance.web', field: 'ami', value: lit('ami-2') }]);
    openModuleView('modules/net', 'net');
    editor().applyCanvasOps([{ kind: 'remove_resource', nodeId: 'aws_subnet.a' }]);
    expect(editor().ir.resources.map((r) => r.id)).toEqual(['aws_vpc.this']);
    moduleViewTo(0);
    // undo on the root canvas takes back the edit made inside the module…
    editor().undo();
    expect(editor().files['modules/net/main.tf']).toBe(NET);
    expect(editor().files['main.tf']).toContain('ami-2');
    // …then the root's own
    editor().undo();
    expect(editor().files).toEqual(FILES);
    openModuleView('modules/net', 'net');
    editor().redo();
    expect(editor().files['main.tf']).toContain('ami-2');
    expect(editor().ir.resources.map((r) => r.id)).toEqual(['aws_vpc.this', 'aws_subnet.a']);
    editor().redo();
    expect(editor().ir.resources.map((r) => r.id)).toEqual(['aws_vpc.this']);
  });

  it('renames with a moved block inside the module, in module-relative addresses', () => {
    openModuleView('modules/net', 'net');
    const { ir } = editor();
    const subnet = ir.resources.find((r) => r.id === 'aws_subnet.a')!;
    editor().applyCanvasOps(renameOps(ir, subnet, 'private', { keepState: true, isHistory: isHistoryMove }), 'aws_subnet.private');
    const { files, selection } = editor();
    expect(selection).toBe('aws_subnet.private');
    expect(files['modules/net/main.tf']).toBe(
      NET.replace('resource "aws_subnet" "a" {', 'resource "aws_subnet" "private" {').replace(
        '  cidr_block = "10.0.1.0/24"\n}\n',
        '  cidr_block = "10.0.1.0/24"\n}\n\nmoved {\n  from = aws_subnet.a\n  to   = aws_subnet.private\n}\n',
      ),
    );
    // the module's output follows; the root, which only reads module.net.subnet_id, doesn't change
    expect(files['modules/net/outputs.tf']).toBe(OUTS.replace('aws_subnet.a.id', 'aws_subnet.private.id'));
    expect(files['main.tf']).toBe(MAIN);
  });

  it('keeps the state by default when the root looks deployed', () => {
    const deployed = { ...FILES, 'versions.tf': 'terraform {\n  backend "s3" {}\n}\n' };
    editor().load(createProject({ name: 'deployed', files: deployed }));
    openModuleView('modules/net', 'net');
    expect(keepStateFor({}, editor().projectId, editor().ir)).toBe(true);
    moduleViewBack();
    expect(keepStateFor({}, editor().projectId, editor().ir)).toBe(true);
  });

  it('follows its code: typed text re-draws it, errors in it lock it, a folder gone closes it', () => {
    openModuleView('modules/net', 'net');
    editor().onCodeChange('modules/net/main.tf', `${NET}\nresource "aws_eip" "nat" {}\n`);
    vi.advanceTimersByTime(400);
    expect(editor().ir.resources.map((r) => r.id)).toEqual(['aws_vpc.this', 'aws_subnet.a', 'aws_eip.nat']);
    expect(editor().codeErrored).toBe(false);
    editor().onCodeChange('modules/net/main.tf', 'resource "aws_vpc" "this" {\n');
    vi.advanceTimersByTime(400);
    expect(editor().codeErrored).toBe(true);
    expect(editor().ir.resources.map((r) => r.id)).toEqual(['aws_vpc.this', 'aws_subnet.a', 'aws_eip.nat']);
    // an error in the root's code doesn't lock the module
    editor().onCodeChange('modules/net/main.tf', NET);
    editor().onCodeChange('main.tf', 'module "net" {\n');
    vi.advanceTimersByTime(400);
    expect(editor().codeErrored).toBe(false);
    expect(editor().scope?.dir).toBe('modules/net');
    // the module's files go away: the root comes back
    vi.advanceTimersByTime(400);
    editor().load({ ...createProject({ name: 'gone', files: { 'main.tf': MAIN } }), id: editor().projectId! }, { keepView: true });
    expect(editor().scope).toBeNull();
    expect(useModuleView.getState().path).toEqual([]);
  });

  it('opens nested modules one level deeper, and a path straight away', () => {
    openModuleView('modules/net', 'net');
    openModuleView('modules/edge', 'edge');
    expect(editor().scope).toEqual({ dir: 'modules/edge', path: ['net', 'edge'] });
    expect(editor().ir.resources.map((r) => r.id)).toEqual(['aws_s3_bucket.logs']);
    moduleViewBack();
    expect(editor().scope?.dir).toBe('modules/net');
    moduleViewTo(0);
    openModulePath(
      [
        { dir: 'modules/net', name: 'net' },
        { dir: 'modules/edge', name: 'edge' },
      ],
      'aws_s3_bucket.logs',
    );
    expect(editor().scope?.path).toEqual(['net', 'edge']);
    expect(editor().selection).toBe('aws_s3_bucket.logs');
  });

  it('is analysed with the inputs its call gives', () => {
    openModuleView('modules/net', 'net');
    const view = editor().ir;
    const analysed = analysisIr(view);
    expect(analysed).not.toBe(view);
    expect(analysed.resources.find((r) => r.id === 'aws_vpc.this')?.args.cidr_block).toEqual(lit('10.0.0.0/16'));
    expect(view.resources.find((r) => r.id === 'aws_vpc.this')?.args.cidr_block).toEqual({ kind: 'ref', path: 'var.cidr' });
    // the root module is read as it is
    moduleViewBack();
    expect(analysisIr(editor().ir)).toBe(editor().ir);
  });

  it('refuses edits in a read-only view', () => {
    editor().load(createProject({ name: 'view', files: FILES }), { readOnly: true });
    openModuleView('modules/net', 'net');
    editor().applyCanvasOps([{ kind: 'remove_resource', nodeId: 'aws_subnet.a' }]);
    expect(editor().files).toEqual(FILES);
  });
});

describe('duplicating a module call', () => {
  it('copies it under a unique name next to it, in its file, in one undo step', () => {
    const plan = duplicateModuleOps(editor().ir, 'module.net')!;
    expect(plan.node.name).toBe('net_copy');
    editor().applyCanvasOps(plan.ops, plan.node.id);
    expect(editor().files['main.tf']).toBe(`${MAIN}\n# @blueprint:pos=${plan.node.position!.x},${plan.node.position!.y}\nmodule "net_copy" {\n  source = "./modules/net"\n\n  cidr = "10.0.0.0/16"\n}\n`);
    expect(editor().selection).toBe('module.net_copy');
    expect(duplicateModuleOps(editor().ir, 'module.net_copy')!.node.name).toBe('net_copy_2');
    editor().undo();
    expect(editor().files).toEqual(FILES);
  });
});
