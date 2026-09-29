import { ChevronDown, Plus, Search } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { Input, Kbd } from '@/components/ui';
import { MOD } from '@/features/command/paletteStore';
import { useMessages } from '@/i18n/messages';
import type { Provider } from '@/ir/types';
import { detectProviders } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { PROVIDER_COLORS, PROVIDER_LABELS, ProviderDot, ResourceIcon } from '@/resources/icons';
import { defsByProvider } from '@/resources/registry';
import { CATEGORY_LABELS, type Category, type ResourceDef } from '@/resources/types';
import { PALETTE_MIME } from './CanvasPane';
import { canvasApi } from './canvasApi';
import { paletteDragStarted } from './canvasDrag';
import { layoutMessages } from './layout.messages';
import { useLayout } from './layoutStore';
import { HidePanelButton, PanelGrip } from './PanelChrome';
import { buildNewNode } from './newNode';
import { useEditor } from './store';

const PROVIDERS: Provider[] = ['aws', 'azure', 'gcp'];

/** roving-tabindex keys: one Tab stop for the whole list, arrows move inside */
const itemKey = (def: ResourceDef) => `res:${def.type}`;
const headerKey = (category: Category) => `cat:${category}`;

function PaletteItem({ def, active }: { def: ResourceDef; active: boolean }) {
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
    // it lands below the diagram — bring it into view (and get the drawer out of the way)
    if (useLayout.getState().compact) useLayout.getState().closeDrawer();
    setTimeout(() => canvasApi()?.focusNode(node.id), 60);
  };

  return (
    <button
      type="button"
      draggable
      tabIndex={active ? 0 : -1}
      data-rove={itemKey(def)}
      aria-label={`Add ${def.displayName} (${def.type})`}
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_MIME, def.type);
        e.dataTransfer.effectAllowed = 'copy';
        // panels floating over the canvas let the drop through
        paletteDragStarted();
      }}
      onClick={addAtFreeSpot}
      title={`${def.displayName} — drag to the canvas or click to add\n${def.description ?? ''}`}
      className="group flex w-full cursor-grab items-center gap-2.5 rounded-[8px] border border-transparent px-2 py-1.5 text-left transition-colors outline-none hover:border-border hover:bg-surface-2 focus-visible:border-primary focus-visible:bg-surface-2 active:cursor-grabbing"
    >
      <ResourceIcon category={def.category} type={def.type} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium leading-tight">
          {def.displayName}
        </span>
        <span className="block truncate font-mono text-[10px] leading-tight text-faint">
          {def.type}
        </span>
      </span>
      <Plus className="h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}

const COLLAPSED_KEY = 'cb-palette-collapsed';

function readCollapsed(): Set<Category> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as Category[]);
  } catch {
    return new Set();
  }
}

