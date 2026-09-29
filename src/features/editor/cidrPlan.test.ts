import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToasts } from '@/components/Toast';
import { parseProject } from '@/hcl/parser';
import { applyOpsWithPatches } from '@/hcl/patch';
import { deriveStructure } from '@/ir/graph';
import { autoLayout } from '@/ir/layout';
import type { IR } from '@/ir/types';
import { validateProject } from '@/ir/validate';
import { createProject } from '@/lib/storage';
import { getDef, isContainerType } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import {
  addSubnetOps,
  defaultPrefix,
  fitsBlocks,
  networkPlan,
  sizeChoices,
  splitAcrossZonesOps,
  subnetPlan,
  type PlanResult,
} from './cidrPlan';
import { useEditor } from './store';

/** a project as the editor holds it: files, and the IR derived from them */
function project(files: Record<string, string>): { files: Record<string, string>; ir: IR } {
  const { ir } = parseProject(files);
  deriveStructure(ir, getDef);
  autoLayout(ir, isContainerType);
  return { files, ir };
}

const template = (slug: string) => project(TEMPLATES.find((t) => t.slug === slug)!.build('production-web'));

function ok(result: PlanResult | { error: string }): PlanResult {
  if ('error' in result) throw new Error(result.error);
  return result;
}

/** apply the ops the way the canvas does, then re-derive */
function apply(state: { files: Record<string, string>; ir: IR }, result: PlanResult) {
  const outcome = applyOpsWithPatches(state.files, state.ir, result.ops);
  expect(outcome.refused).toBeUndefined();
  expect(outcome.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return project(outcome.files);
}

const block = (text: string, type: string, name: string) => {
  const m = new RegExp(`(# @blueprint:pos=[^\\n]*\\n)?resource "${type}" "${name}" \\{\\n[\\s\\S]*?\\n\\}\\n`).exec(text);
  return m?.[0];
};

describe('network plan', () => {
  it("reads the seed VPC's usage, subnets and region", () => {
    const plan = networkPlan(template('aws-web-app').ir, 'aws_vpc.main')!;
    expect(plan.blocked).toBeUndefined();
    expect(plan.rows.map((r) => [r.node.id, r.label, r.zone])).toEqual([
      ['aws_subnet.public_a', '10.0.1.0/24', 'us-east-1a'],
      ['aws_subnet.public_b', '10.0.2.0/24', 'us-east-1b'],
    ]);
    expect([plan.allocated, plan.total]).toEqual([512n, 65536n]);
    expect(plan.region).toBe('us-east-1');
  });

  it('offers the sizes a VPC can take, and marks the ones that no longer fit', () => {
    const { ir } = project({
      'main.tf':
        'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/24"\n}\nresource "aws_subnet" "a" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.0.0.0/25"\n}\n',
    });
    const plan = networkPlan(ir, 'aws_vpc.main')!;
    const choices = sizeChoices(plan);
    expect(choices.map((c) => [c.prefix, c.fits])).toEqual([
      [24, false],
      [25, true],
      [26, true],
      [27, true],
      [28, true],
    ]);
    expect(choices.find((c) => c.prefix === 26)!.usable).toBe(59n);
    expect(defaultPrefix(choices)).toBe(25);
    expect(fitsBlocks(plan, 26, 2)).toBe(true);
    expect(fitsBlocks(plan, 26, 3)).toBe(false);
    expect(defaultPrefix(sizeChoices(networkPlan(template('aws-web-app').ir, 'aws_vpc.main')!))).toBe(24);
  });

  it("explains what it can't plan: expressions, broken ranges, GCP networks", () => {
    const expr = project({ 'main.tf': 'variable "cidr" {}\nresource "aws_vpc" "main" {\n  cidr_block = var.cidr\n}\n' });
    expect(networkPlan(expr.ir, 'aws_vpc.main')!.blocked).toEqual({ reason: 'expression', field: 'cidr_block', text: 'var.cidr' });
    expect(addSubnetOps(expr.ir, 'aws_vpc.main', 24)).toEqual({ error: expect.stringMatching(/isn't a literal CIDR/) });
    const broken = project({ 'main.tf': 'resource "aws_vpc" "main" {\n  cidr_block = "10.0/16"\n}\n' });
    expect(networkPlan(broken.ir, 'aws_vpc.main')!.blocked).toEqual({ reason: 'invalid', field: 'cidr_block', text: '10.0/16' });
    const gcp = template('gcp-web-app');
    const plan = networkPlan(gcp.ir, 'google_compute_network.main')!;
    expect(plan.blocked).toEqual({ reason: 'none' });
    expect(plan.rows.map((r) => r.label)).toEqual(['10.0.1.0/24']);
  });
});

describe('adding subnets', () => {
  it('adds one subnet in the next free block, in the quietest AZ, inside the VPC', () => {
    const seed = template('aws-web-app');
    const result = ok(addSubnetOps(seed.ir, 'aws_vpc.main', 24));
    expect(result.ops).toHaveLength(1);
    expect(result.created).toEqual([{ id: 'aws_subnet.subnet', cidr: '10.0.3.0/24', zone: 'us-east-1c' }]);

    const next = apply(seed, result);
    expect(block(next.files['main.tf'], 'aws_subnet', 'subnet')).toBe(
      '# @blueprint:pos=24,492,300,176\n' +
        'resource "aws_subnet" "subnet" {\n' +
        '  vpc_id            = aws_vpc.main.id\n' +
        '  cidr_block        = "10.0.3.0/24"\n' +
        '  availability_zone = "us-east-1c"\n' +
        '}\n',
    );
    const node = next.ir.resources.find((r) => r.id === 'aws_subnet.subnet')!;
    expect(node.parentId).toBe('aws_vpc.main');
    expect(validateProject(next.ir, getDef)).toEqual([]);
    // the untouched blocks are byte-for-byte the same
    expect(next.files['main.tf'].startsWith(seed.files['main.tf'].trimEnd())).toBe(true);
  });

  it('splits across AZs as one batch of ops that never overlap', () => {
    const seed = template('aws-web-app');
    const result = ok(splitAcrossZonesOps(seed.ir, 'aws_vpc.main', 22, 3));
    expect(result.created).toEqual([
      { id: 'aws_subnet.subnet', cidr: '10.0.4.0/22', zone: 'us-east-1a' },
      { id: 'aws_subnet.subnet_2', cidr: '10.0.8.0/22', zone: 'us-east-1b' },
      { id: 'aws_subnet.subnet_3', cidr: '10.0.12.0/22', zone: 'us-east-1c' },
    ]);
    const next = apply(seed, result);
    const text = next.files['main.tf'];
    for (const { id, cidr, zone } of result.created) {
      const hcl = block(text, 'aws_subnet', id.split('.')[1])!;
      expect(hcl).toContain(`cidr_block        = "${cidr}"`);
      expect(hcl).toContain(`availability_zone = "${zone}"`);
      expect(hcl).toContain('vpc_id            = aws_vpc.main.id');
    }
    expect(next.ir.resources).toHaveLength(14);
    expect(validateProject(next.ir, getDef)).toEqual([]);

    // drawn inside the VPC without covering its other children
    const children = next.ir.resources.filter((r) => r.parentId === 'aws_vpc.main');
    const rect = (id: string) => {
      const p = next.ir.resources.find((r) => r.id === id)!.position!;
      return { x: p.x, y: p.y, w: p.w ?? 208, h: p.h ?? 76 };
    };
    for (const { id } of result.created) {
      const a = rect(id);
      expect(a.x).toBeGreaterThanOrEqual(24);
      for (const other of children.filter((c) => c.id !== id)) {
        const b = rect(other.id);
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${id} is drawn over ${other.id}`).toBe(false);
      }
    }
  });

  it('adds an Azure subnet with the VNet’s resource group and a list of prefixes', () => {
    const azure = template('azure-web-app');
    const result = ok(addSubnetOps(azure.ir, 'azurerm_virtual_network.main', 24));
    expect(result.created).toEqual([{ id: 'azurerm_subnet.subnet', cidr: '10.10.2.0/24', zone: undefined }]);
    const next = apply(azure, result);
    const hcl = block(next.files['main.tf'], 'azurerm_subnet', 'subnet')!;
    expect(hcl).toContain('address_prefixes     = ["10.10.2.0/24"]');
    expect(hcl).toContain('virtual_network_name = azurerm_virtual_network.main.name');
    expect(hcl).toContain('resource_group_name  = azurerm_virtual_network.main.resource_group_name');
    expect(hcl).toContain('name                 = "subnet"');
    expect(validateProject(next.ir, getDef)).toEqual([]);
    expect(splitAcrossZonesOps(azure.ir, 'azurerm_virtual_network.main', 24, 2)).toEqual({ error: expect.stringMatching(/AWS/) });
  });

  it("says so when there's no room or no region", () => {
    const small = project({
      'main.tf':
        'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/27"\n}\nresource "aws_subnet" "a" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.0.0.0/27"\n}\n',
    });
    expect(addSubnetOps(small.ir, 'aws_vpc.main', 28)).toEqual({ error: "There's no room left for a /28 in aws_vpc.main" });
    expect(splitAcrossZonesOps(small.ir, 'aws_vpc.main', 28, 2)).toEqual({
      error: "Set the AWS provider's region to spread subnets across its zones",
    });
    const withRegion = project({ ...small.files, 'providers.tf': 'provider "aws" {\n  region = "eu-west-1"\n}\n' });
    expect(splitAcrossZonesOps(withRegion.ir, 'aws_vpc.main', 28, 2)).toEqual({
      error: "There's no room left for 2 /28 subnets in aws_vpc.main",
    });
  });
});

describe('subnet plan', () => {
  it('gives the size, usable addresses and share of the VPC', () => {
    const plan = subnetPlan(template('aws-web-app').ir, 'aws_subnet.public_b')!;
    expect(plan.usable?.count).toBe(251n);
    expect(plan.share).toBeCloseTo(256 / 65536);
    expect(plan.outside).toBe(false);
    expect(plan.parent?.network.node.id).toBe('aws_vpc.main');
  });

  it('knows GCP keeps four addresses, and flags a subnet outside its VPC', () => {
    expect(subnetPlan(template('gcp-web-app').ir, 'google_compute_subnetwork.app')!.usable?.count).toBe(252n);
    const { ir } = project({
      'main.tf':
        'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\nresource "aws_subnet" "a" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.9.0.0/24"\n}\n',
    });
    expect(subnetPlan(ir, 'aws_subnet.a')!.outside).toBe(true);
  });
});

describe('in the editor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
    const files = TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('production-web');
    useEditor.getState().load(createProject({ name: 'plan', files }));
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('a split is one undo step', () => {
    const before = useEditor.getState().files['main.tf'];
    const result = ok(splitAcrossZonesOps(useEditor.getState().ir, 'aws_vpc.main', 24, 3));
    useEditor.getState().applyCanvasOps(result.ops);
    expect(useEditor.getState().ir.resources).toHaveLength(14);
    useEditor.getState().undo();
    expect(useEditor.getState().files['main.tf']).toBe(before);
    expect(useEditor.getState().ir.resources).toHaveLength(11);
  });
});
