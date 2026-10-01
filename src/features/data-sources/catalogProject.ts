/**
 * Every data source preset of a provider, added the way the palette adds it
 * to a project: `scripts/emit-catalog.ts` writes them as `data.tf` next to
 * the palette resources so CI's `terraform validate` and `fmt -check` judge
 * the presets too.
 */
import { emitData } from '@/hcl/emitter';
import { applyOps } from '@/ir/ops';
import type { IR, Provider } from '@/ir/types';
import { presetsFor } from './catalog';
import { buildDataNode } from './newData';

export function dataCatalogFile(provider: Provider, ir: IR): string {
  let next = ir;
  for (const preset of presetsFor(provider)) next = applyOps(next, buildDataNode(next, preset).ops).ir;
  return next.data.map((d) => emitData({ ...d, position: undefined })).join('\n');
}
