import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { CONTAINER_MIN_H, CONTAINER_MIN_W, NODE_H, NODE_W } from '@/ir/layout';
import type { Expression, ResourceNode } from '@/ir/types';
import { repeatOf } from '@/ir/repeat';
import { validateProject } from '@/ir/validate';
import { cloudName } from '@/resources/naming';
import { getDef } from '@/resources/registry';
import { scratchProject, TEMPLATES } from './index';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** canvas rectangles in flow coordinates (children are positioned relative to their parent) */
function absoluteRects(resources: ResourceNode[]): Map<string, Rect> {
  const byId = new Map(resources.map((r) => [r.id, r] as const));
  const out = new Map<string, Rect>();
  const rectOf = (r: ResourceNode): Rect => {
    const known = out.get(r.id);
    if (known) return known;
    const p = r.position!;
    const container = getDef(r.type)?.container === true;
    const origin = r.parentId ? rectOf(byId.get(r.parentId)!) : { x: 0, y: 0 };
    const rect = {
      x: origin.x + p.x,
      y: origin.y + p.y,
      w: container ? (p.w ?? CONTAINER_MIN_W) : NODE_W,
      h: container ? (p.h ?? CONTAINER_MIN_H) : NODE_H,
    };
    out.set(r.id, rect);
    return rect;
  };
  resources.forEach(rectOf);
  return out;
}

