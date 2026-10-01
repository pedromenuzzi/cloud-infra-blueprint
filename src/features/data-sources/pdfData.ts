/**
 * The PDF document's "Data sources" section: every data block with its type,
 * name, the arguments it looks things up with (secrets masked like
 * everywhere else in the document) and what reads it.
 */
import type { Column, Cursor, Row } from '@/features/export/archDoc';
import { isSecretName, redactSecrets } from '@/features/export/archDoc';
import type { Locale } from '@/i18n/locale';
import { defineMessages, messagesFor } from '@/i18n/messages';
import type { IR } from '@/ir/types';
import { argText } from './argText';
import { dataSourceMessages } from './dataSources.messages';
import { dataSourceName } from './i18n';
import { readersByAttribute } from './readers';

const INK = '#0f172a';
const MUTED = '#475569';
const FAINT = '#94a3b8';
const MASK = '••••••';

export const pdfDataMessages = defineMessages(
  {
    writing: 'Listing the data sources…',
    colArguments: 'Looked up with',
    noArguments: 'no arguments',
    more: (n: number) => `+${n} more`,
  },
  {
    writing: 'Listando as fontes de dados…',
    colArguments: 'Consultada com',
    noArguments: 'sem argumentos',
    more: (n) => `+${n}`,
  },
);

/** arguments and readers listed per data source, at most (the code section has them all) */
const MAX_LINES = 8;

export function* dataSection(c: Cursor, ir: IR, locale: Locale): Generator<void, void> {
  const t = messagesFor(pdfDataMessages, locale);
  const m = messagesFor(dataSourceMessages, locale);
  c.section('data', m.pdfTitle, m.pdfIntro(ir.data.length));
  const rows: Row[] = ir.data.map((d) => {
    const args = Object.entries(d.args).filter(([k]) => !/[\s"]/.test(k));
    const shown = args.slice(0, MAX_LINES).map(([k, v]) => ({
      text: `${k} = ${isSecretName(k) ? MASK : redactSecrets(argText(v))}`,
      font: 'mono' as const,
      size: 6.8,
      color: INK,
      maxLines: 2,
    }));
    if (args.length > MAX_LINES) shown.push({ text: t.more(args.length - MAX_LINES), font: 'mono', size: 6.8, color: FAINT, maxLines: 1 });
    const readers = readersByAttribute(ir, d.id);
    const read = readers.slice(0, MAX_LINES).map(({ attribute, readers: by }) => ({
      text: `${attribute ? `${attribute}: ` : ''}${by.map((r) => r.label).join(', ')}`,
      font: 'mono' as const,
      size: 6.8,
      color: MUTED,
      maxLines: 3,
    }));
    return {
      cells: [
        [
          { text: d.name, font: 'bold' },
          { text: d.id, font: 'mono', size: 6.6, color: FAINT, maxLines: 2 },
        ],
        [
          { text: dataSourceName(d.type, locale) },
          { text: d.type, font: 'mono', size: 6.6, color: FAINT },
        ],
        shown.length ? shown : [{ text: t.noArguments, size: 7.5, color: FAINT }],
        read.length ? read : [{ text: m.pdfNothing, size: 7.5, color: FAINT }],
      ],
    } satisfies Row;
  });
  const columns: Column[] = [
    { title: m.pdfName, share: 0.22 },
    { title: m.pdfType, share: 0.2 },
    { title: t.colArguments, share: 0.33 },
    { title: m.pdfReadBy, share: 0.25 },
  ];
  yield* c.table(columns, rows);
}
