/**
 * The shipped price tables against the catalog: every value the palette
 * offers for a priced field has a price (or is listed as deliberately
 * unpriced), every template can be estimated, and the tables are well formed.
 */
import { describe, expect, it } from 'vitest';
import { providerSummary } from '@/features/export/archDoc';
import { parseProject } from '@/hcl/parser';
import { lit } from '@/ir/expr';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { emptyIR } from '@/ir/types';
import { allDefs, getDef } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import { estimateProject, estimateResource } from './estimate';
import { PRICE_BOOK } from './prices';
import { resourceRegion } from './resolve';
import { hasRule, UNPRICED_OPTIONS } from './services';
import type { CostKind } from './types';

const book = PRICE_BOOK;

function node(type: string, overrides: Record<string, Expression> = {}, name = 'x'): ResourceNode {
  const def = getDef(type)!;
  return { id: `${type}.${name}`, provider: def.provider, type, name, args: { ...def.defaults, ...overrides }, trivia: { leadingComments: [] } };
}

function kindOf(resources: ResourceNode[], id = resources[0].id): { kind: CostKind; note?: string } {
  const ir: IR = { ...emptyIR(), resources };
  return estimateResource(ir.resources.find((r) => r.id === id)!, ir, book);
}

/** resources the catalog drops with a fixed monthly price */
const PRICED_AT_DEFAULTS = [
  'aws_instance',
  'aws_db_instance',
  'aws_elasticache_cluster',
  'aws_lb',
  'aws_nat_gateway',
  'aws_eip',
  'aws_eks_cluster',
  'aws_eks_node_group',
  'aws_route53_zone',
  'aws_kms_key',
  'aws_secretsmanager_secret',
  'azurerm_linux_virtual_machine',
  'azurerm_service_plan',
  'azurerm_mssql_database',
  'azurerm_postgresql_flexible_server',
  'azurerm_public_ip',
  'azurerm_redis_cache',
  'azurerm_container_registry',
  'azurerm_servicebus_namespace',
  'azurerm_kubernetes_cluster',
  'google_compute_instance',
  'google_sql_database_instance',
  'google_container_cluster',
  'google_container_node_pool',
  'google_redis_instance',
  'google_compute_global_forwarding_rule',
  'google_dns_managed_zone',
];

/** fields priced together: every combination of their options */
const COMBINED: Record<string, [string, string]> = {
  aws_db_instance: ['instance_class', 'engine'],
  aws_elasticache_cluster: ['node_type', 'engine'],
  azurerm_service_plan: ['sku_name', 'os_type'],
};

