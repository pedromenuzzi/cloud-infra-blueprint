/**
 * The editor around a lesson's code: the editor's own palette, canvas, code
 * pane, inspector and security panel, with a slim toolbar on top and the
 * simulated terminal docked below. The lesson's mode sets the starting
 * layout (canvas first, balanced, or code first) by borrowing the editor's
 * layout store, so the panels behave as in the editor (hide, strips,
 * drawers, Ctrl B / J / I) and nothing changes the layout someone set up
 * in the editor itself.
 */
import { Code2, ExternalLink, PanelLeft, Redo2, ShieldCheck, Undo2 } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, hasOpenLayer } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { isCanvasDragging, useCanvasDrag, useCanvasDragTracking } from '@/features/editor/canvasDrag';
import { CanvasPane } from '@/features/editor/CanvasPane';
import { codeMessages } from '@/features/editor/CodePane.messages';
import { Inspector } from '@/features/editor/Inspector';
import { dockedInspector, floatingInspectorSlot, INSPECTOR_WIDTH, securityPanelSlot } from '@/features/editor/inspectorPlacement';
import { useKeepSelectionVisible, useRevealOpensCode } from '@/features/editor/layoutEffects';
import type { LayoutPrefs } from '@/features/editor/layoutPrefs';
import { SPLIT_DEFAULT } from '@/features/editor/layoutPrefs';
import { useLayout } from '@/features/editor/layoutStore';
import { Palette } from '@/features/editor/Palette';
import { CanvasLayoutControls, CodePaneControls, CollapsedStrip, FLOAT_CHROME, focusSoon, InspectorTab, PanelDropZones, WORKSPACE_ID } from '@/features/editor/PanelChrome';
import { useEditor } from '@/features/editor/store';
import { ExportPdfHost } from '@/features/export/ExportPdfDialog';
import { TerminalPanel } from '@/features/learn/terminal/TerminalPanel';
import { RulesEditor } from '@/features/security/RulesEditor';
import { SecurityPanel } from '@/features/security/SecurityPanel';
import { GRADE_COLORS, useProjectAudit, useSecurityUi } from '@/features/security/securityStore';
import { useMessages } from '@/i18n/messages';
import { nodeIds } from '@/ir/modules';
import type { IR } from '@/ir/types';
import type { Lesson, LessonMode } from '@/learn/types';
import { shortcut } from '@/lib/keys';
import { cn } from '@/lib/utils';
import { lessonAsProject } from './lessonDraft';
import { playerMessages } from './player.messages';

const CodePane = lazy(() => import('@/features/editor/CodePane').then((m) => ({ default: m.CodePane })));

/**
 * Where each mode starts; everything else comes from the user's editor layout.
 * The live diagram is the point of a lesson, so the canvas gets the most room
 * the mode allows. `split` is the code column's share of the whole editor
 * area (it never goes below 300 px).
 */
const MODE_LAYOUT: Record<LessonMode, Partial<LayoutPrefs>> = {
  // drag from the palette: the canvas leads, the code it writes alongside
  canvas: { palette: true, code: true, split: 28 },
  mixed: { palette: true, code: true, split: 32 },
  // typing: the code leads, the canvas still draws it live; resources stay one click away
  code: { palette: false, code: true, split: 50 },
};
const LESSON_LAYOUT: Partial<LayoutPrefs> = {
  canvas: true,
  inspector: true,
  // the inspector sits on top of the code column, never over the canvas (compact screens float it)
  inspectorMode: 'docked',
  paletteSide: 'left',
  codeSide: 'right',
};

/** narrower than this, the editor area is compact: the canvas alone, palette and code as drawers */
const WIDE_MIN = 860;
/** the security panel (340 px) and the floating inspector side by side, with their margins */
const BOTH_PANELS = 340 + INSPECTOR_WIDTH + 3 * 12;

const CANVAS_TARGET = 'bp-canvas';
const CODE_TARGET = 'bp-code';

function CodeFallback() {
  const m = useMessages(codeMessages);
  return (
    <section
      className="flex h-full flex-col items-center justify-center gap-3 bg-surface-1 text-[12px] text-faint"
      aria-label={m.terraformCode}
      aria-busy="true"
    >
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
      {m.loading}
    </section>
  );
}

/** Is `ref` narrower than `px`? (followed as it resizes) */
function useNarrowerThan(ref: RefObject<HTMLElement | null>, px: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setNarrow(el.clientWidth < px);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, px]);
  return narrow;
}

/** some block of the diagram is (partly) outside the canvas's visible area */
function outOfView(host: HTMLElement | null): boolean {
  const pane = host?.querySelector('.react-flow');
  if (!pane) return false;
  const box = pane.getBoundingClientRect();
  return Array.from(pane.querySelectorAll('.react-flow__node')).some((node) => {
    const r = node.getBoundingClientRect();
    return r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > box.bottom;
  });
}

