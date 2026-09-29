import {
  AlertTriangle,
  Check,
  ChevronDown,
  Code2,
  Download,
  Eye,
  FileArchive,
  FileImage,
  FileText,
  FolderSync,
  ImageDown,
  Loader2,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Redo2,
  Search,
  Share2,
  ShieldCheck,
  Sun,
  Undo2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ContextMenu, type MenuEntry } from '@/components/ContextMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { showToast } from '@/components/Toast';
import { Button, Kbd, LogoMark } from '@/components/ui';
import { IS_MAC, MOD, usePalette } from '@/features/command/paletteStore';
import { FolderSyncStatus } from '@/features/data/FolderSyncStatus';
import { startFolderLink } from '@/features/data/folderSync';
import { copyText, exportZip } from '@/lib/download';
import { shareLinkInfo, viewLinkInfo } from '@/lib/share';
import { cn } from '@/lib/utils';
import { openExportPdf } from '@/features/export/ExportPdfDialog';
import { GRADE_COLORS, getAudit, useSecurityUi } from '@/features/security/securityStore';
import { useTheme } from '@/theme/useTheme';
import { canvasApi } from './canvasApi';
import { useLayout, type PanelId } from './layoutStore';
import { useEditor } from './store';

function IconToggle({
  label,
  pressed,
  emphasis,
  onClick,
  children,
}: {
  label: string;
  /** a toggle (aria-pressed); omit for a plain button */
  pressed?: boolean;
  /** plain button drawn like a pressed toggle */
  emphasis?: boolean;
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
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-sm transition-colors',
        pressed || emphasis
          ? 'text-foreground hover:bg-surface-2'
          : 'text-faint hover:bg-surface-2 hover:text-muted',
      )}
    >
      {children}
    </button>
  );
}

function SecurityBadge() {
  const ir = useEditor((s) => s.ir);
  const open = useSecurityUi((s) => s.panelOpen);
  const setPanel = useSecurityUi((s) => s.setPanel);
  const audit = getAudit(ir);
  const urgent = audit.counts.critical + audit.counts.high;
  const color = audit.grade ? GRADE_COLORS[audit.grade] : undefined;
  return (
    <button
      type="button"
      onClick={() => setPanel(!open)}
      aria-pressed={open}
      aria-label={`Security${audit.grade ? ` grade ${audit.grade}` : ''}${urgent ? `, ${urgent} urgent issues` : ''}`}
      title="Security audit"
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12px] font-semibold transition-colors hover:border-border-strong',
        open ? 'bg-primary-soft' : 'bg-surface-1',
      )}
    >
      <ShieldCheck className="h-4 w-4" style={{ color }} />
      <span className="hidden text-muted lg:inline">Security</span>
      <span style={{ color }}>{audit.grade ?? '—'}</span>
      {urgent > 0 ? (
        <span className="rounded-full bg-danger-solid px-1.5 text-[10px] font-bold leading-4 text-white">{urgent}</span>
      ) : null}
    </button>
  );
}

const SAVE_ERROR_HINT: Record<'quota' | 'conflict' | 'deleted', string> = {
  quota: 'Browser storage is full — export or delete projects; your edits are kept in this tab until then',
  conflict: 'This project changed in another tab — choose which version to keep',
  deleted: 'This project was deleted in another tab — restore it or keep it as a new project',
};

