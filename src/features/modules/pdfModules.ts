/**
 * The PDF document's "Modules" section: every module call with its source
 * (a link to the Registry page for Registry modules), version and the
 * inputs it's given — secrets masked like everywhere else in the document.
 *
 * Then "Inside local modules": for each call to a module of the project
 * (nested ones too), its resources with their key settings and monthly
 * cost, and the security findings inside it, read with the call's inputs;
 * the cost table of the document groups the same resources under each call.
 */
import { usd } from '@/cost/format';
import type { ModuleCost, ProjectCost, ResourceCost } from '@/cost/types';
import type { Column, Cursor, Row } from '@/features/export/archDoc';
import { isSecretName, keySettings, redactSecrets } from '@/features/export/archDoc';
import type { Locale } from '@/i18n/locale';
import { defineMessages, messagesFor } from '@/i18n/messages';
import { exprPreview } from '@/ir/expr';
import { flattenInstances, moduleInstances } from '@/ir/moduleInstance';
import { moduleInputs, moduleMetaArgs, moduleSourceInfo, moduleVersion, registryUrl, versionLabel } from '@/ir/modules';
import type { IR } from '@/ir/types';
import { resourceShortName } from '@/resources/i18n';
import { getDef } from '@/resources/registry';
import { auditModules } from '@/security/modules';
import type { Severity } from '@/security/audit';
import { modulesMessages } from './modules.messages';

const INK = '#0f172a';
const MUTED = '#475569';
const FAINT = '#94a3b8';
const MASK = '••••••';

export const pdfModuleMessages = defineMessages(
  {
    title: 'Modules',
    hint: 'Module calls, where each comes from and what it is given. What local modules hold follows in Inside local modules; Registry and git modules hold what their source does.',
    writing: 'Listing the modules…',
    colModule: 'Module',
    colSource: 'Source',
    colVersion: 'Version',
    colInputs: 'Inputs',
    noSource: 'no source',
    noInputs: 'none',
    more: (n: number) => `+${n} more`,
    insideTitle: 'Inside local modules',
    insideHint: 'What each call to a module of this project holds, read with the inputs the call gives.',
    writingInside: 'Looking inside the local modules…',
    callMeta: (dir: string, count: number | null) =>
      `${dir} · ${count === null ? 'instances decided at plan time' : count === 1 ? 'one instance' : `${count} instances`}`,
    colResource: 'Resource',
    colSettings: 'Key settings',
    colPerMonth: 'Per month',
    noResources: 'No resources of its own.',
    findings: 'Findings',
    noFindings: 'No findings inside.',
    subtotal: (amount: string, count: number | null) =>
      count === null || count === 1 ? `Inside it: ~${amount}/mo` : `Inside it: ~${amount}/mo per instance, × ${count}`,
    usage: 'usage-based',
    unknown: 'not estimated',
    free: 'no charge',
    moduleGroup: (label: string, count: number | null) =>
      `${label}${count === null ? ' (instances decided at plan time)' : count === 1 ? '' : ` × ${count}`}`,
    findingsInside: (n: number) => `${n} finding${n === 1 ? '' : 's'} inside local modules: see Inside local modules.`,
  },
  {
    title: 'Módulos',
    hint: 'As chamadas de módulo, de onde cada uma vem e o que recebe. O conteúdo delas não entra no inventário, na revisão de segurança nem na estimativa de custo.',
    writing: 'Listando os módulos…',
    colModule: 'Módulo',
    colSource: 'Origem',
    colVersion: 'Versão',
    colInputs: 'Entradas',
    noSource: 'sem source',
    noInputs: 'nenhuma',
    more: (n) => `+${n}`,
    insideTitle: 'Dentro de módulos locais',
    insideHint: 'O que cada chamada a um módulo deste projeto contém, lido com as entradas que a chamada passa.',
    writingInside: 'Olhando dentro dos módulos locais…',
    callMeta: (dir, count) =>
      `${dir} · ${count === null ? 'instâncias decididas no plan' : count === 1 ? 'uma instância' : `${count} instâncias`}`,
    colResource: 'Recurso',
    colSettings: 'Configurações principais',
    colPerMonth: 'Por mês',
    noResources: 'Nenhum recurso próprio.',
    findings: 'Achados',
    noFindings: 'Nenhum achado aqui dentro.',
    subtotal: (amount, count) =>
      count === null || count === 1 ? `Dentro dele: ~${amount}/mês` : `Dentro dele: ~${amount}/mês por instância, × ${count}`,
    usage: 'por uso',
    unknown: 'sem estimativa',
    free: 'sem cobrança',
    moduleGroup: (label, count) => `${label}${count === null ? ' (instâncias decididas no plan)' : count === 1 ? '' : ` × ${count}`}`,
    findingsInside: (n) => `${n} ${n === 1 ? 'achado' : 'achados'} dentro de módulos locais: veja Dentro de módulos locais.`,
  },
);

