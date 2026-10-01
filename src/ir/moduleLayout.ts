/**
 * Module calls on the canvas are plain nodes (the size of a resource, never
 * nested): laid out with the resources, positions carried over while the
 * text doesn't pin them yet.
 */
import { autoLayout } from './layout';
import { withModuleNodes } from './modules';
import type { IR } from './types';

/** autoLayout, module calls and data sources included: those without a position get one. */
export function layoutWithModules(ir: IR, isContainerType: (type: string) => boolean): void {
  if (ir.modules.length === 0 && ir.data.length === 0) {
    autoLayout(ir, isContainerType);
    return;
  }
  const laid = withModuleNodes(ir);
  autoLayout(laid, isContainerType);
  const placed = new Map(laid.resources.map((r) => [r.id, r.position] as const));
  for (const m of ir.modules) if (!m.position) m.position = placed.get(m.id);
  for (const d of ir.data) if (!d.position) d.position = placed.get(d.id);
}

/** Keep the previous canvas position of module calls and data sources the text doesn't place (typing in the code). */
export function carryModulePositions(ir: IR, prev: IR): void {
  if (ir.modules.length === 0 && ir.data.length === 0) return;
  const before = new Map([...prev.modules, ...prev.data].map((m) => [m.id, m.position] as const));
  for (const m of [...ir.modules, ...ir.data]) {
    const old = before.get(m.id);
    if (!m.position && old) m.position = { ...old };
  }
}
