/**
 * The opened module's bar, on top of the canvas (the canvas itself then
 * shows the module's blocks and edits them like the root module's, see the
 * editor store's `scope`): the way back (`root › service › ecr`, Esc goes
 * one level up once nothing is selected), what the module holds, its
 * interface (inputs, required or not, and outputs) and its code.
 */
import { ArrowLeft, ChevronDown, ChevronRight, Code2, Eye } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { hasOpenLayer, useLayer } from '@/components/ui';
import { useLayout } from '@/features/editor/layoutStore';
import { useEditor } from '@/features/editor/store';
import { useSecurityUi } from '@/features/security/securityStore';
import { useMessages } from '@/i18n/messages';
import { exprPreview } from '@/ir/expr';
import { readLocalModule, type LocalModule } from '@/ir/localModules';
import { cn } from '@/lib/utils';
import { moduleViewMessages } from './ModuleView.messages';
import { moduleViewBack, moduleViewTo, useModuleView } from './moduleViewStore';

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .monaco-editor';

/** Esc on the canvas: the selection goes first (the page clears it), then one level up. */
function useEscapeGoesUp() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || hasOpenLayer()) return;
      if ((e.target as HTMLElement).closest?.(EDITABLE)) return;
      if (useEditor.getState().selection || useLayout.getState().drawer || useSecurityUi.getState().panelOpen) return;
      if (document.querySelector('[role="menu"], [data-bp-tooltip]')) return;
      // the Esc is ours: a focused canvas node would otherwise take it too (React Flow unselects on it)
      e.preventDefault();
      e.stopPropagation();
      moduleViewBack();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

function InterfacePopover({ child, onClose, anchor }: { child: LocalModule; onClose(): void; anchor: React.RefObject<HTMLElement | null> }) {
  const m = useMessages(moduleViewMessages);
  const ref = useRef<HTMLDivElement>(null);
  useLayer(true, onClose, { kind: 'popup', node: ref });
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, [anchor, onClose]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={m.interface}
      className="bp-pop-in nowheel nodrag nopan absolute left-1/2 top-full z-20 mt-2 w-[min(320px,calc(100vw-32px))] -translate-x-1/2 rounded-[12px] border bg-surface-1 text-left shadow-xl"
    >
      <div className="max-h-[50vh] space-y-3 overflow-y-auto px-3 pb-3 pt-2.5">
        <section>
          <h3 className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.inputs(child.variables.length)}</h3>
          {child.variables.length === 0 ? <p className="text-[11.5px] text-faint">{m.noInputs}</p> : null}
          <ul className="space-y-1">
            {child.variables.map((v) => (
              <li key={v.name} className="rounded-[7px] bg-surface-2 px-2 py-1">
                <span className="flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-semibold">{v.name}</code>
                  <span className={cn('text-[10px] font-semibold uppercase tracking-wide', v.required ? 'text-warning' : 'text-muted')}>
                    {v.required ? m.required : m.optional}
                  </span>
                </span>
                {v.type || v.default || v.description ? (
                  <span className="block truncate font-mono text-[10px] text-muted" title={v.description}>
                    {[v.type, v.default ? `= ${exprPreview(v.default)}` : '', v.description ? `· ${v.description}` : ''].filter(Boolean).join(' ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.outputs(child.outputs.length)}</h3>
          {child.outputs.length === 0 ? <p className="text-[11.5px] text-faint">{m.noOutputs}</p> : null}
          <ul className="space-y-1">
            {child.outputs.map((o) => (
              <li key={o.name} className="rounded-[7px] bg-surface-2 px-2 py-1">
                <code className="block truncate font-mono text-[11.5px] font-semibold">{o.name}</code>
                {o.description ? <span className="block truncate text-[10px] text-muted">{o.description}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

const PILL =
  'inline-flex items-center gap-1 rounded-full border bg-surface-1/90 px-2.5 py-1 text-[11.5px] font-semibold shadow-xs backdrop-blur-md transition-colors';

export default function ModuleView() {
  const m = useMessages(moduleViewMessages);
  const path = useModuleView((s) => s.path);
  const files = useEditor((s) => s.files);
  const readOnly = useEditor((s) => s.readOnly);
  const [showInterface, setShowInterface] = useState(false);
  const interfaceButton = useRef<HTMLButtonElement>(null);
  const interfaceId = useId();
  useEscapeGoesUp();
  const current = path[path.length - 1];
  if (!current) return null;
  const child = readLocalModule(files, current.dir);
  const up = path.length > 1 ? path[path.length - 2].name : m.root;

  const openCode = () => {
    if (!child) return;
    useEditor.getState().setActiveFile(child.files.find((f) => f.endsWith('/main.tf')) ?? child.files[0]);
    useLayout.getState().show('code');
  };

  return (
    <section aria-label={m.label(current.name)} data-testid="module-view" className="relative flex max-w-full flex-wrap items-center justify-center gap-1">
      <button type="button" onClick={moduleViewBack} title={m.backTo(up)} className={cn(PILL, 'text-foreground hover:border-border-strong')}>
        <ArrowLeft className="h-3.5 w-3.5" /> {m.back}
      </button>
      <nav aria-label={m.path} className={cn(PILL, 'min-w-0 max-w-full font-medium')}>
        <ol className="flex min-w-0 flex-wrap items-center gap-0.5">
          <li>
            <button type="button" onClick={() => moduleViewTo(0)} className="rounded-[5px] px-1 text-primary hover:underline">
              {m.root}
            </button>
          </li>
          {path.map((p, i) => (
            <li key={`${i}:${p.dir}`} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight className="h-3 w-3 shrink-0 text-faint" aria-hidden="true" />
              {i === path.length - 1 ? (
                <span aria-current="page" className="truncate font-semibold text-foreground" title={current.dir}>
                  {p.name}
                </span>
              ) : (
                <button type="button" onClick={() => moduleViewTo(i + 1)} className="truncate rounded-[5px] px-1 text-primary hover:underline">
                  {p.name}
                </button>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {child && !child.broken ? (
        <span className="relative">
          <button
            ref={interfaceButton}
            type="button"
            aria-expanded={showInterface}
            aria-haspopup="dialog"
            aria-controls={showInterface ? interfaceId : undefined}
            onClick={() => setShowInterface((v) => !v)}
            className={cn(PILL, 'text-muted hover:border-border-strong hover:text-foreground', showInterface && 'border-border-strong')}
          >
            {m.interfaceCounts(child.variables.length, child.outputs.length)}
            <ChevronDown className={cn('h-3 w-3 transition-transform', showInterface && 'rotate-180')} aria-hidden="true" />
          </button>
          {showInterface ? (
            <span id={interfaceId}>
              <InterfacePopover child={child} anchor={interfaceButton} onClose={() => setShowInterface(false)} />
            </span>
          ) : null}
        </span>
      ) : null}
      {child ? (
        <button type="button" onClick={openCode} className={cn(PILL, 'text-muted hover:border-primary/40 hover:text-primary')}>
          <Code2 className="h-3.5 w-3.5" /> {m.openCode}
        </button>
      ) : null}
      {readOnly ? (
        <span className={cn(PILL, 'font-bold uppercase tracking-wide text-muted')} title={m.readOnlyHint}>
          <Eye className="h-3 w-3" /> {m.readOnly}
        </span>
      ) : null}
    </section>
  );
}
