/**
 * Under a resource argument in the inspector: the project's data sources
 * that usually fill it, one click each (`ami` → `data.aws_ami.ubuntu.id`,
 * `availability_zone` → `data.aws_availability_zones.available.names[0]`).
 * Nothing when no data source fits or the argument already reads one.
 */
import { Link2 } from 'lucide-react';
import { useEditor } from '@/features/editor/store';
import { useMessages } from '@/i18n/messages';
import { exprMentions, ref } from '@/ir/expr';
import type { ResourceNode } from '@/ir/types';
import { typeDef } from './catalog';
import { dataSourceMessages } from './dataSources.messages';

/** `data.x.y.<read>` references a data source in `ir` offers for `type.arg` */
export function dataSuggestions(ir: { data: Array<{ id: string; type: string }> }, type: string, arg: string): string[] {
  const out: string[] = [];
  for (const d of ir.data) {
    for (const feed of typeDef(d.type)?.feeds ?? []) {
      if (feed.arg === arg && feed.resourceTypes.includes(type)) out.push(`${d.id}.${feed.read}`);
    }
  }
  return out;
}

export function DataSourceHint({ node, field }: { node: ResourceNode; field: string }) {
  const m = useMessages(dataSourceMessages);
  const ir = useEditor((s) => s.ir);
  const readOnly = useEditor((s) => s.readOnly);
  const apply = useEditor((s) => s.applyCanvasOps);
  if (readOnly || ir.data.length === 0) return null;
  const current = node.args[field];
  const offers = dataSuggestions(ir, node.type, field);
  // already reading one of them
  if (offers.length === 0 || (current && ir.data.some((d) => exprMentions(current, d.id)))) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {offers.map((value) => (
        <button
          key={value}
          type="button"
          title={m.useDataTitle(value)}
          onClick={(e) => {
            // inside a <label>: don't let the click reach the field
            e.preventDefault();
            apply([{ kind: 'set_arg', nodeId: node.id, field, value: ref(value) }]);
          }}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-(--data-ring) bg-(--data-chip) px-2 py-px text-[10.5px] font-medium text-(--data-text) transition-colors hover:border-(--data-border)"
        >
          <Link2 className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{m.useData(value)}</span>
        </button>
      ))}
    </span>
  );
}
