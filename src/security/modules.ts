/**
 * The security audit of what's inside local modules: each call to a module
 * of the project is audited as that call makes it (its literal inputs put
 * in, src/ir/moduleInstance.ts), nested calls included, and its findings
 * are reported as `module.network › aws_security_group.web`. An input the
 * call gives as an expression stays `var.x` — the finding then says the
 * value comes from that input.
 *
 * Registry and git modules stay out (their contents aren't in the project).
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { collectRefs } from '@/ir/expr';
import { inModuleLabel, moduleInstances, type ModuleInstance } from '@/ir/moduleInstance';
import type { IR } from '@/ir/types';
import { auditSecurity, gradeOf, scoreOf, SEVERITY_ORDER, type AuditResult, type Finding, type Severity } from './audit';
import { moduleAuditMessages } from './modules.messages';
import { analyzeSecurity } from './topology';

export interface ModuleFinding {
  /** unique across the project: the call path and the finding's id */
  key: string;
  /** the module call it was found in */
  module: Pick<ModuleInstance, 'id' | 'label' | 'path' | 'steps' | 'dir'>;
  /** in the module's own terms (`resource` is an address inside it) */
  finding: Finding;
  /** `module.network › aws_security_group.web` */
  label: string;
  /** the finding's resource reads these inputs, which the call gives as expressions: what to say about them */
  inputs: Array<{ name: string; value: string; note: string }>;
}

/** The variables a block of the module reads (`var.x`, in raw expressions too). */
function varsRead(ir: IR, id: string): Set<string> {
  const block = ir.resources.find((r) => r.id === id);
  const refs: Array<{ field: string; path: string }> = [];
  for (const [field, e] of Object.entries(block?.args ?? {})) collectRefs(e, field, refs);
  return new Set(refs.flatMap((r) => (/^var\.([A-Za-z_][\w-]*)/.exec(r.path)?.[1] ?? []) as string[]));
}

/** One call's audit, as the call makes the module. */
export function auditInstance(m: ModuleInstance, locale: Locale = currentLocale()): AuditResult {
  return auditSecurity(m.ir, analyzeSecurity(m.ir, locale));
}

/**
 * The findings inside every local module call under `ir` (the root module,
 * or an opened one as its calls make it; `steps`: the calls leading to it),
 * outermost call first, worst first within each.
 */
export function auditModules(
  ir: IR,
  files: Record<string, string>,
  locale: Locale = currentLocale(),
  steps: Array<{ dir: string; name: string }> = [],
): { findings: ModuleFinding[]; audited: boolean } {
  const t = messagesFor(moduleAuditMessages, locale);
  const findings: ModuleFinding[] = [];
  let audited = false;
  const visit = (list: ModuleInstance[]) => {
    for (const m of list) {
      const audit = auditInstance(m, locale);
      if (audit.score !== null) audited = true;
      const order = (s: Severity) => SEVERITY_ORDER.indexOf(s);
      for (const finding of [...audit.findings].sort((a, b) => order(a.severity) - order(b.severity))) {
        const read = varsRead(m.child.ir, finding.resource);
        const inputs = [...m.fromInputs]
          .filter(([name]) => read.has(name))
          .map(([name, value]) => ({ name, value, note: t.fromInput(name, value) }));
        findings.push({
          key: `${m.path.join('/')}|${finding.id}`,
          module: { id: m.id, label: m.label, path: m.path, steps: m.steps, dir: m.dir },
          finding,
          label: inModuleLabel(m.path, finding.resource),
          inputs,
        });
      }
      visit(m.nested);
    }
  };
  visit(moduleInstances(ir, files, steps));
  return { findings, audited };
}

export interface ProjectAudit {
  /** the audit of the module on the canvas, its own blocks */
  own: AuditResult;
  /** findings inside the local modules it calls */
  modules: ModuleFinding[];
  /** counts, score and grade of both together */
  counts: Record<Severity, number>;
  score: number | null;
  grade: AuditResult['grade'];
}

/** `own` (an audit of `ir`) and the findings inside its local module calls, scored together. */
export function projectAudit(
  own: AuditResult,
  ir: IR,
  files: Record<string, string>,
  steps: Array<{ dir: string; name: string }> = [],
): ProjectAudit {
  if (ir.modules.length === 0) return { own, modules: [], counts: own.counts, score: own.score, grade: own.grade };
  const { findings: modules, audited } = auditModules(ir, files, own.locale, steps);
  if (modules.length === 0 && !audited) return { own, modules, counts: own.counts, score: own.score, grade: own.grade };
  const all = [...own.findings, ...modules.map((m) => m.finding)];
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of all) counts[f.severity]++;
  const score = own.score === null && !audited ? null : scoreOf(all);
  return { own, modules, counts, score, grade: score === null ? null : gradeOf(score) };
}
