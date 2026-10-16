import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { registerSchema } from '@/schema/store';
import { resourceSchema } from '@/schema/store';
import type { SchemaData } from '@/schema/types';
import { getTemplate } from '@/templates';
import { stateToProject } from './fromState';
import { MAX_FILE_BYTES, nodeIdFor, pathKey, readJsonFile, readJsonText } from './json';
import { diffRows, MAX_CHANGES, parsePlan, planCounts, planMarks, riskyChanges, type PlanChange, type RealPlan } from './plan';
import { samplePlan } from './sample';
import { isSensitivePath, parseState, stateByNode, type ParsedState } from './state';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));

function plan(name = 'aws-plan.json'): RealPlan {
  const result = parsePlan(fixture(name));
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.plan;
}

function state(): ParsedState {
  const result = parseState(fixture('aws.tfstate.json'));
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.state;
}

const change = (p: RealPlan, address: string): PlanChange => p.changes.find((c) => c.address === address)!;

describe('reading a plan', () => {
  it('reads a real `terraform show -json` plan, counted the way Terraform counts it', () => {
    const p = plan();
    expect(p.terraformVersion).toBe('1.9.8');
    expect(p.changes).toHaveLength(11);
    const c = planCounts(p.changes);
    expect(c).toMatchObject({ create: 1, update: 2, replace: 6, delete: 2 });
    // "Plan: 7 to add, 2 to change, 8 to destroy."
    expect([c.add, c.change, c.destroy]).toEqual([7, 2, 8]);
    expect(p.outputs).toEqual([{ name: 'vpc_id', action: 'delete' }]);
  });

  it('maps count, for_each and module addresses to their canvas node', () => {
    const p = plan();
    expect(change(p, 'aws_subnet.public[2]')).toMatchObject({ node: 'aws_subnet.public', index: 2, action: 'delete', reason: 'delete_because_count_index' });
    expect(change(p, 'aws_instance.app["a"]')).toMatchObject({ node: 'aws_instance.app', index: 'a', action: 'replace' });
    expect(change(p, 'module.net.aws_vpc.this')).toMatchObject({ node: 'module.net', module: 'module.net' });
    // a key with a dot, and a module's change without `module_address`
    const tf = plan('terraform-data-plan.json');
    expect(change(tf, 'terraform_data.keyed["b.c"]').node).toBe('terraform_data.keyed');
    expect(nodeIdFor({ mode: 'managed', type: 'aws_vpc', name: 'x', module: 'module.net["a"].module.sub' })).toBe('module.net');
    expect(nodeIdFor({ mode: 'data', type: 'aws_ami', name: 'ubuntu' })).toBe('data.aws_ami.ubuntu');
    const bare = parsePlan({ format_version: '1.2', resource_changes: [{ address: 'module.app[0].aws_s3_bucket.b', type: 'aws_s3_bucket', name: 'b', change: { actions: ['create'] } }] });
    expect(bare.ok && bare.plan.changes[0]).toMatchObject({ node: 'module.app', module: 'module.app[0]' });
  });

  it('diffs the attributes: what forces the replacement first, unknowns said, secrets never shown', () => {
    const p = plan();
    const db = diffRows(change(p, 'aws_db_instance.main'));
    expect(db.rows[0]).toMatchObject({ path: 'engine', forces: true, status: 'changed', before: { kind: 'value', text: '"mysql"' }, after: { kind: 'value', text: '"postgres"' } });
    expect(db.rows.find((r) => r.path === 'address')?.after).toEqual({ kind: 'unknown' });
    const password = db.rows.find((r) => r.path === 'password')!;
    expect(password.after).toEqual({ kind: 'sensitive' });
    expect(JSON.stringify(db.rows)).not.toContain('s3cr3t-pass');

    const vpc = diffRows(change(p, 'aws_vpc.main'));
    expect(vpc.rows.find((r) => r.path === 'tags.env')).toMatchObject({ status: 'changed', before: { text: '"dev"' }, after: { text: '"prod"' } });
    expect(vpc.rows.find((r) => r.path === 'cidr_block')?.status).toBe('same');

    // a sensitive value inside an object: unchanged is "same", and still never shown
    const one = diffRows(change(plan('terraform-data-plan.json'), 'terraform_data.one'));
    expect(one.rows.find((r) => r.path === 'input.pw')).toMatchObject({ status: 'same', after: { kind: 'sensitive' } });
    expect(one.rows.find((r) => r.path === 'input.name')?.status).toBe('changed');
    expect(JSON.stringify(one.rows.find((r) => r.path === 'input.pw'))).not.toContain('hunter2');

    // a destroy lists what's lost; a create what's coming
    expect(diffRows(change(p, 'aws_subnet.public[2]')).rows.every((r) => r.status === 'removed')).toBe(true);
    expect(diffRows(change(p, 'aws_instance.app["b"]')).rows.every((r) => r.status === 'added')).toBe(true);
  });

  it('draws each node once: its strongest change, its instances counted; destroys with no node apart', () => {
    const declared = new Set(['aws_subnet.public', 'aws_instance.app', 'aws_vpc.main', 'module.net', 'aws_db_instance.main']);
    const { nodes, gone } = planMarks(plan().changes, declared);
    // two replaced, one destroyed (count went from 3 to 2): a replace mark ×3
    expect(nodes['aws_subnet.public']).toEqual({ action: 'replace', count: 3 });
    expect(nodes['aws_instance.app']).toEqual({ action: 'replace', count: 2 });
    expect(nodes['module.net']).toEqual({ action: 'replace', count: 1 });
    expect(nodes['aws_vpc.main']).toEqual({ action: 'update', count: 1 });
    // not in the code: the destroyed one is listed, the others are the panel's to show
    expect(gone).toEqual(['aws_db_instance.legacy']);
    expect(nodes['aws_s3_bucket.logs']).toBeUndefined();
  });

  it('calls out destroying or replacing what keeps data', () => {
    expect(riskyChanges(plan().changes).map((c) => c.address).sort()).toEqual(['aws_db_instance.legacy', 'aws_db_instance.main', 'aws_s3_bucket.logs']);
  });

  it('reads imports and moves', () => {
    const p = parsePlan({
      format_version: '1.2',
      resource_changes: [
        { address: 'aws_vpc.main', type: 'aws_vpc', name: 'main', mode: 'managed', change: { actions: ['no-op'], importing: { id: 'vpc-1' } } },
        { address: 'aws_subnet.b', previous_address: 'aws_subnet.a', type: 'aws_subnet', name: 'b', change: { actions: ['no-op'] } },
        { address: 'aws_iam_role.r', type: 'aws_iam_role', name: 'r', change: { actions: ['create', 'delete'] } },
      ],
    });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(planCounts(p.plan.changes)).toMatchObject({ imports: 1, moved: 1, replace: 1 });
    expect(p.plan.changes[2].createFirst).toBe(true);
  });

  it('refuses what is not a plan, with a reason', () => {
    expect(parsePlan('x')).toEqual({ ok: false, error: { code: 'not-object' } });
    expect(parsePlan({ hello: 1 })).toEqual({ ok: false, error: { code: 'not-a-plan' } });
    expect(parsePlan({ version: 4, resources: [] })).toEqual({ ok: false, error: { code: 'state-not-plan' } });
    expect(parsePlan({ format_version: '1.0', values: {} })).toEqual({ ok: false, error: { code: 'state-json-not-plan' } });
    expect(parsePlan({ format_version: '2.0', resource_changes: [] })).toEqual({ ok: false, error: { code: 'format', version: '2.0' } });
    expect(parsePlan({ format_version: '1.2', resource_changes: {} })).toEqual({ ok: false, error: { code: 'not-a-plan' } });
    const bad = (c: unknown) => parsePlan({ format_version: '1.2', resource_changes: [c] });
    expect(bad({ address: 'a.b', type: 'a', name: 'b', change: { actions: ['explode'] } })).toEqual({ ok: false, error: { code: 'bad-change', index: 0 } });
    expect(bad({ address: 1, type: 'a', name: 'b', change: { actions: ['create'] } }).ok).toBe(false);
    expect(bad({ address: 'a.b', type: 'a', name: 'b' }).ok).toBe(false);
    expect(bad({ address: 'a.b', type: 'a', name: 'b', mode: 'weird', change: { actions: ['create'] } }).ok).toBe(false);
    expect(bad(null).ok).toBe(false);
    // an empty plan is a plan
    expect(parsePlan({ format_version: '1.2', planned_values: {} })).toMatchObject({ ok: true, plan: { changes: [] } });
  });

  it('reads big plans and refuses huge ones', () => {
    const item = (i: number) => ({ address: `aws_s3_bucket.b${i}`, type: 'aws_s3_bucket', name: `b${i}`, change: { actions: ['create'], before: null, after: { bucket: `b${i}` } } });
    const big = Array.from({ length: 20_000 }, (_, i) => item(i));
    const started = performance.now();
    const read = readJsonText(JSON.stringify({ format_version: '1.2', resource_changes: big }));
    const p = parsePlan(read.ok ? read.value : null);
    expect(p.ok && p.plan.changes.length).toBe(20_000);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(parsePlan({ format_version: '1.2', resource_changes: new Array(MAX_CHANGES + 1).fill(null) })).toEqual({ ok: false, error: { code: 'too-many' } });
  });
});

