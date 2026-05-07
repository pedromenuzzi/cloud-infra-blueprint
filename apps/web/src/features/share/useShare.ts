import { useCallback, useState } from 'react';

import { buildShareUrl, encodeIR, ShareTooLargeError } from './share';

import type { IR } from '@blueprint/ir';

export type ShareStatus = 'idle' | 'copied' | 'error';

interface UseShareOptions {
  /**
   * Optional clock override for tests so the "copied" toast clears
   * deterministically without `setTimeout` flakiness.
   */
  setTimeoutImpl?: typeof setTimeout;
  /**
   * How long the "Copied!" affordance stays visible after a successful
   * share. 1.6 s matches the rest of the design system's toasts.
   */
  copiedDurationMs?: number;
}

export interface UseShareResult {
  /** Most recent share URL (or `null` before the first share). */
  url: string | null;
  /** Last error message, surfaced to the UI and screen readers. */
  error: string | null;
  /** Lifecycle of the affordance — drives the icon and aria-live text. */
  status: ShareStatus;
  /**
   * Encode the given IR, copy the URL to the clipboard, and flip the
   * status to `copied` for a brief window. Falls back to leaving the URL
   * in `url` if the clipboard API is unavailable so the caller can still
   * surface it (e.g. select-on-focus input).
   */
  share: (ir: IR) => Promise<string | null>;
}

/**
 * Hook backing the topbar's "Share" button.
 *
 * Encapsulates three concerns the button shouldn't have to think about:
 *
 * 1. **Encoding errors.** `ShareTooLargeError` becomes a friendly message
 *    that explains the URL would be truncated by Slack / WhatsApp.
 * 2. **Clipboard fallback.** When the browser blocks
 *    `navigator.clipboard.writeText` (file://, insecure context, denied
 *    permission), we still hand back the URL so the UI can render a
 *    select-on-focus input.
 * 3. **Toast lifecycle.** A single-source-of-truth status drives the icon
 *    swap, label change and `aria-live` announcement without any setState
 *    plumbing in the consumer.
 */
export function useShare(options: UseShareOptions = {}): UseShareResult {
  const { setTimeoutImpl = setTimeout, copiedDurationMs = 1600 } = options;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ShareStatus>('idle');

  const share = useCallback(
    async (ir: IR) => {
      setError(null);
      try {
        const hash = encodeIR(ir);
        const fullUrl = buildShareUrl(hash);
        setUrl(fullUrl);

        const clipboard =
          typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null;
        if (clipboard?.writeText) {
          try {
            await clipboard.writeText(fullUrl);
            setStatus('copied');
            setTimeoutImpl(() => {
              setStatus((current) => (current === 'copied' ? 'idle' : current));
            }, copiedDurationMs);
          } catch (err) {
            setStatus('error');
            setError(
              `URL ready, but copying failed: ${(err as Error).message ?? 'permission denied'}.`,
            );
          }
        } else {
          setStatus('error');
          setError('URL ready — clipboard not available, copy it manually.');
        }
        return fullUrl;
      } catch (err) {
        setUrl(null);
        if (err instanceof ShareTooLargeError) {
          setStatus('error');
          setError(
            `Blueprint too large for a shareable URL (${err.length.toLocaleString()} / ${err.limit.toLocaleString()} chars). Use Export → JSON instead.`,
          );
        } else {
          setStatus('error');
          setError(`Failed to encode share URL: ${(err as Error).message}.`);
        }
        return null;
      }
    },
    [copiedDurationMs, setTimeoutImpl],
  );

  return { url, error, status, share };
}
