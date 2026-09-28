import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { lit, list, ref } from '@/ir/expr';
import { deriveStructure } from '@/ir/graph';
import { CONTAINER_MIN_H, CONTAINER_MIN_W, NODE_H, NODE_W } from '@/ir/layout';
import { applyOps } from '@/ir/ops';
import { emptyIR, type IR, type ResourceNode } from '@/ir/types';
import { AZURE_DEFAULT_LOCATION } from '@/resources/azure';
import { buildCatalogIR } from '@/resources/catalogProject';
import { cidrsOverlap, nextFreeCidr } from '@/resources/cidr';
import { allDefs, getDef } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import { buildNewNode, duplicateNode } from './newNode';

function seed(slug = 'aws-web-app'): IR {
  const { ir } = parseProject(TEMPLATES.find((t) => t.slug === slug)!.build('production-web'));
  deriveStructure(ir, getDef);
  return ir;
}

function add(ir: IR, type: string, parentId?: string): { ir: IR; node: ResourceNode } {
  const parent = parentId ? ir.resources.find((r) => r.id === parentId) : undefined;
  const { node, ops } = buildNewNode(ir, getDef(type)!, { x: 40, y: 60 }, parent);
  const next = applyOps(ir, ops).ir;
  deriveStructure(next, getDef);
  return { ir: next, node };
}

const byId = (ir: IR, id: string) => ir.resources.find((r) => r.id === id)!;

describe('next free CIDR', () => {
  it('finds the next /24 that overlaps nothing', () => {
    expect(nextFreeCidr('10.0.0.0/16', [], '10.0.1.0/24')).toBe('10.0.1.0/24');
    expect(nextFreeCidr('10.0.0.0/16', ['10.0.1.0/24', '10.0.2.0/24'], '10.0.1.0/24')).toBe('10.0.3.0/24');
    // a wider sibling covers several /24s
    expect(nextFreeCidr('10.0.0.0/16', ['10.0.0.0/22'], '10.0.1.0/24')).toBe('10.0.4.0/24');
    // default outside the network: start inside it
    expect(nextFreeCidr('172.16.0.0/16', [], '10.0.1.0/24')).toBe('172.16.1.0/24');
    // wraps around to the first block, then gives up when full
    expect(nextFreeCidr('10.0.0.0/23', ['10.0.1.0/24'], '10.0.1.0/24')).toBe('10.0.0.0/24');
    expect(nextFreeCidr('10.0.0.0/24', ['10.0.0.0/24'])).toBeUndefined();
    expect(nextFreeCidr('var.cidr', [])).toBeUndefined();
    expect(cidrsOverlap('10.0.0.0/16', '10.0.3.0/24')).toBe(true);
    expect(cidrsOverlap('10.0.2.0/24', '10.0.3.0/24')).toBe(false);
  });

  it('gives a subnet dropped in the seed VPC a range no sibling uses', () => {
    let ir = seed();
    const first = add(ir, 'aws_subnet', 'aws_vpc.main');
    expect(first.node.args.vpc_id).toEqual(ref('aws_vpc.main.id'));
    expect(first.node.args.cidr_block).toEqual(lit('10.0.3.0/24'));
    ir = first.ir;
    const second = add(ir, 'aws_subnet', 'aws_vpc.main');
    expect(second.node.args.cidr_block).toEqual(lit('10.0.4.0/24'));
  });

  it('keeps the default in an empty VPC and ignores other VPCs’ subnets', () => {
    let ir = add(seed(), 'aws_vpc').ir;
    const vpc = ir.resources.find((r) => r.id === 'aws_vpc.vpc')!;
    expect(vpc).toBeDefined();
    ir = add(ir, 'aws_subnet', vpc.id).ir;
    expect(byId(ir, 'aws_subnet.subnet').args.cidr_block).toEqual(lit('10.0.1.0/24'));
  });

  it('keeps the default when the VPC range is not a literal', () => {
    const { ir } = parseProject({ 'main.tf': 'resource "aws_vpc" "v" {\n  cidr_block = var.cidr\n}\n' });
    const { node } = buildNewNode(ir, getDef('aws_subnet')!, { x: 0, y: 0 }, ir.resources[0]);
    expect(node.args.cidr_block).toEqual(lit('10.0.1.0/24'));
  });

  it('works for Azure subnets (address_prefixes inside address_space)', () => {
    const { ir } = parseProject({
      'main.tf': [
        'resource "azurerm_virtual_network" "v" {',
        '  address_space = ["10.10.0.0/16"]',
        '}',
        'resource "azurerm_subnet" "a" {',
        '  virtual_network_name = azurerm_virtual_network.v.name',
        '  address_prefixes     = ["10.10.1.0/24"]',
        '}',
        '',
      ].join('\n'),
    });
    const vnet = ir.resources.find((r) => r.id === 'azurerm_virtual_network.v')!;
    const { node } = buildNewNode(ir, getDef('azurerm_subnet')!, { x: 0, y: 0 }, vnet);
    expect(node.args.address_prefixes).toEqual(list([lit('10.10.2.0/24')]));
  });

  it('gives a duplicated subnet its own range', () => {
    const ir = seed();
    const { node } = duplicateNode(ir, byId(ir, 'aws_subnet.public_b'));
    expect(node.args.cidr_block).toEqual(lit('10.0.3.0/24'));
  });
});

