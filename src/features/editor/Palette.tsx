import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui';
import type { Provider } from '@/ir/types';
import { cn } from '@/lib/utils';
import { PROVIDER_COLORS, PROVIDER_LABELS, ProviderDot, ResourceIcon } from '@/resources/icons';
import { defsByProvider } from '@/resources/registry';
import { CATEGORY_LABELS, type ResourceDef } from '@/resources/types';
import { buildNewNode, PALETTE_MIME } from './CanvasPane';
import { useEditor } from './store';

const PROVIDERS: Provider[] = ['aws', 'azure', 'gcp'];

function PaletteItem({ def }: { def: ResourceDef }) {
  const applyCanvasOps = useEditor((s) => s.applyCanvasOps);

  const addAtFreeSpot = () => {
    const state = useEditor.getState();
    const tops = state.ir.resources.filter((r) => !r.parentId && r.position);
    const maxY = tops.length
      ? Math.max(...tops.map((r) => (r.position?.y ?? 0) + (r.position?.h ?? 90)))
      : 40;
    const size = def.container ? { w: 320, h: 180 } : {};
    const { node, ops } = buildNewNode(state.ir, def, { x: 60, y: maxY + 50, ...size });
    applyCanvasOps(ops, node.id);
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_MIME, def.type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={addAtFreeSpot}
      title={`${def.displayName} — drag to the canvas or click to add\n${def.description ?? ''}`}
      className="flex w-full cursor-grab items-center gap-2.5 rounded-sm border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-surface-2 active:cursor-grabbing"
    >
      <ResourceIcon category={def.category} provider={def.provider} size={26} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium leading-tight">
          {def.displayName}
        </span>
        <span className="block truncate font-mono text-[10px] leading-tight text-faint">
          {def.type}
        </span>
      </span>
    </button>
  );
}

export function Palette() {
  const [provider, setProvider] = useState<Provider>('aws');
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return defsByProvider(provider)
      .map((g) => ({
        ...g,
        defs: q
          ? g.defs.filter((d) => `${d.displayName} ${d.type}`.toLowerCase().includes(q))
          : g.defs,
      }))
      .filter((g) => g.defs.length > 0);
  }, [provider, query]);

  return (
    <aside
      className="flex w-60 shrink-0 flex-col border-r bg-surface-1"
      aria-label="Resource palette"
    >
      <div className="border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <Input
            className="h-8 pl-8"
            placeholder="Search resources…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="mt-2.5 flex gap-1" role="tablist" aria-label="Cloud provider">
          {PROVIDERS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={provider === p}
              type="button"
              onClick={() => setProvider(p)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-sm border px-2 py-1.5 text-[12px] font-semibold transition-colors',
                provider === p
                  ? 'border-border-strong bg-surface-2 text-foreground'
                  : 'border-transparent text-muted hover:text-foreground',
              )}
              style={provider === p ? { borderBottomColor: PROVIDER_COLORS[p] } : undefined}
            >
              <ProviderDot provider={p} size={8} />
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {groups.map((g) => (
          <div key={g.category} className="mb-3">
            <h3 className="px-2 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
              {CATEGORY_LABELS[g.category]}
            </h3>
            <div className="space-y-0.5">
              {g.defs.map((d) => (
                <PaletteItem key={d.type} def={d} />
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-faint">No resources match.</p>
        ) : null}
      </div>

      <p className="border-t px-3 py-2 text-[10.5px] leading-relaxed text-faint">
        Drag onto the canvas, or click to add. Drop inside a VPC / subnet / group to nest.
      </p>
    </aside>
  );
}
