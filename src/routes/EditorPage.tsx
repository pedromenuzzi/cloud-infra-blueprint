import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { hasOpenLayer } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { codeMessages } from '@/features/editor/CodePane.messages';
import { useCanvasDrag, useCanvasDragTracking } from '@/features/editor/canvasDrag';
import { CanvasPane, focusRenameInput } from '@/features/editor/CanvasPane';
import { dockedInspector, floatingInspectorSlot, INSPECTOR_WIDTH, securityPanelSlot } from '@/features/editor/inspectorPlacement';
import { useKeepSelectionVisible, useRevealOpensCode } from '@/features/editor/layoutEffects';
import { layoutMessages } from '@/features/editor/layout.messages';
import { SPLIT_DEFAULT } from '@/features/editor/layoutPrefs';
import { useLayout } from '@/features/editor/layoutStore';
import {
  CanvasLayoutControls,
  CodePaneControls,
  CollapsedStrip,
  FLOAT_CHROME,
  focusSoon,
  InspectorTab,
  PanelDropZones,
  WORKSPACE_ID,
} from '@/features/editor/PanelChrome';
import { ExportPdfHost } from '@/features/export/ExportPdfDialog';
import { RulesEditor } from '@/features/security/RulesEditor';
import { SecurityPanel } from '@/features/security/SecurityPanel';
import { useSecurityDelta } from '@/features/security/securityDelta';
import { useSecurityUi } from '@/features/security/securityStore';
import { Inspector } from '@/features/editor/Inspector';
import { Palette } from '@/features/editor/Palette';
import { Topbar } from '@/features/editor/Topbar';
import { loadProjectIntoEditor, useEditor } from '@/features/editor/store';
import { useMessages } from '@/i18n/messages';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { cn } from '@/lib/utils';
import { editorPageMessages } from './EditorPage.messages';

// Monaco is ~2 MB: split it out so the canvas paints while the code pane loads
const CodePane = lazy(() =>
  import('@/features/editor/CodePane').then((m) => ({ default: m.CodePane })),
);