describe('reading a file', () => {
  it('tells JSON, a binary plan and junk apart, and refuses big files before reading them', async () => {
    expect(readJsonText('﻿{"format_version":"1.2","resource_changes":[]}')).toMatchObject({ ok: true, kind: 'plan' });
    expect(readJsonText('{"version":4,"resources":[]}')).toMatchObject({ ok: true, kind: 'state' });
    expect(readJsonText('PK\u0003\u0004…')).toEqual({ ok: false, error: 'binary-plan' });
    expect(readJsonText('resource "x" {}')).toEqual({ ok: false, error: 'not-json' });
    let read = false;
    const huge = { size: MAX_FILE_BYTES + 1, text: async () => ((read = true), '{}') } as unknown as Blob;
    expect(await readJsonFile(huge)).toEqual({ ok: false, error: 'too-large' });
    expect(read).toBe(false);
  });

  it('writes attribute paths the way Terraform does', () => {
    expect(pathKey(['tags', 'env'])).toBe('tags.env');
    expect(pathKey(['ingress', 0, 'from_port'])).toBe('ingress[0].from_port');
    expect(pathKey(['tags', 'kubernetes.io/role'])).toBe('tags["kubernetes.io/role"]');
  });
});

describe('reading a state', () => {
  it('reads instances with their keys, modules and data sources', () => {
    const s = state();
    expect(s).toMatchObject({ terraformVersion: '1.9.8', serial: 12, outputs: ['vpc_id'] });
    const subnets = s.resources.find((r) => r.address === 'aws_subnet.public')!;
    expect(subnets.instances.map((i) => i.address)).toEqual(['aws_subnet.public[0]', 'aws_subnet.public[1]', 'aws_subnet.public[2]']);
    expect(s.resources.find((r) => r.type === 'aws_instance')!.instances[0].address).toBe('aws_instance.app["a"]');
    expect(s.resources.find((r) => r.module)).toMatchObject({ address: 'module.net.aws_vpc.this', node: 'module.net' });
    // nodes: managed resources only
    const nodes = stateByNode(s);
    expect(nodes.has('data.aws_availability_zones.available')).toBe(false);
    expect(nodes.get('module.net')).toHaveLength(1);
  });

  it('masks what Terraform marks sensitive and what is named like a secret', () => {
    const db = state().resources.find((r) => r.address === 'aws_db_instance.main')!.instances[0];
    expect(db.sensitive).toEqual(['password']);
    expect(isSensitivePath(db, 'password')).toBe(true);
    expect(isSensitivePath(db, 'identifier')).toBe(false);
    const inst = { address: 'x.y', attributes: {}, sensitive: ['input.pw'] };
    expect(isSensitivePath(inst, 'input.pw')).toBe(true);
    expect(isSensitivePath(inst, 'input.name')).toBe(false);
    expect(isSensitivePath(inst, 'master_user_secret[0].secret_arn')).toBe(true);
    expect(isSensitivePath(inst, 'bypass')).toBe(false);
  });

  it('refuses what is not a version 4 state', () => {
    expect(parseState(null)).toEqual({ ok: false, error: { code: 'not-object' } });
    expect(parseState({ version: 3, resources: [] })).toEqual({ ok: false, error: { code: 'version', version: '3' } });
    expect(parseState({ format_version: '1.2', resource_changes: [] })).toEqual({ ok: false, error: { code: 'plan-not-state' } });
    expect(parseState({ format_version: '1.0', values: {} })).toEqual({ ok: false, error: { code: 'state-json' } });
    expect(parseState({ lineage: 'x' })).toEqual({ ok: false, error: { code: 'not-a-state' } });
    const bad = (r: unknown) => parseState({ version: 4, resources: [r] });
    expect(bad({ mode: 'managed', type: 'a', name: 'b', instances: [{ attributes: 'x' }] })).toEqual({ ok: false, error: { code: 'bad-resource', index: 0 } });
    expect(bad({ mode: 'other', type: 'a', name: 'b', instances: [] }).ok).toBe(false);
    expect(bad({ mode: 'managed', type: 'a', name: 'b', module: 'net', instances: [] }).ok).toBe(false);
    expect(bad({ mode: 'managed', type: 'a', name: 'b', instances: [{ index_key: {}, attributes: {} }] }).ok).toBe(false);
    // a deposed object (create_before_destroy) is not the current one
    const deposed = parseState({ version: 4, resources: [{ mode: 'managed', type: 'a', name: 'b', instances: [{ attributes: { id: '1' } }, { deposed: 'abc', attributes: { id: '0' } }] }] });
    expect(deposed.ok && deposed.state.resources[0].instances).toHaveLength(1);
  });
});

