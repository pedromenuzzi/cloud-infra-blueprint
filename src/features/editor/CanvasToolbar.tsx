import { Panel, useReactFlow, useStore } from '@xyflow/react';
import {
  ImageDown,
  Loader2,
  Map as MapIcon,
  Maximize,
  Minus,
  Plus,
  WandSparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

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

/** Floating canvas controls — replaces React Flow's stock (unthemed) Controls. */
export function CanvasToolbar({
  minimap,
  tidying,
  onToggleMinimap,
  onTidy,
  onExport,
}: {
  minimap: boolean;
  tidying: boolean;
  onToggleMinimap(): void;
  onTidy(): void;
  onExport(e: React.MouseEvent<HTMLButtonElement>): void;
}) {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <Panel position="bottom-left">
      <div
        className="flex items-center gap-0.5 rounded-[11px] border bg-surface-1/90 p-1 shadow-md backdrop-blur-md"
        role="toolbar"
        aria-label="Canvas controls"
      >
        <ToolButton label="Zoom out" onClick={() => void rf.zoomOut({ duration: 200 })}>
          <Minus className="h-3.5 w-3.5" />
        </ToolButton>
        <button
          type="button"
          data-tip="Reset to 100%"
          aria-label="Reset zoom"
          onClick={() => void rf.zoomTo(1, { duration: 250 })}
          className="bp-tip h-7 w-11 rounded-[7px] text-center text-[11.5px] font-medium tabular-nums text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolButton label="Zoom in" onClick={() => void rf.zoomIn({ duration: 200 })}>
          <Plus className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton
          label="Fit view  ⇧1"
          onClick={() => void rf.fitView({ padding: 0.15, maxZoom: 1, duration: 350 })}
        >
          <Maximize className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Tidy up layout" onClick={onTidy}>
          {tidying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <WandSparkles className="h-3.5 w-3.5" />
          )}
        </ToolButton>
        <Divider />
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
