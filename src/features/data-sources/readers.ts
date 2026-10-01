/**
 * Who reads a data source, worded for people: blocks by their address, a
 * verbatim block by its keyword and file (`locals (main.tf)`), since its id
 * (`raw.main.tf#0`) means nothing on screen. Shared by the inspector and
 * the PDF.
 */
import { dataReaders } from '@/ir/dataSources';
import type { IR } from '@/ir/types';

export function readerLabel(ir: IR, id: string): string {
  if (!id.startsWith('raw.')) return id;
  const block = ir.extras.find((x) => x.id === id);
  const keyword = /^\s*([A-Za-z_][\w-]*)/.exec(block?.text ?? '')?.[1] ?? 'block';
  return `${keyword} (${block?.trivia.sourceFile ?? '?'})`;
}

/** attribute ('' for the whole object) → readers, worded; attributes in name order, the whole object last */
export function readersByAttribute(ir: IR, dataId: string): Array<{ attribute: string; readers: Array<{ id: string; label: string }> }> {
  return [...dataReaders(ir, dataId)]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([attribute, ids]) => ({ attribute, readers: ids.map((id) => ({ id, label: readerLabel(ir, id) })) }));
}