export function Palette() {
  const m = useMessages(layoutMessages);
  const side = useLayout((s) => s.paletteSide);
  // open on the project's own cloud
  const [provider, setProvider] = useState<Provider>(
    () => detectProviders(useEditor.getState().files).find((p) => PROVIDERS.includes(p)) ?? 'aws',
  );
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        PROVIDERS.map((p) => [p, defsByProvider(p).reduce((n, g) => n + g.defs.length, 0)]),
      ) as Record<Provider, number>,
    [],
  );

  const toggleCategory = (category: Category) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        /* private mode */
      }
      return next;
    });
  };

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

  // the list is one Tab stop; ↑/↓/Home/End move between categories and resources
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const isOpen = (category: Category) => query.trim() !== '' || !collapsed.has(category);
  const keys = groups.flatMap((g) => [headerKey(g.category), ...(isOpen(g.category) ? g.defs.map(itemKey) : [])]);
  const current = activeKey !== null && keys.includes(activeKey) ? activeKey : keys[0];

  const focusKey = (key: string | undefined) => {
    if (!key) return;
    setActiveKey(key);
    listRef.current?.querySelector<HTMLElement>(`[data-rove="${CSS.escape(key)}"]`)?.focus();
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-rove]')?.dataset.rove;
    if (!key) return;
    const i = keys.indexOf(key);
    let next: string | undefined;
    if (e.key === 'ArrowDown') next = keys[Math.min(i + 1, keys.length - 1)];
    else if (e.key === 'ArrowUp') next = keys[Math.max(i - 1, 0)];
    else if (e.key === 'Home') next = keys[0];
    else if (e.key === 'End') next = keys[keys.length - 1];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // ← on a resource: up to its category; ←/→ on a category: collapse / expand
      const group = groups.find((g) => key === headerKey(g.category) || g.defs.some((d) => itemKey(d) === key));
      if (!group) return;
      if (key !== headerKey(group.category)) {
        if (e.key === 'ArrowLeft') next = headerKey(group.category);
      } else if (query.trim() === '' && isOpen(group.category) === (e.key === 'ArrowLeft')) {
        toggleCategory(group.category);
      } else if (e.key === 'ArrowRight') {
        next = keys[i + 1];
      }
    } else return;
    e.preventDefault();
    focusKey(next);
  };

  const onProviderKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = PROVIDERS.indexOf(provider);
    const next =
      e.key === 'Home'
        ? PROVIDERS[0]!
        : e.key === 'End'
          ? PROVIDERS[PROVIDERS.length - 1]!
          : PROVIDERS[(i + step + PROVIDERS.length) % PROVIDERS.length]!;
    setProvider(next);
    document.getElementById(`${uid}-tab-${next}`)?.focus();
  };

  return (
    <aside
      className={cn('flex w-60 shrink-0 flex-col bg-surface-1', side === 'left' ? 'border-r' : 'border-l')}
      aria-label="Resource palette"
    >
      <h2 className="sr-only">Resource palette</h2>
      <div className="flex items-center gap-1 border-b py-1 pl-1.5 pr-2">
        <PanelGrip panel="palette" />
        <span className="flex-1 truncate text-[11px] font-bold uppercase tracking-wider text-faint" aria-hidden="true">
          {m.resourcesTitle}
        </span>
        <HidePanelButton panel="palette" />
      </div>
      <div className="border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <Input
            className="h-8 pl-8"
            placeholder="Search resources…"
            aria-label="Search resources"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusKey(keys.find((k) => k.startsWith('res:')) ?? keys[0]);
              }
            }}
          />
        </div>
        <div
          className="mt-2.5 flex gap-1"
          role="tablist"
          aria-label="Cloud provider"
          onKeyDown={onProviderKeyDown}
        >
          {PROVIDERS.map((p) => (
            <button
              key={p}
              id={`${uid}-tab-${p}`}
              role="tab"
              aria-selected={provider === p}
              aria-controls={`${uid}-panel`}
              tabIndex={provider === p ? 0 : -1}
              type="button"
              onClick={() => setProvider(p)}
              title={`${counts[p]} ${PROVIDER_LABELS[p]} resources`}
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

      <div
        id={`${uid}-panel`}
        role="tabpanel"
        aria-labelledby={`${uid}-tab-${provider}`}
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        <div
          ref={listRef}
          role="toolbar"
          aria-orientation="vertical"
          aria-label={`${PROVIDER_LABELS[provider]} resources — arrow keys to move, Enter to add`}
          onKeyDown={onListKeyDown}
          onFocus={(e) => {
            const key = (e.target as HTMLElement).dataset.rove;
            if (key) setActiveKey(key);
          }}
        >
          {groups.map((g) => {
            const open = isOpen(g.category);
            return (
              <div key={g.category} className="mb-2">
                <h3>
                  <button
                    type="button"
                    aria-expanded={open}
                    tabIndex={current === headerKey(g.category) ? 0 : -1}
                    data-rove={headerKey(g.category)}
                    onClick={() => toggleCategory(g.category)}
                    className="flex w-full items-center gap-1.5 rounded-[6px] px-2 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint outline-none transition-colors hover:text-muted focus-visible:bg-surface-2 focus-visible:text-foreground focus-visible:ring-1 focus-visible:ring-primary"
                  >
                    <ChevronDown className={cn('h-3 w-3 transition-transform', !open && '-rotate-90')} />
                    <span className="flex-1 text-left">{CATEGORY_LABELS[g.category]}</span>
                    <span className="font-medium normal-case tracking-normal">{g.defs.length}</span>
                  </button>
                </h3>
                {open ? (
                  <div className="space-y-0.5">
                    {g.defs.map((d) => (
                      <PaletteItem key={d.type} def={d} active={current === itemKey(d)} />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-faint">No resources match.</p>
        ) : null}
      </div>

      <p className="border-t px-3 py-2 text-[10.5px] leading-relaxed text-faint">
        Drag onto the canvas or click to add — drop inside a VPC / subnet / group to nest.
        Double-click the canvas or press <Kbd>{MOD} K</Kbd> to search.
      </p>
    </aside>
  );
}
