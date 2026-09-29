import { RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { showToast } from '@/components/Toast';
import { Button } from '@/components/ui';
import { safeStorage } from '@/lib/storage';
import { applyUpdate, usePwa } from './pwa';

const OFFLINE_TOLD_KEY = 'cb-offline-ready-told';

/**
 * "Update available — Reload": shown when a new version finished installing
 * in the background (instead of the old tab hitting missing chunks). Also
 * says once, on the first visit, that the app now works offline. Portaled and
 * `data-bp-live`, so an open dialog doesn't make it inert.
 */
export function UpdatePrompt() {
  const updateReady = usePwa((s) => s.updateReady);
  const offlineReady = usePwa((s) => s.offlineReady);
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const told = useRef(false);

  useEffect(() => {
    if (!offlineReady || told.current || safeStorage.getItem(OFFLINE_TOLD_KEY)) return;
    told.current = true;
    safeStorage.setItem(OFFLINE_TOLD_KEY, '1');
    showToast('Cloud Blueprint now works offline too', 'success');
  }, [offlineReady]);

  if (!updateReady || dismissed) return null;
  return createPortal(
    <div
      data-bp-live=""
      role="status"
      aria-live="polite"
      className="bp-pop-in fixed bottom-4 right-4 z-[85] flex max-w-[calc(100vw-24px)] items-center gap-3 rounded-md border bg-surface-1 py-2 pl-3.5 pr-2 text-[13px] shadow-lg max-sm:inset-x-3 max-sm:bottom-3"
    >
      <RefreshCw className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">Update available</span>
        <span className="text-muted max-sm:hidden"> — reload to get the new version.</span>
      </span>
      <Button
        size="sm"
        disabled={reloading}
        onClick={() => {
          setReloading(true);
          if (!applyUpdate()) location.reload();
        }}
      >
        {reloading ? 'Reloading…' : 'Reload'}
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>,
    document.body,
  );
}
