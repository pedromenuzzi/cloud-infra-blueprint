/**
 * The controls every editor section carries: a grip that moves the resource
 * palette or the code pane to the other side (drag it, or click / ←→), a
 * hide button in the section's header, the slim strip a hidden section
 * leaves behind (click it to bring the section back), the drop zones shown
 * while a panel is dragged, the canvas's own corner controls and the tab a
 * minimized inspector waits in.
 */
import {
  Code2,
  EyeOff,
  GripVertical,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { shortcut } from '@/lib/keys';
import { useMessages } from '@/i18n/messages';
import { cn } from '@/lib/utils';
import { layoutMessages } from './layout.messages';
import { useLayout, type MovableId, type PanelId, type Side } from './layoutStore';

/** the element panels are dragged across (palette, canvas and code) */
export const WORKSPACE_ID = 'bp-workspace';

const SHORTCUT: Partial<Record<PanelId, string>> = { palette: shortcut('mod', 'B'), code: shortcut('mod', 'J'), inspector: shortcut('mod', 'I') };

const withShortcut = (label: string, panel: PanelId) => (SHORTCUT[panel] ? `${label} (${SHORTCUT[panel]})` : label);

const otherSide = (side: Side): Side => (side === 'left' ? 'right' : 'left');

/**
 * Keep the keyboard where the user is: a hidden section's control leaves the
 * page, so focus moves to what replaced it (its strip, or the section's own
 * hide button once it's back). The lazy code pane may take a moment.
 */
export function focusSoon(selector: string) {
  const start = performance.now();
  const tick = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) el.focus({ preventScroll: true });
    else if (performance.now() - start < 1500) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** where focus goes once a section is back */
const SHOWN_FOCUS: Record<PanelId, string> = {
  palette: '[data-hide="palette"]',
  code: '[data-hide="code"]',
  canvas: '#bp-canvas',
  inspector: '[aria-label="Inspector"] [data-minimize]',
};

function useSide(panel: MovableId): Side {
  return useLayout((s) => (panel === 'palette' ? s.paletteSide : s.codeSide));
}

/**
 * Panels floating over the canvas turn see-through and let the pointer pass
 * while something is dragged there (the canvas host sets `data-dragging`).
 */
export const FLOAT_CHROME =
  'group-data-[dragging=true]/canvas:pointer-events-none group-data-[dragging=true]/canvas:opacity-25';

/** Small icon button for a section header. */
export const HeaderButton = forwardRef<
  HTMLButtonElement,
  { label: string; onClick(): void; children: ReactNode; className?: string } & Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'onClick' | 'children' | 'className'
  >
>(function HeaderButton({ label, onClick, children, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-faint transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ grip */

/**
 * Drag handle for a movable panel. Dragging shows the drop zones and drops
 * the panel on the side under the pointer; a click (or Enter) moves it to
 * the other side and ←/→ pick a side — the Layout menu does the same.
 */
export function PanelGrip({ panel }: { panel: MovableId }) {
  const m = useMessages(layoutMessages);
  const side = useSide(panel);
  const ref = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const moveTo = (to: Side) => {
    useLayout.getState().setSide(panel, to);
    // the panel moved in the page: keep the keyboard on its grip
    requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
  };

  const sideAt = (x: number): Side => {
    const area = document.getElementById(WORKSPACE_ID)?.getBoundingClientRect();
    const mid = area ? area.left + area.width / 2 : window.innerWidth / 2;
    return x < mid ? 'left' : 'right';
  };

  const endDrag = () => {
    drag.current = null;
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
    if (useLayout.getState().panelDrag) useLayout.getState().setPanelDrag(null);
  };

  // Esc cancels a drag in progress (before anything else hears it)
  const dragging = useLayout((s) => s.panelDrag?.panel === panel);
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      suppressClick.current = true;
      endDrag();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dragging]);

  useEffect(() => () => endDrag(), []);

  return (
    <HeaderButton
      ref={ref}
      label={m.moveTo(panel, otherSide(side))}
      aria-keyshortcuts="ArrowLeft ArrowRight"
      data-grip={panel}
      className="cursor-grab touch-none active:cursor-grabbing"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
        if (!d.moved) {
          d.moved = true;
          document.body.style.cursor = 'grabbing';
          document.body.style.userSelect = 'none';
        }
        const over = sideAt(e.clientX);
        const current = useLayout.getState().panelDrag;
        if (current?.over !== over) useLayout.getState().setPanelDrag({ panel, over });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        const wasDrag = d.moved && useLayout.getState().panelDrag !== null;
        endDrag();
        if (!d.moved) return; // a click: onClick handles it
        suppressClick.current = true;
        if (wasDrag) {
          const over = sideAt(e.clientX);
          if (over !== side) moveTo(over);
        }
      }}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => {
        if (drag.current) endDrag();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        moveTo(e.key === 'ArrowLeft' ? 'left' : 'right');
      }}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        moveTo(otherSide(side));
      }}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </HeaderButton>
  );
}

