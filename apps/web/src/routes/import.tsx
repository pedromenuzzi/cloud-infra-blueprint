import { createWorkerAdapter } from '@blueprint/hcl';
import { Badge, LogoLockup } from '@blueprint/ui';
import { ArrowRight, FileWarning, FileCheck2, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Dropzone } from '@/features/import/Dropzone';
import { parseUploads, type ImportResult } from '@/features/import/parseUploads';
import { useIRStore } from '@/store/useIRStore';
import { ThemeToggle } from '@/theme';

type Status = 'idle' | 'parsing' | 'success' | 'error';

/**
 * `/import` — drop a Terraform project to spawn an editable canvas.
 *
 * Pipeline (everything client-side):
 *
 *   File[]
 *     ├── classify by extension (.tf / .tfstate / .zip)
 *     ├── expand zips client-side via JSZip
 *     ├── HCL → IR via the existing `@blueprint/hcl` Web Worker
 *     ├── tfstate → IR via `tfstate.ts`
 *     ├── merge into a single IR
 *     └── dagre auto-layout so nodes don't stack at (0, 0)
 *
 * No server round-trip, no `terraform` CLI required, no auth needed to
 * preview the result. After success the user clicks "Open in editor"
 * which `setIR`s the store and navigates to `/editor/imported`.
 */
export function ImportRoute() {
  const setIR = useIRStore((s) => s.setIR);
  const navigate = useNavigate();
  const workerRef = useRef<Worker | null>(null);

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setStatus('parsing');
    setError(null);
    setResult(null);

    try {
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('../workers/hcl.worker.ts', import.meta.url), {
          type: 'module',
        });
      }
      const adapter = createWorkerAdapter(workerRef.current);
      const parsed = await parseUploads(files, adapter);
      setResult(parsed);
      setStatus(parsed.totals.failed > 0 && parsed.totals.resources === 0 ? 'error' : 'success');
    } catch (err) {
      setStatus('error');
      setError(`Import failed: ${(err as Error).message}.`);
    }
  }, []);

  const handleOpen = () => {
    if (!result) return;
    setIR(result.ir);
    navigate('/editor/imported');
  };

  return (
    <div className="relative isolate flex min-h-full flex-col overflow-x-clip bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(80%_60%_at_50%_0%,hsl(var(--primary)/0.18),transparent_70%)]"
      />

      <ImportHeader />

      <main className="container flex flex-1 flex-col gap-6 py-8">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Import existing Terraform</h1>
          <p className="text-sm text-muted-foreground">
            Drop your <code className="rounded bg-muted px-1.5 py-0.5">.tf</code> files,{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">.tfstate</code> snapshot or a zipped
            project. Parsing happens locally in your browser — files never leave the page.
          </p>
        </header>

        <Dropzone onFiles={handleFiles} disabled={status === 'parsing'} />

        {status === 'parsing' ? (
          <ParsingNote />
        ) : status === 'error' ? (
          <ErrorPanel message={error ?? 'Failed to parse uploaded files.'} files={result?.files} />
        ) : result ? (
          <ResultPanel result={result} onOpen={handleOpen} />
        ) : (
          <HintList />
        )}
      </main>
    </div>
  );
}

function ImportHeader() {
  return (
    <header className="border-b border-border/60 bg-card/80 backdrop-blur">
      <div className="container flex h-14 items-center justify-between gap-3">
        <Link to="/" className="focus-ring inline-flex items-center gap-2 rounded-md">
          <LogoLockup size="md" />
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">Import</span>
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant="default" size="sm">
            Local
          </Badge>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function HintList() {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
      <h2 className="mb-2 font-semibold text-foreground">What to expect</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>HCL files keep their formatting and comments — round-tripping is lossless.</li>
        <li>State files become an editable canvas; sensitive computed attributes are stripped.</li>
        <li>
          Zip archives skip <code>.terraform/</code>, <code>node_modules/</code> and{' '}
          <code>.git/</code>.
        </li>
        <li>
          Layout uses the same dagre engine as the editor&apos;s &ldquo;Tidy up&rdquo; action.
        </li>
      </ul>
    </section>
  );
}

function ParsingNote() {
  return (
    <section
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm text-primary"
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      Parsing uploads in your browser… this stays local, nothing is uploaded.
    </section>
  );
}

interface ResultPanelProps {
  result: ImportResult;
  onOpen: () => void;
}

function ResultPanel({ result, onOpen }: ResultPanelProps) {
  const { totals, files } = result;
  return (
    <section className="space-y-3 rounded-xl border border-success/30 bg-success/10 p-4 text-success">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <h2 className="text-base font-semibold">Parsed locally — ready to open</h2>
            <p className="text-sm opacity-90">
              {totals.resources} resources · {totals.modules} modules · {totals.edges} edges across{' '}
              {totals.files} file{totals.files === 1 ? '' : 's'}
              {totals.failed > 0 ? ` · ${totals.failed} skipped` : ''}.
            </p>
          </div>
        </div>
        <button
          onClick={onOpen}
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
        >
          Open in editor <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <FilesList files={files} />
    </section>
  );
}

function ErrorPanel({ message, files }: { message: string; files?: ImportResult['files'] }) {
  return (
    <section
      role="alert"
      className="space-y-3 rounded-xl border border-danger/30 bg-danger/10 p-4 text-danger"
    >
      <div className="flex items-start gap-3">
        <FileWarning className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div>
          <h2 className="text-base font-semibold">Could not import this project</h2>
          <p className="text-sm opacity-90">{message}</p>
        </div>
      </div>
      {files && files.length > 0 ? <FilesList files={files} /> : null}
    </section>
  );
}

function FilesList({ files }: { files: ImportResult['files'] }) {
  return (
    <ol className="space-y-1 text-xs text-foreground/80">
      {files.map((f) => (
        <li
          key={f.filename}
          className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-2 py-1"
        >
          <span className="truncate font-mono">{f.filename}</span>
          {f.error ? (
            <span className="text-danger">{f.error}</span>
          ) : (
            <span className="text-muted-foreground">
              {f.kind} · {(f.bytes / 1024).toFixed(1)} KB
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