describe('a project from a state', () => {
  registerSchema(JSON.parse(readFileSync(new URL('../schema/data/aws.json', import.meta.url), 'utf8')) as SchemaData);
  const result = stateToProject(state(), resourceSchema);
  const main = result.files['main.tf'];

  it('writes the catalog types and says what it left out', () => {
    expect(result.converted).toEqual(['aws_vpc.main', 'aws_subnet.public', 'aws_security_group.web', 'aws_instance.app', 'aws_db_instance.main', 'aws_db_instance.legacy', 'aws_s3_bucket.logs']);
    expect(result.instances).toBe(9);
    expect(result.skipped).toEqual([
      { address: 'data.aws_availability_zones.available', type: 'aws_availability_zones', reason: 'data-source' },
      { address: 'module.net.aws_vpc.this', type: 'aws_vpc', reason: 'in-module' },
    ]);
    expect(stateToProject({ resources: [{ address: 'aws_glue_job.x', node: 'aws_glue_job.x', mode: 'managed', type: 'aws_glue_job', name: 'x', instances: [{ address: 'aws_glue_job.x', attributes: {}, sensitive: [] }] }], outputs: [] }).skipped).toEqual([
      { address: 'aws_glue_job.x', type: 'aws_glue_job', reason: 'not-in-catalog' },
    ]);
  });

  it('round-trips through the parser, with references rebuilt from ids', () => {
    const { ir, diagnostics } = parseProject(result.files);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(ir.resources.map((r) => r.id)).toEqual(result.converted);
    const args = (id: string) => ir.resources.find((r) => r.id === id)!.args;
    expect(args('aws_subnet.public').vpc_id).toEqual({ kind: 'ref', path: 'aws_vpc.main.id' });
    expect(args('aws_security_group.web').vpc_id).toEqual({ kind: 'ref', path: 'aws_vpc.main.id' });
    expect(main).toContain('vpc_security_group_ids = [aws_security_group.web.id]');
    expect(main).toContain('subnet_id              = aws_subnet.public[0].id');
    expect(result.references).toBeGreaterThanOrEqual(4);
    // the region comes from the ARNs
    expect(result.files['providers.tf']).toContain('region = "us-east-1"');
    expect(result.files['versions.tf']).toContain('hashicorp/aws');
  });

  it('keeps count and for_each keys, with per-instance values picked by index', () => {
    expect(main).toMatch(/resource "aws_subnet" "public" \{\n  count\s+= 3/);
    expect(main).toMatch(/cidr_block\s+= \["10\.0\.0\.0\/24", "10\.0\.1\.0\/24", "10\.0\.2\.0\/24"\]\[count\.index\]/);
    expect(main).toMatch(/for_each\s+= toset\(\["a"\]\)/);
    // the same everywhere: written once
    expect(main).toMatch(/availability_zone\s+= "us-east-1a"/);
  });

  it('writes the security rules as blocks, without the computed or empty values', () => {
    expect(main).toMatch(/ingress \{\n\s+cidr_blocks = \["0\.0\.0\.0\/0"\]\n\s+from_port\s+= 443\n\s+protocol\s+= "tcp"\n\s+to_port\s+= 443\n\s+\}/);
    expect(main).not.toMatch(/\barn\b|tags_all|owner_id|default_security_group_id|self\s*=/);
  });

  it('never writes a secret: each becomes a sensitive variable', () => {
    expect(result.secrets).toEqual(['main_password', 'legacy_password']);
    expect(main).toContain('password            = var.main_password');
    expect(result.files['variables.tf']).toMatch(/variable "main_password" \{[^}]*sensitive\s+= true/);
    expect(JSON.stringify(result.files)).not.toMatch(/s3cr3t-pass|old-pass/);
  });
});

describe('the sample plan', () => {
  it('is a valid plan drawn on the open project', () => {
    const { ir } = parseProject(getTemplate('aws-web-app')!.build('demo'));
    const result = parsePlan(samplePlan(ir));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const counts = planCounts(result.plan.changes);
    expect(counts).toMatchObject({ imports: 1, update: 1, replace: 1, delete: 1 });
    expect(counts.create).toBeGreaterThan(3);
    const declared = new Set(ir.resources.map((r) => r.id));
    expect(result.plan.changes.filter((c) => !declared.has(c.node)).map((c) => c.address)).toEqual(['aws_instance.legacy']);
    expect(riskyChanges(result.plan.changes).map((c) => c.type)).toEqual(['aws_db_instance']);
    // an empty project still gets something to look at
    const empty = parsePlan(samplePlan(parseProject({}).ir));
    expect(empty.ok && empty.plan.changes).toHaveLength(1);
  });
});