describe('price tables', () => {
  it('are well formed', () => {
    for (const [provider, table] of Object.entries(book)) {
      const { meta, regions } = table;
      expect(meta.retrieved, provider).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(meta.currency).toBe('USD');
      expect(meta.sources.length, provider).toBeGreaterThan(0);
      for (const s of meta.sources) expect(s, provider).toMatch(/^https:\/\//);
      expect(regions[meta.region], `${provider} default region`).toBe(1);
      for (const [region, m] of Object.entries(regions)) {
        expect(m, `${provider} ${region}`).toBeGreaterThan(0.5);
        expect(m, `${provider} ${region}`).toBeLessThan(3);
      }
      // every rate is a finite, non-negative number — zero only for a free tier (App Service F1)
      const walk = (value: unknown, path: string): void => {
        if (typeof value === 'number') {
          expect(Number.isFinite(value) && value >= 0, path).toBe(true);
          if (value === 0) expect(path, 'a zero rate').toMatch(/appService\.\w+\.F1$/);
        } else if (value && typeof value === 'object') {
          for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
        }
      };
      for (const [key, value] of Object.entries(table)) if (key !== 'meta') walk(value, `${provider}.${key}`);
    }
  });

  it('have a rule for every catalog resource', () => {
    const missing = allDefs().filter((d) => !hasRule(d.type)).map((d) => d.type);
    expect(missing).toEqual([]);
  });

  it('price every catalog resource that has a fixed price as it is dropped', () => {
    for (const type of PRICED_AT_DEFAULTS) {
      const result = kindOf([node(type)]);
      expect(result.kind, `${type}: ${result.note ?? ''}`).toBe('fixed');
    }
  });

  it('price every option the catalog offers for a priced field, or list it as unpriced', () => {
    for (const def of allDefs()) {
      if (def.type === 'azurerm_redis_cache') continue; // sku × family × capacity: below
      const baseline = kindOf([node(def.type)]).kind;
      for (const field of def.fields) {
        for (const option of field.options ?? []) {
          const key = `${def.type}.${field.name}=${option}`;
          const result = kindOf([node(def.type, { [field.name]: lit(option) })]);
          const listed = UNPRICED_OPTIONS[key];
          if (listed) expect(result.kind, key).toBe(listed.kind);
          else if (baseline !== 'unknown') expect(result.kind, `${key}: ${result.note ?? ''}`).not.toBe('unknown');
        }
      }
    }
  });

  it('price every combination of fields priced together', () => {
    for (const [type, [a, b]] of Object.entries(COMBINED)) {
      const fields = getDef(type)!.fields;
      for (const x of fields.find((f) => f.name === a)!.options!) {
        for (const y of fields.find((f) => f.name === b)!.options!) {
          for (const multi of type === 'aws_db_instance' ? [false, true] : [false]) {
            const result = kindOf([node(type, { [a]: lit(x), [b]: lit(y), ...(multi ? { multi_az: lit(true) } : {}) })]);
            const listed = UNPRICED_OPTIONS[`${type}.${a}=${x}`] ?? UNPRICED_OPTIONS[`${type}.${b}=${y}`];
            expect(result.kind, `${type} ${x} ${y}${multi ? ' multi-AZ' : ''}: ${result.note ?? ''}`).toBe(listed?.kind ?? 'fixed');
          }
        }
      }
    }
  });

  it('price every Azure Cache for Redis size', () => {
    const sizes = [
      ...['Basic', 'Standard'].flatMap((sku) => [0, 1, 2, 3, 4, 5, 6].map((n) => [sku, 'C', n] as const)),
      ...[1, 2, 3, 4, 5].map((n) => ['Premium', 'P', n] as const),
    ];
    for (const [sku, family, capacity] of sizes) {
      const result = kindOf([node('azurerm_redis_cache', { sku_name: lit(sku), family: lit(family), capacity: lit(capacity) })]);
      expect(result.kind, `${sku} ${family}${capacity}`).toBe('fixed');
    }
  });

  it('price every Fargate size the task definition offers', () => {
    const fields = getDef('aws_ecs_task_definition')!.fields;
    for (const cpu of fields.find((f) => f.name === 'cpu')!.options!) {
      for (const memory of fields.find((f) => f.name === 'memory')!.options!) {
        const task = node('aws_ecs_task_definition', { cpu: lit(cpu), memory: lit(memory) }, 'app');
        const service = node('aws_ecs_service', { task_definition: { kind: 'ref', path: 'aws_ecs_task_definition.app.arn' } }, 'svc');
        expect(kindOf([task, service], service.id).kind, `${cpu}/${memory}`).toBe('fixed');
      }
    }
  });

  it('produce the kind each deliberately unpriced option is listed with', () => {
    for (const [key, { kind }] of Object.entries(UNPRICED_OPTIONS)) {
      const [, type, field, value] = /^(\w+)\.(\w+)=(.+)$/.exec(key)!;
      expect(getDef(type)?.fields.find((f) => f.name === field)?.options, key).toContain(value);
      expect(kindOf([node(type, { [field]: lit(value) })]).kind, key).toBe(kind);
    }
  });
});

describe('templates', () => {
  it('can all be estimated, every resource type known', () => {
    for (const t of TEMPLATES) {
      const { ir } = parseProject(t.build('demo'));
      const cost = estimateProject(ir, book);
      expect(cost.items.filter((i) => i.note === "This resource type isn't in the price table yet").map((i) => i.type), t.slug).toEqual([]);
      expect(Number.isFinite(cost.total), t.slug).toBe(true);
    }
  });

  it('read the same AWS and Azure regions as the PDF overview', () => {
    for (const t of TEMPLATES) {
      const { ir } = parseProject(t.build('demo'));
      for (const p of providerSummary(ir).filter((s) => s.provider === 'aws' || s.provider === 'azure')) {
        const ours = new Set(ir.resources.filter((r) => r.provider === p.provider).map((r) => resourceRegion(r, ir)));
        expect([...ours].filter(Boolean).sort(), `${t.slug} ${p.provider}`).toEqual([...p.regions].sort());
      }
    }
  });

  it('price the seed project (production-web): the EC2 instance, its public IP and the database', () => {
    const { ir } = parseProject(TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('production-web'));
    const cost = estimateProject(ir, book);
    const { aws } = book;
    expect(cost.counts).toEqual({ fixed: 2, usage: 0, unknown: 0, free: 9 });
    const web = cost.items.find((i) => i.id === 'aws_instance.web')!;
    expect(web.breakdown.map((l) => l.label)).toEqual(['t3.micro', '8 GB gp3', 'Public IPv4']);
    const db = cost.items.find((i) => i.id === 'aws_db_instance.main')!;
    expect(db.breakdown.map((l) => l.label)).toEqual(['db.t3.micro', '20 GB gp2']);
    const expected =
      730 * aws.ec2['t3.micro'] + 8 * aws.ebs.gp3 + 730 * aws.publicIpv4Hour + 730 * aws.rds.instance['db.t3.micro'].postgres.single + 20 * aws.rds.storage.gp2.single;
    expect(cost.total).toBeCloseTo(expected, 6);
  });
});