function CodePaneFallback() {
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

const CANVAS_TARGET = 'bp-canvas';
const CODE_TARGET = 'bp-code';

/** Focus `find()` as soon as it exists (the code pane loads lazily); else the fallback. */
function focusWhenReady(find: () => HTMLElement | null, fallback: () => HTMLElement | null) {
  const start = performance.now();
  const tick = () => {
    const el = find();
    if (el) el.focus();
    else if (performance.now() - start < 4000) requestAnimationFrame(tick);
    else fallback()?.focus();
  };
  tick();
}

/** First Tab stops on the page: jump past the topbar and palette. */
function SkipLinks() {
  const m = useMessages(editorPageMessages);
  const toCanvas = (e: React.MouseEvent) => {
    e.preventDefault();
    const layout = useLayout.getState();
    if (!layout.panels.canvas) layout.setVisible('canvas', true);
    requestAnimationFrame(() => document.getElementById(CANVAS_TARGET)?.focus());
  };
  const toCode = (e: React.MouseEvent) => {
    e.preventDefault();
    const layout = useLayout.getState();
    if (!layout.isOpen('code')) layout.toggle('code');
    focusWhenReady(
      () => document.querySelector<HTMLElement>(`#${CODE_TARGET} .monaco-editor textarea`),
      () => document.getElementById(CODE_TARGET),
    );
  };
  const cls =
    'sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[90] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-primary-fg focus:shadow-lg focus:outline-2 focus:outline-offset-2 focus:outline-primary';
  return (
    <>
      <a href={`#${CANVAS_TARGET}`} onClick={toCanvas} className={cls}>
        {m.skipToCanvas}
      </a>
      <a href={`#${CODE_TARGET}`} onClick={toCode} className={cls}>
        {m.skipToCode}
      </a>
    </>
  );
}

/** The docked inspector's column when nothing is selected. */
function DockedEmpty() {
  const m = useMessages(layoutMessages);
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] leading-relaxed text-faint">
      {m.dockedEmpty}
    </div>
  );
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const m = useMessages(editorPageMessages);
  const [ready, setReady] = useState(false);
  const splitRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panels = useLayout((s) => s.panels);
  const compact = useLayout((s) => s.compact);
  const drawer = useLayout((s) => s.drawer);
  const paletteSide = useLayout((s) => s.paletteSide);
  const codeSide = useLayout((s) => s.codeSide);
  const split = useLayout((s) => s.split);
  const floatingSlot = useLayout(floatingInspectorSlot);
  const docked = useLayout(dockedInspector);
  const securitySlot = useLayout(securityPanelSlot);
  const selection = useEditor((s) => s.selection);
  const securityPanel = useSecurityUi((s) => s.panelOpen);
  const dragging = useCanvasDrag((s) => s.kind !== null);
  useDocumentTitle(useEditor((s) => s.projectName));
  useSecurityDelta();
  useCanvasDragTracking(canvasRef, ready);
  useRevealOpensCode(() => useLayout.getState().show('code'));
  useKeepSelectionVisible();

  // the configurable layout (docking, hidden canvas) applies while this page is up
  useEffect(() => {
    useLayout.getState().setEditorLayout(true);
    return () => useLayout.getState().setEditorLayout(false);
  }, []);

  // compact layout below 1100px: canvas full-width, palette/code as drawers
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1099px)');
    const apply = () => useLayout.getState().setCompact(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!id || !loadProjectIntoEditor(id)) {
      navigate('/dashboard', { replace: true });
      return;
    }
    setReady(true);
  }, [id, navigate]);

  // global undo/redo (outside inputs & Monaco, which handle their own)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('input, textarea, select, [contenteditable], .monaco-editor') !== null
      ) {
        return;
      }
      if (e.key === 'Escape') {
        // a dialog, menu or panel on top owns Esc (the layer stack closes it)
        if (e.defaultPrevented || hasOpenLayer()) return;
        if (useLayout.getState().drawer) useLayout.getState().closeDrawer();
        else if (useEditor.getState().selection) useEditor.getState().setSelection(null);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // behind a modal dialog only undo/redo still apply (dialog edits are undoable)
      if (hasOpenLayer(['modal']) && !(mod && (key === 'z' || key === 'y'))) return;
      const selected = useEditor.getState().selection;
      if (mod && !e.shiftKey && (key === 'b' || key === 'j' || key === 'i')) {
        e.preventDefault();
        useLayout.getState().toggle(key === 'b' ? 'palette' : key === 'j' ? 'code' : 'inspector');
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        if (selected) canvasApi()?.duplicate(selected);
        return;
      }
      if (!mod && e.key === 'F2' && selected) {
        e.preventDefault();
        if (!useLayout.getState().panels.inspector) useLayout.getState().toggle('inspector');
        focusRenameInput();
        return;
      }
      if (e.shiftKey && !mod && (e.code === 'Digit1' || e.key === '!')) {
        e.preventDefault();
        canvasApi()?.fitView();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useEditor.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // a hidden canvas stays mounted (viewport, exports and canvas actions keep working) but out of reach
  useEffect(() => {
    canvasRef.current?.toggleAttribute('inert', !panels.canvas);
  }, [panels.canvas, ready]);

  /** code pane splitter: drags from either side of the canvas */
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

  if (!ready) return null;

  const minimizeInspector = () => {
    useLayout.getState().setVisible('inspector', false);
    focusSoon('[data-strip="inspector"]');
  };
  const wide = !compact;
  const canvasShown = panels.canvas;
  /** the code pane as a column beside the canvas (wide) or, with the canvas hidden, as the whole stage */
  const codeColumn = canvasShown ? wide && panels.code : true;
  const codePane = (
    <Suspense fallback={<CodePaneFallback />}>
      <CodePane controls={<CodePaneControls />} />
    </Suspense>
  );

  const securityEl =
    securityPanel && securitySlot ? (
      <div
        className={cn(
          'absolute bottom-[68px] left-3 top-3 z-20 flex w-[min(340px,calc(100%-24px))] transition-opacity',
          FLOAT_CHROME,
        )}
      >
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
        'group/canvas flex min-w-0 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        canvasShown ? 'relative' : 'pointer-events-none absolute inset-0 -z-10 opacity-0',
        canvasShown && !codeColumn && 'flex-1',
      )}
      style={canvasShown && codeColumn ? { width: `${100 - split}%` } : undefined}
    >
      <div className="relative min-w-0 flex-1">
        <CanvasPane />
        {wide && canvasShown ? <CanvasLayoutControls /> : null}
        {floatingSlot && selection ? (
          <div
            className={cn('absolute bottom-3 right-3 top-3 z-20 flex transition-opacity', FLOAT_CHROME)}
            style={{ width: `min(${INSPECTOR_WIDTH}px, calc(100% - 24px))` }}
          >
            <div className="bp-drawer-right flex min-w-0 flex-1">
              <Inspector onMinimize={minimizeInspector} />
            </div>
          </div>
        ) : null}
        {!panels.inspector && selection && canvasShown && !docked ? <InspectorTab /> : null}
        {canvasShown ? securityEl : null}
      </div>
      {docked ? (
        panels.inspector ? (
          <div className="flex shrink-0 flex-col border-l bg-surface-1" style={{ width: INSPECTOR_WIDTH }} data-testid="docked-inspector">
            {selection ? (
              <Inspector docked onMinimize={minimizeInspector} />
            ) : (
              <DockedEmpty />
            )}
          </div>
        ) : (
          <CollapsedStrip panel="inspector" edge="left" />
        )
      ) : null}
    </div>
  );

  const codeSlot: ReactNode[] = [];
  if (codeColumn) {
    if (canvasShown) {
      codeSlot.push(
        <div
          key="separator"
          role="separator"
          aria-orientation="vertical"
          aria-label={m.resizeCode}
          className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60 active:bg-primary"
          onPointerDown={startDrag}
          onDoubleClick={() => useLayout.getState().setSplit(SPLIT_DEFAULT)}
        />,
      );
    }
    codeSlot.push(
      <div
        key="code"
        id={CODE_TARGET}
        tabIndex={-1}
        className={cn('min-w-[300px] outline-none', !canvasShown && 'min-w-0 flex-1')}
        style={canvasShown ? { width: `${split}%` } : undefined}
      >
        {codePane}
      </div>,
    );
  } else if (wide) {
    codeSlot.push(<CollapsedStrip key="code-strip" panel="code" edge={codeSide === 'right' ? 'left' : 'right'} />);
  }
  // the separator always sits between the canvas and the code
  if (codeSide === 'left') codeSlot.reverse();

  const canvasColumn: ReactNode[] = [canvasSlot];
  if (!canvasShown && wide) {
    canvasColumn.push(<CollapsedStrip key="canvas-strip" panel="canvas" edge={codeSide === 'right' ? 'right' : 'left'} />);
  }
  const mainChildren = codeSide === 'left' ? [...codeSlot, ...canvasColumn] : [...canvasColumn, ...codeSlot];

  const main = (
    <main key="main" ref={splitRef} className="relative isolate flex min-w-0 flex-1" aria-label={m.main}>
      <h1 className="sr-only">{m.heading}</h1>
      {mainChildren}
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

  return (
    <div className="flex h-full flex-col">
      <SkipLinks />
      <Topbar />
      <div id={WORKSPACE_ID} className="relative flex min-h-0 flex-1">
        {paletteSide === 'left' ? [palette, main] : [main, palette]}
        <PanelDropZones />
      </div>
      <RulesEditor />
      <ExportPdfHost />
    </div>
  );
}
