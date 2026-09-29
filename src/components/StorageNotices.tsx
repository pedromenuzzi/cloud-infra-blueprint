import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { shellMessages } from '@/components/messages';
import { showToast } from '@/components/Toast';
import { messagesFor, useMessages } from '@/i18n/messages';
import { onStorageNotice } from '@/lib/storage';

type Banner = 'blocked' | 'full';

/**
 * Turns storage problems into something the user sees: a persistent banner
 * while saving is impossible (blocked or full), toasts for the rest.
 */
export function StorageNotices() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const m = useMessages(shellMessages);

  useEffect(() => {
    let lastQuotaToast = 0;
    return onStorageNotice((notice) => {
      const text = messagesFor(shellMessages);
      switch (notice.type) {
        case 'blocked':
          setBanner('blocked');
          break;
        case 'quota':
          setBanner((b) => (b === 'blocked' ? b : 'full'));
          if (Date.now() - lastQuotaToast > 10_000) {
            lastQuotaToast = Date.now();
            showToast(text.storageFullToast, 'error');
          }
          break;
        case 'recovered':
          setBanner((b) => (b === 'full' ? null : b));
          break;
        case 'nearly-full':
          showToast(text.storageNearlyFull(notice.percent), 'info');
          break;
        case 'backup':
          showToast(text.storageBackupKept, 'error');
          break;
      }
    });
  }, []);

  if (!banner) return null;
  return (
    <div
      role="alert"
      className="fixed left-1/2 top-2 z-[75] flex w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-md border border-danger/40 bg-surface-1 py-1.5 pl-3 pr-1.5 text-[12.5px] font-medium text-danger shadow-lg"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>{banner === 'blocked' ? m.storageBlocked : m.storageFullBanner}</span>
      <button
        type="button"
        aria-label={m.dismiss}
        onClick={() => setBanner(null)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