export function Topbar() {
  const projectName = useEditor((s) => s.projectName);
  const renameProject = useEditor((s) => s.renameProject);
  const saveState = useEditor((s) => s.saveState);
  const saveError = useEditor((s) => s.saveError);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const toggle = useLayout((s) => s.toggle);
  // re-render on any layout change; isOpen() answers per mode (side panel vs drawer)
  useLayout((s) => `${s.compact}:${s.drawer}:${s.panels.palette}${s.panels.code}${s.panels.inspector}`);
  const isOpen = useLayout.getState().isOpen;
  const openPalette = usePalette((s) => s.setOpen);
  const { theme, setTheme } = useTheme();
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null);
  // ⋯ menu below lg: the actions the bar has no room for at the current width
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number; small: boolean } | null>(null);

  const doExportZip = () => {
    const { projectName: name, files } = useEditor.getState();
    exportZip(name, files);
    showToast('Terraform zip downloaded', 'success');
  };

  const doViewLink = () => {
    const { projectName: name, files } = useEditor.getState();
    const link = viewLinkInfo({ name, files });
    if (link.tooLarge) {
      showToast(link.warning!, 'error');
      return;
    }
    void copyText(link.url).then(
      () => showToast(link.warning ?? 'View link copied — anyone can look, nobody can edit', link.warning ? 'info' : 'success'),
      () => showToast('Could not copy the link', 'error'),
    );
  };

  const doShare = () => {
    const { projectName: name, files } = useEditor.getState();
    const link = shareLinkInfo({ name, files });
    if (link.tooLarge) {
      showToast(link.warning!, 'error');
      return;
    }
    void copyText(link.url).then(
      () => showToast(link.warning ?? 'Share link copied — anyone can open this project', link.warning ? 'info' : 'success'),
      () => showToast('Could not copy the link', 'error'),
    );
  };

  const panelToggles: Array<{ id: PanelId; label: string; icon: ReactNode }> = [
    { id: 'palette', label: `Resource palette (${MOD}B)`, icon: <PanelLeft className="h-4 w-4" /> },
    { id: 'code', label: `Code editor (${MOD}J)`, icon: <Code2 className="h-4 w-4" /> },
    { id: 'inspector', label: `Inspector (${MOD}I)`, icon: <PanelRight className="h-4 w-4" /> },
  ];

  const moreEntries = (small: boolean): MenuEntry[] => [
    ...(small
      ? [
          {
            id: 'search',
            label: 'Command palette…',
            icon: Search,
            shortcut: `${MOD} K`,
            onSelect: () => openPalette(true),
          },
        ]
      : []),
    { id: 'undo', label: 'Undo', icon: Undo2, shortcut: `${MOD} Z`, disabled: !canUndo, onSelect: undo },
    { id: 'redo', label: 'Redo', icon: Redo2, shortcut: `${MOD} ⇧ Z`, disabled: !canRedo, onSelect: redo },
    ...(small
      ? [
          { id: 'share', label: 'Copy share link', icon: Share2, onSelect: doShare },
          { id: 'view-link', label: 'Copy view link (read-only)', icon: Eye, onSelect: doViewLink },
          {
            id: 'inspector',
            label: 'Inspector',
            icon: PanelRight,
            shortcut: `${MOD} I`,
            checked: isOpen('inspector'),
            toggle: true,
            onSelect: () => toggle('inspector'),
          },
        ]
      : []),
    'separator',
    ...(['light', 'dark', 'system'] as const).map((t) => ({
      id: `theme-${t}`,
      label: `${t[0]!.toUpperCase()}${t.slice(1)} theme`,
      icon: t === 'light' ? Sun : t === 'dark' ? Moon : Monitor,
      checked: theme === t,
      onSelect: () => setTheme(t),
    })),
  ];

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-1.5 border-b bg-surface-1 px-2 sm:gap-2 sm:px-3">
      <Link
        to="/dashboard"
        aria-label="Back to dashboard"
        className="shrink-0 rounded-sm p-1 hover:bg-surface-2"
      >
        <LogoMark size={22} />
      </Link>
      {/* the name keeps ≥ 96 px: secondary actions collapse into ⋯ first */}
      <nav
        className="flex min-w-24 shrink items-center gap-1.5 text-[13px] sm:min-w-44"
        aria-label="Breadcrumb"
      >
        <Link to="/dashboard" className="hidden shrink-0 text-muted hover:text-foreground sm:inline">
          Projects
        </Link>
        <span className="hidden text-faint sm:inline" aria-hidden="true">
          /
        </span>
        <input
          key={projectName}
          defaultValue={projectName}
          aria-label="Project name"
          className="w-44 min-w-0 flex-1 truncate rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 font-semibold text-foreground hover:border-border focus:border-primary focus:outline-none"
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
          'items-center gap-1 text-[11.5px] font-medium transition-colors',
          saveState === 'error' ? 'flex text-danger' : 'hidden sm:flex',
          saveState === 'saved' ? 'text-faint' : saveState === 'saving' ? 'text-muted' : '',
        )}
        role="status"
        title={saveState === 'error' ? SAVE_ERROR_HINT[saveError ?? 'quota'] : undefined}
      >
        {saveState === 'saved' ? (
          <>
            <Check className="h-3.5 w-3.5 text-success" /> Saved
          </>
        ) : saveState === 'error' ? (
          <>
            <AlertTriangle className="h-3.5 w-3.5" />
            {saveError === 'quota' ? 'Not saved — storage full' : 'Not saved'}
          </>
        ) : (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving
          </>
        )}
      </span>
      <FolderSyncStatus />

      <div className="flex min-w-0 flex-1 justify-center px-2 max-xl:px-0">
        <button
          type="button"
          onClick={() => openPalette(true)}
          className="hidden h-8 w-full max-w-[340px] items-center gap-2 whitespace-nowrap rounded-md border bg-surface-2/70 px-2.5 text-[12.5px] text-faint transition-colors hover:border-border-strong hover:text-muted xl:flex"
          aria-label="Search or run a command"
          aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 truncate text-left">Search or run a command…</span>
          <Kbd>{MOD} K</Kbd>
        </button>
      </div>
      <span className="hidden sm:contents xl:hidden">
        <IconToggle label={`Search or run a command (${MOD}K)`} emphasis onClick={() => openPalette(true)}>
          <Search className="h-4 w-4" />
        </IconToggle>
      </span>

      <SecurityBadge />

      <div className="flex shrink-0 items-center" role="group" aria-label="Panels">
        {panelToggles.map((p) => (
          <span key={p.id} className={cn('contents', p.id === 'inspector' && 'max-sm:hidden')}>
            <IconToggle label={p.label} pressed={isOpen(p.id)} onClick={() => toggle(p.id)}>
              {p.icon}
            </IconToggle>
          </span>
        ))}
      </div>

      <span className="hidden lg:contents">
        <span className="mx-1 h-5 w-px shrink-0 bg-border" />
        <Button variant="ghost" size="icon" aria-label="Undo" title={`Undo (${MOD}Z)`} disabled={!canUndo} onClick={undo}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Redo" title={`Redo (${MOD}⇧Z)`} disabled={!canRedo} onClick={redo}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-5 w-px shrink-0 bg-border" />
      </span>

      <span className="hidden sm:contents">
        <Button variant="outline" size="sm" onClick={doShare} aria-label="Share" className="shrink-0">
          <Share2 className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Share</span>
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={doViewLink}
          aria-label="Copy view link"
          title="Copy a read-only view link"
          className="h-7 w-7 shrink-0"
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
      </span>
      <Button
        size="sm"
        aria-haspopup="menu"
        aria-expanded={exportMenu !== null}
        aria-label="Export"
        className="shrink-0"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setExportMenu({ x: r.right - 220, y: r.bottom + 6 });
        }}
      >
        <Download className="h-3.5 w-3.5" /> <span className="hidden md:inline">Export</span>
        <ChevronDown className="-mr-0.5 h-3.5 w-3.5 opacity-80 max-sm:hidden" />
      </Button>
      <span className="hidden lg:contents">
        <ThemeToggle />
      </span>
      <span className="contents lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={moreMenu !== null}
          title="More actions"
          className="shrink-0"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const small = !window.matchMedia('(min-width: 640px)').matches;
            setMoreMenu({ x: r.right - 240, y: r.bottom + 6, small });
          }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </span>

      {moreMenu ? (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          label="More actions"
          onClose={() => setMoreMenu(null)}
          entries={moreEntries(moreMenu.small)}
        />
      ) : null}
      {exportMenu ? (
        <ContextMenu
          x={exportMenu.x}
          y={exportMenu.y}
          label="Export"
          onClose={() => setExportMenu(null)}
          entries={[
            { id: 'pdf', label: 'PDF document to share…', icon: FileText, onSelect: openExportPdf },
            'separator',
            { id: 'zip', label: 'Terraform files (.zip)', icon: FileArchive, onSelect: doExportZip },
            { id: 'folder', label: 'Sync with folder…', icon: FolderSync, onSelect: () => void startFolderLink() },
            'separator',
            { id: 'png', label: 'Diagram as PNG', icon: ImageDown, onSelect: () => void canvasApi()?.exportImage('png') },
            { id: 'svg', label: 'Diagram as SVG', icon: FileImage, onSelect: () => void canvasApi()?.exportImage('svg') },
          ]}
        />
      ) : null}
    </header>
  );
}
