import { applyOps, emptyIR, lit, newResource, obj } from '@blueprint/ir';
import { describe, expect, it } from 'vitest';

import { emitBlock, emitIR, emitResource, expr } from './emitter.js';

describe('HCL emitter', () => {
  it('renders literals correctly', () => {
    expect(expr(lit('t3.micro'))).toBe('"t3.micro"');
    expect(expr(lit(42))).toBe('42');
    expect(expr(lit(true))).toBe('true');
    expect(expr(lit(null))).toBe('null');
  });

  it('escapes special characters in strings', () => {
    expect(expr(lit('hello "world"'))).toBe('"hello \\"world\\""');
    expect(expr(lit('a\nb'))).toBe('"a\\nb"');
  });

  it('inlines short literal lists', () => {
    expect(expr({ kind: 'list', items: [lit('a'), lit('b')] })).toBe('["a", "b"]');
  });

  it('emits a resource block matching expected shape', () => {
    const ec2 = newResource('aws_instance', 'web', {
      ami: 'ami-0abc',
      instance_type: 't3.micro',
      tags: { Name: 'web' },
    });
    const out = emitResource(ec2);
    expect(out).toContain('resource "aws_instance" "web"');
    expect(out).toContain('ami           = "ami-0abc"'.replace(/\s+/g, ' '));
    expect(out).toMatch(/instance_type\s*=\s*"t3.micro"/);
    expect(out).toMatch(/tags\s*=\s*\{\s*Name\s*=\s*"web"\s*\}/);
  });

  it('emits empty body as `{}` not `{\\n}`', () => {
    expect(emitBlock('terraform', [], {})).toBe('terraform {}');
  });

  it('emitIR groups providers/variables/outputs/main into separate files', () => {
    const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });
    const ir = applyOps(emptyIR(), [
      { kind: 'add_resource', node: ec2 },
      { kind: 'set_provider', provider: 'aws', config: { region: 'us-east-1' } },
      {
        kind: 'set_variable',
        name: 'env',
        decl: { type: 'string', default: lit('dev') },
      },
      {
        kind: 'set_output',
        name: 'instance_id',
        decl: { value: { kind: 'ref', path: 'aws_instance.web.id' } },
      },
    ]);
    const files = emitIR(ir);
    expect(Object.keys(files).sort()).toEqual([
      'main.tf',
      'outputs.tf',
      'providers.tf',
      'variables.tf',
    ]);
    expect(files['providers.tf']).toContain('provider "aws"');
    expect(files['variables.tf']).toContain('variable "env"');
    expect(files['outputs.tf']).toContain('aws_instance.web.id');
    expect(files['main.tf']).toContain('aws_instance');
  });

  it('preserves trivia.sourceFile when grouping', () => {
    const ec2 = newResource('aws_instance', 'web', {});
    ec2.trivia.sourceFile = 'compute.tf';
    const ir = applyOps(emptyIR(), [{ kind: 'add_resource', node: ec2 }]);
    const files = emitIR(ir);
    expect(files['compute.tf']).toBeDefined();
    expect(files['main.tf']).toBeUndefined();
  });

  it('renders nested objects with stable indentation and canonical key order', () => {
    const o = obj({ Name: lit('x'), Env: lit('prod') });
    const out = expr(o);
    // Keys are sorted alphabetically for canonical output (round-trip safe).
    expect(out).toBe('{\n    Env = "prod"\n    Name = "x"\n  }');
  });
});
