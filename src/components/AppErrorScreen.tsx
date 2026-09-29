import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { shellMessages } from '@/components/messages';
import { Button, LogoMark } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { canRecoveryReload, isChunkLoadError, recoveryReload } from '@/lib/chunkReload';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

function describe(error: unknown, unknown: string): { message: string; details: string } {
  if (isRouteErrorResponse(error)) {
    return { message: `${error.status} ${error.statusText}`, details: String(error.data ?? '') };
  }
  if (error instanceof Error) {
    return { message: error.message || error.name, details: error.stack ?? String(error) };
  }
  return { message: unknown, details: String(error) };
}

/**
 * Root `errorElement`: any render crash, or a chunk that no longer exists
 * after a deploy, lands here instead of a blank page or a raw stack trace.
 * A stale chunk first gets one automatic reload (guarded against loops).
 */
export function AppErrorScreen() {
  const error = useRouteError();
  const chunk = isChunkLoadError(error);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const [reloading, setReloading] = useState(() => chunk && canRecoveryReload());
  const m = useMessages(shellMessages);
  const { message, details } = describe(error, m.unknownError);

  useEffect(() => {
    if (reloading && !recoveryReload()) setReloading(false);
  }, [reloading]);

  useDocumentTitle(m.somethingWrong);

  if (reloading) {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-background px-5 py-10">
      <div className="w-full max-w-md text-center" role="alert">
        <div className="flex justify-center">
          <LogoMark size={44} />
        </div>
        <h1 className="mt-5 text-[22px] font-bold tracking-[-0.01em]">
          {chunk ? m.appUpdated : m.somethingWrong}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {chunk ? (offline ? m.chunkOffline : m.chunkStale) : m.crashed}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => location.reload()}>
            <RefreshCw className="h-4 w-4" /> {m.reload}
          </Button>
          <Button
            variant="outline"
            onClick={() => location.assign(`${import.meta.env.BASE_URL}dashboard`)}
          >
            {m.backToProjects}
          </Button>
        </div>
        <details className="mt-7 rounded-md border bg-surface-1 text-left">
          <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-muted">
            {m.errorDetails}
          </summary>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border-t px-3 py-2 font-mono text-[11px] text-faint">
            {message}
            {details && details !== message ? `\n\n${details}` : ''}
          </pre>
        </details>
      </div>
    </div>
  );
}
