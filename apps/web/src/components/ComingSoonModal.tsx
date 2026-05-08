import { Button, Modal } from '@blueprint/ui';
import { Sparkles } from 'lucide-react';

export interface ComingSoonModalProps {
  open: boolean;
  onClose: () => void;
  /** Friendly name of the feature, e.g. "Watch demo" or "Settings". */
  feature: string;
  /** Optional one-liner explaining what this thing will do. */
  description?: string;
  /** Optional ETA / phase label, e.g. "Phase 5 — Templates + Git". */
  phase?: string;
}

/**
 * Small generic modal used to announce a feature that is intentionally not
 * implemented yet (Watch demo, Settings, Teams, etc.). Avoids leaving buttons
 * without feedback while staying honest about the project's roadmap.
 */
export function ComingSoonModal({
  open,
  onClose,
  feature,
  description,
  phase,
}: ComingSoonModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${feature} — coming soon`}
      className="max-w-md"
      footer={
        <div className="ml-auto">
          <Button onClick={onClose} size="sm">
            Got it
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="space-y-2 text-sm">
          <p>
            {description ??
              `${feature} isn't wired up in this build yet — it's planned for an upcoming phase.`}
          </p>
          {phase && (
            <p className="text-xs text-muted-foreground">
              Tracked under <span className="font-mono">{phase}</span>.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            See <code>docs/ROADMAP.md</code> in the repo for the full plan.
          </p>
        </div>
      </div>
    </Modal>
  );
}