const blockSet = (ir: IR) => [...nodeIds(ir)].sort().join('\n');

/**
 * The diagram stays in view as blocks come and go (a drop, typed code, the
 * solution): when one lands outside the visible area, the canvas fits the
 * view. Nothing moves while the learner drags, or when everything is in view.
 */
function useDiagramInView(canvas: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = useEditor.subscribe((state, prev) => {
      if (state.ir === prev.ir || blockSet(state.ir) === blockSet(prev.ir)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!isCanvasDragging() && outOfView(canvas.current)) canvasApi()?.fitView();
      }, 400);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [canvas]);
}

/** The editor's keys, outside fields and Monaco (which handle their own): undo / redo, panels, Esc, fit view. */
function useEditorKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable], .monaco-editor')) return;
      if (e.key === 'Escape') {
        // a dialog, menu or panel on top owns Esc (the layer stack closes it)
        if (e.defaultPrevented || hasOpenLayer()) return;
        if (useLayout.getState().drawer) useLayout.getState().closeDrawer();
        else if (useEditor.getState().selection) useEditor.getState().setSelection(null);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (hasOpenLayer(['modal']) && !(mod && (key === 'z' || key === 'y'))) return;
      if (mod && !e.shiftKey && (key === 'b' || key === 'j' || key === 'i')) {
        e.preventDefault();
        useLayout.getState().toggle(key === 'b' ? 'palette' : key === 'j' ? 'code' : 'inspector');
      } else if (e.shiftKey && !mod && (e.code === 'Digit1' || e.key === '!')) {
        e.preventDefault();
        canvasApi()?.fitView();
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        useEditor.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function LessonWorkspace({ lesson }: { lesson: Lesson }) {
  const m = useMessages(playerMessages);
  const areaRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panels = useLayout((s) => s.panels);
  const compact = useLayout((s) => s.compact);
  const drawer = useLayout((s) => s.drawer);
  const split = useLayout((s) => s.split);
  const floatingSlot = useLayout(floatingInspectorSlot);
  const docked = useLayout(dockedInspector);
  const securitySlot = useLayout(securityPanelSlot);
  const selection = useEditor((s) => s.selection);
  const selectionOrigin = useEditor((s) => s.selectionOrigin);
  const securityPanel = useSecurityUi((s) => s.panelOpen);
  const dragging = useCanvasDrag((s) => s.kind !== null);

  // the lesson's layout while it's on screen; the editor's own comes back after
  useLayoutEffect(() => {
    const giveBack = useLayout.getState().borrow({ ...LESSON_LAYOUT, ...MODE_LAYOUT[lesson.mode] });
    useLayout.getState().setEditorLayout(true);
    return () => {
      useLayout.getState().setEditorLayout(false);
      giveBack();
    };
  }, [lesson.mode]);

  // compact by the room this area has (the lesson panel takes its share of the window)
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const apply = () => useLayout.getState().setCompact(el.clientWidth < WIDE_MIN);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // a code lesson on a compact screen: the code it asks for is open from the start (a drawer over the canvas)
  useEffect(() => {
    if (lesson.mode === 'code' && useLayout.getState().compact) useLayout.getState().show('code');
  }, [lesson.mode]);

  useEditorKeys();
  useCanvasDragTracking(canvasRef);
  useRevealOpensCode(() => useLayout.getState().show('code'));
  useKeepSelectionVisible();
  useDiagramInView(canvasRef);

  // a hidden canvas stays mounted (viewport and canvas actions keep working) but out of reach
  useEffect(() => {
    canvasRef.current?.toggleAttribute('inert', !panels.canvas);
  }, [panels.canvas]);

  // one floating panel at a time on a narrow canvas, as in the editor: the security panel covers
  // the inspector while it's open, and a resource picked meanwhile closes it for the inspector
  const onePanel = useNarrowerThan(canvasRef, BOTH_PANELS);
  const securityShown = securityPanel && securitySlot && panels.canvas;
  const seen = useRef({ selection, securityShown });
  useEffect(() => {
    const before = seen.current;
    seen.current = { selection, securityShown };
    if (onePanel && securityShown && before.securityShown && selection !== null && selection !== before.selection) {
      useSecurityUi.getState().setPanel(false);
    }
  }, [onePanel, selection, securityShown]);
  const inspectorYields = onePanel && securityShown;

  /** code pane splitter */
  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const codeOnLeft = useLayout.getState().codeSide === 'left';
    let last = useLayout.getState().split;
    const onMove = (ev: PointerEvent) => {
      const fromLeft = ((ev.clientX - rect.left) / rect.width) * 100;
      last = codeOnLeft ? fromLeft : 100 - fromLeft;
      useLayout.getState().setSplit(last, false);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      useLayout.getState().setSplit(last);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const wide = !compact;
  const canvasShown = panels.canvas;
  const codeSide = useLayout((s) => s.codeSide);
  const paletteSide = useLayout((s) => s.paletteSide);
  const minimizeInspector = () => {
    useLayout.getState().setVisible('inspector', false);
    focusSoon('[data-strip="inspector"]');
  };
  // a block picked on the canvas opens the inspector; the caret moving through the code (which picks
  // the block it's in) leaves the code its whole column while the learner types
  const dockedEl =
    docked && panels.inspector && selection && selectionOrigin === 'canvas' ? (
      <div className="flex min-h-0 flex-[3] flex-col border-b bg-surface-1" data-testid="docked-inspector">
        <Inspector docked onMinimize={minimizeInspector} />
      </div>
    ) : null;
  const codePane = (
    <Suspense fallback={<CodeFallback />}>
      <CodePane controls={<CodePaneControls />} wrap />
    </Suspense>
  );
  const securityEl =
    securityPanel && securitySlot ? (
      <div className={cn('absolute bottom-[68px] left-3 top-3 z-20 flex w-[min(340px,calc(100%-24px))] transition-opacity', FLOAT_CHROME)}>
        <SecurityPanel />
      </div>
    ) : null;

  const canvasSlot = (
    <div
      key="canvas"
      id={CANVAS_TARGET}
      ref={canvasRef}
      tabIndex={-1}
      data-dragging={dragging || undefined}
      className={cn(
        'group/canvas flex min-w-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        canvasShown ? 'relative flex-1' : 'pointer-events-none absolute inset-0 -z-10 opacity-0',
      )}
    >
      <div className="relative min-w-0 flex-1">
        <CanvasPane templates={false} />
        {wide && canvasShown ? <CanvasLayoutControls /> : null}
        {floatingSlot && selection && !inspectorYields ? (
          <div
            className={cn('absolute bottom-3 right-3 top-3 z-20 flex transition-opacity', FLOAT_CHROME)}
            style={{ width: `min(${INSPECTOR_WIDTH}px, calc(100% - 24px))` }}
          >
            <div className="bp-drawer-right flex min-w-0 flex-1">
              <Inspector onMinimize={minimizeInspector} />
            </div>
          </div>
        ) : null}
        {!panels.inspector && selection && canvasShown ? <InspectorTab /> : null}
        {canvasShown ? securityEl : null}
      </div>
    </div>
  );

  /**
   * Wide, with the canvas on screen: the code (and the inspector above it) is a full-height column
   * beside the canvas, the terminal docked under the palette and the canvas, where its plan is drawn.
   */
  const side: ReactNode[] = [];
  if (wide && canvasShown) {
    if (panels.code) {
      side.push(
        <div
          key="separator"
          role="separator"
          aria-orientation="vertical"
          aria-label={m.resizeCode}
          className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60 active:bg-primary"
          onPointerDown={startDrag}
          onDoubleClick={() => useLayout.getState().setSplit(SPLIT_DEFAULT)}
        />,
        <div key="code" className="flex min-w-[300px] shrink-0 flex-col" style={{ width: `${split}%` }}>
          {dockedEl}
          <div id={CODE_TARGET} tabIndex={-1} className="min-h-0 flex-[2] outline-none">
            {codePane}
          </div>
        </div>,
      );
    } else {
      side.push(<CollapsedStrip key="code-strip" panel="code" edge={codeSide === 'right' ? 'left' : 'right'} />);
      // the code is hidden: the inspector keeps a column of its own
      if (dockedEl) {
        side.push(
          <div key="inspector" className="flex shrink-0 flex-col border-l" style={{ width: INSPECTOR_WIDTH }}>
            {dockedEl}
          </div>,
        );
      }
    }
    if (codeSide === 'left') side.reverse();
  }

  // the canvas hidden: the code takes its place
  const stageCode =
    wide && !canvasShown
      ? [
          <div key="code" id={CODE_TARGET} tabIndex={-1} className="min-w-0 flex-1 outline-none">
            {codePane}
          </div>,
          <CollapsedStrip key="canvas-strip" panel="canvas" edge={codeSide === 'right' ? 'right' : 'left'} />,
        ]
      : [];
  if (codeSide === 'left') stageCode.reverse();

  const main = (
    <main key="main" className="relative isolate flex min-w-0 flex-1" aria-label={m.editor}>
      {codeSide === 'left' ? [...stageCode, canvasSlot] : [canvasSlot, ...stageCode]}
      {canvasShown ? null : securityEl}
      {compact && drawer === 'palette' ? (
        <div
          className={cn(
            'absolute bottom-0 top-0 z-30 flex shadow-lg',
            paletteSide === 'left' ? 'bp-drawer-left left-0' : 'bp-drawer-right right-0',
          )}
        >
          <Palette />
        </div>
      ) : null}
      {compact && drawer === 'code' && canvasShown ? (
        <div
          id={CODE_TARGET}
          tabIndex={-1}
          className={cn(
            'absolute bottom-0 top-0 z-30 w-[min(560px,94%)] shadow-lg outline-none',
            codeSide === 'right' ? 'bp-drawer-right right-0 border-l' : 'bp-drawer-left left-0 border-r',
          )}
        >
          {codePane}
        </div>
      ) : null}
    </main>
  );
  const palette = wide ? (
    panels.palette ? (
      <Palette key="palette" />
    ) : (
      <CollapsedStrip key="palette" panel="palette" side={paletteSide} edge={paletteSide === 'left' ? 'right' : 'left'} />
    )
  ) : null;
  const stage = (
    <div key="stage" className="flex min-w-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1">{paletteSide === 'left' ? [palette, main] : [main, palette]}</div>
      <Terminal slug={lesson.slug} />
    </div>
  );

  return (
    <div ref={areaRef} className="flex h-full min-w-0 flex-1 flex-col">
      <LessonToolbar lesson={lesson} />
      <div id={WORKSPACE_ID} ref={splitRef} className="relative flex min-h-0 flex-1">
        {codeSide === 'left' ? [...side, stage] : [stage, ...side]}
        <PanelDropZones />
      </div>
      <RulesEditor />
      <ExportPdfHost />
    </div>
  );
}

/** the terminal re-renders with the code; nothing else around it has to */
function Terminal({ slug }: { slug: string }) {
  const files = useEditor((s) => s.files);
  return <TerminalPanel slug={slug} files={files} className="shrink-0 border-t" />;
}

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2 text-[12.5px] font-medium transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40',
        pressed ? 'bg-surface-2 text-foreground' : 'text-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function LessonToolbar({ lesson }: { lesson: Lesson }) {
  const m = useMessages(playerMessages);
  const navigate = useNavigate();
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  // re-render on any layout change; isOpen() answers per mode (column or drawer)
  useLayout((s) => `${s.compact}:${s.drawer}:${s.panels.palette}${s.panels.canvas}${s.panels.code}`);
  const isOpen = useLayout.getState().isOpen;
  const toggle = useLayout((s) => s.toggle);
  const securityOpen = useSecurityUi((s) => s.panelOpen);
  const audit = useProjectAudit();
  const urgent = audit.counts.critical + audit.counts.high;
  const gradeColor = audit.grade ? GRADE_COLORS[audit.grade] : undefined;

  const openInEditor = () => {
    const id = lessonAsProject(lesson);
    if (id) navigate(`/editor/${id}`);
  };

  return (
    // labels give way to icons as the editor area narrows (the lesson panel takes its share of the window)
    <div role="toolbar" aria-label={m.toolbar} className="@container flex h-11 shrink-0 items-center gap-0.5 border-b bg-surface-1 px-2">
      <ToolButton label={m.undoLabel(shortcut('mod', 'Z'))} disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
        <Undo2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton label={m.redoLabel(shortcut('mod', 'shift', 'Z'))} disabled={!canRedo} onClick={() => useEditor.getState().redo()}>
        <Redo2 className="h-4 w-4" />
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <ToolButton label={`${m.resources} (${shortcut('mod', 'B')})`} pressed={isOpen('palette')} onClick={() => toggle('palette')}>
        <PanelLeft className="h-4 w-4" />
        <span className="@max-xl:hidden">{m.resources}</span>
      </ToolButton>
      <ToolButton label={`${m.code} (${shortcut('mod', 'J')})`} pressed={isOpen('code')} onClick={() => toggle('code')}>
        <Code2 className="h-4 w-4" />
        <span className="@max-xl:hidden">{m.code}</span>
      </ToolButton>
      <ToolButton
        label={m.securityLabel(audit.grade ?? null, urgent)}
        pressed={securityOpen}
        onClick={() => useSecurityUi.getState().setPanel(!securityOpen)}
      >
        <ShieldCheck className="h-4 w-4" style={{ color: gradeColor }} />
        <span className="@max-3xl:hidden">{m.security}</span>
        {audit.grade ? (
          <span className="font-semibold" style={{ color: gradeColor }}>
            {audit.grade}
          </span>
        ) : null}
        {urgent > 0 ? (
          <span className="rounded-full bg-danger-solid px-1.5 text-[10px] font-bold leading-4 text-white">{urgent}</span>
        ) : null}
      </ToolButton>
      <span className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        onClick={openInEditor}
        title={m.openInEditorHint}
        aria-label={m.openInEditor}
        className="shrink-0 whitespace-nowrap"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span className="@max-lg:hidden">{m.openInEditor}</span>
      </Button>
      <span className="ml-1 flex items-center">
        <LanguageSwitcher compact />
        <ThemeToggle />
      </span>
    </div>
  );
}
