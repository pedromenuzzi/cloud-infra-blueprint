import { Badge, LogoLockup } from '@blueprint/ui';
import { ArrowRight, GitFork, AlertTriangle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ProductMockup } from '@/components/ProductMockup';
import { decodeIR, ShareDecodeError } from '@/features/share';
import { useIRStore } from '@/store/useIRStore';
import { ThemeToggle } from '@/theme';

/**
 * `/p/:hash` — read-only playground rendered from a self-contained URL.
 *
 * No backend, no database, no account. The hash is the entire payload:
 * an LZ-compressed `{ v, ir }` envelope. See `features/share/share.ts`.
 *
 * UX rules:
 *   - **No fork without intent.** Visualization works without sign-in;
 *     the `Fork` CTA is the funnel into `/dashboard` (auth lives there).
 *   - **Fail visibly.** A broken hash renders a friendly error card with a
 *     "Start blank" link instead of an exception page.
 *   - **Honest preview.** Renders the same canvas component the editor
 *     uses, so what the visitor sees here matches what a fork would open.
 */
export function PlaygroundRoute() {
  const { hash } = useParams<{ hash: string }>();
  const setIR = useIRStore((s) => s.setIR);

  const [error, setError] = useState<string | null>(null);

  const decoded = useMemo(() => {
    if (!hash) {
      return { ok: false as const, error: 'Missing share hash.' };
    }
    try {
      return { ok: true as const, ir: decodeIR(hash) };
    } catch (err) {
      const message =
        err instanceof ShareDecodeError
          ? err.message
          : `Unexpected decode failure: ${(err as Error).message}`;
      return { ok: false as const, error: message };
    }
  }, [hash]);

  useEffect(() => {
    if (decoded.ok) {
      setIR(decoded.ir);
      setError(null);
    } else {
      setError(decoded.error);
    }
  }, [decoded, setIR]);

  return (
    <div className="relative isolate flex min-h-full flex-col overflow-x-clip bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(80%_60%_at_50%_0%,hsl(var(--primary)/0.18),transparent_70%)]"
      />

      <PlaygroundHeader hash={hash} />

      <main className="container flex flex-1 flex-col gap-6 py-8">
        {error ? <PlaygroundErrorCard message={error} /> : <PlaygroundReadyCard />}

        <section
          aria-label="Read-only blueprint preview"
          className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm"
        >
          <ProductMockup />
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Preview is read-only — fork to edit, comment or sync with HCL.
          </p>
        </section>
      </main>
    </div>
  );
}

function PlaygroundHeader({ hash }: { hash: string | undefined }) {
  return (
    <header className="border-b border-border/60 bg-card/80 backdrop-blur">
      <div className="container flex h-14 items-center justify-between gap-3">
        <Link to="/" className="focus-ring inline-flex items-center gap-2 rounded-md">
          <LogoLockup size="md" />
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
            Playground
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant="default" size="sm">
            Read-only
          </Badge>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            {hash ? `${hash.slice(0, 10)}…` : 'no payload'}
          </span>
          <ThemeToggle />
          <Link
            to="/dashboard"
            className="focus-ring inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
          >
            <GitFork className="h-4 w-4" /> Fork to edit
          </Link>
        </div>
      </div>
    </header>
  );
}

function PlaygroundReadyCard() {
  return (
    <section className="flex flex-col items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Loaded from a shared URL</h1>
        <p className="text-sm text-muted-foreground">
          This blueprint was rendered entirely from the link — no account, no server. Your changes
          won&apos;t persist until you fork.
        </p>
      </div>
      <Link
        to="/dashboard"
        className="focus-ring inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
      >
        Fork to edit <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

function PlaygroundErrorCard({ message }: { message: string }) {
  return (
    <section
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4 text-danger sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <h1 className="text-base font-semibold">This share link is unreadable</h1>
          <p className="text-sm opacity-90">{message}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/"
          className="focus-ring inline-flex h-8 items-center rounded-md bg-transparent px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Back home
        </Link>
        <Link
          to="/dashboard"
          className="focus-ring inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
        >
          Start blank
        </Link>
      </div>
    </section>
  );
}
