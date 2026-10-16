import { Cloud, FileDiff } from 'lucide-react';
import { useMemo } from 'react';
import { useMessages } from '@/i18n/messages';
import { cn } from '@/lib/utils';
import { isNoteworthy, planCounts } from '@/deploy/plan';
import { PLAN_SYMBOL } from '@/features/learn/terminal/PlanMarks';
import { deployMessages } from './messages';
import { ACTION_TEXT } from './StateViews';
import { setDeployPanel, useDeploy } from './store';

/** The topbar's way to the plan and state panel; once a plan is open, its counts in Terraform's symbols. */
export function DeployButton() {
  const m = useMessages(deployMessages);
  const open = useDeploy((s) => s.panelOpen);
  const plan = useDeploy((s) => s.plan?.plan);
  const hasState = useDeploy((s) => s.state !== null);
  const counts = useMemo(() => (plan ? planCounts(plan.changes.filter(isNoteworthy)) : null), [plan]);
  const shown = counts ? (['create', 'update', 'replace', 'delete'] as const).filter((a) => counts[a] > 0) : [];
  const summary = shown.map((a) => m.counts[a](counts![a])).join(', ');
  return (
    <button
      type="button"
      onClick={() => setDeployPanel(!open)}
      aria-pressed={open}
      aria-label={m.topbar(summary)}
      title={m.panel}
      data-testid="deploy-button"
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12px] font-semibold transition-colors hover:border-border-strong',
        open ? 'bg-primary-soft' : 'bg-surface-1',
      )}
    >
      <span className="relative">
        <FileDiff className={cn('h-4 w-4', plan ? 'text-primary' : 'text-muted')} />
        {shown.length ? <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-surface-1 xl:hidden" aria-hidden /> : null}
      </span>
      {/* the counts in Terraform's symbols where the bar has room, their total elsewhere */}
      {shown.map((a) => (
        <span key={a} className={cn('hidden font-mono text-[11px] 2xl:inline', ACTION_TEXT[a])} aria-hidden>
          {PLAN_SYMBOL[a]}
          {counts![a]}
        </span>
      ))}
      {shown.length ? (
        <span className="hidden rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4 text-primary-fg xl:inline 2xl:hidden" aria-hidden>
          {shown.reduce((n, a) => n + counts![a], 0)}
        </span>
      ) : null}
      {hasState ? <Cloud className="h-3.5 w-3.5 text-success" aria-hidden /> : null}
    </button>
  );
}
