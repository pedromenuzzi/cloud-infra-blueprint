/**
 * Semantic validation layered above the parser: missing required fields,
 * dangling references, cross-cloud references. Messages are in the UI
 * language in effect when it runs — whoever keeps the result re-runs it on a
 * language switch (src/features/editor/localeBridge.ts).
 */
import { messagesFor } from '@/i18n/messages';
import { fieldBoundsDiagnostics } from '@/resources/fieldRules';
import { schemaDiagnostics } from '@/schema/validate';
import type { ResourceDef } from '@/resources/types';
import { runChecks } from './checks';
import { collectRefs, refTargetAddress } from './expr';
import { validateMessages } from './messages';
import type { Diagnostic, IR, ResourceNode } from './types';

const RESOURCE_PREFIX = /^(aws_|azurerm_|azuread_|google_)/;

/**
 * Where a warning points: the offending argument's key, else the block header
 * (never the `# @blueprint:pos` line above it).
 */
function markerAt(node: ResourceNode, field?: string): Pick<Diagnostic, 'start' | 'end'> {
  const spans = node.trivia.spans;
  if (!spans) return {};
  const entry = field === undefined ? undefined : spans.body.entries.find((e) => e.key === field);
  if (entry) {
    return {
      start: { line: entry.line, col: entry.col },
      end: { line: entry.line, col: entry.col + (entry.keyEnd - entry.keyStart) },
    };
  }
  const lastLabel = spans.labels[spans.labels.length - 1];
  const width = lastLabel ? lastLabel.end - spans.header : 'resource'.length;
  return { start: { line: spans.line, col: spans.col }, end: { line: spans.line, col: spans.col + width } };
}

export function validateProject(
  ir: IR,
  getDef: (type: string) => ResourceDef | undefined,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const m = messagesFor(validateMessages);

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
            message: m.requiredMissing(node.id, field.name),
            nodeId: node.id,
            ...markerAt(node, value === undefined ? undefined : field.name),
          });
        }
      }
      // numbers typed in code or imported that the inspector would have refused
      for (const { field, message } of fieldBoundsDiagnostics(node, def)) {
        out.push({ file, severity: 'warning', message, nodeId: node.id, ...markerAt(node, field) });
      }
    }

    // provider schema (once loaded): unknown / deprecated / mistyped arguments
    out.push(...schemaDiagnostics(ir, node, def, file, markerAt));

    const refs: Array<{ field: string; path: string }> = [];
    for (const [field, expr] of Object.entries(node.args)) collectRefs(expr, field, refs);
    for (const r of refs) {
      const address = refTargetAddress(r.path);
      if (!address) continue;
      const head = address.split('.')[0];
      const looksLikeResource = RESOURCE_PREFIX.test(head) || getDef(head) !== undefined;
      if (!looksLikeResource) continue;
      const target = byId.get(address);
      const marker = markerAt(node, r.field.split('.')[0]);
      if (!target) {
        out.push({
          file,
          severity: 'warning',
          message: m.unknownReference(node.id, r.field, address),
          nodeId: node.id,
          ...marker,
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
          message: m.crossCloud(node.id, address, node.provider, target.provider),
          nodeId: node.id,
          ...marker,
        });
      }
    }
  }

  out.push(...runChecks(ir, getDef, markerAt));
  return out;
}
