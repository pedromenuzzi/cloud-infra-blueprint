import { Panel, useReactFlow, useStore } from '@xyflow/react';
import {
  ImageDown,
  Loader2,
  Map as MapIcon,
  Maximize,
  Minus,
  Plus,
  ScanEye,
  WandSparkles,
} from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useSecurityUi } from '@/features/security/securityStore';
import { useMessages } from '@/i18n/messages';
import { motionMs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { arrangeMessages } from './arrange.messages';

function ToolButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick(e: React.MouseEvent<HTMLButtonElement>): void;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      data-tip={label}
      onClick={onClick}
      className={cn(
        'bp-tip flex h-7 w-7 items-center justify-center rounded-[7px] text-muted transition-colors hover:bg-surface-2 hover:text-foreground',
        pressed && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary',
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-4 w-px bg-border" />;

/** The one labeled control: Auto-arrange is what people look for when the diagram is a mess. */
function ArrangeButton({
  onClick,
  busy,
  compact,
  overlapping,
}: {
  onClick(): void;
  busy: boolean;
  compact: boolean;
  overlapping: boolean;
}) {
  const m = useMessages(arrangeMessages);
  const noteId = useId();
  const Icon = busy ? Loader2 : WandSparkles;
  return (
    <>
      <button
        type="button"
        aria-label={m.button}
        aria-describedby={overlapping ? noteId : undefined}
        aria-busy={busy || undefined}
        data-tip={overlapping ? m.overlap : m.tooltip}
        onClick={onClick}
        className={cn(
          'bp-tip relative flex h-7 items-center justify-center gap-1.5 rounded-[7px] font-semibold text-primary transition-colors hover:bg-primary-soft',
          compact ? 'w-7' : 'px-2 text-[12px]',
        )}
      >
        <Icon className={cn('h-3.5 w-3.5 shrink-0', busy && 'animate-spin')} />
        {compact ? null : <span>{m.button}</span>}
        {overlapping ? (
          <span aria-hidden className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-warning ring-2 ring-surface-1" />
        ) : null}
      </button>
      {overlapping ? (
        <span id={noteId} className="sr-only">
          {m.overlap}
        </span>
      ) : null}
    </>
  );
}

/** Floating canvas controls — replaces React Flow's stock (unthemed) Controls. */
export function CanvasToolbar({
  minimap,
  tidying,
  onToggleMinimap,
  onTidy,
  onExport,
  compact = false,
  overlapping = false,
}: {
  minimap: boolean;
  tidying: boolean;
  onToggleMinimap(): void;
  /** omitted in a read-only view */
  onTidy?(): void;
  onExport(e: React.MouseEvent<HTMLButtonElement>): void;
  /** a narrow canvas: Auto-arrange shows as an icon only */
  compact?: boolean;
  /** some resources overlap — Auto-arrange gets a dot */
  overlapping?: boolean;
}) {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const lens = useSecurityUi((s) => s.lens);
  const toggleLens = useSecurityUi((s) => s.toggleLens);
  return (
    <Panel position="bottom-left">
      <div
        className="flex items-center gap-0.5 rounded-[11px] border bg-surface-1/90 p-1 shadow-md backdrop-blur-md"
        role="toolbar"
        aria-label="Canvas controls"
      >
        {onTidy ? (
          <>
            <ArrangeButton onClick={onTidy} busy={tidying} compact={compact} overlapping={overlapping} />
            <Divider />
          </>
        ) : null}
        <ToolButton label="Zoom out" onClick={() => void rf.zoomOut({ duration: motionMs(200) })}>
          <Minus className="h-3.5 w-3.5" />
        </ToolButton>
        <button
          type="button"
          data-tip="Reset to 100%"
          aria-label="Reset zoom"
          onClick={() => void rf.zoomTo(1, { duration: motionMs(250) })}
          className="bp-tip h-7 w-11 rounded-[7px] text-center text-[11.5px] font-medium tabular-nums text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolButton label="Zoom in" onClick={() => void rf.zoomIn({ duration: motionMs(200) })}>
          <Plus className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton
          label="Fit view  ⇧1"
          onClick={() => void rf.fitView({ padding: 0.15, maxZoom: 1, duration: motionMs(350) })}
        >
          <Maximize className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton label={lens ? 'Hide security lens' : 'Security lens'} pressed={lens} onClick={toggleLens}>
          <ScanEye className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label={minimap ? 'Hide minimap' : 'Show minimap'} pressed={minimap} onClick={onToggleMinimap}>
          <MapIcon className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Export image" onClick={onExport}>
          <ImageDown className="h-3.5 w-3.5" />
        </ToolButton>
      </div>
    </Panel>
  );
}