/** While a panel is dragged: the two halves it can land in, the one under the pointer lit. */
export function PanelDropZones() {
  const m = useMessages(layoutMessages);
  const drag = useLayout((s) => s.panelDrag);
  const current = useLayout((s) => (s.panelDrag?.panel === 'code' ? s.codeSide : s.paletteSide));
  if (!drag) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex gap-3 bg-background/35 p-3 backdrop-blur-[1px]" data-testid="panel-drop-zones">
      {(['left', 'right'] as const).map((side) => {
        const over = drag.over === side;
        return (
          <div
            key={side}
            data-drop={side}
            data-over={over || undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 rounded-[14px] border-2 border-dashed text-[13px] font-semibold transition-colors',
              over ? 'border-primary bg-primary-soft/80 text-primary' : 'border-border-strong bg-surface-1/50 text-muted',
            )}
          >
            {side === 'left' ? <PanelLeftOpen className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
            <span>{m.dropHere(drag.panel, side)}</span>
            {current === side ? <span className="text-[11px] font-medium text-faint">{m.current}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------- hide / strips */

/** The hide button in a section's header (on compact screens: closes its drawer). */
export function HidePanelButton({ panel }: { panel: 'palette' | 'code' }) {
  const m = useMessages(layoutMessages);
  const side = useSide(panel);
  const Icon = side === 'left' ? PanelLeftClose : PanelRightClose;
  return (
    <HeaderButton
      label={withShortcut(m.hide[panel], panel)}
      onClick={() => {
        useLayout.getState().toggle(panel);
        // on wide screens a strip takes its place; a closed drawer returns focus to the page
        if (!useLayout.getState().compact) focusSoon(`[data-strip="${panel}"]`);
      }}
      data-hide={panel}
    >
      <Icon className="h-3.5 w-3.5" />
    </HeaderButton>
  );
}

const STRIP_ICON: Record<PanelId, (side: Side) => LucideIcon> = {
  palette: (side) => (side === 'left' ? PanelLeftOpen : PanelRightOpen),
  code: () => Code2,
  canvas: () => Workflow,
  inspector: () => PanelRightOpen,
};

/**
 * What a hidden section leaves: a slim full-height strip in its place, with
 * its icon and name, that brings it back. `edge`: the side facing the rest
 * of the layout (where its border goes).
 */
export function CollapsedStrip({ panel, edge, side = 'left' }: { panel: PanelId; edge: Side; side?: Side }) {
  const m = useMessages(layoutMessages);
  const Icon = STRIP_ICON[panel](side);
  return (
    <button
      type="button"
      aria-label={m.show[panel]}
      title={withShortcut(m.show[panel], panel)}
      data-strip={panel}
      onClick={() => {
        useLayout.getState().setVisible(panel, true);
        focusSoon(SHOWN_FOCUS[panel]);
      }}
      className={cn(
        'flex w-7 shrink-0 flex-col items-center gap-2 bg-surface-1 py-3 text-faint transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        edge === 'left' ? 'border-l' : 'border-r',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-[11px] font-semibold tracking-wide [writing-mode:vertical-rl]">{m.section[panel]}</span>
    </button>
  );
}

/* ---------------------------------------------------------------- canvas */

/**
 * Top-left of the canvas: focus on it (hide resources and code; again to
 * bring them back) or hide it (the code takes the room). Hidden on canvases
 * too narrow to spare the corner.
 */
export function CanvasLayoutControls() {
  const m = useMessages(layoutMessages);
  const focused = useLayout((s) => !s.panels.palette && !s.panels.code);
  const ref = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(true);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const observer = new ResizeObserver(() => setRoomy(host.clientWidth >= 560));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      role="group"
      aria-label={m.canvasControls}
      className={cn(
        'absolute left-3 top-3 z-10 flex items-center gap-0.5 rounded-[9px] border bg-surface-1/85 p-0.5 shadow-xs backdrop-blur-md transition-opacity',
        FLOAT_CHROME,
        !roomy && 'hidden',
      )}
    >
      <HeaderButton label={focused ? m.exitFocus : m.focusCanvas} aria-pressed={focused} onClick={() => useLayout.getState().toggleCanvasFocus()}>
        {focused ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </HeaderButton>
      <HeaderButton
        label={m.hide.canvas}
        onClick={() => {
          useLayout.getState().setVisible('canvas', false);
          focusSoon('[data-strip="canvas"]');
        }}
        data-hide="canvas"
      >
        <EyeOff className="h-3.5 w-3.5" />
      </HeaderButton>
    </div>
  );
}

/** Controls for the code pane's header: grip, expand over the canvas (and back), hide. */
export function CodePaneControls() {
  const m = useMessages(layoutMessages);
  const canvas = useLayout((s) => s.panels.canvas);
  const compact = useLayout((s) => s.compact);
  return (
    <>
      <PanelGrip panel="code" />
      <HeaderButton
        label={canvas ? m.expandCode : m.showCanvasAgain}
        aria-pressed={!canvas}
        onClick={() => useLayout.getState().setVisible('canvas', !canvas)}
        className={cn(compact && canvas && 'hidden')}
      >
        {canvas ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
      </HeaderButton>
      <HidePanelButton panel="code" />
    </>
  );
}

/* ------------------------------------------------------------- inspector */

/** A minimized floating inspector: a tab on the canvas's right edge that opens it again. */
export function InspectorTab() {
  const m = useMessages(layoutMessages);
  return (
    <button
      type="button"
      aria-label={m.show.inspector}
      title={withShortcut(m.show.inspector, 'inspector')}
      data-strip="inspector"
      onClick={() => {
        useLayout.getState().setVisible('inspector', true);
        focusSoon(SHOWN_FOCUS.inspector);
      }}
      className={cn(
        'bp-drawer-right absolute right-0 top-3 z-20 flex flex-col items-center gap-2 rounded-l-[10px] border border-r-0 bg-surface-1/95 px-1.5 py-3 text-muted shadow-md backdrop-blur-md transition-[opacity,background-color,color] hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        FLOAT_CHROME,
      )}
    >
      <SlidersHorizontal className="h-4 w-4 shrink-0" />
      <span className="text-[11px] font-semibold tracking-wide [writing-mode:vertical-rl]">{m.section.inspector}</span>
    </button>
  );
}
