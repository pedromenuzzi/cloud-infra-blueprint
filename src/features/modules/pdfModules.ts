/**
 * The PDF document's "Modules" section: every module call with its source
 * (a link to the Registry page for Registry modules), version and the
 * inputs it's given — secrets masked like everywhere else in the document.
 */
import type { Column, Cursor, Row } from '@/features/export/archDoc';
import { isSecretName, redactSecrets } from '@/features/export/archDoc';
import type { Locale } from '@/i18n/locale';
import { defineMessages, messagesFor } from '@/i18n/messages';
import { exprPreview } from '@/ir/expr';
import { moduleInputs, moduleMetaArgs, moduleSourceInfo, moduleVersion, registryUrl, versionLabel } from '@/ir/modules';
import type { IR } from '@/ir/types';
import { modulesMessages } from './modules.messages';

const INK = '#0f172a';
const MUTED = '#475569';
const FAINT = '#94a3b8';
const MASK = '••••••';

export const pdfModuleMessages = defineMessages(
  {
    title: 'Modules',
    hint: 'Module calls, where each comes from and what it is given. Their contents are not part of the inventory, the security review or the cost estimate.',
    writing: 'Listing the modules…',
    colModule: 'Module',
    colSource: 'Source',
    colVersion: 'Version',
    colInputs: 'Inputs',
    noSource: 'no source',
    noInputs: 'none',
    more: (n: number) => `+${n} more`,
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
