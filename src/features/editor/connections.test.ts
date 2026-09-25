import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { getDef } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import { deleteResourcesOps, removeReferencesOps } from './connections';
import { useEditor } from './store';

function webApp() {
  const files = TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('demo');
  const { ir } = parseProject(files);
  const edges = deriveStructure(ir, getDef);
  return { files, ir, edges };
}

describe('deleteResourcesOps', () => {
  it('drops references that surviving resources hold to the deleted one', () => {
    const { ir, edges } = webApp();
    const { ops, removed } = deleteResourcesOps(ir, edges, ['aws_security_group.web']);
    expect(removed).toEqual(['aws_security_group.web']);
    expect(ops).toContainEqual({ kind: 'remove_resource', nodeId: 'aws_security_group.web' });
    // EC2 and RDS both listed the SG in vpc_security_group_ids → the (single-item) lists go away
    expect(ops).toContainEqual({ kind: 'unset_arg', nodeId: 'aws_instance.web', field: 'vpc_security_group_ids' });
    expect(ops).toContainEqual({ kind: 'unset_arg', nodeId: 'aws_db_instance.main', field: 'vpc_security_group_ids' });
  });

  it('takes nested resources along with their container', () => {
    const { ir, edges } = webApp();
    const { removed } = deleteResourcesOps(ir, edges, ['aws_vpc.main']);
    expect(removed.sort()).toEqual(
      ['aws_instance.web', 'aws_security_group.web', 'aws_subnet.public_a', 'aws_subnet.public_b', 'aws_vpc.main'].sort(),
    );
  });

  it('removes several targets from one list in a single op', () => {
    const { ir } = parseProject({
      'main.tf':
        'resource "aws_security_group" "a" {}\nresource "aws_security_group" "b" {}\nresource "aws_security_group" "c" {}\n' +
        'resource "aws_instance" "x" {\n  vpc_security_group_ids = [aws_security_group.a.id, aws_security_group.b.id, aws_security_group.c.id]\n}\n',
    });
    const ops = removeReferencesOps(ir, [
      { source: 'aws_instance.x', target: 'aws_security_group.a', field: 'vpc_security_group_ids' },
      { source: 'aws_instance.x', target: 'aws_security_group.c', field: 'vpc_security_group_ids' },
    ]);
    expect(ops).toEqual([
      {
        kind: 'set_arg',
        nodeId: 'aws_instance.x',
        field: 'vpc_security_group_ids',
        value: { kind: 'list', items: [{ kind: 'ref', path: 'aws_security_group.b.id' }] },
      },
    ]);
  });
});

// Regression: node + edge deletion used to be two history entries, so one undo
// brought the resource back without its connections.
describe('editor store: delete then undo', () => {
  it('restores the exact files — resource and connections — in one step', () => {
    const { files } = webApp();
    const store = useEditor.getState();
    store.load({ id: 'p1', name: 'demo', files, providers: ['aws'], createdAt: '', updatedAt: '' });
    const edgesBefore = useEditor.getState().edges.length;

    useEditor.getState().deleteResources(['aws_security_group.web']);
    expect(useEditor.getState().ir.resources.some((r) => r.id === 'aws_security_group.web')).toBe(false);

    useEditor.getState().undo();
    expect(useEditor.getState().files).toEqual(files);
    expect(useEditor.getState().edges.length).toBe(edgesBefore);
  });
});
