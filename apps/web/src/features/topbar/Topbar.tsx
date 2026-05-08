import { Avatar, AvatarGroup, Button } from '@blueprint/ui';
import { Check, ChevronRight, Download, HelpCircle, Settings } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ComingSoonModal } from '@/components/ComingSoonModal';
import { CostTotalBadge, useCostEstimate } from '@/features/cost';
import { ShareButton } from '@/features/share';
import { useIRStore } from '@/store/useIRStore';
import { ThemeToggle } from '@/theme';

interface TopbarProps {
  projectId: string;
  /** Workspace label rendered before the slash. Defaults to "Acme Corp". */
  workspace?: string;
  /** Sync status — defaults to `saved`. */
  status?: 'saved' | 'syncing' | 'error';
  /** Callback invoked by the help (?) button to open the onboarding tour. */
  onOpenHelp?: () => void;
}

/**
 * Editor topbar — mirrors image 01: centered breadcrumb (workspace / project),
 * collaborator avatar pile, sync status pill, Share, Export and Settings.
 */
export function Topbar({
  projectId,
  workspace = 'Acme Corp',
  status = 'saved',
  onOpenHelp,
}: TopbarProps) {
  const ir = useIRStore((s) => s.ir);
  const cost = useCostEstimate(ir);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-border/60 bg-card px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          to="/dashboard"
          className="focus-ring flex items-center gap-1 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Back to dashboard"
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
        </Link>
        <Breadcrumb workspace={workspace} project={projectId || 'untitled'} />
      </div>

      <div className="flex items-center gap-2">
        <AvatarGroup max={3}>
          <Avatar name="Pedro Silva" size={28} ring="success" />
          <Avatar name="Maria Souza" size={28} />
        </AvatarGroup>

        <SyncBadge status={status} />

        {cost.ready && cost.estimate?.provider === 'infracost' ? (
          <CostTotalBadge total={cost.estimate.totalMonthlyCost} />
        ) : null}

        <span className="mx-1 h-6 w-px bg-border" />

        <ShareButton />
        <Button size="sm" onClick={() => setExportOpen(true)}>
          <Download className="h-4 w-4" /> Export
        </Button>

        <span className="mx-1 h-6 w-px bg-border" />

        <ThemeToggle />
        <Button
          size="icon"
          variant="ghost"
          aria-label="Help & onboarding tour"
          title="Help (open tour)"
          onClick={() => onOpenHelp?.()}
        >
          <HelpCircle className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      <ComingSoonModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        feature="Project settings"
        description="Per-project settings (default region, naming conventions, plug-ins) will live here."
        phase="Phase 4 — Persistence"
      />
      <ComingSoonModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        feature="Export to ZIP / push to Git"
        description="Bundle your Terraform as a downloadable ZIP or push directly to GitHub / GitLab."
        phase="Phase 5 — Templates + Git"
      />
    </header>
  );
}

function Breadcrumb({ workspace, project }: { workspace: string; project: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">{workspace}</span>
      <span className="text-muted-foreground">/</span>
      <span className="truncate font-semibold tracking-tight">{project}</span>
    </nav>
  );
}

function SyncBadge({ status }: { status: 'saved' | 'syncing' | 'error' }) {
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-1 text-[11px] font-semibold text-success">
        <Check className="h-3 w-3" /> Saved
      </span>
    );
  }
  if (status === 'syncing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] font-semibold text-[hsl(var(--warning-foreground))] dark:text-warning">
        Syncing…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] font-semibold text-danger">
      Conflict
    </span>
  );
}
