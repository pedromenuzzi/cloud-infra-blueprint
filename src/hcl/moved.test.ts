import { describe, expect, it } from 'vitest';
import type { Op } from '@/ir/ops';
import { emitMoved, looksDeployed, movedBlocks, moveOps, readMoved, type MovedStatement } from './moved';
import { parseProject } from './parser';
import { applyOpsWithPatches } from './patch';

const WEB = `resource "aws_instance" "web" {
  ami = "ami-1"
}
`;
const EIP = `
resource "aws_eip" "ip" {
  instance = aws_instance.web.id
}
`;

/** rename a resource the way the inspector does: the rename, then the moved block */
function rename(files: Record<string, string>, from: string, name: string, isHistory?: (m: MovedStatement) => boolean) {
  const { ir } = parseProject(files);
  const node = ir.resources.find((r) => r.id === from)!;
  const to = `${node.type}.${name}`;
  const ops: Op[] = [
    { kind: 'rename_resource', nodeId: from, newName: name },
    ...moveOps(ir, [{ from, to }], { after: to, isHistory }),
  ];
  const out = applyOpsWithPatches(files, ir, ops);
  expect(out.refused).toBeUndefined();
  return out.files;
}

describe('reading moved blocks', () => {
  it('reads from / to, with comments and keys', () => {
    expect(readMoved(emitMoved('aws_instance.a', 'aws_instance.b'))).toMatchObject({ from: 'aws_instance.a', to: 'aws_instance.b' });
    const text = `moved {\n  # renamed in PR 12\n  from = aws_route53_record.x["A"] # old key\n  to   = aws_route53_record.x["a.example.com-A"]\n}`;
    const m = readMoved(text)!;
    expect(m).toMatchObject({ from: 'aws_route53_record.x["A"]', to: 'aws_route53_record.x["a.example.com-A"]' });
    expect(text.slice(m.toSpan[0], m.toSpan[1])).toBe('aws_route53_record.x["a.example.com-A"]');
    expect(readMoved('import {\n  to = aws_instance.a\n  id = "i-1"\n}')).toBeNull();
    expect(readMoved('moved {\n  from = aws_instance.a\n}')).toBeNull();
  });

  it('are kept verbatim: parse and patch round-trip them', () => {
    const src = `${WEB}\n# keep the state\nmoved {\n  from = aws_instance.old\n  to   = aws_instance.web # was old\n}\n`;
    const { ir } = parseProject({ 'main.tf': src });
    expect(movedBlocks(ir)).toHaveLength(1);
    const out = applyOpsWithPatches({ 'main.tf': src }, ir, [{ kind: 'move_node', nodeId: 'aws_instance.web', position: { x: 10, y: 20 } }]);
    expect(out.files['main.tf']).toBe(`# @blueprint:pos=10,20\n${src}`);
  });

  it('say whether a project looks deployed', () => {
    const ir = (s: string) => parseProject({ 'main.tf': s }).ir;
    expect(looksDeployed(ir(WEB))).toBe(false);
    expect(looksDeployed(ir(`terraform {\n  required_version = ">= 1.5"\n}\n${WEB}`))).toBe(false);
    expect(looksDeployed(ir(`terraform {\n  backend "s3" {\n    bucket = "state"\n  }\n}\n${WEB}`))).toBe(true);
    expect(looksDeployed(ir(`terraform {\n  cloud {\n    organization = "acme"\n  }\n}\n${WEB}`))).toBe(true);
    expect(looksDeployed(ir(`${WEB}import {\n  to = aws_instance.web\n  id = "i-1"\n}\n`))).toBe(true);
  });
});

