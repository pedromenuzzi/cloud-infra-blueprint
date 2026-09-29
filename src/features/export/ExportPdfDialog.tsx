/**
 * "Export PDF document": a shareable architecture document built in the
 * browser — the diagram plus a readable summary. The PDF code (archDoc.ts +
 * lib/pdf) is loaded only when the user actually generates one.
 */
import { AlertTriangle, CircleDollarSign, Code2, Download, FileText, ListTree, Loader2, ShieldCheck, Waypoints, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { create } from 'zustand';
import { showToast } from '@/components/Toast';
import { Button, Field, Input, Modal, Textarea } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { orderedFiles, useEditor } from '@/features/editor/store';
import { getAudit } from '@/features/security/securityStore';
import { downloadBlob } from '@/lib/download';
import { unsupportedChars } from '@/lib/pdf/metrics';
import { cn, slugify } from '@/lib/utils';
import type { DocSections, Paper } from './archDoc';
import type { DiagramVector } from './diagramVector';

const PREFS_KEY = 'cb-pdf-export';

interface Prefs {
  sections: DocSections;
  paper: Paper;
}

/** Letter in the Americas that use it, A4 everywhere else */
function defaultPaper(): Paper {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region && ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE'].includes(region) ? 'letter' : 'a4';
  } catch {
    return 'a4';
  }
}

function readPrefs(): Prefs {
  const fallback: Prefs = {
    // cost on: readers of the document ask what it costs first; every number is labelled an estimate
    sections: { inventory: true, connections: true, security: true, cost: true, code: false },
    paper: defaultPaper(),
  };
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return {
      sections: { ...fallback.sections, ...stored?.sections },
      paper: stored?.paper === 'letter' || stored?.paper === 'a4' ? stored.paper : fallback.paper,
    };
  } catch {
    return fallback;
  }
}

function writePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode */
  }
}

interface ExportPdfState {
  open: boolean;
  /** title + notes typed per project, kept for the session */
  drafts: Record<string, { title: string; notes: string }>;
}

const useExportPdf = create<ExportPdfState>(() => ({ open: false, drafts: {} }));

export function openExportPdf() {
  if (useEditor.getState().ir.resources.length === 0) {
    showToast('Nothing to export yet — add a resource first', 'info');
    return;
  }
  useExportPdf.setState({ open: true });
}

export function ExportPdfHost() {
  const open = useExportPdf((s) => s.open);
  return open ? <ExportPdfDialog onClose={() => useExportPdf.setState({ open: false })} /> : null;
}

const SECTION_ROWS: Array<{ key: keyof DocSections; icon: LucideIcon; title: string; hint: string }> = [
  { key: 'inventory', icon: ListTree, title: 'Resource inventory', hint: 'Every resource with its key settings, plus variables and outputs' },
  { key: 'connections', icon: Waypoints, title: 'Connections & traffic', hint: 'Dependencies and the network flows the rules allow' },
  { key: 'security', icon: ShieldCheck, title: 'Security review', hint: '' },
  { key: 'cost', icon: CircleDollarSign, title: 'Cost estimate', hint: 'Monthly on-demand estimate per resource, with its assumptions' },
  { key: 'code', icon: Code2, title: 'Terraform source', hint: 'Every .tf file as an appendix — check it for secrets before sharing' },
];

/** file-name friendly: accents dropped rather than turned into dashes */
function fileName(title: string): string {
  return `${slugify(title.normalize('NFD').replace(/[̀-ͯ]/g, ''))}-architecture.pdf`;
}