/** Inputs listed per module, at most (the code section has them all). */
const MAX_INPUTS = 12;

export function* modulesSection(c: Cursor, ir: IR, locale: Locale): Generator<void, void> {
  const t = messagesFor(pdfModuleMessages, locale);
  const kinds = messagesFor(modulesMessages, locale).kind;
  c.section('modules', t.title, t.hint);
  const rows: Row[] = ir.modules.map((m) => {
    const info = moduleSourceInfo(m);
    const version = versionLabel(moduleVersion(m)) ?? info?.ref;
    const url = info ? registryUrl(info, moduleVersion(m)) : null;
    const inputs = [...moduleMetaArgs(m), ...moduleInputs(m)];
    const shown = inputs.slice(0, MAX_INPUTS).map(([k, v]) => ({
      text: `${k} = ${isSecretName(k) ? MASK : redactSecrets(exprPreview(v))}`,
      font: 'mono' as const,
      size: 6.8,
      color: INK,
      maxLines: 2,
    }));
    if (inputs.length > MAX_INPUTS) shown.push({ text: t.more(inputs.length - MAX_INPUTS), font: 'mono', size: 6.8, color: FAINT, maxLines: 1 });
    return {
      cells: [
        [
          { text: m.name, font: 'bold' },
          { text: m.id, font: 'mono', size: 6.6, color: FAINT },
        ],
        info
          ? [
              { text: info.short, ...(url ? { url } : {}) },
              { text: `${kinds[info.kind]} · ${info.source}`, font: 'mono', size: 6.6, color: FAINT, maxLines: 3 },
            ]
          : [{ text: t.noSource, color: FAINT }],
        [{ text: version ?? '—', font: version ? 'mono' : 'regular', size: 7.5, color: version ? MUTED : FAINT }],
        shown.length ? shown : [{ text: t.noInputs, size: 7.5, color: FAINT }],
      ],
    } satisfies Row;
  });
  const columns: Column[] = [
    { title: t.colModule, share: 0.2 },
    { title: t.colSource, share: 0.3 },
    { title: t.colVersion, share: 0.12 },
    { title: t.colInputs, share: 0.38 },
  ];
  yield* c.table(columns, rows);
}

const SEVERITY: Record<Severity, string> = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#64748b' };
const MODULE_COLOR = '#7c3aed';

/** Does the project call any module it holds (so "Inside local modules" has something to say)? */
export function hasLocalModules(ir: IR, files: Record<string, string>): boolean {
  return ir.modules.length > 0 && moduleInstances(ir, files).length > 0;
}

/** every module call of an estimate with how many times its amounts count (null: unknown) */
function costGroups(modules: ModuleCost[] | undefined, factor: number | null = 1): Array<{ mod: ModuleCost; factor: number | null }> {
  return (modules ?? []).flatMap((mod) => {
    const f = factor === null || mod.count === null ? null : factor * mod.count;
    return [{ mod, factor: f }, ...costGroups(mod.nested, f)];
  });
}

