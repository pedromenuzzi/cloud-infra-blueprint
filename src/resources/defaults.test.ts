import { describe, expect, it } from 'vitest';
import { buildNewNode } from '@/features/editor/newNode';
import { parseProject } from '@/hcl/parser';
import { lit } from '@/ir/expr';
import type { Expression } from '@/ir/types';
import { emptyIR } from '@/ir/types';
import { validateProject } from '@/ir/validate';
import { buildCatalogIR, CATALOG_PROVIDERS, catalogProject } from './catalogProject';
import { fieldBoundsDiagnostics, withinBounds } from './fieldRules';
import { allDefs, getDef } from './registry';

/**
 * Nested blocks (and their required arguments) the providers need before
 * `terraform validate` passes — from `terraform providers schema -json`
 * (min_items ≥ 1) plus the one-of groups validate enforces. `a|b` = one of.
 */
const REQUIRED_BLOCKS: Record<string, Record<string, string[]>> = {
  aws_lb_listener: { default_action: ['type'] },
  aws_cloudfront_distribution: {
    origin: ['domain_name', 'origin_id'],
    default_cache_behavior: ['allowed_methods', 'cached_methods', 'target_origin_id', 'viewer_protocol_policy'],
    restrictions: ['geo_restriction'],
    viewer_certificate: [],
  },
  aws_eks_cluster: { vpc_config: [] },
  aws_eks_node_group: { scaling_config: ['desired_size', 'max_size', 'min_size'] },
  azurerm_network_interface: { ip_configuration: ['name', 'private_ip_address_allocation'] },
  azurerm_linux_virtual_machine: {
    os_disk: ['caching', 'storage_account_type'],
    'source_image_reference|source_image_id|os_managed_disk_id': [],
  },
  azurerm_cdn_endpoint: { origin: ['name', 'host_name'] },
  azurerm_kubernetes_cluster: {
    default_node_pool: ['name', 'vm_size'],
    node_provisioning_profile: [],
    'identity|service_principal': [],
  },
  azurerm_linux_web_app: { site_config: [] },
  azurerm_linux_function_app: { site_config: [] },
  google_compute_instance: { boot_disk: ['initialize_params'], network_interface: [] },
  google_sql_database_instance: { 'settings|clone': ['tier'] },
  google_cloud_run_v2_service: { template: ['containers'] },
  google_compute_firewall: { 'allow|deny': ['protocol'] },
  google_secret_manager_secret: { replication: [] },
};

/** required top-level arguments validate enforces that the schema doesn't mark required */
const REQUIRED_ARGS: Record<string, string[]> = {
  aws_ecs_task_definition: ['family', 'container_definitions'],
  aws_route53_record: ['records|alias'],
  google_compute_firewall: ['source_ranges|source_tags'],
  azurerm_key_vault: ['tenant_id', 'rbac_authorization_enabled'],
};

const isBlock = (e: Expression | undefined) => e?.kind === 'block' || e?.kind === 'blocks';
const bodyOf = (e: Expression) => (e.kind === 'block' ? e.body : e.kind === 'blocks' ? e.items[0] : {});