describe('templates', () => {
  for (const t of TEMPLATES) {
    it(`${t.slug} builds valid, connected Terraform`, () => {
      const files = t.build('My Demo App');
      expect(Object.keys(files)).toContain('main.tf');
      expect(Object.keys(files)).toContain('providers.tf');
      expect(Object.keys(files)).toContain('versions.tf');

      const { ir, diagnostics } = parseProject(files);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

      const warnings = validateProject(ir, getDef);
      expect(warnings, `template ${t.slug} should have no validation warnings`).toEqual([]);

      const edges = deriveStructure(ir, getDef);
      expect(edges.length).toBeGreaterThan(0);

      // every resource type is in the catalog
      for (const r of ir.resources) {
        expect(getDef(r.type), `catalog def for ${r.type}`).toBeDefined();
      }

      // every resource carries a persisted canvas position
      for (const r of ir.resources) {
        expect(r.position, `${r.id} has a position`).toBeDefined();
      }
    });
  }

  for (const t of TEMPLATES) {
    it(`${t.slug} draws each node only inside the containers it belongs to`, () => {
      const { ir } = parseProject(t.build('production-web'));
      deriveStructure(ir, getDef);
      const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
      const ancestors = (r: ResourceNode) => {
        const out = new Set<string>();
        for (let cur = r.parentId; cur; cur = byId.get(cur)?.parentId) out.add(cur);
        return out;
      };
      const rects = absoluteRects(ir.resources);
      for (const a of ir.resources) {
        for (const b of ir.resources) {
          if (a.id >= b.id || ancestors(a).has(b.id) || ancestors(b).has(a.id)) continue;
          const ra = rects.get(a.id)!;
          const rb = rects.get(b.id)!;
          const overlap = ra.x < rb.x + rb.w && rb.x < ra.x + ra.w && ra.y < rb.y + rb.h && rb.y < ra.y + ra.h;
          expect(overlap, `${a.id} is drawn over ${b.id}`).toBe(false);
        }
      }
    });

    it(`${t.slug} gives resources cloud-side names valid for their type`, () => {
      for (const appName of ['production_web', 'My Demo App', 'a really long application name for a template']) {
        const { ir } = parseProject(t.build(appName));
        for (const r of ir.resources) {
          const def = getDef(r.type)!;
          for (const arg of new Set([def.nameArg ?? 'name', 'bucket', 'identifier'])) {
            const value = r.args[arg];
            if (value?.kind !== 'literal' || typeof value.value !== 'string' || value.value.startsWith('$')) continue;
            expect(cloudName(value.value, def.naming), `${r.id}.${arg} = "${value.value}"`).toBe(value.value);
            if (def.naming?.style !== 'underscore') expect(value.value).not.toContain('_');
          }
        }
      }
    });
  }

  for (const t of TEMPLATES) {
    it(`${t.slug}: public subnets route 0.0.0.0/0 to an internet gateway`, () => {
      const { ir } = parseProject(t.build('demo'));
      // the resource a reference points at, without its instance key (`aws_subnet.public[count.index].id`)
      const target = (e: Expression | undefined) =>
        e?.kind === 'ref' ? e.path.replace(/\[[^\]]*\]/g, '').split('.').slice(0, 2).join('.') : undefined;
      const publicSubnets = ir.resources.filter(
        (r) =>
          r.type === 'aws_subnet' &&
          (r.name.startsWith('public') || (r.args.map_public_ip_on_launch as { value?: unknown })?.value === true),
      );
      for (const subnet of publicSubnets) {
        const tables = ir.resources
          .filter((r) => r.type === 'aws_route_table_association' && target(r.args.subnet_id) === subnet.id)
          .map((a) => ir.resources.find((r) => r.id === target(a.args.route_table_id)));
        const routesOut = tables.some((table) => {
          const route = table?.args.route;
          const routes = route?.kind === 'block' ? [route.body] : route?.kind === 'blocks' ? route.items : [];
          return routes.some((r) => {
            const gateway = ir.resources.find((g) => g.id === target(r.gateway_id));
            return (
              (r.cidr_block as { value?: unknown })?.value === '0.0.0.0/0' &&
              gateway?.type === 'aws_internet_gateway' &&
              target(gateway.args.vpc_id) === target(subnet.args.vpc_id)
            );
          });
        });
        expect(routesOut, `${subnet.id} is public but has no route to an internet gateway`).toBe(true);
      }
    });
  }

  it('serves the Azure static site with the static website resource, not the deprecated block', () => {
    const { ir } = parseProject(TEMPLATES.find((t) => t.slug === 'azure-static-site')!.build('demo'));
    const account = ir.resources.find((r) => r.type === 'azurerm_storage_account')!;
    expect(account.args.static_website).toBeUndefined();
    const site = ir.resources.find((r) => r.type === 'azurerm_storage_account_static_website')!;
    expect(site.args.storage_account_id).toEqual({ kind: 'ref', path: 'azurerm_storage_account.site.id' });
  });

  it('pins the current provider majors', () => {
    const versions = TEMPLATES.find((t) => t.slug === 'multi-cloud-dr')!.build('demo')['versions.tf'];
    expect(versions).toMatch(/hashicorp\/aws"\s+version = "~> 6\.0"/);
    expect(versions).toMatch(/hashicorp\/azurerm"\s+version = "~> 5\.0"/);
    expect(versions).toMatch(/hashicorp\/google"\s+version = "~> 8\.0"/);
  });

  it('scratch projects include provider + versions scaffolding', () => {
    for (const provider of ['aws', 'azure', 'gcp'] as const) {
      const files = scratchProject(provider, 'test');
      const { ir, diagnostics } = parseProject(files);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(ir.providers).toHaveLength(1);
      expect(ir.extras.some((e) => e.text.includes('required_providers'))).toBe(true);
    }
  });

  it('containment derives from real refs (web app: instance inside subnet inside vpc)', () => {
    const files = TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('demo');
    const { ir } = parseProject(files);
    deriveStructure(ir, getDef);
    const byId = new Map(ir.resources.map((r) => [r.id, r]));
    expect(byId.get('aws_subnet.public_a')?.parentId).toBe('aws_vpc.main');
    expect(byId.get('aws_instance.web')?.parentId).toBe('aws_subnet.public_a');
    expect(byId.get('aws_security_group.web')?.parentId).toBe('aws_vpc.main');
    expect(byId.get('aws_internet_gateway.igw')?.parentId).toBe('aws_vpc.main');
    expect(byId.get('aws_route_table.public')?.parentId).toBe('aws_vpc.main');
  });

  it('subnets per AZ: one block per tier, repeated with count over var.azs, drawn as stacks', () => {
    const { ir } = parseProject(TEMPLATES.find((t) => t.slug === 'aws-subnets-per-az')!.build('demo'));
    deriveStructure(ir, getDef);
    const byId = new Map(ir.resources.map((r) => [r.id, r]));
    for (const id of ['aws_subnet.public', 'aws_subnet.private', 'aws_route_table_association.public', 'aws_route_table_association.private']) {
      expect(repeatOf(byId.get(id)!, ir), id).toMatchObject({ kind: 'count', size: 3, via: 'var.azs' });
    }
    expect(byId.get('aws_subnet.public')!.args.cidr_block).toEqual({ kind: 'raw', hcl: 'cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)' });
    expect(byId.get('aws_subnet.private')!.args.cidr_block).toEqual({ kind: 'raw', hcl: 'cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)' });
    // nested where its references put it: subnets in the VPC, the NAT gateway in the first public subnet
    expect(byId.get('aws_subnet.public')?.parentId).toBe('aws_vpc.main');
    expect(byId.get('aws_subnet.private')?.parentId).toBe('aws_vpc.main');
    expect(byId.get('aws_nat_gateway.nat')?.parentId).toBe('aws_subnet.public');
    expect(byId.get('aws_route_table.private')?.parentId).toBe('aws_vpc.main');
    expect(byId.get('aws_vpc.main')?.args.cidr_block).toEqual(expect.objectContaining({ value: '10.0.0.0/16' }));
  });
});