/** The cost table's rows for what local modules hold: a group per call, then its resources (as `row` writes them). */
export function moduleCostRows(cost: ProjectCost, locale: Locale, row: (item: ResourceCost) => Row): Row[] {
  const t = messagesFor(pdfModuleMessages, locale);
  const out: Row[] = [];
  for (const { mod, factor } of costGroups(cost.modules)) {
    const charged = mod.items.filter((i) => i.kind !== 'free');
    if (charged.length === 0) continue;
    const own = mod.items.reduce((sum, i) => sum + (i.kind === 'fixed' ? (i.monthly ?? 0) : 0), 0);
    out.push({
      cells: [],
      group: { label: t.moduleGroup(mod.label, factor), color: MODULE_COLOR, note: factor === null ? undefined : usd(own * factor, locale) },
    });
    for (const item of charged) out.push(row(item));
  }
  return out;
}

/** "Inside local modules": per call, its resources (settings, cost) and the findings inside it. */
export function* localModulesSection(
  c: Cursor,
  ir: IR,
  files: Record<string, string>,
  cost: ProjectCost | null,
  locale: Locale,
): Generator<void, void> {
  const t = messagesFor(pdfModuleMessages, locale);
  const instances = flattenInstances(moduleInstances(ir, files));
  if (instances.length === 0) return;
  c.section('local-modules', t.insideTitle, t.insideHint);
  const { findings } = auditModules(ir, files, locale);
  const costs = new Map(costGroupsByLabel(cost));
  const columns: Column[] = [
    { title: t.colResource, share: 0.32 },
    { title: t.colSettings, share: 0.5 },
    { title: t.colPerMonth, share: 0.18 },
  ];
  for (const m of instances) {
    c.heading(m.label, t.callMeta(m.dir, m.count));
    const items = new Map((costs.get(m.label)?.items ?? []).map((i) => [i.id, i] as const));
    const rows: Row[] = m.ir.resources.map((r) => {
      const item = items.get(r.id);
      const amount = !item
        ? []
        : item.kind === 'fixed'
          ? [{ text: usd(item.monthly ?? 0, locale), font: 'bold' as const, size: 8.5 }]
          : [{ text: item.kind === 'usage' ? t.usage : item.kind === 'free' ? t.free : t.unknown, size: 7.5, color: FAINT }];
      return {
        cells: [
          [
            { text: r.name, font: 'bold' },
            { text: getDef(r.type) ? resourceShortName(r.type, locale) : r.type, size: 7, color: FAINT },
          ],
          keySettings(r, 4, locale).map((s) => ({ text: s, font: 'mono' as const, size: 6.8, color: INK, maxLines: 2 })),
          amount,
        ],
      } satisfies Row;
    });
    if (rows.length) yield* c.table(columns, rows);
    else c.paragraph(t.noResources, { size: 8, color: MUTED });
    const mine = findings.filter((f) => f.module.label === m.label);
    if (mine.length) {
      for (const f of mine) {
        c.paragraph(`${f.finding.title}: ${f.label}`, { font: 'bold', size: 8.5, color: SEVERITY[f.finding.severity], gap: 1 });
        c.paragraph(f.finding.detail, { size: 8, color: MUTED, gap: f.inputs.length ? 1 : 5 });
        for (const i of f.inputs) c.paragraph(i.note, { size: 7.5, color: MUTED, gap: 5 });
      }
    } else {
      c.paragraph(t.noFindings, { size: 8, color: MUTED });
    }
    const group = costs.get(m.label);
    if (group && group.counts.fixed > 0) {
      const own = group.items.reduce((sum, i) => sum + (i.kind === 'fixed' ? (i.monthly ?? 0) : 0), 0);
      c.paragraph(t.subtotal(usd(own, locale), m.count), { size: 8, color: INK, gap: 12 });
    }
  }
}

/** What the security review says about the findings inside local modules; null when there are none. */
export function moduleFindingsNote(ir: IR, files: Record<string, string>, locale: Locale): string | null {
  if (ir.modules.length === 0) return null;
  const n = auditModules(ir, files, locale).findings.length;
  return n > 0 ? messagesFor(pdfModuleMessages, locale).findingsInside(n) : null;
}

function costGroupsByLabel(cost: ProjectCost | null): Array<[string, ModuleCost]> {
  return costGroups(cost?.modules).map(({ mod }) => [mod.label, mod]);
}
