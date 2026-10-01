import { useEffect, useRef, useState, type ReactNode } from 'react';
import { lineColOf } from '@/hcl/parser';
import { childFileDiagnostics } from '@/ir/localModules';
import { findNode } from '@/ir/modules';
import { useLocale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { codeMessages } from './CodePane.messages';
import { ensureMonacoSetup, monaco, setCompletionSource } from './monaco/setup';
import { orderedFiles, readOnlyHint, useEditor } from './store';

ensureMonacoSetup();

/** Apply newText to the model as a single minimal splice (keeps cursors sane). */
function applyMinimalEdit(model: monaco.editor.ITextModel, newText: string) {
  const oldText = model.getValue();
  if (oldText === newText) return;
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText[start] === newText[start]) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld--;
    endNew--;
  }
  const from = model.getPositionAt(start);
  const to = model.getPositionAt(endOld);
  model.applyEdits([
    {
      range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
      text: newText.slice(start, endNew),
    },
  ]);
}

/** `controls`: layout buttons for the header (grip, expand, hide) — the editor passes them, the viewer doesn't. */
export function CodePane({ controls }: { controls?: ReactNode } = {}) {
  const m = useMessages(codeMessages);
  const locale = useLocale((s) => s.locale);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
  const suppressRef = useRef(false);

  const projectId = useEditor((s) => s.projectId);
  const files = useEditor((s) => s.files);
  const filesRevision = useEditor((s) => s.filesRevision);
  const activeFile = useEditor((s) => s.activeFile);
  const setActiveFile = useEditor((s) => s.setActiveFile);
  const parseDiagnostics = useEditor((s) => s.parseDiagnostics);
  const warnings = useEditor((s) => s.warnings);
  const selection = useEditor((s) => s.selection);
  const selectionOrigin = useEditor((s) => s.selectionOrigin);
  const revealSeq = useEditor((s) => s.revealSeq);
  const readOnly = useEditor((s) => s.readOnly);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  /** resource waiting to be scrolled into view once its file's model is active */
  const pendingRevealRef = useRef<string | null>(null);
  const flashRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  /**
   * The editor was just created (the pane opened to show a block): a smooth
   * scroll started before its first frame stops short, and there is nothing
   * to animate from anyway — jump.
   */
  const freshRef = useRef(true);

  const fileList = orderedFiles(files);

  const getModel = (file: string): monaco.editor.ITextModel => {
    const key = `${projectId}:${file}`;
    let model = modelsRef.current.get(key);
    if (!model || model.isDisposed()) {
      model = monaco.editor.createModel(
        files[file] ?? '',
        'hcl',
        monaco.Uri.parse(`inmemory://blueprint/${projectId ?? 'p'}/${file}`),
      );
      model.onDidChangeContent(() => {
        if (suppressRef.current) return;
        useEditor.getState().onCodeChange(file, model!.getValue());
      });
      modelsRef.current.set(key, model);
    }
    return model;
  };

  // create the editor once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setCompletionSource(() => useEditor.getState().ir);
    // Monaco holds on to the last editor it created; a host node we own (and
    // detach on unmount) keeps that reference from pinning the whole page
    const host = document.createElement('div');
    host.style.height = '100%';
    container.appendChild(host);
    const editor = monaco.editor.create(host, {
      model: null,
      language: 'hcl',
      fontFamily: "'JetBrains Mono Variable', 'Cascadia Code', monospace",
      fontSize: 12.5,
      lineHeight: 1.7,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      insertSpaces: true,
      padding: { top: 10, bottom: 10 },
      renderLineHighlight: 'line',
      smoothScrolling: !prefersReducedMotion(),
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      guides: { indentation: true },
      wordBasedSuggestions: 'off',
      quickSuggestions: { other: true, strings: true, comments: false },
      fixedOverflowWidgets: true,
      readOnly: useEditor.getState().readOnly,
      domReadOnly: useEditor.getState().readOnly,
      readOnlyMessage: { value: readOnlyHint() },
    });
    // code → canvas: explicit caret moves (click, arrows) select the enclosing resource
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    editor.onDidChangeCursorPosition((e) => {
      setCursor({ line: e.position.lineNumber, col: e.position.column });
      if (e.reason !== monaco.editor.CursorChangeReason.Explicit) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        const model = editor.getModel();
        if (!model) return;
        const state = useEditor.getState();
        const offset = model.getOffsetAt(e.position);
        // module calls and data sources are picked like resources
        const hit = [...state.ir.resources, ...state.ir.modules, ...state.ir.data].find((r) => {
          const range = r.trivia.rawTextRange;
          return (
            range &&
            (r.trivia.sourceFile ?? 'main.tf') === state.activeFile &&
            offset >= range.start &&
            offset < range.end
          );
        });
        if (hit && hit.id !== state.selection) state.setSelection(hit.id, 'code');
      }, 120);
    });
    // one history for canvas and code: Monaco's own undo stack doesn't know
    // about the edits the canvas makes to the text
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => useEditor.getState().undo());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () =>
      useEditor.getState().redo(),
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => useEditor.getState().redo());
    editorRef.current = editor;
    freshRef.current = true;
    const settle = requestAnimationFrame(() => requestAnimationFrame(() => (freshRef.current = false)));

    // theme follows the app's dark class
    const el = document.documentElement;
    const applyTheme = () =>
      monaco.editor.setTheme(el.classList.contains('dark') ? 'blueprint-dark' : 'blueprint-light');
    applyTheme();
    const observer = new MutationObserver(applyTheme);
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });

    const models = modelsRef.current;
    return () => {
      clearTimeout(syncTimer);
      cancelAnimationFrame(settle);
      observer.disconnect();
      editor.dispose();
      host.remove();
      for (const model of models.values()) model.dispose();
      models.clear();
      editorRef.current = null;
    };
  }, []);

  // a read-only view: the code can be read, selected and copied — not typed into
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly, domReadOnly: readOnly });
  }, [readOnly]);

  // a language switch re-words the read-only tooltip in place (the editor, its models and undo stay);
  // the editor was created in the language in effect, so nothing to do until it changes
  const wordedIn = useRef(locale);
  useEffect(() => {
    if (wordedIn.current === locale) return;
    wordedIn.current = locale;
    editorRef.current?.updateOptions({ readOnlyMessage: { value: readOnlyHint() } });
  }, [locale]);

  // dispose stale models when switching projects
  useEffect(() => {
    for (const [key, model] of modelsRef.current) {
      if (!key.startsWith(`${projectId}:`)) {
        model.dispose();
        modelsRef.current.delete(key);
      }
    }
  }, [projectId]);

  // active model + external text updates (canvas ops, undo, load)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !projectId) return;
    suppressRef.current = true;
    try {
      for (const file of fileList) {
        const model = getModel(file);
        if (model.getValue() !== (files[file] ?? '')) {
          applyMinimalEdit(model, files[file] ?? '');
        }
      }
      const model = getModel(activeFile in files ? activeFile : (fileList[0] ?? 'main.tf'));
      if (editor.getModel() !== model) editor.setModel(model);
    } finally {
      suppressRef.current = false;
    }
    flushReveal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, activeFile, filesRevision]);

  /** canvas → code: scroll the pending resource's block into view and flash it */
  const flushReveal = () => {
    const editor = editorRef.current;
    const id = pendingRevealRef.current;
    if (!editor || !id) return;
    const state = useEditor.getState();
    const node = findNode(state.ir, id);
    const range = node?.trivia.rawTextRange;
    if (!node || !range) {
      pendingRevealRef.current = null;
      return;
    }
    const file = node.trivia.sourceFile ?? 'main.tf';
    if (state.activeFile !== file) {
      state.setActiveFile(file); // the model-switch effect calls flushReveal again
      return;
    }
    pendingRevealRef.current = null;
    const model = editor.getModel();
    if (!model) return;
    const start = model.getPositionAt(range.start).lineNumber;
    const end = model.getPositionAt(Math.max(range.start, range.end - 1)).lineNumber;
    editor.revealLinesInCenterIfOutsideViewport(
      start,
      end,
      freshRef.current ? monaco.editor.ScrollType.Immediate : monaco.editor.ScrollType.Smooth,
    );
    flashRef.current?.clear();
    flashRef.current = editor.createDecorationsCollection([
      {
        range: new monaco.Range(start, 1, end, 1),
        options: { isWholeLine: true, className: 'bp-code-flash', linesDecorationsClassName: 'bp-code-flash-gutter' },
      },
    ]);
  };

  useEffect(() => {
    if (!selection || selectionOrigin === 'code') return;
    pendingRevealRef.current = selection;
    flushReveal();
    const t = setTimeout(() => flashRef.current?.clear(), 1600);
    return () => clearTimeout(t);
  }, [selection, selectionOrigin, revealSeq]);

  // diagnostics → markers
  useEffect(() => {
    if (!projectId) return;
    const ir = useEditor.getState().ir;
    for (const file of fileList) {
      const model = modelsRef.current.get(`${projectId}:${file}`);
      if (!model) continue;
      const markers: monaco.editor.IMarkerData[] = [];
      // a child module's files aren't in the root parse: their own errors
      const fileDiagnostics = file.includes('/') ? childFileDiagnostics(files, file) : parseDiagnostics;
      for (const d of fileDiagnostics) {
        if (d.file !== file || !d.start) continue;
        markers.push({
          severity:
            d.severity === 'error'
              ? monaco.MarkerSeverity.Error
              : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: d.start.line,
          startColumn: d.start.col,
          endLineNumber: d.end?.line ?? d.start.line,
          endColumn: d.end?.col ?? d.start.col + 4,
        });
      }
      for (const w of warnings) {
        if (!w.nodeId) continue;
        const node = findNode(ir, w.nodeId);
        if (!node || (node.trivia.sourceFile ?? 'main.tf') !== file) continue;
        const range = node.trivia.rawTextRange;
        if (!range) continue;
        // validation points at the argument or block header when it can; otherwise
        // find the block's header line (the range starts at the block's leading comments)
        const text = files[file] ?? '';
        const header = text.slice(range.start, range.end).search(/^[ \t]*(?:resource|data|module)\b/m);
        const pos = w.start ?? lineColOf(text, range.start + Math.max(0, header));
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          message: w.message,
          startLineNumber: pos.line,
          startColumn: w.start ? pos.col : 1,
          endLineNumber: w.end?.line ?? pos.line,
          endColumn: w.end?.col ?? 80,
        });
      }
      monaco.editor.setModelMarkers(model, 'blueprint', markers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parseDiagnostics, warnings, filesRevision, projectId]);

  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // scroll the strip itself: scrollIntoView would also move the page and
    // the browser's Tab starting point
    const strip = tabsRef.current;
    const tab = strip?.querySelector<HTMLElement>(`[data-file="${CSS.escape(activeFile)}"]`);
    if (!strip || !tab) return;
    const s = strip.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < s.left) strip.scrollLeft -= s.left - t.left + 8;
    else if (t.right > s.right) strip.scrollLeft += t.right - s.right + 8;
  }, [activeFile]);

  const fileErrors = (file: string) =>
    parseDiagnostics.some((d) => d.file === file && d.severity === 'error');

  return (
    <section className="flex h-full min-w-0 flex-col bg-surface-1" aria-label={m.terraformCode}>
      <div className="flex items-center border-b">
        <div ref={tabsRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1.5 pt-1" role="tablist" aria-label={m.files}>
          {fileList.map((f, i) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={activeFile === f}
              data-file={f}
              onClick={() => setActiveFile(f)}
              className={cn(
                'relative shrink-0 rounded-t-[6px] border border-b-0 px-3 py-1.5 font-mono text-[11.5px] transition-colors',
                activeFile === f
                  ? 'border-border bg-surface-1 font-semibold text-foreground'
                  : 'border-transparent text-muted hover:text-foreground',
                // child module files come after the root module's, set apart
                f.includes('/') && !fileList[i - 1]?.includes('/') && i > 0 && 'ml-2.5 before:absolute before:-left-2 before:top-2 before:h-3.5 before:w-px before:bg-border-strong',
              )}
            >
              {f.includes('/') ? (
                <>
                  <span className="font-normal text-faint">{f.slice(0, f.lastIndexOf('/') + 1)}</span>
                  {f.slice(f.lastIndexOf('/') + 1)}
                </>
              ) : (
                f
              )}
              {fileErrors(f) ? (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-danger" />
              ) : null}
              {activeFile === f ? (
                <span className="absolute inset-x-0 -bottom-px h-px bg-surface-1" />
              ) : null}
            </button>
          ))}
        </div>
        {controls ? <div className="flex shrink-0 items-center gap-0.5 px-1.5">{controls}</div> : null}
      </div>

      <div ref={containerRef} className="min-h-0 flex-1" data-testid="monaco" />

      <div className="flex items-center justify-between border-t px-3 py-1 text-[10.5px] text-faint">
        <span className="flex gap-3">
          <span>HCL</span>
          <span>UTF-8</span>
        </span>
        <span>{m.position(cursor.line, cursor.col)}</span>
      </div>
    </section>
  );
}
