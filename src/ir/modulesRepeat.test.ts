/**
 * Where module calls meet repetition and moved blocks: a module input follows
 * a resource that gains `count`, and module and resource renames share one
 * moved planner.
 */
import { describe, expect, it } from 'vitest';
import { readMoved } from '@/hcl/moved';
import { applyOpsWithPatches } from '@/hcl/patch';
import { parseProject } from '@/hcl/parser';
import { lit } from './expr';
import { moduleMoveOps } from './moduleMoved';

const MAIN = `resource "aws_subnet" "extra" {
  vpc_id     = "vpc-123"
  cidr_block = "10.0.9.0/24"
}

module "app" {
  source    = "./modules/app"
  subnet_id = aws_subnet.extra.id # the app's subnet
}
`;

const files = { 'main.tf': MAIN };

describe('modules with repetition and moved blocks', () => {
  it('a module input follows a resource that gains count, comment and all', () => {
    const { ir } = parseProject(files);
    const out = applyOpsWithPatches(files, ir, [
      { kind: 'set_arg', nodeId: 'aws_subnet.extra', field: 'count', value: lit(2) },
      { kind: 'rekey_refs', address: 'aws_subnet.extra', rekey: { add: '0' } },
    ]);
    expect(out.refused).toBeUndefined();
    expect(out.files['main.tf']).toContain('  subnet_id = aws_subnet.extra[0].id # the app\'s subnet\n');
  });

  it('a module rename writes its moved block after the call, and renaming back removes it', () => {
    const { ir } = parseProject(files);
    const renamed = applyOpsWithPatches(files, ir, [
      { kind: 'rename_resource', nodeId: 'module.app', newName: 'api' },
      ...moduleMoveOps(ir, 'module.app', 'module.api'),
    ]);
    expect(renamed.files['main.tf']).toBe(
      MAIN.replace('module "app" {', 'module "api" {') + '\nmoved {\n  from = module.app\n  to   = module.api\n}\n',
    );
    expect(renamed.ir.extras.map((x) => readMoved(x.text)?.to)).toEqual(['module.api']);

    const back = applyOpsWithPatches(renamed.files, renamed.ir, [
      { kind: 'rename_resource', nodeId: 'module.api', newName: 'app' },
      ...moduleMoveOps(renamed.ir, 'module.api', 'module.app'),
    ]);
    expect(back.files['main.tf']).toBe(MAIN);
  });

  it('moved blocks already in the files are history: a rename chains after them', () => {
    const withHistory = { 'main.tf': `${MAIN}\nmoved {\n  from = module.old\n  to   = module.app\n}\n` };
    const { ir } = parseProject(withHistory);
    const out = applyOpsWithPatches(withHistory, ir, [
      { kind: 'rename_resource', nodeId: 'module.app', newName: 'api' },
      ...moduleMoveOps(ir, 'module.app', 'module.api', () => true),
    ]);
    const moves = out.ir.extras.map((x) => readMoved(x.text)).map((m) => m && `${m.from}→${m.to}`);
    expect(moves).toContain('module.old→module.app');
    expect(moves).toContain('module.app→module.api');
  });
});
