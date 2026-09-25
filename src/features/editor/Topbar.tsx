import {
  Check,
  ChevronDown,
  Code2,
  Download,
  FileArchive,
  FileImage,
  ImageDown,
  Loader2,
  PanelLeft,
  PanelRight,
  Redo2,
  Search,
  Share2,
  Undo2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { showToast } from '@/components/Toast';
import { Button, Kbd, LogoMark } from '@/components/ui';
import { MOD, usePalette } from '@/features/command/paletteStore';
import { copyText, exportZip } from '@/lib/download';
import { shareUrl } from '@/lib/share';
import { cn } from '@/lib/utils';
import { canvasApi } from './canvasApi';
import { useLayout, type PanelId } from './layoutStore';
import { useEditor } from './store';

function IconToggle({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-sm transition-colors',
        pressed ? 'text-foreground hover:bg-surface-2' : 'text-faint hover:bg-surface-2 hover:text-muted',
      )}
    >
      {children}
    </button>
  );
}

export function Topbar() {
  const projectName = useEditor((s) => s.projectName);
  const renameProject = useEditor((s) => s.renameProject);
  const saveState = useEditor((s) => s.saveState);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const toggle = useLayout((s) => s.toggle);
  // re-render on any layout change; isOpen() answers per mode (side panel vs drawer)
  useLayout((s) => `${s.compact}:${s.drawer}:${s.panels.palette}${s.panels.code}${s.panels.inspector}`);
  const isOpen = useLayout.getState().isOpen;
  const openPalette = usePalette((s) => s.setOpen);
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null);

  const doExportZip = () => {
    const { projectName: name, files } = useEditor.getState();
    exportZip(name, files);
    showToast('Terraform zip downloaded', 'success');
  };

  const doShare = () => {
    const { projectName: name, files } = useEditor.getState();
    void copyText(shareUrl({ name, files })).then(
      () => showToast('Share link copied — anyone can open this project', 'success'),
      () => showToast('Could not copy the link', 'error'),
    );
  };

  const panelToggles: Array<{ id: PanelId; label: string; icon: ReactNode }> = [
    { id: 'palette', label: `Resource palette (${MOD}B)`, icon: <PanelLeft className="h-4 w-4" /> },
    { id: 'code', label: `Code editor (${MOD}J)`, icon: <Code2 className="h-4 w-4" /> },
    { id: 'inspector', label: `Inspector (${MOD}I)`, icon: <PanelRight className="h-4 w-4" /> },
  ];

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-2 border-b bg-surface-1 px-3">
      <Link to="/dashboard" aria-label="Back to dashboard" className="rounded-sm p-1 hover:bg-surface-2">
        <LogoMark size={22} />
      </Link>
      <nav className="flex min-w-0 items-center gap-1.5 text-[13px]" aria-label="Breadcrumb">
        <Link to="/dashboard" className="hidden shrink-0 text-muted hover:text-foreground sm:inline">
          Projects
        </Link>
        <span className="hidden text-faint sm:inline">/</span>
        <input
          key={projectName}
          defaultValue={projectName}
          aria-label="Project name"
          className="w-28 min-w-0 truncate rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 font-semibold text-foreground hover:border-border focus:border-primary focus:outline-none sm:w-44"
          onBlur={(e) => {
            if (e.target.value.trim() && e.target.value !== projectName) {
              renameProject(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </nav>

      <span
        className={cn(
          'hidden items-center gap-1 text-[11.5px] font-medium transition-colors sm:flex',
          saveState === 'saved' ? 'text-faint' : 'text-muted',
        )}
        role="status"
      >
        {saveState === 'saved' ? (
          <>
            <Check className="h-3.5 w-3.5 text-success" /> Saved
          </>
        ) : (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving
          </>
        )}
      </span>

      <div className="flex flex-1 justify-center px-2">
        <button
          type="button"
          onClick={() => openPalette(true)}
          className="hidden h-8 w-full max-w-[340px] items-center gap-2 whitespace-nowrap rounded-md border bg-surface-2/70 px-2.5 text-[12.5px] text-faint transition-colors hover:border-border-strong hover:text-muted xl:flex"
          aria-label="Search or run a command"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 truncate text-left">Search or run a command…</span>
          <Kbd>{MOD} K</Kbd>
        </button>
      </div>
      <span className="contents xl:hidden">
        <IconToggle label={`Search or run a command (${MOD}K)`} pressed onClick={() => openPalette(true)}>
          <Search className="h-4 w-4" />
        </IconToggle>
      </span>

      <div className="flex items-center" role="group" aria-label="Panels">
        {panelToggles.map((p) => (
          <IconToggle key={p.id} label={p.label} pressed={isOpen(p.id)} onClick={() => toggle(p.id)}>
            {p.icon}
          </IconToggle>
        ))}
      </div>

      <span className="hidden sm:contents">
        <span className="mx-1 h-5 w-px bg-border" />
        <Button variant="ghost" size="icon" aria-label="Undo" title={`Undo (${MOD}Z)`} disabled={!canUndo} onClick={undo}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Redo" title={`Redo (${MOD}⇧Z)`} disabled={!canRedo} onClick={redo}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
      </span>

      <Button variant="outline" size="sm" onClick={doShare} aria-label="Share">
        <Share2 className="h-3.5 w-3.5" /> <span className="hidden md:inline">Share</span>
      </Button>
      <Button
        size="sm"
        aria-haspopup="menu"
        aria-label="Export"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setExportMenu({ x: r.right - 220, y: r.bottom + 6 });
        }}
      >
        <Download className="h-3.5 w-3.5" /> <span className="hidden md:inline">Export</span>
        <ChevronDown className="-mr-0.5 h-3.5 w-3.5 opacity-80" />
      </Button>
      <span className="hidden sm:contents">
        <ThemeToggle />
      </span>

      {exportMenu ? (
        <ContextMenu
          x={exportMenu.x}
          y={exportMenu.y}
          label="Export"
          onClose={() => setExportMenu(null)}
          entries={[
            { id: 'zip', label: 'Terraform files (.zip)', icon: FileArchive, onSelect: doExportZip },
            'separator',
            { id: 'png', label: 'Diagram as PNG', icon: ImageDown, onSelect: () => void canvasApi()?.exportImage('png') },
            { id: 'svg', label: 'Diagram as SVG', icon: FileImage, onSelect: () => void canvasApi()?.exportImage('svg') },
          ]}
        />
      ) : null}
    </header>
  );
}