describe('palette defaults', () => {
  for (const [type, blocks] of Object.entries(REQUIRED_BLOCKS)) {
    it(`${type} ships its required nested blocks`, () => {
      const def = getDef(type);
      expect(def, `${type} is in the catalog`).toBeDefined();
      const { node } = buildNewNode(emptyIR(), def!, { x: 0, y: 0 });
      for (const [names, attrs] of Object.entries(blocks)) {
        const present = names.split('|').find((n) => isBlock(node.args[n]));
        expect(present, `${type} has a ${names} block`).toBeDefined();
        const body = bodyOf(node.args[present!]);
        for (const attr of attrs) expect(body[attr], `${type}.${present}.${attr}`).toBeDefined();
      }
    });
  }

  for (const [type, args] of Object.entries(REQUIRED_ARGS)) {
    it(`${type} ships the arguments validate needs`, () => {
      const { node } = buildNewNode(emptyIR(), getDef(type)!, { x: 0, y: 0 });
      for (const names of args) {
        expect(names.split('|').some((n) => node.args[n]), `${type}.${names}`).toBe(true);
      }
    });
  }

  it('drops the EKS placeholder that could never validate', () => {
    const { node } = buildNewNode(emptyIR(), getDef('aws_eks_cluster')!, { x: 0, y: 0 });
    expect(node.args.vpc_config).toEqual({ kind: 'block', body: {} });
    expect(getDef('aws_eks_cluster')!.blockConnections?.[0]).toMatchObject({ block: 'vpc_config', arg: 'subnet_ids' });
  });

  it('keeps the default GCP firewall rule off the internet', () => {
    const { node } = buildNewNode(emptyIR(), getDef('google_compute_firewall')!, { x: 0, y: 0 });
    const ranges = node.args.source_ranges;
    expect(ranges?.kind).toBe('list');
    expect(ranges).not.toEqual(expect.objectContaining({ items: expect.arrayContaining([lit('0.0.0.0/0')]) }));
    expect(ranges).toEqual({ kind: 'list', items: [lit('10.128.0.0/9')] });
  });

  it('offers no retired CDN SKUs', () => {
    const sku = getDef('azurerm_cdn_profile')!.fields.find((f) => f.name === 'sku')!;
    expect(sku.options).toEqual(['Standard_Microsoft']);
  });

  it('keeps every number default inside its field bounds', () => {
    for (const def of allDefs()) {
      for (const field of def.fields) {
        if (field.min !== undefined && field.max !== undefined) expect(field.min).toBeLessThanOrEqual(field.max);
        const value = def.defaults?.[field.name];
        if (field.type !== 'number' || value?.kind !== 'literal' || typeof value.value !== 'number') continue;
        expect(withinBounds(field, value.value), `${def.type}.${field.name} = ${value.value}`).toBe(true);
      }
    }
  });
});

describe('field bounds', () => {
  it('flags literal numbers outside min / max', () => {
    const def = getDef('aws_db_instance')!;
    const { node } = buildNewNode(emptyIR(), def, { x: 0, y: 0 });
    expect(fieldBoundsDiagnostics(node, def)).toEqual([]);
    node.args.allocated_storage = lit(-5);
    expect(fieldBoundsDiagnostics(node, def)).toEqual([
      'aws_db_instance.instance: "allocated_storage" is -5 but must be between 20 and 65536',
    ]);
    node.args.allocated_storage = { kind: 'ref', path: 'var.storage' };
    expect(fieldBoundsDiagnostics(node, def)).toEqual([]);
  });

  it('bounds the ports, sizes and counts that can never be negative', () => {
    const bounded = (type: string, name: string) => getDef(type)!.fields.find((f) => f.name === name)!;
    expect(bounded('aws_lb_target_group', 'port')).toMatchObject({ min: 1, max: 65535 });
    expect(bounded('aws_lambda_function', 'timeout')).toMatchObject({ min: 1, max: 900 });
    expect(bounded('azurerm_key_vault', 'soft_delete_retention_days')).toMatchObject({ min: 7, max: 90 });
    expect(bounded('google_redis_instance', 'memory_size_gb')).toMatchObject({ min: 1 });
  });
});

describe('catalog projects (what CI runs terraform validate on)', () => {
  for (const provider of CATALOG_PROVIDERS) {
    it(`${provider}: every palette resource, wired up, with no validation warnings`, () => {
      const ir = buildCatalogIR(provider);
      const types = allDefs()
        .filter((d) => d.provider === provider)
        .map((d) => d.type)
        .sort();
      expect(ir.resources.map((r) => r.type).sort()).toEqual(types);
      expect(validateProject(ir, getDef)).toEqual([]);

      const { ir: back, diagnostics } = parseProject(catalogProject(provider));
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(back.resources).toHaveLength(types.length);
    });
  }

  it('wires nested-block connections (NIC → subnet)', () => {
    const nic = buildCatalogIR('azure').resources.find((r) => r.type === 'azurerm_network_interface')!;
    expect(nic.args.ip_configuration).toMatchObject({
      body: { subnet_id: { kind: 'ref', path: 'azurerm_subnet.subnet.id' } },
    });
  });
});
