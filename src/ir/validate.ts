/**
 * Semantic validation layered above the parser: missing required fields,
 * dangling references (to resources and to data sources, and attributes a
 * data source doesn't expose), cross-cloud references, and what the provider
 * schemas say about resource and data blocks. Messages are in the UI
 * language in effect when it runs — whoever keeps the result re-runs it on a
 * language switch (relocalizeEditorMessages in src/features/editor/store.ts).
 */
import { messagesFor } from '@/i18n/messages';
import { fieldBoundsDiagnostics } from '@/resources/fieldRules';
import { closestName, entryOf } from '@/schema/lookup';
import { schemaMessages } from '@/schema/messages';
import { dataSourceSchema } from '@/schema/store';
import { dataSchemaDiagnostics, pinMismatch, schemaDiagnostics } from '@/schema/validate';
import type { ResourceDef } from '@/resources/types';
import { runChecks } from './checks';
import { dataRef, type DataRef } from './dataSources';
import { collectRefs, refTargetAddress, scanTraversals } from './expr';
import { validateMessages } from './messages';
import type { DataNode, Diagnostic, Expression, IR, Trivia } from './types';

const RESOURCE_PREFIX = /^(aws_|azurerm_|azuread_|google_)/;

/**
 * Where a warning points: the offending argument's key, else the block header
 * (never the `# @blueprint:pos` line above it).
 */
function markerAt(node: { trivia: Trivia }, field?: string): Pick<Diagnostic, 'start' | 'end'> {
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

  for (const node of ir.data) {
    // provider schema (once its data sources are loaded): unknown data source, arguments…
    out.push(...dataSchemaDiagnostics(ir, node, node.trivia.sourceFile ?? 'main.tf', markerAt));
  }
  out.push(...dataReferenceDiagnostics(ir));

  out.push(...runChecks(ir, getDef, markerAt));
  return out;
}

/* ------------------------------------------------------- data references */

/** what a `terraform_remote_state` data source exposes (a remote output is read as `outputs.<name>`) */
const REMOTE_STATE_ATTRIBUTES = new Set(['backend', 'config', 'defaults', 'outputs', 'workspace']);
/** blocks that name state addresses, or hold data blocks of their own (`check`) */
const NOT_READERS = /^\s*(?:moved|removed|import|check)\b/;

/**
 * Why a `data.x.y…` reference can't work, or undefined: the data source
 * isn't in the project, or (once its schema is loaded) the attribute read
 * isn't one it exposes.
 */
function dataRefProblem(ir: IR, known: Map<string, DataNode>, owner: string, field: string, ref: DataRef): string | undefined {
  const m = messagesFor(validateMessages);
  const target = known.get(ref.address);
  if (!target) return m.unknownDataReference(owner, field, ref.address);
  const attribute = ref.attribute;
  if (attribute === undefined) return undefined;
  const hint = (name: string | undefined) => (name ? messagesFor(schemaMessages).didYouMean(name) : '');
  if (target.type === 'terraform_remote_state') {
    // `data.terraform_remote_state.net.vpc_id` was Terraform 0.11's way: it is `.outputs.vpc_id` now
    return REMOTE_STATE_ATTRIBUTES.has(attribute) ? undefined : m.unknownDataAttribute(owner, field, ref.address, attribute, hint(`outputs.${attribute}`));
  }
  const block = dataSourceSchema(target.type);
  if (!block || pinMismatch(ir, target.type) || entryOf(block, attribute)) return undefined;
  const suggestion = closestName(attribute, [...Object.keys(block.attributes), ...Object.keys(block.blocks)]);
  return m.unknownDataAttribute(owner, field, ref.address, attribute, hint(suggestion));
}

/** references to data sources that aren't in the project, or read attributes they don't expose */
function dataReferenceDiagnostics(ir: IR): Diagnostic[] {
  const out: Diagnostic[] = [];
  const known = new Map<string, DataNode>();
  for (const d of ir.data) if (!known.has(d.id)) known.set(d.id, d);
  const seen = new Set<string>();

  const blocks: Array<{ id: string; args: Record<string, Expression>; trivia: Trivia }> = [
    ...ir.resources,
    ...ir.modules,
    ...ir.data,
    ...ir.outputs,
    ...ir.providers,
  ];
  for (const node of blocks) {
    const refs: Array<{ field: string; path: string }> = [];
    for (const [field, expr] of Object.entries(node.args)) collectRefs(expr, field, refs);
    for (const r of refs) {
      const ref = dataRef(r.path);
      if (!ref || ref.address === node.id) continue;
      const field = r.field.split('.')[0];
      const key = `${node.id}\u0000${field}\u0000${ref.address}\u0000${ref.attribute ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const message = dataRefProblem(ir, known, node.id, field, ref);
      if (!message) continue;
      out.push({ file: node.trivia.sourceFile ?? 'main.tf', severity: 'warning', message, nodeId: node.id, ...markerAt(node, field) });
    }
  }

  // locals and the other verbatim blocks: the reference itself is marked
  for (const x of ir.extras) {
    const spans = x.trivia.spans;
    if (!spans || NOT_READERS.test(x.text)) continue;
    const owner = /^\s*([A-Za-z_][\w-]*)/.exec(x.text)?.[1] ?? x.id;
    for (const t of scanTraversals(x.text)) {
      const ref = dataRef(t.path);
      if (!ref) continue;
      const entry = spans.body.entries.find((e) => spans.header + t.start >= e.start && spans.header + t.start < e.end);
      const field = entry?.key ?? owner;
      const message = dataRefProblem(ir, known, owner, field, ref);
      if (!message) continue;
      const before = x.text.slice(0, t.start);
      const nl = before.lastIndexOf('\n');
      const line = spans.line + (before.match(/\n/g)?.length ?? 0);
      const col = nl === -1 ? spans.col + t.start : t.start - nl;
      out.push({
        file: x.trivia.sourceFile ?? 'main.tf',
        severity: 'warning',
        message,
        start: { line, col },
        end: { line, col: col + (t.end - t.start) },
      });
    }
  }
  return out;
}
