import { describe, expect, it } from 'vitest';
import { parseTyped } from './input';
import { clearPlan, nodeOf, showPlan, usePlanMarks } from './planMarks';

describe('the prompt', () => {
  it('reads terraform commands, the tf alias and the flags', () => {
    expect(parseTyped('terraform plan')).toEqual({ kind: 'sim', command: 'plan', autoApprove: false });
    expect(parseTyped('  tf   apply -auto-approve ')).toEqual({ kind: 'sim', command: 'apply', autoApprove: true });
    expect(parseTyped('terraform state list')).toEqual({ kind: 'state-list' });
    expect(parseTyped('')).toEqual({ kind: 'empty' });
    expect(parseTyped('help').kind).toBe('help');
    expect(parseTyped('terraform').kind).toBe('help');
    expect(parseTyped('clear').kind).toBe('clear');
  });

  it('answers what it doesn’t run like a shell would, with a guess', () => {
    expect(parseTyped('plan')).toEqual({ kind: 'not-found', word: 'plan', guess: 'plan' });
    expect(parseTyped('ls')).toEqual({ kind: 'not-found', word: 'ls' });
    expect(parseTyped('terraform fmt')).toEqual({ kind: 'not-here', sub: 'fmt' });
    expect(parseTyped('terraform plna')).toEqual({ kind: 'no-such', sub: 'plna' });
  });
});

describe('the plan on the canvas', () => {
  it('marks each node with its strongest change and lists what has no node left', () => {
    expect(nodeOf('aws_subnet.a[0]')).toBe('aws_subnet.a');
    expect(nodeOf('aws_s3_bucket.b["logs"]')).toBe('aws_s3_bucket.b');
    expect(nodeOf('module.net.aws_vpc.this')).toBe('module.net');
    showPlan(
      {
        changes: [
          { address: 'aws_subnet.a[0]', action: 'update' },
          { address: 'aws_subnet.a[1]', action: 'replace' },
          { address: 'aws_vpc.main', action: 'create' },
          { address: 'aws_s3_bucket.old', action: 'delete' },
        ],
        add: 2,
        change: 1,
        destroy: 2,
      },
      new Set(['aws_subnet.a', 'aws_vpc.main']),
    );
    expect(usePlanMarks.getState()).toEqual({
      nodes: { 'aws_subnet.a': { action: 'replace', count: 2 }, 'aws_vpc.main': { action: 'create', count: 1 } },
      gone: ['aws_s3_bucket.old'],
    });
    clearPlan();
    expect(usePlanMarks.getState()).toEqual({ nodes: {}, gone: [] });
  });
});
