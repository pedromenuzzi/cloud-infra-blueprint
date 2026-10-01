/**
 * Validation of module calls, next to validate.ts's for resources:
 *
 * - a call without `source`;
 * - for modules in this project, the inputs they require but aren't passed
 *   (a variable with no `default`) and the arguments that aren't inputs;
 * - references to modules that don't exist (`module.nope.x`) and, for modules
 *   in this project, to outputs they don't declare.
 *
 * Modules from the Registry or git are opaque: their inputs and outputs are
 * unknown here, so nothing about them is checked beyond `source`.
 */
import { messagesFor } from '@/i18n/messages';
import { collectRefs } from './expr';
import { moduleTarget, type LocalModule } from './localModules';
import { moduleAddress, moduleInputs, moduleRef } from './modules';
import { moduleCheckMessages } from './modules.messages';
import type { Diagnostic, Expression, IR, Trivia } from './types';

/** Where a warning points: the argument's key, else the block's header line (as validate.ts does). */
function markerAt(trivia: Trivia, field?: string): Pick<Diagnostic, 'start' | 'end'> {
  const spans = trivia.spans;
  if (!spans) return {};
  const entry = field === undefined ? undefined : spans.body.entries.find((e) => e.key === field);
  if (entry) {
    return {
      start: { line: entry.line, col: entry.col },
      end: { line: entry.line, col: entry.col + (entry.keyEnd - entry.keyStart) },
    };
  }
  const lastLabel = spans.labels[spans.labels.length - 1];
  const width = lastLabel ? lastLabel.end - spans.header : 'module'.length;
  return { start: { line: spans.line, col: spans.col }, end: { line: spans.line, col: spans.col + width } };
}

export function moduleDiagnostics(ir: IR, files: Record<string, string>): Diagnostic[] {
  const out: Diagnostic[] = [];
  const m = messagesFor(moduleCheckMessages);
  const local = new Map<string, LocalModule | null>();

  for (const mod of ir.modules) {
    const file = mod.trivia.sourceFile ?? 'main.tf';
    const target = moduleTarget(files, mod);
    if (target.kind === 'none') {
      out.push({ file, severity: 'warning', message: m.missingSource(mod.id), nodeId: mod.id, ...markerAt(mod.trivia, 'source') });
      continue;
    }
    if (target.kind !== 'local') continue;
    local.set(mod.id, target.module);
    const child = target.module;
    // a module with parse errors, or one whose variables come from elsewhere: nothing to hold the call to
    if (!child || child.broken) continue;
    const passed = new Set(moduleInputs(mod).map(([k]) => k));
    for (const v of child.variables) {
      if (v.required && !passed.has(v.name)) {
        out.push({ file, severity: 'warning', message: m.missingInput(mod.id, v.name, child.dir), nodeId: mod.id, ...markerAt(mod.trivia) });
      }
    }
    const declared = new Set(child.variables.map((v) => v.name));
    for (const key of passed) {
      if (!declared.has(key)) {
        out.push({ file, severity: 'warning', message: m.unknownInput(mod.id, key, child.dir), nodeId: mod.id, ...markerAt(mod.trivia, key) });
      }
    }
  }

  // references to modules (canvas nodes carry the warning; outputs are listed in the overview)
  const names = new Set(ir.modules.map((x) => x.name));
  const check = (id: string, args: Record<string, Expression>, trivia: Trivia, nodeId: string | undefined) => {
    const refs: Array<{ field: string; path: string }> = [];
    for (const [field, expr] of Object.entries(args)) collectRefs(expr, field, refs);
    const seen = new Set<string>();
    for (const r of refs) {
      const ref = moduleRef(r.path);
      if (!ref) continue;
      const address = moduleAddress(ref.name);
      const field = r.field.split('.')[0];
      const key = `${field}\u0000${address}\u0000${ref.output ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const file = trivia.sourceFile ?? 'main.tf';
      if (!names.has(ref.name)) {
        out.push({ file, severity: 'warning', message: m.unknownModule(id, r.field, address), nodeId, ...markerAt(trivia, field) });
        continue;
      }
      const child = local.get(address);
      if (!child || child.broken || ref.output === undefined) continue;
      if (!child.outputs.some((o) => o.name === ref.output)) {
        out.push({ file, severity: 'warning', message: m.unknownOutput(id, r.field, address, ref.output), nodeId, ...markerAt(trivia, field) });
      }
    }
  };
  for (const r of ir.resources) check(r.id, r.args, r.trivia, r.id);
  for (const mod of ir.modules) check(mod.id, mod.args, mod.trivia, mod.id);
  for (const o of ir.outputs) check(o.id, o.args, o.trivia, undefined);
  return out;
}
