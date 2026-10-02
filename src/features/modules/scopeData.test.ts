/**
 * Where an opened local module meets data blocks: the module's own data
 * sources are on its canvas, edited and renamed in the module's files, and
 * their edges stay inside the module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '@/features/editor/store';
import { lit } from '@/ir/expr';
import { createProject } from '@/lib/storage';
import { moduleViewBack, openModuleView, useModuleView } from './moduleViewStore';

const MAIN = `module "app" {
  source = "./modules/app"
}
`;

const APP = `data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id # the module's own image lookup
  instance_type = "t3.micro"
}
`;

const FILES = { 'main.tf': MAIN, 'modules/app/main.tf': APP };
const editor = () => useEditor.getState();

beforeEach(() => {
  vi.useFakeTimers();
  useModuleView.setState({ path: [] });
  editor().load(createProject({ name: 'scope-data', files: FILES }));
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('data blocks inside an opened module', () => {
  it('are on the module canvas with their edges, and not on the root one', () => {
    expect(editor().ir.data).toEqual([]);
    openModuleView('modules/app', 'app');
    const { ir, edges } = editor();
    expect(ir.data.map((d) => d.id)).toEqual(['data.aws_ami.ubuntu']);
    expect(edges.some((e) => e.source === 'aws_instance.web' && e.target === 'data.aws_ami.ubuntu')).toBe(true);
    moduleViewBack();
    expect(editor().ir.data).toEqual([]);
  });

  it('edit and rename in the module’s own file, comments and the root untouched', () => {
    openModuleView('modules/app', 'app');
    editor().applyCanvasOps([{ kind: 'set_arg', nodeId: 'data.aws_ami.ubuntu', field: 'most_recent', value: lit(false) }]);
    expect(editor().files['modules/app/main.tf']).toBe(APP.replace('most_recent = true', 'most_recent = false'));

    editor().applyCanvasOps([{ kind: 'rename_resource', nodeId: 'data.aws_ami.ubuntu', newName: 'base' }]);
    const text = editor().files['modules/app/main.tf'];
    expect(text).toContain('data "aws_ami" "base" {');
    expect(text).toContain('ami           = data.aws_ami.base.id # the module\'s own image lookup');
    // data blocks have no state to keep: no moved block
    expect(text).not.toContain('moved {');
    expect(editor().files['main.tf']).toBe(MAIN);
  });
});
