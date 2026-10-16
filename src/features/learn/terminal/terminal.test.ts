import { describe, expect, it } from 'vitest';
import { complete, parseTyped, words } from './input';
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

  it('reads the flags of plan and apply, quotes like a shell', () => {
    expect(words(`terraform plan -var 'name=a b' -var="x=1"`)).toEqual(['terraform', 'plan', '-var', 'name=a b', '-var=x=1']);
    expect(parseTyped(`terraform plan -var 'env=prod' -var-file=prod.tfvars -out=tfplan`)).toEqual({
      kind: 'sim',
      command: 'plan',
      autoApprove: false,
      flags: {
        vars: [
          { kind: 'var', text: 'env=prod' },
          { kind: 'file', name: 'prod.tfvars' },
        ],
        out: 'tfplan',
      },
    });
    expect(parseTyped('terraform apply tfplan')).toEqual({ kind: 'sim', command: 'apply', autoApprove: false, flags: { planFile: 'tfplan' } });
    expect(parseTyped('tf plan -generate-config-out=generated.tf')).toMatchObject({ flags: { generateConfig: 'generated.tf' } });
    expect(parseTyped('terraform init -migrate-state')).toMatchObject({ command: 'init', flags: { backendFlag: 'migrate-state' } });
    expect(parseTyped('terraform plan -auto-approve')).toMatchObject({ kind: 'bad-flag', detail: 'flag provided but not defined: -auto-approve' });
    expect(parseTyped('terraform plan -var')).toMatchObject({ kind: 'bad-flag', detail: 'flag needs an argument: -var' });
    expect(parseTyped('terraform workspace new dev')).toEqual({ kind: 'workspace', args: ['new', 'dev'] });
    expect(parseTyped('terraform output -raw url')).toEqual({ kind: 'output', args: ['-raw', 'url'] });
  });

  it('completes commands and flags with Tab, and lists the matches when there are several', () => {
    const ctx = { outputs: ['url', 'vpc_id'], workspaces: ['default', 'dev'], plans: ['tfplan'], files: ['main.tf', 'prod.tfvars'] };
    expect(complete('terraform pl', ctx)).toEqual({ text: 'terraform plan ', options: [] });
    expect(complete('ter', ctx)).toEqual({ text: 'terraform ', options: [] });
    expect(complete('terraform plan -o', ctx)).toEqual({ text: 'terraform plan -out=', options: [] });
    expect(complete('terraform plan -var-file=', ctx)).toEqual({ text: 'terraform plan -var-file=prod.tfvars ', options: [] });
    expect(complete('terraform apply -', ctx)?.options).toEqual(['-auto-approve', '-var', '-var-file=']);
    expect(complete('terraform apply t', ctx)?.text).toBe('terraform apply tfplan ');
    expect(complete('tf workspace select d', ctx)).toEqual({ text: 'tf workspace select de', options: ['default', 'dev'] });
    expect(complete('terraform output v', ctx)?.text).toBe('terraform output vpc_id ');
    expect(complete('terraform zz', ctx)).toBeNull();
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
