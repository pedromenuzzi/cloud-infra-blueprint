import { describe, expect, it } from 'vitest';
import { buildNewNode, duplicateNode } from '@/features/editor/newNode';
import { applyOps } from '@/ir/ops';
import { emptyIR, type IR } from '@/ir/types';
import { cloudName, copyName, nameSlug } from './naming';
import { allDefs, getDef } from './registry';
import type { NamingRule, ResourceDef } from './types';

/** what each style accepts, as the providers spell it out */
function isValid(name: string, rule: NamingRule = {}): boolean {
  const style = rule.style ?? 'hyphen';
  const body = style === 'dns' ? name.replace(/\.$/, '').split('.')[0] : name;
  const pattern =
    style === 'alnum'
      ? /^[a-z][a-z0-9]*$/
      : style === 'underscore'
        ? /^[A-Za-z][A-Za-z0-9_]*$/
        : /^[a-z]([a-z0-9-]*[a-z0-9])?$/;
  if (style === 'dns' && !name.endsWith('.')) return false;
  if (!pattern.test(body) || /--|__/.test(body)) return false;
  if (rule.maxLength !== undefined && name.length > rule.maxLength) return false;
  if (rule.minLength !== undefined && name.length < rule.minLength) return false;
  return true;
}

const nameArgOf = (def: ResourceDef) => def.nameArg ?? 'name';
const namedDefs = allDefs().filter((d) => d.fields.some((f) => f.name === nameArgOf(d)));

function drop(ir: IR, def: ResourceDef): IR {
  return applyOps(ir, buildNewNode(ir, def, { x: 0, y: 0 }).ops).ir;
}

describe('cloudName', () => {
  it('turns labels and app names into hyphenated lowercase names', () => {
    expect(cloudName('lb_2')).toBe('lb-2');
    expect(cloudName('Production Web', {}, 'alb')).toBe('production-web-alb');
    expect(cloudName('production_web', {}, 'db')).toBe('production-web-db');
    expect(cloudName('--a__b--')).toBe('a-b');
  });

  it('keeps only letters and digits for alphanumeric names', () => {
    expect(cloudName('my_app', { style: 'alnum' }, 'site')).toBe('myappsite');
    expect(cloudName('registry_2', { style: 'alnum' })).toBe('registry2');
  });

  it('keeps underscores for underscore-style names', () => {
    expect(cloudName('dataset_2', { style: 'underscore' })).toBe('dataset_2');
    expect(cloudName('my-app data', { style: 'underscore' }, 'copy')).toBe('my_app_data_copy');
  });

  it('starts with a letter', () => {
    expect(cloudName('123 app', {}, 'alb')).toBe('r-123-app-alb');
    expect(isValid(cloudName('9lives', { style: 'alnum' }), { style: 'alnum' })).toBe(true);
  });

  it('truncates to maxLength, shortening the base so the suffix survives', () => {
    const name = cloudName('a very long application name indeed', { maxLength: 32 }, 'alb');
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name.endsWith('-alb')).toBe(true);
    expect(name).not.toMatch(/--/);
    expect(cloudName('abcdefghij', { maxLength: 6 })).toBe('abcdef');
    expect(cloudName('abcd-efgh', { maxLength: 5 })).toBe('abcd');
  });

  it('pads names shorter than minLength', () => {
    expect(cloudName('ab', { style: 'alnum', minLength: 5 })).toBe('ab000');
  });

  it('writes DNS names fully qualified', () => {
    expect(cloudName('set', { style: 'dns' })).toBe('set.example.com.');
    expect(cloudName('set_2', { style: 'dns' })).toBe('set-2.example.com.');
  });

  it('slugs app names for templates', () => {
    expect(nameSlug('production_web')).toBe('production-web');
    expect(nameSlug('My Demo App!')).toBe('my-demo-app');
    expect(nameSlug('___')).toBe('app');
  });
});

describe('copyName', () => {
  it('appends copy in the style of the type', () => {
    expect(copyName(getDef('aws_lb'), 'web-alb', 'web_copy')).toBe('web-alb-copy');
    expect(copyName(getDef('azurerm_storage_account'), 'demosite', 'site_copy')).toBe('demositecopy');
    expect(copyName(getDef('azurerm_container_registry'), 'registry', 'registry_copy')).toBe('registrycopy');
    expect(copyName(getDef('google_bigquery_dataset'), 'analytics', 'dataset_copy')).toBe('analytics_copy');
    expect(copyName(getDef('google_dns_record_set'), 'www.example.com.', 'set_copy')).toBe('www-copy.example.com.');
  });

  it('numbers further copies after the Terraform label instead of stacking suffixes', () => {
    expect(copyName(getDef('aws_lb'), 'web-alb-copy', 'web_copy_2')).toBe('web-alb-copy-2');
    expect(copyName(getDef('azurerm_storage_account'), 'demositecopy', 'site_copy_2')).toBe('demositecopy2');
  });

  it('respects maxLength', () => {
    const name = copyName(getDef('azurerm_storage_account'), 'abcdefghijklmnopqrstuvwx', 'site_copy');
    expect(name).toHaveLength(24);
    expect(name.endsWith('copy')).toBe(true);
  });
});

describe('palette names are valid cloud-side names', () => {
  for (const def of namedDefs) {
    it(`${def.type}: first, second and duplicated drops`, () => {
      let ir = drop(emptyIR(), def);
      ir = drop(ir, def);
      const [first, second] = ir.resources;
      expect(second.name, 'Terraform label keeps the _N suffix').toMatch(/_2$/);
      const nameArg = nameArgOf(def);
      const names = [first, second].map((r) => r.args[nameArg]);
      const copy = duplicateNode(ir, second, def).node.args[nameArg];
      for (const e of [...names, copy]) {
        // a def default (e.g. an API stage's "$default") isn't derived from the label
        if (def.defaults?.[nameArg]) continue;
        expect(e?.kind).toBe('literal');
        const value = (e as { value: string }).value;
        expect(isValid(value, def.naming), `${def.type}.${nameArg} = "${value}"`).toBe(true);
      }
      if (!def.defaults?.[nameArg]) {
        const values = [...names, copy].map((e) => (e as { value: string }).value);
        expect(new Set(values).size, 'names are distinct').toBe(3);
      }
    });
  }

  it('prefills DNS record set names fully qualified', () => {
    const { node } = buildNewNode(emptyIR(), getDef('google_dns_record_set')!, { x: 0, y: 0 });
    expect(node.args.name).toEqual({ kind: 'literal', value: 'set.example.com.' });
  });

  it('fixes the name argument of task definitions and Artifact Registry', () => {
    const task = buildNewNode(emptyIR(), getDef('aws_ecs_task_definition')!, { x: 0, y: 0 }).node;
    expect(task.args.family).toEqual({ kind: 'literal', value: 'definition' });
    const repo = buildNewNode(emptyIR(), getDef('google_artifact_registry_repository')!, { x: 0, y: 0 }).node;
    expect(repo.args.repository_id).toEqual({ kind: 'literal', value: 'repository' });
  });
});
