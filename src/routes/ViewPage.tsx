/**
 * Read-only viewer for `/#view=<project>` links: the editor's canvas,
 * inspector and code tabs with the store's `readOnly` flag on — pan, zoom,
 * select, read and export, but nothing can change, and nothing is written
 * to this browser's storage or its projects. "Make a copy to edit" goes
 * through the share-link import (same confirmation, same dedupe).
 *
 * `&embed=1` is the iframe version: the diagram and an "Open" link, no app
 * chrome, no dialogs and no focus taken on load.
 */
import {
  ArrowUpRight,
  Code2,
  CopyPlus,
  Download,
  Eye,
  FileArchive,
  FileCode2,
  FileImage,
  FileText,
  ImageDown,
  Link2,
  Monitor,
  Moon,
  MoreHorizontal,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ContextMenu, type MenuEntry } from '@/components/ContextMenu';
import { offerShareImport } from '@/components/ShareLinkHost';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';
import { showToast } from '@/components/Toast';
import { Badge, Button, buttonClass, hasOpenLayer, LogoMark } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { CanvasPane } from '@/features/editor/CanvasPane';
import { Inspector } from '@/features/editor/Inspector';
import { useLayout } from '@/features/editor/layoutStore';
import { useEditor } from '@/features/editor/store';
import { ExportPdfHost, openExportPdf } from '@/features/export/ExportPdfDialog';
import { copyText, exportZip } from '@/lib/download';
import { parseViewHash, shareHash, viewLinkInfo, viewUrl, type ShareError, type SharePayload } from '@/lib/share';
import { detectProviders, type Project } from '@/lib/storage';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { cn } from '@/lib/utils';
import { useTheme } from '@/theme/useTheme';

const CodePane = lazy(() => import('@/features/editor/CodePane').then((m) => ({ default: m.CodePane })));

const ERRORS: Record<ShareError, string> = {
  invalid: 'This view link is damaged or incomplete — ask for a new one.',
  'too-large': 'This view link is too large to open safely.',
  version: 'This view link needs a newer version of Cloud Blueprint — reload and try again.',
};

const COMPACT = '(max-width: 1099px)';
const EPOCH = new Date(0).toISOString();

/** The link's project, as the editor store takes it — never stored anywhere. */
function viewProject(payload: SharePayload): Project {
  return {
    id: `view_${shareHash(payload)}`,
    name: payload.name,
    files: payload.files,
    providers: detectProviders(payload.files),
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}

function htmlAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** The `<iframe>` snippet for this view. */
function embedSnippet(payload: SharePayload): string {
  return `<iframe src="${viewUrl(payload, { embed: true })}" title="${htmlAttr(payload.name)} — Cloud Blueprint" width="100%" height="480" style="border:0;border-radius:12px" loading="lazy"></iframe>`;
}

function copyViewLink(payload: SharePayload) {
  const link = viewLinkInfo(payload);
  if (link.tooLarge) {
    showToast(link.warning!, 'error');
    return;
  }
  void copyText(link.url).then(
    () => showToast(link.warning ?? 'View link copied — anyone with it can look, nobody can edit', link.warning ? 'info' : 'success'),
    () => showToast('Could not copy the link', 'error'),
  );
}

function copyEmbed(payload: SharePayload) {
  const link = viewLinkInfo(payload, { embed: true });
  if (link.tooLarge) {
    showToast(link.warning!, 'error');
    return;
  }
  void copyText(embedSnippet(payload)).then(
    () => showToast(link.warning ?? 'Embed code copied — paste it into any page that allows iframes', link.warning ? 'info' : 'success'),
    () => showToast('Could not copy the embed code', 'error'),
  );
}

/* ------------------------------------------------------------------ bits */

function LinkError({ error, embed }: { error: ShareError; embed: boolean }) {
  useDocumentTitle('View link');
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 bg-background px-6 text-center" role="alert">
      <LogoMark size={embed ? 28 : 44} />
      <h1 className={cn('font-bold', embed ? 'text-[15px]' : 'text-[22px]')}>Can’t open this view</h1>
      <p className="max-w-sm text-[13px] leading-relaxed text-muted">{ERRORS[error]}</p>
      {embed ? (
        <a href={import.meta.env.BASE_URL} target="_blank" rel="noopener" className={buttonClass('outline', 'sm')}>
          Open Cloud Blueprint <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      ) : (
        <Link to="/" className={buttonClass('primary', 'md', 'mt-2')}>
          Go to Cloud Blueprint
        </Link>
      )}
    </main>
  );
}

