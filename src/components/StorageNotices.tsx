import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { showToast } from '@/components/Toast';
import { onStorageNotice } from '@/lib/storage';

type Banner = 'blocked' | 'full';

const TEXT: Record<Banner, string> = {
  blocked: 'Your browser blocks storage — changes won’t persist after you close this tab.',
  full: 'Storage is full — changes aren’t being saved. Export or delete projects to free space.',
};

/**
 * Turns storage problems into something the user sees: a persistent banner
 * while saving is impossible (blocked or full), toasts for the rest.
 */
export function StorageNotices() {
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    let lastQuotaToast = 0;
    return onStorageNotice((notice) => {
      switch (notice.type) {
        case 'blocked':
          setBanner('blocked');
          break;
        case 'quota':
          setBanner((b) => (b === 'blocked' ? b : 'full'));
          if (Date.now() - lastQuotaToast > 10_000) {
            lastQuotaToast = Date.now();
            showToast('Storage is full — export or delete projects', 'error');
          }
          break;
        case 'recovered':
          setBanner((b) => (b === 'full' ? null : b));
          break;
        case 'nearly-full':
          showToast(
            `Browser storage is ${notice.percent}% full — export or delete old projects to keep saving`,
            'info',
          );
          break;
        case 'backup':
          showToast('Some saved projects were unreadable — a backup copy was kept in this browser', 'error');
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
      <span>{TEXT[banner]}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setBanner(null)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
