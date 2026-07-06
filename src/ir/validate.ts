/**
 * Semantic validation layered above the parser: missing required fields,
 * dangling references, cross-cloud references.
 */
import type { ResourceDef } from '@/resources/types';
import { collectRefs, refTargetAddress } from './expr';
import type { Diagnostic, IR } from './types';

const RESOURCE_PREFIX = /^(aws_|azurerm_|azuread_|google_)/;

export function validateProject(
  ir: IR,
  getDef: (type: string) => ResourceDef | undefined,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));

  for (const node of ir.resources) {
    const file = node.trivia.sourceFile ?? 'main.tf';
    const def = getDef(node.type);

    if (def) {
      for (const field of def.fields) {
        if (!field.required) continue;
        const value = node.args[field.name];
        const empty =
          value === undefined ||
          (value.kind === 'literal' && (value.value === '' || value.value === null));
        if (empty) {
          out.push({
            file,
            severity: 'warning',
            message: `${node.id}: required argument "${field.name}" is missing`,
            nodeId: node.id,
          });
        }
      }
    }

    const refs: Array<{ field: string; path: string }> = [];
    for (const [field, expr] of Object.entries(node.args)) collectRefs(expr, field, refs);
    for (const r of refs) {
      const address = refTargetAddress(r.path);
      if (!address) continue;
      const head = address.split('.')[0];
      const looksLikeResource = RESOURCE_PREFIX.test(head) || getDef(head) !== undefined;
      if (!looksLikeResource) continue;
      const target = byId.get(address);
      if (!target) {
        out.push({
          file,
          severity: 'warning',
          message: `${node.id}: "${r.field}" references unknown resource ${address}`,
          nodeId: node.id,
        });
        continue;
      }
      if (
        target.provider !== node.provider &&
        target.provider !== 'other' &&
        node.provider !== 'other'
      ) {
        out.push({
          file,
          severity: 'warning',
          message: `${node.id}: cross-cloud reference to ${address} (${node.provider} → ${target.provider})`,
          nodeId: node.id,
        });
      }
    }
  }

  return out;
}
