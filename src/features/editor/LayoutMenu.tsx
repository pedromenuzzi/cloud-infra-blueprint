/**
 * The topbar's Layout popover: presets, a switch per section, which side the
 * resource palette and the code pane sit on, and whether the inspector
 * floats or docks. Everything applies at once and is remembered per browser.
 * (Dragging a panel by its grip does the same as the side switches.)
 */
import { Code2, PanelLeft, RotateCcw, SlidersHorizontal, Workflow, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { focusIsLost, Kbd, restoreFocus, useLayer } from '@/components/ui';
import { MOD } from '@/features/command/paletteStore';
import { useMessages } from '@/i18n/messages';
import { cn } from '@/lib/utils';
import { layoutMessages } from './layout.messages';
import { activePreset, PRESET_IDS, type PresetId, type SectionId } from './layoutPrefs';
import { useLayout, type InspectorMode, type Side } from './layoutStore';

const SECTIONS: Array<{ id: SectionId; icon: LucideIcon; shortcut?: string }> = [
  { id: 'palette', icon: PanelLeft, shortcut: `${MOD} B` },
  { id: 'canvas', icon: Workflow },
  { id: 'code', icon: Code2, shortcut: `${MOD} J` },
  { id: 'inspector', icon: SlidersHorizontal, shortcut: `${MOD} I` },
];

/** a preset drawn as its columns: p(alette), v (the canVas), c(ode) */
const THUMB: Record<PresetId, Array<'p' | 'v' | 'c'>> = {
  default: ['p', 'v', 'c'],
  'code-left': ['c', 'v', 'p'],
  'canvas-focus': ['v'],
  'code-focus': ['c'],
};

function PresetThumb({ id }: { id: PresetId }) {
  const cols = THUMB[id];
  return (
    <span className="flex h-9 w-full gap-[3px] rounded-[6px] border bg-surface-1 p-[3px]" aria-hidden="true">
      {cols.map((c, i) =>
        c === 'p' ? (
          <span key={i} className="w-2.5 shrink-0 rounded-[3px] border bg-surface-2" />
        ) : c === 'v' ? (
          <span
            key={i}
            className="flex-1 rounded-[3px] bg-canvas"
            style={{ backgroundImage: 'radial-gradient(var(--canvas-grid-strong) 0.8px, transparent 0.8px)', backgroundSize: '5px 5px' }}
          />
        ) : (
          <span key={i} className={cn('flex flex-col gap-[3px] rounded-[3px] bg-surface-2 p-[3px]', cols.length === 1 ? 'flex-1' : 'w-5 shrink-0')}>
            <span className="h-[2px] w-3/4 rounded-full bg-primary/60" />
            <span className="h-[2px] w-1/2 rounded-full bg-faint/60" />
            <span className="h-[2px] w-2/3 rounded-full bg-faint/60" />
          </span>
        ),
      )}
    </span>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 px-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">{children}</h3>;
}

/** a small segmented control made of real radio buttons (arrow keys, one Tab stop) */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(value: T): void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-1">
      <span id={id} className="text-[12.5px]">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex shrink-0 rounded-md border bg-surface-2 p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'relative flex h-6 items-center rounded-[4px] px-2 text-[11.5px] font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary',
              value === o.value ? 'bg-surface-1 text-foreground shadow-xs' : 'text-muted hover:text-foreground',
            )}
          >
            <input
              type="radio"
              name={id}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              // the whole segment is the radio: it takes the click, the label draws it
              className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-[4px] outline-none"
            />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function LayoutMenu({ anchor, onClose }: { anchor: HTMLElement; onClose(): void }) {
  const m = useMessages(layoutMessages);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const layout = useLayout();
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  useLayer(true, onClose, { kind: 'popup', node: ref });

  // under the trigger, right-aligned to it, kept on screen
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const a = anchor.getBoundingClientRect();
      const width = el.offsetWidth;
      setPos({ top: a.bottom + 6, left: Math.max(8, Math.min(a.right - width, window.innerWidth - width - 8)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  // focus starts on the active preset (or the first); on close it goes back to the trigger
  useLayoutEffect(() => {
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? el?.querySelector<HTMLElement>('button'))?.focus({
      preventScroll: true,
    });
    return () => {
      if (focusIsLost(el)) restoreFocus(anchor);
    };
  }, [anchor]);

  // a click outside closes (the trigger toggles on its own)
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, [anchor, onClose]);

  const active = activePreset({
    ...layout.panels,
    paletteSide: layout.paletteSide,
    codeSide: layout.codeSide,
    inspectorMode: layout.inspectorMode,
    split: layout.split,
  });
  const sides = (['left', 'right'] as const).map((s) => ({ value: s, label: m.side[s] }));

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      data-testid="layout-menu"
      className="bp-pop-in fixed z-50 flex max-h-[calc(100vh-64px)] w-[328px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[14px] border bg-surface-1 shadow-xl"
      style={pos}
      onBlur={(e) => {
        // Tab out of the popover (to something that isn't the trigger) closes it
        const next = e.relatedTarget as Node | null;
        if (next && !ref.current?.contains(next) && !anchor.contains(next)) onClose();
      }}
    >
      <header className="flex items-center justify-between gap-2 border-b py-2.5 pl-4 pr-2.5">
        <h2 id={titleId} className="text-[13.5px] font-semibold">
          {m.layout}
        </h2>
        <button
          type="button"
          onClick={() => layout.reset()}
          className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" /> {m.reset}
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <section aria-labelledby={`${titleId}-presets`}>
          <Heading>
            <span id={`${titleId}-presets`}>{m.presets}</span>
          </Heading>
          <div className="grid grid-cols-4 gap-1.5">
            {PRESET_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={active === id}
                title={m.presetHint[id]}
                data-preset={id}
                onClick={() => layout.applyPreset(id)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-[9px] border p-1.5 text-center text-[10.5px] font-medium leading-tight transition-colors',
                  active === id
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-transparent text-muted hover:border-border hover:bg-surface-2 hover:text-foreground',
                )}
              >
                <PresetThumb id={id} />
                {m.preset[id]}
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby={`${titleId}-sections`}>
          <Heading>
            <span id={`${titleId}-sections`}>{m.sections}</span>
          </Heading>
          <div className="space-y-0.5">
            {SECTIONS.map(({ id, icon: Icon, shortcut }) => {
              const hint = id === 'inspector' && !layout.panels.canvas ? m.inspectorWithCanvas : undefined;
              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-1 py-1.5 transition-colors hover:bg-surface-2"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px]">{m.section[id]}</span>
                    {hint ? <span className="block text-[10.5px] text-faint">{hint}</span> : null}
                  </span>
                  {shortcut ? <Kbd>{shortcut}</Kbd> : null}
                  <input
                    type="checkbox"
                    role="switch"
                    className="bp-switch"
                    aria-label={m.section[id]}
                    data-section={id}
                    checked={layout.isOpen(id)}
                    onChange={() => layout.toggle(id)}
                  />
                </label>
              );
            })}
          </div>
        </section>

        <section aria-labelledby={`${titleId}-arrangement`}>
          <Heading>
            <span id={`${titleId}-arrangement`}>{m.arrangement}</span>
          </Heading>
          <Segmented<Side>
            label={m.sideOf.palette}
            value={layout.paletteSide}
            options={sides}
            onChange={(side) => layout.setSide('palette', side)}
          />
          <Segmented<Side>
            label={m.sideOf.code}
            value={layout.codeSide}
            options={sides}
            onChange={(side) => layout.setSide('code', side)}
          />
          <Segmented<InspectorMode>
            label={m.inspectorPlacement}
            value={layout.inspectorMode}
            options={[
              { value: 'floating', label: m.floating },
              { value: 'docked', label: m.docked },
            ]}
            onChange={(mode) => layout.setInspectorMode(mode)}
          />
        </section>
      </div>

      <p className="border-t px-4 py-2.5 text-[11px] leading-snug text-faint">
        {layout.compact ? m.compactNote : m.dragTip}
      </p>
    </div>,
    document.body,
  );
}
