import {
  AlertTriangle,
  Check,
  ChevronDown,
  Code2,
  Columns3,
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
  SlidersHorizontal,
  Sun,
  Undo2,
  Workflow,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ContextMenu, type MenuEntry } from '@/components/ContextMenu';
import { BrazilFlag, UsFlag } from '@/components/flags';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';
import { showToast } from '@/components/Toast';
import { Button, Kbd, LogoMark } from '@/components/ui';
import { usePalette } from '@/features/command/paletteStore';
import { FolderSyncStatus } from '@/features/data/FolderSyncStatus';
import { startFolderLink } from '@/features/data/folderSync';
import { copyText, exportZip } from '@/lib/download';
import { shareLinkInfo, viewLinkInfo } from '@/lib/share';
import { cn } from '@/lib/utils';
import { ariaShortcut, shortcut } from '@/lib/keys';
import { openExportPdf } from '@/features/export/ExportPdfDialog';
import { GRADE_COLORS, useAudit, useSecurityUi } from '@/features/security/securityStore';
import { LOCALES, useLocale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
import { useTheme } from '@/theme/useTheme';
import { canvasApi } from './canvasApi';
import { layoutMessages } from './layout.messages';
import { LayoutMenu } from './LayoutMenu';
import { useLayout, type PanelId } from './layoutStore';
import { openProjectRootPath, useEditor } from './store';
import { topbarMessages } from './Topbar.messages';

function IconToggle({
  label,
  pressed,
  emphasis,
  onClick,
  children,
  ...rest
}: {
  label: string;
  /** a toggle (aria-pressed); omit for a plain button */
  pressed?: boolean;
  /** plain button drawn like a pressed toggle */
  emphasis?: boolean;
  onClick(e: React.MouseEvent<HTMLButtonElement>): void;
  children: ReactNode;
} & Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-haspopup' | 'aria-expanded'>) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      {...rest}
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
  const m = useMessages(topbarMessages);
  const open = useSecurityUi((s) => s.panelOpen);
  const setPanel = useSecurityUi((s) => s.setPanel);
  const audit = useAudit();
  const urgent = audit.counts.critical + audit.counts.high;
  const color = audit.grade ? GRADE_COLORS[audit.grade] : undefined;
  return (
    <button
      type="button"
      onClick={() => setPanel(!open)}
      aria-pressed={open}
      aria-label={m.securityLabel(audit.grade ?? null, urgent)}
      title={m.securityAudit}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12px] font-semibold transition-colors hover:border-border-strong',
        open ? 'bg-primary-soft' : 'bg-surface-1',
      )}
    >
      <ShieldCheck className="h-4 w-4" style={{ color }} />
      <span className="hidden text-muted lg:inline">{m.security}</span>
      {audit.grade ? <span style={{ color }}>{audit.grade}</span> : null}
      {urgent > 0 ? (
        <span className="rounded-full bg-danger-solid px-1.5 text-[10px] font-bold leading-4 text-white">{urgent}</span>
      ) : null}
    </button>
  );
}

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
  useLayout((s) => `${s.compact}:${s.drawer}:${s.panels.palette}${s.panels.canvas}${s.panels.code}${s.panels.inspector}`);
  const isOpen = useLayout.getState().isOpen;
  const paletteSide = useLayout((s) => s.paletteSide);
  const lm = useMessages(layoutMessages);
  const m = useMessages(topbarMessages);
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  /** the Layout popover, opened from its button (or the ⋯ menu on phones) */
  const [layoutMenu, setLayoutMenu] = useState<HTMLElement | null>(null);
  const openPalette = usePalette((s) => s.setOpen);
  const { theme, setTheme } = useTheme();
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null);
  // ⋯ menu below lg: the actions the bar has no room for at the current width
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number; small: boolean } | null>(null);

  const doExportZip = () => {
    const { projectName: name, files } = useEditor.getState();
    exportZip(name, files, { rootPath: openProjectRootPath() });
    showToast(m.zipDownloaded, 'success');
  };

  const doViewLink = () => {
    const { projectName: name, files } = useEditor.getState();
    const link = viewLinkInfo({ name, files });
    if (link.tooLarge) {
      showToast(link.warning!, 'error');
      return;
    }
    void copyText(link.url).then(
      () => showToast(link.warning ?? m.viewCopied, link.warning ? 'info' : 'success'),
      () => showToast(m.copyFailed, 'error'),
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
      () => showToast(link.warning ?? m.shareCopied, link.warning ? 'info' : 'success'),
      () => showToast(m.copyFailed, 'error'),
    );
  };

  const panelToggles: Array<{ id: PanelId; label: string; icon: ReactNode }> = [
    {
      id: 'palette',
      label: m.palette(shortcut('mod', 'B')),
      icon: paletteSide === 'left' ? <PanelLeft className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />,
    },
    { id: 'canvas', label: lm.section.canvas, icon: <Workflow className="h-4 w-4" /> },
    { id: 'code', label: m.code(shortcut('mod', 'J')), icon: <Code2 className="h-4 w-4" /> },
    { id: 'inspector', label: m.inspector(shortcut('mod', 'I')), icon: <SlidersHorizontal className="h-4 w-4" /> },
  ];

  const moreEntries = (small: boolean): MenuEntry[] => [
    ...(small
      ? [
          {
            id: 'search',
            label: m.commandPalette,
            icon: Search,
            shortcut: shortcut('mod', 'K'),
            onSelect: () => openPalette(true),
          },
        ]
      : []),
    { id: 'undo', label: m.undo, icon: Undo2, shortcut: shortcut('mod', 'Z'), disabled: !canUndo, onSelect: undo },
    { id: 'redo', label: m.redo, icon: Redo2, shortcut: shortcut('mod', 'shift', 'Z'), disabled: !canRedo, onSelect: redo },
    ...(small
      ? [
          { id: 'share', label: m.copyShareLink, icon: Share2, onSelect: doShare },
          { id: 'view-link', label: m.copyViewLinkReadOnly, icon: Eye, onSelect: doViewLink },
          {
            id: 'inspector',
            label: m.inspectorEntry,
            icon: SlidersHorizontal,
            shortcut: shortcut('mod', 'I'),
            checked: isOpen('inspector'),
            toggle: true,
            onSelect: () => toggle('inspector'),
          },
          {
            id: 'layout',
            label: lm.layoutMore,
            icon: Columns3,
            onSelect: () => setLayoutMenu(document.querySelector<HTMLElement>('[data-more-actions]')),
          },
        ]
      : []),
    'separator',
    ...(['light', 'dark', 'system'] as const).map((t) => ({
      id: `theme-${t}`,
      label: m.theme[t],
      icon: t === 'light' ? Sun : t === 'dark' ? Moon : Monitor,
      checked: theme === t,
      onSelect: () => setTheme(t),
    })),
    // the flag picker sits in the bar from lg up; below, the languages are listed here
    'separator',
    ...LOCALES.map((l) => ({
      id: `locale-${l.id}`,
      label: l.label,
      icon: l.id === 'pt-BR' ? BrazilFlag : UsFlag,
      checked: locale === l.id,
      onSelect: () => setLocale(l.id),
    })),
  ];

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-1.5 border-b bg-surface-1 px-2 sm:gap-2 sm:px-3">
      <Link
        to="/dashboard"
        aria-label={m.backToDashboard}
        className="shrink-0 rounded-sm p-1 hover:bg-surface-2"
      >
        <LogoMark size={22} />
      </Link>
      {/* the name keeps ≥ 96 px: secondary actions collapse into ⋯ first */}
      <nav
        className="flex min-w-24 shrink items-center gap-1.5 text-[13px] sm:min-w-44"
        aria-label={m.breadcrumb}
      >
        <Link to="/dashboard" className="hidden shrink-0 text-muted hover:text-foreground sm:inline">
          {m.projects}
        </Link>
        <span className="hidden text-faint sm:inline" aria-hidden="true">
          /
        </span>
        <input
          key={projectName}
          defaultValue={projectName}
          aria-label={m.projectName}
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
        title={saveState === 'error' ? m.saveError[saveError ?? 'quota'] : undefined}
      >
        {saveState === 'saved' ? (
          <>
            <Check className="h-3.5 w-3.5 text-success" /> {m.saved}
          </>
        ) : saveState === 'error' ? (
          <>
            <AlertTriangle className="h-3.5 w-3.5" />
            {saveError === 'quota' ? m.notSavedFull : m.notSaved}
          </>
        ) : (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {m.saving}
          </>
        )}
      </span>
      <FolderSyncStatus />

      <div className="flex min-w-0 flex-1 justify-center px-2 max-xl:px-0">
        <button
          type="button"
          onClick={() => openPalette(true)}
          className="hidden h-8 w-full max-w-[340px] items-center gap-2 whitespace-nowrap rounded-md border bg-surface-2/70 px-2.5 text-[12.5px] text-faint transition-colors hover:border-border-strong hover:text-muted xl:flex"
          aria-label={m.search}
          aria-keyshortcuts={ariaShortcut('mod', 'K')}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 truncate text-left">{m.searchPlaceholder}</span>
          <Kbd>{shortcut('mod', 'K')}</Kbd>
        </button>
      </div>
      <span className="hidden sm:contents xl:hidden">
        <IconToggle label={m.searchShortcut(shortcut('mod', 'K'))} emphasis onClick={() => openPalette(true)}>
          <Search className="h-4 w-4" />
        </IconToggle>
      </span>

      <SecurityBadge />

      <div className="flex shrink-0 items-center" role="group" aria-label={m.panels}>
        {panelToggles.map((p) => (
          <span key={p.id} className={cn('contents', (p.id === 'inspector' || p.id === 'canvas') && 'max-sm:hidden')}>
            <IconToggle label={p.label} pressed={isOpen(p.id)} onClick={() => toggle(p.id)}>
              {p.icon}
            </IconToggle>
          </span>
        ))}
        <span className="contents max-sm:hidden">
          <IconToggle
            label={lm.layout}
            emphasis={layoutMenu !== null}
            aria-haspopup="dialog"
            aria-expanded={layoutMenu !== null}
            onClick={(e) => {
              const trigger = e.currentTarget;
              setLayoutMenu((open) => (open ? null : trigger));
            }}
          >
            <Columns3 className="h-4 w-4" />
          </IconToggle>
        </span>
      </div>

      <span className="hidden lg:contents">
        <span className="mx-1 h-5 w-px shrink-0 bg-border" />
        <Button variant="ghost" size="icon" aria-label={m.undo} title={m.undoShortcut(shortcut('mod', 'Z'))} disabled={!canUndo} onClick={undo}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={m.redo} title={m.redoShortcut(shortcut('mod', 'shift', 'Z'))} disabled={!canRedo} onClick={redo}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-5 w-px shrink-0 bg-border" />
      </span>

      <span className="hidden sm:contents">
        <Button variant="outline" size="sm" onClick={doShare} aria-label={m.share} className="shrink-0">
          <Share2 className="h-3.5 w-3.5" /> <span className="hidden lg:inline">{m.share}</span>
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={doViewLink}
          aria-label={m.copyViewLink}
          title={m.copyViewLinkTitle}
          className="h-7 w-7 shrink-0"
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
      </span>
      <Button
        size="sm"
        aria-haspopup="menu"
        aria-expanded={exportMenu !== null}
        aria-label={m.export}
        className="shrink-0"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setExportMenu({ x: r.right - 220, y: r.bottom + 6 });
        }}
      >
        <Download className="h-3.5 w-3.5" /> <span className="hidden md:inline">{m.export}</span>
        <ChevronDown className="-mr-0.5 h-3.5 w-3.5 opacity-80 max-sm:hidden" />
      </Button>
      <span className="hidden lg:contents">
        <LanguageSwitcher compact />
        <ThemeToggle />
      </span>
      <span className="contents lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label={m.moreActions}
          aria-haspopup="menu"
          aria-expanded={moreMenu !== null}
          title={m.moreActions}
          data-more-actions
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

      {layoutMenu ? <LayoutMenu anchor={layoutMenu} onClose={() => setLayoutMenu(null)} /> : null}
      {moreMenu ? (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          label={m.moreActions}
          onClose={() => setMoreMenu(null)}
          entries={moreEntries(moreMenu.small)}
        />
      ) : null}
      {exportMenu ? (
        <ContextMenu
          x={exportMenu.x}
          y={exportMenu.y}
          label={m.export}
          onClose={() => setExportMenu(null)}
          entries={[
            { id: 'pdf', label: m.pdf, icon: FileText, onSelect: openExportPdf },
            'separator',
            { id: 'zip', label: m.zip, icon: FileArchive, onSelect: doExportZip },
            { id: 'folder', label: m.folder, icon: FolderSync, onSelect: () => void startFolderLink() },
            'separator',
            { id: 'png', label: m.png, icon: ImageDown, onSelect: () => void canvasApi()?.exportImage('png') },
            { id: 'svg', label: m.svg, icon: FileImage, onSelect: () => void canvasApi()?.exportImage('svg') },
          ]}
        />
      ) : null}
    </header>
  );
}
