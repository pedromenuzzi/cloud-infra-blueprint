/**
 * "Try with a sample plan": a made-up `terraform show -json` for the open
 * project, so the plan viewer can be tried without running Terraform. It
 * goes through parsePlan like a real one. On the project's own blocks: the
 * networks already exist (the first one brought in by an `import` block),
 * a server changes in place, a database is replaced (its engine version
 * forces it), the rest is new; and one server that left the code is
 * destroyed.
 */
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { isContainerType } from '@/resources/registry';
import { isStateful } from './plan';
import type { Json, JsonObject } from './json';

/** a literal argument's value; anything else (references, functions) is known only after apply */
function values(r: ResourceNode): { known: JsonObject; unknown: JsonObject } {
  const known: JsonObject = {};
  const unknown: JsonObject = { id: true, arn: true };
  const read = (e: Expression): Json | undefined => {
    if (e.kind === 'literal') return e.value;
    if (e.kind === 'list') {
      const items = e.items.map(read);
      return items.every((i) => i !== undefined) ? (items as Json[]) : undefined;
    }
    if (e.kind === 'object') {
      const out: JsonObject = {};
      for (const [k, v] of Object.entries(e.fields)) {
        const x = read(v);
        if (x === undefined) return undefined;
        out[k] = x;
      }
      return out;
    }
    return undefined;
  };
  for (const [k, e] of Object.entries(r.args)) {
    if (k === 'count' || k === 'for_each' || k === 'depends_on' || k === 'lifecycle' || k === 'provider') continue;
    const v = read(e);
    if (v !== undefined) known[k] = v;
    else if (e.kind !== 'block' && e.kind !== 'blocks') unknown[k] = true;
  }
  return { known, unknown };
}

const fakeId = (r: ResourceNode) => `${r.type.split('_').slice(1).join('-')}-0${(r.name.length * 7919).toString(16).padStart(8, '0')}`;

export function samplePlan(ir: IR): JsonObject {
  const changes: JsonObject[] = [];
  const change = (r: ResourceNode, actions: string[], before: Json, after: Json, extra: JsonObject = {}, more: JsonObject = {}) =>
    changes.push({
      address: r.id,
      mode: 'managed',
      type: r.type,
      name: r.name,
      provider_name: `registry.terraform.io/hashicorp/${r.provider === 'azure' ? 'azurerm' : r.provider === 'gcp' ? 'google' : r.provider}`,
      ...extra,
      change: {
        actions,
        before,
        after,
        after_unknown: actions.includes('create') ? values(r).unknown : {},
        before_sensitive: before === null ? false : {},
        after_sensitive: after === null ? false : {},
        ...more,
      },
    });

  let imported = false;
  let updated = false;
  let replaced = false;
  for (const r of ir.resources.filter((x) => x.args.count === undefined && x.args.for_each === undefined)) {
    const { known } = values(r);
    const existing = { ...known, id: fakeId(r) };
    if (isContainerType(r.type)) {
      change(r, ['no-op'], existing, existing, {}, imported ? {} : { importing: { id: fakeId(r) } });
      imported = true;
    } else if (!replaced && isStateful(r.type)) {
      const key = Object.keys(known).find((k) => /version|engine|class|tier|sku/.test(k)) ?? Object.keys(known)[0] ?? 'name';
      const old = typeof known[key] === 'string' ? `${known[key]}-old` : 'previous';
      change(r, ['delete', 'create'], { ...existing, [key]: old }, known, { action_reason: 'replace_because_cannot_update' }, { replace_paths: [[key]] });
      replaced = true;
    } else if (!updated && /instance|vm|virtual_machine|function|service/.test(r.type)) {
      const tags = { ...((known.tags as JsonObject | undefined) ?? {}), owner: 'platform' };
      change(r, ['update'], { ...existing, tags: (known.tags as JsonObject | undefined) ?? {} }, { ...existing, tags });
      updated = true;
    } else {
      change(r, ['create'], null, known);
    }
  }
  // one that left the code: destroyed, and on no node
  const provider = ir.resources[0]?.provider ?? 'aws';
  const [type, attrs]: [string, JsonObject] =
    provider === 'azure'
      ? ['azurerm_linux_virtual_machine', { name: 'legacy-vm', size: 'Standard_B1s' }]
      : provider === 'gcp'
        ? ['google_compute_instance', { name: 'legacy', machine_type: 'e2-small' }]
        : ['aws_instance', { instance_type: 't3.micro', tags: { Name: 'legacy' } }];
  changes.push({
    address: `${type}.legacy`,
    mode: 'managed',
    type,
    name: 'legacy',
    change: { actions: ['delete'], before: { ...attrs, id: 'legacy-0001' }, after: null, after_unknown: {}, before_sensitive: {}, after_sensitive: false },
    action_reason: 'delete_because_no_resource_config',
  });
  return { format_version: '1.2', terraform_version: '1.9.8', resource_changes: changes, output_changes: {}, applyable: true, complete: true, errored: false };
}
