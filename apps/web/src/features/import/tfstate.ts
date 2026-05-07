import { applyOps, edge, emptyIR, lit, newResource, type IR, type Op } from '@blueprint/ir';

/**
 * Subset of the Terraform state file format we consume.
 *
 * Terraform `state` files are JSON written by `terraform apply`. We only need
 * the resource manifest (type / name / attributes / dependencies) to
 * reconstruct an editable IR — the rest (lineage, serial, lock metadata,
 * outputs, schema versions) is ignored on purpose so this importer never
 * has to track Terraform CLI version drift.
 *
 * Spec reference: https://developer.hashicorp.com/terraform/language/state
 */
export interface TerraformStateFile {
  version?: number;
  terraform_version?: string;
  resources?: Array<{
    mode?: 'managed' | 'data';
    type?: string;
    name?: string;
    provider?: string;
    instances?: Array<{
      attributes?: Record<string, unknown>;
      dependencies?: string[];
    }>;
  }>;
}

const SAFE_ATTRS = new Set([
  'cidr_block',
  'instance_type',
  'ami',
  'region',
  'name',
  'bucket',
  'vpc_id',
  'subnet_id',
  'availability_zone',
  'engine',
  'engine_version',
  'storage_type',
  'allocated_storage',
  'machine_type',
  'zone',
  'project',
  'location',
  'sku',
]);

/** Liberal type-guard: returns `true` when the JSON looks like Terraform state. */
export function looksLikeTerraformState(parsed: unknown): parsed is TerraformStateFile {
  if (!parsed || typeof parsed !== 'object') return false;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.resources)) return false;
  if (typeof obj.version !== 'number' && typeof obj.terraform_version !== 'string') {
    return false;
  }
  return true;
}

/**
 * Convert a parsed Terraform state file to an IR.
 *
 * Decisions:
 * - **`managed` resources only.** `data "x" "y" {}` blocks are
 *   reconstruction noise (re-evaluated at plan time anyway) — including
 *   them would clutter the imported canvas without giving the user
 *   anything to edit.
 * - **Whitelisted attributes.** State files dump every computed attribute
 *   (ARNs, generated IDs, full network ACLs). We keep only the subset a
 *   user would have written by hand (`SAFE_ATTRS`). Anything else falls
 *   into the editor's "raw" pane after a fork.
 * - **Dependencies → edges.** `instances[].dependencies` already encodes
 *   the resource graph — we map each `module.x` / `aws_instance.web` ref
 *   to an `IREdge` of kind `reference` so the canvas reflects the real
 *   topology immediately.
 *
 * Returns an `emptyIR()` when the file has no managed resources so callers
 * can still navigate to the editor and start fresh.
 */
export function tfstateToIR(state: TerraformStateFile): IR {
  if (!Array.isArray(state.resources)) return emptyIR();

  const ops: Op[] = [];
  const idByAddress = new Map<string, string>();

  for (const r of state.resources) {
    if (r.mode && r.mode !== 'managed') continue;
    if (!r.type || !r.name) continue;
    const attrs = r.instances?.[0]?.attributes ?? {};
    const args: Record<string, ReturnType<typeof lit>> = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (!SAFE_ATTRS.has(key)) continue;
      if (value === null || value === undefined) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        args[key] = lit(value);
      }
    }
    const node = newResource(r.type, r.name, args);
    ops.push({ kind: 'add_resource', node });
    idByAddress.set(`${r.type}.${r.name}`, node.id);
  }

  let ir = applyOps(emptyIR(), ops);

  const edgeOps: Op[] = [];
  for (const r of state.resources ?? []) {
    if (!r.type || !r.name) continue;
    const fromId = idByAddress.get(`${r.type}.${r.name}`);
    if (!fromId) continue;
    const deps = r.instances?.[0]?.dependencies ?? [];
    for (const dep of deps) {
      const toId = idByAddress.get(dep);
      if (!toId || toId === fromId) continue;
      const fromNode = ir.resources.find((n) => n.id === toId);
      const toNode = ir.resources.find((n) => n.id === fromId);
      if (!fromNode || !toNode) continue;
      edgeOps.push({ kind: 'add_edge', edge: edge(fromNode, toNode, 'reference') });
    }
  }
  if (edgeOps.length > 0) {
    ir = applyOps(ir, edgeOps);
  }

  return ir;
}