describe('Azure location', () => {
  const located = allDefs().filter((d) => d.provider === 'azure' && d.fields.some((f) => f.name === 'location'));

  it('covers every Azure resource with a location', () => {
    expect(located.length).toBeGreaterThanOrEqual(17);
  });

  for (const def of located) {
    it(`${def.type}: location from the resource group, else a default`, () => {
      const outside = buildNewNode(emptyIR(), def, { x: 0, y: 0 }).node;
      expect(outside.args.location, 'dropped on the canvas').toBeDefined();
      if (def.type === 'azurerm_cdn_profile' || def.type === 'azurerm_cdn_endpoint') {
        expect(outside.args.location).toEqual(lit('global'));
        return;
      }
      expect(outside.args.location).toEqual(lit(AZURE_DEFAULT_LOCATION));
      if (def.type === 'azurerm_resource_group') return;

      const rg = buildNewNode(emptyIR(), getDef('azurerm_resource_group')!, { x: 0, y: 0 }).node;
      const inside = buildNewNode({ ...emptyIR(), resources: [rg] }, def, { x: 20, y: 60 }, rg).node;
      expect(inside.args.location, 'dropped in a resource group').toEqual(ref('azurerm_resource_group.group.location'));
      expect(inside.args.resource_group_name).toEqual(ref('azurerm_resource_group.group.name'));
    });
  }

  it('apps dropped in a service plan take its location and resource group', () => {
    let ir = add(emptyIR(), 'azurerm_resource_group').ir;
    ir = add(ir, 'azurerm_service_plan', 'azurerm_resource_group.group').ir;
    const app = add(ir, 'azurerm_linux_web_app', 'azurerm_service_plan.plan').node;
    expect(app.args.service_plan_id).toEqual(ref('azurerm_service_plan.plan.id'));
    expect(app.args.location).toEqual(ref('azurerm_service_plan.plan.location'));
    expect(app.args.resource_group_name).toEqual(ref('azurerm_service_plan.plan.resource_group_name'));
  });

  it('the CI catalog project drops Azure resources in the resource group, so they inherit its location', () => {
    const vault = buildCatalogIR('azure').resources.find((r) => r.type === 'azurerm_key_vault')!;
    expect(vault.args.location).toEqual(ref('azurerm_resource_group.group.location'));
  });

  it('subnets dropped in a VNet take its resource group', () => {
    let ir = add(emptyIR(), 'azurerm_resource_group').ir;
    ir = add(ir, 'azurerm_virtual_network', 'azurerm_resource_group.group').ir;
    const subnet = add(ir, 'azurerm_subnet', 'azurerm_virtual_network.network').node;
    expect(subnet.args.resource_group_name).toEqual(ref('azurerm_virtual_network.network.resource_group_name'));
  });
});

describe('dropping into containers with nested-block connections', () => {
  it('a GCP instance dropped in a subnetwork attaches its network interface', () => {
    let ir = add(emptyIR(), 'google_compute_network').ir;
    ir = add(ir, 'google_compute_subnetwork', 'google_compute_network.network').ir;
    const vm = add(ir, 'google_compute_instance', 'google_compute_subnetwork.subnetwork');
    expect(vm.node.args.network_interface).toEqual({
      kind: 'block',
      body: { subnetwork: ref('google_compute_subnetwork.subnetwork.id') },
    });
    expect(byId(vm.ir, vm.node.id).parentId).toBe('google_compute_subnetwork.subnetwork');
  });
});

describe('duplicate offset', () => {
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const rect = (r: ResourceNode) => ({
    x: r.position!.x,
    y: r.position!.y,
    w: r.position!.w ?? NODE_W,
    h: r.position!.h ?? NODE_H,
  });

  it('moves a copy at least a node away, onto a spot no sibling uses', () => {
    const ir = seed();
    for (const id of ['aws_security_group.web', 'aws_instance.web', 'aws_iam_role.web', 'aws_db_instance.main']) {
      const source = byId(ir, id);
      const { node } = duplicateNode(ir, source);
      const next = applyOps(ir, [{ kind: 'add_resource', node }]).ir;
      deriveStructure(next, getDef);
      const copy = byId(next, node.id);
      expect(copy.parentId, `${id} copy stays in its container`).toBe(source.parentId);
      for (const other of next.resources) {
        if (other.id === copy.id || other.parentId !== copy.parentId || !other.position) continue;
        expect(overlaps(rect(copy), rect(other)), `${node.id} overlaps ${other.id}`).toBe(false);
      }
    }
  });

  it('offsets a container by its size plus a gap, clear of its siblings, and keeps its size', () => {
    const ir = seed();
    for (const id of ['aws_vpc.main', 'aws_subnet.public_a', 'aws_subnet.public_b']) {
      const source = byId(ir, id);
      const { node } = duplicateNode(ir, source);
      const p = node.position!;
      const s = source.position!;
      expect(p).toMatchObject({ w: s.w, h: s.h });
      expect(p.x - s.x >= s.w! + 32 || p.y - s.y >= s.h! + 32, `${id} copy clears the original`).toBe(true);
      for (const other of ir.resources) {
        if (other.parentId !== source.parentId || !other.position) continue;
        expect(overlaps(rect({ ...node, position: p }), rect(other)), `${node.id} overlaps ${other.id}`).toBe(false);
      }
    }
    // an empty neighbourhood: straight to the right
    const vpc = byId(ir, 'aws_vpc.main');
    const alone = duplicateNode({ ...ir, resources: [vpc] }, vpc).node;
    expect(alone.position).toEqual({ x: vpc.position!.x + vpc.position!.w! + 32, y: vpc.position!.y, w: 680, h: 430 });
  });

  it('gives a container without a saved size the minimum container size', () => {
    const { node: vpc } = buildNewNode(emptyIR(), getDef('aws_vpc')!, { x: 100, y: 100 });
    const { node } = duplicateNode({ ...emptyIR(), resources: [vpc] }, vpc);
    expect(node.position).toEqual({ x: 100 + CONTAINER_MIN_W + 32, y: 100, w: CONTAINER_MIN_W, h: CONTAINER_MIN_H });
  });
});
