/**
 * A data source argument as one line of code, for the inspector and the
 * PDF: values as written (`["099720109477"]`, strings quoted), a nested
 * block as its arguments (`{ name = "name", values = [...] }`), deeper
 * blocks as `{ … }`.
 */
import { exprText } from '@/ir/repeat';
import type { Expression } from '@/ir/types';

export function argText(e: Expression): string {
  const bodies = e.kind === 'block' ? [e.body] : e.kind === 'blocks' ? e.items : null;
  if (!bodies) return exprText(e).replace(/\s+/g, ' ');
  return bodies.map((body) => `{ ${Object.entries(body).map(([k, v]) => `${k} = ${exprText(v).replace(/\s+/g, ' ')}`).join(', ')} }`).join(' ');
}
