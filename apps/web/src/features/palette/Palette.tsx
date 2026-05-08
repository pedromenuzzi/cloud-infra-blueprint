import { resourcesByProvider } from '@blueprint/resources';
import { Input, ProviderIcon, cn } from '@blueprint/ui';
import {
  Boxes,
  Cloud,
  Cpu,
  Database,
  HardDrive,
  Network,
  Search,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import type { Provider, ResourceDefinition } from '@blueprint/ir';

/** Only the cloud providers that have palette entries. */
type PaletteTab = Extract<Provider, 'aws' | 'azure' | 'gcp'>;

const TABS: { id: PaletteTab; label: string }[] = [
  { id: 'aws', label: 'AWS' },
  { id: 'azure', label: 'Azure' },
  { id: 'gcp', label: 'GCP' },
];

const CATEGORY_ICON: Record<string, LucideIcon> = {
  Compute: Cpu,
  Storage: HardDrive,
  Network: Network,
  Database: Database,
  Identity: Shield,
  Container: Boxes,
  Serverless: Cloud,
};

/**
 * Resource palette — image 01 reference. Tabs to switch provider, search to
 * filter, then resources grouped by category with provider-tinted glyphs.
 *
 * Items are draggable (`application/blueprint-resource` MIME) so the canvas
 * can `add_resource` on drop.
 */
export function Palette() {
  const [tab, setTab] = useState<PaletteTab>('aws');
  const [search, setSearch] = useState('');

  const items = useMemo<ResourceDefinition[]>(() => resourcesByProvider[tab] ?? [], [tab]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = items.filter(
      (r) =>
        !q ||
        r.displayName.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.tags?.some((t) => t.includes(q)),
    );
    const map = new Map<string, ResourceDefinition[]>();
    matched.forEach((r) => {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    });
    return Array.from(map.entries());
  }, [items, search]);

  return (
    <aside className="flex h-full w-full min-w-0 flex-col bg-card" aria-label="Resource palette">
      {/* Search */}
      <div className="border-b border-border/60 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resources..."
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex border-b border-border/60 px-2"
        role="tablist"
        aria-label="Filter resources by provider"
      >
        {TABS.map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-semibold transition-colors',
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <ProviderIcon provider={t.id} size={12} />
              {t.label}
              {isActive && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {grouped.map(([category, defs]) => (
          <CategoryGroup key={category} category={category} defs={defs} provider={tab} />
        ))}
        {grouped.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">No resources match.</p>
        )}
      </div>
    </aside>
  );
}

function CategoryGroup({
  category,
  defs,
  provider,
}: {
  category: string;
  defs: ResourceDefinition[];
  provider: PaletteTab;
}) {
  const Icon = CATEGORY_ICON[category] ?? Boxes;
  return (
    <details open className="group mb-1 select-none">
      <summary className="focus-ring flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent">
        <Icon className="h-3.5 w-3.5" />
        <span className="flex-1">{category}</span>
        <span className="text-[10px] font-normal opacity-60">{defs.length}</span>
      </summary>
      <div className="mt-1 space-y-1">
        {defs.map((r) => (
          <PaletteItem key={r.type} resource={r} provider={provider} />
        ))}
      </div>
    </details>
  );
}

function PaletteItem({
  resource,
  provider,
}: {
  resource: ResourceDefinition;
  provider: PaletteTab;
}) {
  const onDragStart = (ev: React.DragEvent) => {
    ev.dataTransfer.setData('application/blueprint-resource', resource.type);
    ev.dataTransfer.effectAllowed = 'copy';
  };
  const tone =
    provider === 'aws'
      ? 'bg-provider-aws/15'
      : provider === 'azure'
        ? 'bg-provider-azure/15'
        : 'bg-provider-gcp/15';
  return (
    <div
      draggable
      onDragStart={onDragStart}
      title={resource.description ?? resource.displayName}
      className="focus-ring flex cursor-grab items-center gap-2 rounded-md border border-transparent bg-background px-2 py-1.5 text-xs transition-colors hover:border-primary/30 hover:bg-accent active:cursor-grabbing"
    >
      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded', tone)}>
        <ProviderIcon provider={provider} size={12} />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{resource.displayName}</span>
    </div>
  );
}
