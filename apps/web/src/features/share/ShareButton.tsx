import { Button } from '@blueprint/ui';
import { Check, Share2, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

import { useShare } from './useShare';

import { useIRStore } from '@/store/useIRStore';

interface ShareButtonProps {
  /** Override label — useful when shrinking to icon-only on narrow widths. */
  label?: string;
  /** Disable the button externally (e.g. while a project is loading). */
  disabled?: boolean;
}

/**
 * Topbar "Share" button.
 *
 * Encodes the current IR to an LZ-compressed `/p/:hash` URL on click and
 * copies it. Status ("Copied!" / error) lives in `useShare` so the visible
 * affordance follows automatically — see that hook for the lifecycle.
 *
 * The component never throws on encoding failure: a too-large IR shows up
 * as an inline alert under the button so the user can route to the
 * "Export → JSON" escape hatch instead.
 */
export function ShareButton({ label = 'Share', disabled = false }: ShareButtonProps) {
  const ir = useIRStore((s) => s.ir);
  const { share, status, error, url } = useShare();
  const [revealed, setRevealed] = useState(false);

  const handleClick = async () => {
    setRevealed(true);
    await share(ir);
  };

  const Icon = status === 'copied' ? Check : status === 'error' ? AlertTriangle : Share2;
  const visualLabel = status === 'copied' ? 'Copied!' : status === 'error' ? 'Try again' : label;

  return (
    <div className="relative">
      <Button size="sm" variant="ghost" onClick={handleClick} disabled={disabled}>
        <Icon className="h-4 w-4" /> {visualLabel}
      </Button>
      <span className="sr-only" aria-live="polite">
        {status === 'copied'
          ? `Share URL copied to clipboard: ${url ?? ''}`
          : status === 'error'
            ? (error ?? '')
            : ''}
      </span>
      {revealed && status === 'error' && error ? (
        <p className="absolute right-0 top-full mt-1 max-w-xs rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] text-danger shadow-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