describe('rename writes a moved block', () => {
  it('right after the resource, references updated, nothing else touched', () => {
    const files = { 'main.tf': `${WEB}${EIP}` };
    expect(rename(files, 'aws_instance.web', 'app')['main.tf']).toBe(`resource "aws_instance" "app" {
  ami = "ami-1"
}

moved {
  from = aws_instance.web
  to   = aws_instance.app
}

resource "aws_eip" "ip" {
  instance = aws_instance.app.id
}
`);
  });

  it('at the end of a file without a trailing newline', () => {
    const files = { 'main.tf': WEB.trimEnd() };
    expect(rename(files, 'aws_instance.web', 'app')['main.tf']).toBe(
      `resource "aws_instance" "app" {\n  ami = "ami-1"\n}\n\nmoved {\n  from = aws_instance.web\n  to   = aws_instance.app\n}\n`,
    );
  });

  it('in the resource\'s own file', () => {
    const files = { 'main.tf': 'resource "aws_vpc" "main" {}\n', 'compute.tf': WEB };
    const out = rename(files, 'aws_instance.web', 'app');
    expect(out['main.tf']).toBe(files['main.tf']);
    expect(out['compute.tf']).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.app\n}');
  });

  it('collapses a chain into one block, and renaming back removes it', () => {
    const files = { 'main.tf': `${WEB}${EIP}` };
    const once = rename(files, 'aws_instance.web', 'app');
    const twice = rename({ 'main.tf': once['main.tf'] }, 'aws_instance.app', 'srv');
    expect(twice['main.tf'].match(/moved \{/g)).toHaveLength(1);
    expect(twice['main.tf']).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.srv\n}');
    expect(twice['main.tf']).toContain('instance = aws_instance.srv.id');
    const back = rename({ 'main.tf': twice['main.tf'] }, 'aws_instance.srv', 'web');
    expect(back['main.tf']).toBe(files['main.tf']);
  });

  it('chains after history instead of rewriting it', () => {
    const history = `moved {\n  from = aws_instance.old\n  to   = aws_instance.web\n}\n`;
    const files = { 'main.tf': `${WEB}\n${history}` };
    const out = rename(files, 'aws_instance.web', 'app', () => true)['main.tf'];
    // the applied statement stays as written; the new one follows the resource
    expect(out).toContain(history);
    expect(out).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.app\n}');
    // renaming back over history replaces the statement it would contradict
    const back = rename({ 'main.tf': out }, 'aws_instance.app', 'web', (m) => m.from === 'aws_instance.old')['main.tf'];
    expect(back).toContain(history);
    expect(back).not.toContain('to   = aws_instance.app');
  });

  it('never rewrites the state side of moved / removed blocks', () => {
    const files = {
      'main.tf': `resource "aws_instance" "web" {\n  count = 2\n}\n\nmoved {\n  from = aws_instance.web[0]\n  to   = aws_instance.web[1]\n}\n\nremoved {\n  from = aws_instance.web[5]\n}\n`,
    };
    const out = rename(files, 'aws_instance.web', 'app', () => true)['main.tf'];
    expect(out).toContain('moved {\n  from = aws_instance.web[0]\n  to   = aws_instance.web[1]\n}');
    expect(out).toContain('removed {\n  from = aws_instance.web[5]\n}');
    expect(out).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.app\n}');
  });

  it('carries instance moves this session wrote along with a rename', () => {
    const files = { 'main.tf': `${WEB}${EIP}` };
    const { ir } = parseProject(files);
    // adding count: web → web[0]
    const counted = applyOpsWithPatches(files, ir, [
      { kind: 'set_arg', nodeId: 'aws_instance.web', field: 'count', value: { kind: 'literal', value: 2 } },
      { kind: 'rekey_refs', address: 'aws_instance.web', rekey: { add: '0' } },
      ...moveOps(ir, [{ from: 'aws_instance.web', to: 'aws_instance.web[0]' }], { after: 'aws_instance.web' }),
    ]).files;
    expect(counted['main.tf']).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.web[0]\n}');
    expect(counted['main.tf']).toContain('instance = aws_instance.web[0].id');
    const renamed = rename(counted, 'aws_instance.web', 'app')['main.tf'];
    expect(renamed.match(/moved \{/g)).toHaveLength(1);
    expect(renamed).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.app[0]\n}');
    expect(renamed).toContain('instance = aws_instance.app[0].id');
  });

  it('is one undoable patch that only touches what changes', () => {
    const files = { 'main.tf': `# servers\n${WEB}${EIP}\noutput "id" {\n  value = aws_instance.web.id # the id\n}\n` };
    const out = rename(files, 'aws_instance.web', 'app')['main.tf'];
    const before = files['main.tf'].split('\n');
    const after = out.split('\n');
    const added = after.filter((l) => !before.includes(l));
    expect(added).toEqual([
      'resource "aws_instance" "app" {',
      'moved {',
      '  from = aws_instance.web',
      '  to   = aws_instance.app',
      '  instance = aws_instance.app.id',
      '  value = aws_instance.app.id # the id',
    ]);
    expect(before.filter((l) => !after.includes(l))).toEqual([
      'resource "aws_instance" "web" {',
      '  instance = aws_instance.web.id',
      '  value = aws_instance.web.id # the id',
    ]);
  });
});

describe('moveOps', () => {
  const ir = parseProject({ 'main.tf': `${WEB}moved {\n  from = aws_instance.a\n  to   = aws_instance.web\n}\n` }).ir;
  it('plans nothing for a no-op', () => {
    expect(moveOps(ir, [{ from: 'aws_instance.web', to: 'aws_instance.web' }])).toEqual([]);
  });
  it('drops a pending block a move undoes', () => {
    const ops = moveOps(ir, [{ from: 'aws_instance.web', to: 'aws_instance.a' }]);
    expect(ops).toEqual([{ kind: 'remove_extra', blockId: ir.extras[0].id }]);
  });
  it('writes several moves at once', () => {
    const plain = parseProject({ 'main.tf': WEB }).ir;
    const ops = moveOps(plain, [
      { from: 'aws_instance.web[0]', to: 'aws_instance.web["a"]' },
      { from: 'aws_instance.web[1]', to: 'aws_instance.web["b"]' },
    ], { after: 'aws_instance.web' });
    expect(ops.map((o) => o.kind)).toEqual(['add_extra', 'add_extra']);
  });
});