function ExportPdfDialog({ onClose }: { onClose(): void }) {
  const projectId = useEditor((s) => s.projectId) ?? '';
  const projectName = useEditor((s) => s.projectName);
  const ir = useEditor((s) => s.ir);
  const audit = getAudit(ir);
  const draft = useExportPdf.getState().drafts[projectId];
  const [title, setTitle] = useState(draft?.title ?? projectName);
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [prefs, setPrefs] = useState(readPrefs);
  const [stage, setStage] = useState<string | null>(null);
  const busy = stage !== null;
  const running = useRef<AbortController | null>(null);
  // closing the dialog (or leaving the editor) stops an export in progress
  useEffect(() => () => running.current?.abort(), []);
  const unsupported = useMemo(() => unsupportedChars(`${title}\n${notes}`), [title, notes]);

  const updatePrefs = (next: Prefs) => {
    setPrefs(next);
    writePrefs(next);
  };
  const saveDraft = (next: { title: string; notes: string }) =>
    useExportPdf.setState((s) => ({ drafts: { ...s.drafts, [projectId]: next } }));

  const securityHint = audit.grade
    ? `Grade ${audit.grade} · ${audit.findings.length === 0 ? 'no findings' : `${audit.findings.length} finding${audit.findings.length === 1 ? '' : 's'}`}`
    : 'Exposure, firewall rules and misconfigurations';

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    const docTitle = title.trim() || projectName;
    if (busy) return;
    const controller = new AbortController();
    running.current = controller;
    const { signal } = controller;
    setStage('Reading the diagram…');
    let diagram: DiagramVector | null = null;
    let diagramError = 'the canvas is not open';
    try {
      diagram = (await canvasApi()?.captureDiagram({ signal })) ?? null;
      if (signal.aborted) return;
      // the document is still built, with a placeholder where the diagram goes
      if (!diagram) diagramError = 'the canvas is empty';
    } catch (err) {
      if (signal.aborted) return;
      diagramError = (err as Error).message;
    }
    setStage('Writing PDF…');
    try {
      const { buildArchitecturePdfAsync } = await import('./archDoc');
      if (signal.aborted) return;
      const state = useEditor.getState();
      const bytes = await buildArchitecturePdfAsync(
        {
          title: docTitle,
          notes,
          ir: state.ir,
          edges: state.edges,
          files: orderedFiles(state.files).map((f) => [f, state.files[f]]),
          audit: getAudit(state.ir),
          diagram,
          sections: prefs.sections,
          paper: prefs.paper,
          generatedAt: new Date(),
        },
        { signal, onStage: (label) => !signal.aborted && setStage(label) },
      );
      if (signal.aborted) return;
      downloadBlob(new Blob([bytes.slice().buffer], { type: 'application/pdf' }), fileName(docTitle));
      if (diagram) showToast('PDF downloaded — ready to share', 'success');
      else showToast(`PDF downloaded, but the diagram could not be rendered (${diagramError})`, 'info');
      onClose();
    } catch (err) {
      if (signal.aborted) return;
      showToast(`Couldn't create the PDF: ${(err as Error).message}`, 'error');
      setStage(null);
    } finally {
      if (running.current === controller) running.current = null;
    }
  };

  /** Cancel, Esc and a click outside all close the dialog, stopping an export in progress */
  const close = () => {
    if (running.current) {
      running.current.abort();
      running.current = null;
      showToast('PDF export cancelled', 'info');
    }
    onClose();
  };

  return (
    <Modal
      open
      onClose={close}
      label="Export PDF document"
      title={
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <FileText className="h-4 w-4 text-muted" /> Export PDF document
        </span>
      }
    >
      <form onSubmit={(e) => void generate(e)} className="space-y-4 p-5">
        <p className="text-[12.5px] leading-relaxed text-muted">
          A document you can send to anyone: the diagram, then a plain-language summary of what it contains. It is built
          in your browser — nothing is uploaded.
        </p>
        <Field label="Title">
          <Input
            autoFocus
            value={title}
            maxLength={120}
            disabled={busy}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setTitle(e.target.value);
              saveDraft({ title: e.target.value, notes });
            }}
          />
        </Field>
        <Field label="Notes for the reader" hint="Optional — the goal of this design, open questions, who to talk to.">
          <Textarea
            rows={3}
            value={notes}
            maxLength={2000}
            disabled={busy}
            placeholder="Proposed architecture for…"
            onChange={(e) => {
              setNotes(e.target.value);
              saveDraft({ title, notes: e.target.value });
            }}
          />
        </Field>
        {unsupported.length > 0 ? (
          <p role="status" className="-mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug text-warning">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              The PDF's fonts can't show {unsupported.slice(0, 6).join(' ')}
              {unsupported.length > 6 ? ' …' : ''} — they will print as “?”. Western European text (accents included)
              is fine.
            </span>
          </p>
        ) : null}

        <fieldset disabled={busy}>
          <legend className="mb-1 block text-xs font-medium text-muted">Include</legend>
          <div className="divide-y rounded-[10px] border">
            {SECTION_ROWS.map((row) => (
              <label key={row.key} className="flex cursor-pointer items-center gap-3 px-3 py-2">
                <row.icon className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold">{row.title}</span>
                  <span className="block text-[11px] leading-snug text-faint">{row.key === 'security' ? securityHint : row.hint}</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="bp-switch"
                  aria-label={row.title}
                  checked={prefs.sections[row.key]}
                  onChange={(e) => updatePrefs({ ...prefs, sections: { ...prefs.sections, [row.key]: e.target.checked } })}
                />
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-faint">The diagram and an overview are always included.</p>
        </fieldset>

        <div className="flex items-center justify-between">
          <span id="pdf-paper" className="text-xs font-medium text-muted">
            Paper size
          </span>
          <div role="radiogroup" aria-labelledby="pdf-paper" className="flex rounded-md border bg-surface-2 p-0.5">
            {(['a4', 'letter'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={prefs.paper === p}
                disabled={busy}
                onClick={() => updatePrefs({ ...prefs, paper: p })}
                className={cn(
                  'h-6 rounded-[5px] px-3 text-[12px] font-medium transition-colors',
                  prefs.paper === p ? 'bg-surface-1 text-foreground shadow-xs' : 'text-muted hover:text-foreground',
                )}
              >
                {p === 'a4' ? 'A4' : 'Letter'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {stage ?? 'Download PDF'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
