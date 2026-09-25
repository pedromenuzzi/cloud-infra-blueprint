import { describe, expect, it } from 'vitest';
import { buildNewNode } from '@/features/editor/newNode';
import { emitProject } from '@/hcl/emitter';
import { parseProject } from '@/hcl/parser';
import { exprEquals } from '@/ir/expr';
import { deriveStructure } from '@/ir/graph';
import { emptyIR } from '@/ir/types';
import { hasServiceGlyph } from './icons';
import { allDefs, docsUrl, getDef } from './registry';
import { CATEGORY_ORDER } from './types';

const PREFIX = { aws: 'aws_', azure: 'azurerm_', gcp: 'google_', other: '' } as const;

describe('resource catalog', () => {
  const defs = allDefs();

  it('has unique, provider-prefixed types in known categories', () => {
    const types = defs.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    for (const d of defs) {
      expect(d.type.startsWith(PREFIX[d.provider]), `${d.type} prefix`).toBe(true);
      expect(CATEGORY_ORDER, `${d.type} category`).toContain(d.category);
      const names = d.fields.map((f) => f.name);
      expect(new Set(names).size, `${d.type} has duplicate fields`).toBe(names.length);
    }
  });

  it('gives every resource its own icon and a docs link', () => {
    for (const d of defs) {
      expect(hasServiceGlyph(d.type), `${d.type} has a service glyph`).toBe(true);
      expect(docsUrl(d.type), `${d.type} docs url`).toMatch(/^https:\/\/registry\.terraform\.io\/providers\/hashicorp\//);
    }
    expect(docsUrl('aws_instance')).toBe(
      'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/instance',
    );
  });

  it('only points refs, containment and connections at catalog types', () => {
    for (const d of defs) {
      const targets = [
        ...d.fields.flatMap((f) => f.refTo ?? []),
        ...(d.containment ?? []).flatMap((c) => c.parentTypes),
        ...(d.connections ?? []).flatMap((c) => c.targetTypes),
      ];
      for (const t of targets) expect(getDef(t), `${d.type} → ${t}`).toBeDefined();
      for (const c of d.connections ?? []) {
        expect(
          d.fields.some((f) => f.name === c.arg),
          `${d.type} connection arg "${c.arg}" is an inspector field`,
        ).toBe(true);
      }
      for (const f of d.fields) {
        if (f.options) expect(f.type, `${d.type}.${f.name} has options`).toBe('select');
      }
    }
  });

  it('nests children inside their container resources', () => {
    const { ir } = parseProject({
      'main.tf': `
resource "aws_eks_cluster" "k8s" {
  name     = "k8s"
  role_arn = aws_iam_role.eks.arn
}
resource "aws_eks_node_group" "workers" {
  cluster_name = aws_eks_cluster.k8s.name
}
resource "aws_apigatewayv2_api" "api" {
  name          = "api"
  protocol_type = "HTTP"
}
resource "aws_apigatewayv2_integration" "fn" {
  api_id           = aws_apigatewayv2_api.api.id
  integration_type = "AWS_PROXY"
}
resource "azurerm_resource_group" "rg" {
  name     = "rg"
  location = "eastus"
}
resource "azurerm_service_plan" "plan" {
  name                = "plan"
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_linux_web_app" "web" {
  name                = "web"
  resource_group_name = azurerm_resource_group.rg.name
  service_plan_id     = azurerm_service_plan.plan.id
}
resource "azurerm_servicebus_namespace" "bus" {
  name = "bus"
}
resource "azurerm_servicebus_queue" "jobs" {
  name         = "jobs"
  namespace_id = azurerm_servicebus_namespace.bus.id
}
resource "google_compute_network" "vpc" {
  name = "vpc"
}
resource "google_compute_subnetwork" "subnet" {
  name    = "subnet"
  network = google_compute_network.vpc.id
}
resource "google_container_cluster" "gke" {
  name       = "gke"
  network    = google_compute_network.vpc.name
  subnetwork = google_compute_subnetwork.subnet.name
}
resource "google_container_node_pool" "pool" {
  name    = "pool"
  cluster = google_container_cluster.gke.id
}
`,
    });
    deriveStructure(ir, getDef);
    const parentOf = (id: string) => ir.resources.find((r) => r.id === id)?.parentId;
    expect(parentOf('aws_eks_node_group.workers')).toBe('aws_eks_cluster.k8s');
    expect(parentOf('aws_apigatewayv2_integration.fn')).toBe('aws_apigatewayv2_api.api');
    expect(parentOf('azurerm_service_plan.plan')).toBe('azurerm_resource_group.rg');
    // the plan wins over the resource group: apps render inside their plan
    expect(parentOf('azurerm_linux_web_app.web')).toBe('azurerm_service_plan.plan');
    expect(parentOf('azurerm_servicebus_queue.jobs')).toBe('azurerm_servicebus_namespace.bus');
    // the subnetwork wins over the network
    expect(parentOf('google_container_cluster.gke')).toBe('google_compute_subnetwork.subnet');
    expect(parentOf('google_container_node_pool.pool')).toBe('google_container_cluster.gke');
  });

  for (const def of defs) {
    it(`${def.type}: a palette drop emits HCL that parses back unchanged`, () => {
      const { node } = buildNewNode(emptyIR(), def, { x: 40, y: 40 });
      const isBlock = Object.values(node.args).map((e) => e.kind === 'block' || e.kind === 'blocks');
      const firstBlock = isBlock.indexOf(true);
      expect(
        firstBlock === -1 || isBlock.slice(firstBlock).every(Boolean),
        'nested blocks come after attributes',
      ).toBe(true);
      const ir = { ...emptyIR(), resources: [node] };
      const files = emitProject(ir);

      const { ir: back, diagnostics } = parseProject(files);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(back.resources).toHaveLength(1);
      const parsed = back.resources[0];
      expect(parsed.id).toBe(node.id);
      expect(Object.keys(parsed.args).sort()).toEqual(Object.keys(node.args).sort());
      for (const [k, v] of Object.entries(node.args)) {
        expect(exprEquals(v, parsed.args[k]), `${def.type}.${k} round-trips`).toBe(true);
      }
    });
  }
});
