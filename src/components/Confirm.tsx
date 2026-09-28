/**
 * In-app confirmation dialog (replaces window.confirm):
 *   if (await confirmAction({ title, body, confirmLabel: 'Delete', danger: true })) …
 */
import { AlertTriangle } from 'lucide-react';
import { useId } from 'react';
import { create } from 'zustand';
import { Button, Modal } from './ui';

interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve(ok: boolean): void;
}

const useConfirm = create<{ request: ConfirmRequest | null }>(() => ({ request: null }));

export function confirmAction(options: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ request: { ...options, resolve } }));
}

export function ConfirmHost() {
  const request = useConfirm((s) => s.request);
  const bodyId = useId();
  if (!request) return null;
  const close = (ok: boolean) => {
    request.resolve(ok);
    useConfirm.setState({ request: null });
  };
  return (
    <Modal
      open
      onClose={() => close(false)}
      role="alertdialog"
      label={request.title}
      describedBy={request.body ? bodyId : undefined}
    >
      <div className="p-5">
        <div className="flex gap-3">
          {request.danger ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/12 text-danger">
              <AlertTriangle className="h-4 w-4" />
            </span>
          ) : null}
          <div>
            <h2 className="text-[15px] font-semibold">{request.title}</h2>
            {request.body ? (
              <p id={bodyId} className="mt-1 text-[13px] leading-relaxed text-muted">
                {request.body}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button data-autofocus variant={request.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {request.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