function CodeFallback() {
  return (
    <section
      className="flex h-full flex-col items-center justify-center gap-3 bg-surface-1 text-[12px] text-faint"
      aria-label="Terraform code"
      aria-busy="true"
    >
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
      Loading code…
    </section>
  );
}

function IconToggle({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
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
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-surface-2',
        pressed ? 'text-foreground' : 'text-faint hover:text-muted',
      )}
    >
      {children}
    </button>
  );
}

type MenuKind = 'share' | 'export' | 'more';

function ViewerTopbar({
  payload,
  codeOpen,
  onToggleCode,
}: {
  payload: SharePayload;
  codeOpen: boolean;
  onToggleCode(): void;
}) {
  const [menu, setMenu] = useState<{ kind: MenuKind; x: number; y: number } | null>(null);
  const { theme, setTheme } = useTheme();
  const open = (kind: MenuKind) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ kind, x: r.right - 230, y: r.bottom + 6 });
  };

  const item = (id: string, label: string, icon: LucideIcon, onSelect: () => void): MenuEntry => ({ id, label, icon, onSelect });
  const share: MenuEntry[] = [
    item('view-link', 'Copy view link', Link2, () => copyViewLink(payload)),
    item('embed', 'Copy embed code', FileCode2, () => copyEmbed(payload)),
  ];
  const exports: MenuEntry[] = [
    item('pdf', 'PDF document…', FileText, openExportPdf),
    item('png', 'Diagram as PNG', ImageDown, () => void canvasApi()?.exportImage('png')),
    item('svg', 'Diagram as SVG', FileImage, () => void canvasApi()?.exportImage('svg')),
    'separator',
    item('zip', 'Terraform files (.zip)', FileArchive, () => {
      exportZip(payload.name, payload.files);
      showToast('Terraform zip downloaded', 'success');
    }),
  ];
  const entries: Record<MenuKind, MenuEntry[]> = {
    share,
    export: exports,
    more: [
      ...share,
      'separator',
      ...exports,
      'separator',
      ...(['light', 'dark', 'system'] as const).map((t) => ({
        id: `theme-${t}`,
        label: `${t[0]!.toUpperCase()}${t.slice(1)} theme`,
        icon: t === 'light' ? Sun : t === 'dark' ? Moon : Monitor,
        checked: theme === t,
        onSelect: () => setTheme(t),
      })),
    ],
  };

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-1.5 border-b bg-surface-1 px-2 sm:gap-2 sm:px-3">
      <Link to="/" aria-label="Cloud Blueprint home" className="shrink-0 rounded-sm p-1 hover:bg-surface-2">
        <LogoMark size={22} />
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
          <span className="hidden shrink-0 text-muted sm:inline">Viewing</span>
          <span className="truncate font-semibold" title={payload.name}>
            {payload.name}
          </span>
        </h1>
        <Badge variant="outline" className="shrink-0" title="Read-only — nothing here can be changed or saved">
          <Eye className="h-3 w-3" />
          <span className="max-sm:sr-only">read-only</span>
        </Badge>
      </div>

      <IconToggle label="Code (⌘J)" pressed={codeOpen} onClick={onToggleCode}>
        <Code2 className="h-4 w-4" />
      </IconToggle>
      <span className="hidden sm:contents">
        <Button variant="outline" size="sm" aria-label="Share" aria-haspopup="menu" aria-expanded={menu?.kind === 'share'} onClick={open('share')}>
          <Link2 className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Share</span>
        </Button>
        <Button variant="outline" size="sm" aria-label="Export" aria-haspopup="menu" aria-expanded={menu?.kind === 'export'} onClick={open('export')}>
          <Download className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Export</span>
        </Button>
        <LanguageSwitcher compact />
        <ThemeToggle />
      </span>
      <span className="contents sm:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === 'more'}
          title="More actions"
          onClick={open('more')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </span>
      <Button size="sm" className="shrink-0" onClick={() => offerShareImport(payload)}>
        <CopyPlus className="h-3.5 w-3.5" />
        <span>
          Make a copy<span className="max-md:hidden"> to edit</span>
        </span>
      </Button>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.kind === 'share' ? 'Share' : menu.kind === 'export' ? 'Export' : 'More actions'}
          onClose={() => setMenu(null)}
          entries={entries[menu.kind]}
        />
      ) : null}
    </header>
  );
}

/* ---------------------------------------------------------------- layouts */

