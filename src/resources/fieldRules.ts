/**
 * Field-level checks for values the inspector can't guard (typed in code,
 * pasted, imported): a literal number outside its field's `min` / `max`.
 *
 * validate.ts calls it per resource with a catalog def and reports each
 * message as a warning on that node.
 */
import { messagesFor } from '@/i18n/messages';
import type { ResourceNode } from '@/ir/types';
import { resourceMessages } from './messages';
import type { FieldDef, ResourceDef } from './types';

/** Whether `value` is acceptable for a number field with bounds. */
export function withinBounds(field: Pick<FieldDef, 'min' | 'max'>, value: number): boolean {
  return (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
}

/** One message per number field whose literal value is outside its bounds. */
export function fieldBoundsDiagnostics(node: ResourceNode, def: ResourceDef): Array<{ field: string; message: string }> {
  const out: Array<{ field: string; message: string }> = [];
  const m = messagesFor(resourceMessages);
  for (const field of def.fields) {
    if (field.type !== 'number' || (field.min === undefined && field.max === undefined)) continue;
    const value = node.args[field.name];
    if (value?.kind !== 'literal' || typeof value.value !== 'number' || withinBounds(field, value.value)) continue;
    const range =
      field.min !== undefined && field.max !== undefined
        ? m.between(field.min, field.max)
        : field.min !== undefined
          ? m.atLeast(field.min)
          : m.atMost(field.max!);
    out.push({ field: field.name, message: m.outOfBounds(node.id, field.name, value.value, range) });
  }
  return out;
}
