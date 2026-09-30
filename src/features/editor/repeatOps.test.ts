import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { lit, raw, ref } from '@/ir/expr';
import { createProject } from '@/lib/storage';
import { isHistoryMove, keepStateFor, useKeepState } from './movedSession';
import { renameOps, repeatChange, type RepeatSpec } from './repeatOps';
import { useEditor } from './store';

const MAIN = `resource "aws_instance" "web" {
  ami           = "ami-1"
  instance_type = "t3.micro"
}

resource "aws_eip" "ip" {
  instance = aws_instance.web.id
}

output "ip" {
  value = aws_instance.web.public_ip
}
`;

const state = () => useEditor.getState();
const web = () => state().ir.resources.find((r) => r.id === 'aws_instance.web')!;
const change = (next: RepeatSpec | null, key?: string, keepState = true) =>
  repeatChange(state().ir, web(), next, { keepState, isHistory: isHistoryMove, key });

beforeEach(() => {
  vi.useFakeTimers();
  state().load(createProject({ name: 'repeat', files: { 'main.tf': MAIN } }));
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  useKeepState.setState({ byProject: {} });
});

describe('adding and removing repetition', () => {
  it('adds count as one undo step: the argument, re-keyed references and the moved block', () => {
    const c = change({ kind: 'count', expr: lit(3) });
    expect(c.moves).toEqual([{ from: 'aws_instance.web', to: 'aws_instance.web[0]' }]);
    state().applyCanvasOps(c.ops);
    expect(state().files['main.tf']).toBe(`resource "aws_instance" "web" {
  count = 3

  ami           = "ami-1"
  instance_type = "t3.micro"
}

moved {
  from = aws_instance.web
  to   = aws_instance.web[0]
}

resource "aws_eip" "ip" {
  instance = aws_instance.web[0].id
}

output "ip" {
  value = aws_instance.web[0].public_ip
}
`);
    expect(state().past).toHaveLength(1);
    state().undo();
    expect(state().files['main.tf']).toBe(MAIN);
  });

  it('changes count in place without a moved block', () => {
    state().applyCanvasOps(change({ kind: 'count', expr: lit(3) }).ops);
    const c = change({ kind: 'count', expr: lit(5) });
    expect(c.moves).toEqual([]);
    expect(c.ops).toEqual([{ kind: 'set_arg', nodeId: 'aws_instance.web', field: 'count', value: lit(5) }]);
    state().applyCanvasOps(c.ops);
    expect(state().files['main.tf']).toContain('  count = 5\n');
  });

  it('removing count again (same session) takes the text back to where it was', () => {
    state().applyCanvasOps(change({ kind: 'count', expr: lit(3) }).ops);
    const back = change(null, '0');
    expect(back.moves).toEqual([{ from: 'aws_instance.web[0]', to: 'aws_instance.web' }]);
    state().applyCanvasOps(back.ops);
    expect(state().files['main.tf']).toBe(MAIN);
  });

  it('adds for_each with the key the existing instance takes', () => {
    const c = change({ kind: 'for_each', expr: raw('toset(["blue", "green"])') }, 'green');
    state().applyCanvasOps(c.ops);
    const text = state().files['main.tf'];
    expect(text).toContain('  for_each = toset(["blue", "green"])\n\n  ami');
    expect(text).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.web["green"]\n}');
    expect(text).toContain('instance = aws_instance.web["green"].id');
  });

  it('removes for_each keeping one instance, from code the session did not write', () => {
    const files = {
      'main.tf': `resource "aws_instance" "web" {\n  for_each = toset(["a", "b"])\n  ami      = "ami-1"\n}\n\nresource "aws_eip" "ip" {\n  instance = aws_instance.web["b"].id\n}\n`,
    };
    state().load(createProject({ name: 'each', files }));
    const c = change(null, 'b');
    expect(c.moves).toEqual([{ from: 'aws_instance.web["b"]', to: 'aws_instance.web' }]);
    state().applyCanvasOps(c.ops);
    const text = state().files['main.tf'];
    expect(text).toContain('resource "aws_instance" "web" {\n  ami = "ami-1"\n}\n\nmoved {\n  from = aws_instance.web["b"]\n  to   = aws_instance.web\n}\n');
    expect(text).toContain('instance = aws_instance.web.id');
  });

  it('switches count → for_each mapping index i to the i-th key', () => {
    state().applyCanvasOps(change({ kind: 'count', expr: lit(2) }).ops);
    const c = change({ kind: 'for_each', expr: raw('toset(["a", "b"])') });
    // web → web[0] (this session) continues to web["a"]; web[1] never existed in state
    expect(c.moves).toEqual([
      { from: 'aws_instance.web[0]', to: 'aws_instance.web["a"]' },
      { from: 'aws_instance.web[1]', to: 'aws_instance.web["b"]' },
    ]);
    state().applyCanvasOps(c.ops);
    const text = state().files['main.tf'];
    expect(text).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.web["a"]\n}');
    expect(text).toContain('moved {\n  from = aws_instance.web[1]\n  to   = aws_instance.web["b"]\n}');
    expect(text).toContain('instance = aws_instance.web["a"].id');
    expect(text).not.toContain('count');
    expect(parseProject(state().files).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('without keeping the state: no moved block, references still follow', () => {
    const c = change({ kind: 'count', expr: lit(2) }, undefined, false);
    state().applyCanvasOps(c.ops);
    expect(state().files['main.tf']).not.toContain('moved');
    expect(state().files['main.tf']).toContain('instance = aws_instance.web[0].id');
  });

  it('an expression count', () => {
    state().applyCanvasOps(change({ kind: 'count', expr: raw('var.enabled ? 1 : 0') }).ops);
    expect(state().files['main.tf']).toContain('  count = var.enabled ? 1 : 0\n');
    expect(state().edges.some((e) => e.source === 'aws_eip.ip' && e.target === 'aws_instance.web')).toBe(true);
  });
});

describe('rename keeps the state', () => {
  it('writes moved when asked, one undo step, and the selection follows', () => {
    state().setSelection('aws_instance.web');
    state().applyCanvasOps(renameOps(state().ir, web(), 'app', { keepState: true, isHistory: isHistoryMove }), 'aws_instance.app');
    expect(state().files['main.tf']).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.app\n}');
    expect(state().selection).toBe('aws_instance.app');
    state().undo();
    expect(state().files['main.tf']).toBe(MAIN);
  });

  it('opting out renames like before', () => {
    state().applyCanvasOps(renameOps(state().ir, web(), 'app', { keepState: false }));
    expect(state().files['main.tf']).toBe(MAIN.replace(/aws_instance\.web/g, 'aws_instance.app').replace('"web"', '"app"'));
  });

  it('treats blocks present at load as history', () => {
    const files = { 'main.tf': `${MAIN}\nmoved {\n  from = aws_instance.old\n  to   = aws_instance.web\n}\n` };
    state().load(createProject({ name: 'history', files }));
    expect(isHistoryMove({ from: 'aws_instance.old', to: 'aws_instance.web' })).toBe(true);
    const node = state().ir.resources.find((r) => r.id === 'aws_instance.web')!;
    state().applyCanvasOps(renameOps(state().ir, node, 'app', { keepState: true, isHistory: isHistoryMove }));
    const text = state().files['main.tf'];
    expect(text).toContain('moved {\n  from = aws_instance.old\n  to   = aws_instance.web\n}');
    expect(text).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.app\n}');
  });

  it('defaults to keeping the state only for projects that look deployed', () => {
    const { ir } = parseProject({ 'main.tf': MAIN });
    expect(keepStateFor({}, 'p1', ir)).toBe(false);
    const deployed = parseProject({ 'main.tf': `terraform {\n  backend "s3" {}\n}\n${MAIN}` }).ir;
    expect(keepStateFor({}, 'p1', deployed)).toBe(true);
    expect(keepStateFor({ p1: true }, 'p1', ir)).toBe(true);
    expect(keepStateFor({ p1: false }, 'p1', deployed)).toBe(false);
  });
});

describe('connecting to repeated resources', () => {
  it('uses the instance or the splat', async () => {
    const { connectionOp, findConnectionRule } = await import('@/resources/connect');
    const { getDef } = await import('@/resources/registry');
    const src = `resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n\nresource "aws_subnet" "private" {\n  count  = 2\n  vpc_id = aws_vpc.main.id\n}\n\nresource "aws_instance" "app" {\n  ami = "ami-1"\n}\n\nresource "aws_lb" "web" {\n  name = "web"\n}\n`;
    const { ir } = parseProject({ 'main.tf': src });
    const byId = (id: string) => ir.resources.find((r) => r.id === id)!;
    const subnet = byId('aws_subnet.private');
    const toInstance = connectionOp(byId('aws_instance.app'), subnet, findConnectionRule(getDef('aws_instance'), 'aws_subnet')!, ir);
    expect(toInstance).toMatchObject({ field: 'subnet_id', value: ref('aws_subnet.private[0].id') });
    const toLb = connectionOp(byId('aws_lb.web'), subnet, findConnectionRule(getDef('aws_lb'), 'aws_subnet')!, ir);
    expect(toLb).toMatchObject({ field: 'subnets', value: ref('aws_subnet.private[*].id') });
  });
});