function useCompact(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT).matches);
  useEffect(() => {
    const mq = window.matchMedia(COMPACT);
    const apply = () => {
      setCompact(mq.matches);
      useLayout.getState().setCompact(mq.matches); // the canvas reads it for the inspector inset
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return compact;
}

function FullViewer({ payload }: { payload: SharePayload }) {
  const compact = useCompact();
  // side-by-side on wide screens; a drawer (closed at first) on narrow ones
  const [codeOpen, setCodeOpen] = useState(() => !window.matchMedia(COMPACT).matches);
  const selection = useEditor((s) => s.selection);
  const inspector = useLayout((s) => s.panels.inspector);
  useDocumentTitle(`${payload.name} (view)`);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable], .monaco-editor')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (e.defaultPrevented || hasOpenLayer()) return;
        if (compact && codeOpen) setCodeOpen(false);
        else if (useEditor.getState().selection) useEditor.getState().setSelection(null);
        return;
      }
      if (hasOpenLayer(['modal'])) return;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setCodeOpen((v) => !v);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        useLayout.getState().toggle('inspector');
      } else if (e.shiftKey && !mod && (e.code === 'Digit1' || e.key === '!')) {
        e.preventDefault();
        canvasApi()?.fitView();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact, codeOpen]);

  const showInspector = inspector && selection !== null && !(compact && codeOpen);

  return (
    <div className="flex h-full flex-col">
      <ViewerTopbar payload={payload} codeOpen={codeOpen} onToggleCode={() => setCodeOpen((v) => !v)} />
      <main className="flex min-h-0 flex-1" aria-label="Blueprint (read-only)">
        <div className="relative min-w-0 flex-1">
          <CanvasPane />
          {showInspector ? (
            <div className="bp-drawer-right absolute bottom-3 right-3 top-3 z-20 flex w-[min(300px,calc(100%-24px))]">
              <Inspector />
            </div>
          ) : null}
          {compact && codeOpen ? (
            <div className="bp-drawer-right absolute bottom-0 right-0 top-0 z-30 w-[min(560px,94%)] border-l shadow-lg">
              <Suspense fallback={<CodeFallback />}>
                <CodePane />
              </Suspense>
            </div>
          ) : null}
        </div>
        {!compact && codeOpen ? (
          <div className="w-[38%] min-w-[320px] max-w-[720px] shrink-0 border-l">
            <Suspense fallback={<CodeFallback />}>
              <CodePane />
            </Suspense>
          </div>
        ) : null}
      </main>
      <ExportPdfHost />
    </div>
  );
}

function EmbedViewer({ payload }: { payload: SharePayload }) {
  const wrapper = useRef<HTMLDivElement>(null);
  useDocumentTitle(`${payload.name} (view)`);
  // the iframe can be resized by its page: keep the whole diagram in view
  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false; // React Flow fits the first layout itself
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => canvasApi()?.fitView(), 150);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
  const full = useMemo(() => viewUrl(payload), [payload]);
  return (
    <main
      ref={wrapper}
      // an embed is a picture of the architecture: no minimap covering it
      className="@container relative h-full [&_.react-flow__minimap]:hidden"
      aria-label={`${payload.name} — read-only diagram`}
    >
      <h1 className="sr-only">{payload.name}</h1>
      <CanvasPane />
      <a
        href={full}
        target="_blank"
        rel="noopener"
        aria-label={`Open ${payload.name} in Cloud Blueprint (new tab)`}
        title={`Open “${payload.name}” in Cloud Blueprint`}
        className="absolute left-2 top-2 z-30 flex items-center gap-1.5 rounded-full border bg-surface-1/90 py-1 pl-1.5 pr-2.5 text-[11.5px] font-medium text-muted shadow-sm backdrop-blur-md transition-colors hover:border-border-strong hover:text-foreground"
      >
        <LogoMark size={15} />
        <span className="hidden @xl:inline">Cloud Blueprint</span>
        <span className="@xl:hidden">Open</span>
        <ArrowUpRight className="h-3 w-3" />
      </a>
    </main>
  );
}

export default function ViewPage() {
  const { hash } = useLocation();
  const link = useMemo(() => parseViewHash(hash), [hash]);
  const payload = link?.result.ok ? link.result.payload : null;
  const [loaded, setLoaded] = useState<SharePayload | null>(null);

  useEffect(() => {
    if (!payload) return;
    useEditor.getState().load(viewProject(payload), { readOnly: true });
    setLoaded(payload);
  }, [payload]);

  if (!link) return null;
  if (!link.result.ok) return <LinkError error={link.result.error} embed={link.embed} />;
  // the store holds this link's project from the first paint of the canvas on
  if (!payload || loaded !== payload) return null;
  return link.embed ? <EmbedViewer payload={payload} /> : <FullViewer payload={payload} />;
}
