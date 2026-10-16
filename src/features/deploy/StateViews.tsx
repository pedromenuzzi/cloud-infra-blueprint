/**
 * The state and the plan where a block is: a chip on its canvas node
 * (deployed, or not yet) and a section in its inspector (its change in the
 * plan, its attributes in the state, secrets masked until asked).
 */
import { ChevronRight, Cloud, CloudOff, Eye, EyeOff, FileDiff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { cn } from '@/lib/utils';
import { formatValue, isNoteworthy, type ChangeAction } from '@/deploy/plan';
import { isSensitivePath, type StateInstance } from '@/deploy/state';
import type { Json } from '@/deploy/json';
import { PLAN_SYMBOL } from '@/features/learn/terminal/PlanMarks';
import { terminalMessages } from '@/features/learn/terminal/terminal.messages';
import { deployMessages } from './messages';
import { setDeployPanel, useDeploy } from './store';

/** text colors (AA in both themes) per change */
export const ACTION_TEXT: Record<string, string> = {
  create: 'text-success',
  update: 'text-warning',
  replace: 'text-danger',
  delete: 'text-danger',
  'no-op': 'text-muted',
};

const instancesOf = (id: string) => (s: ReturnType<typeof useDeploy.getState>) =>
  s.state ? (s.state.byNode.get(id)?.reduce((n, r) => n + r.instances.length, 0) ?? 0) : null;

/** a node's chip: in the state or not yet (nothing without a state); `at` places it (default: the bottom right corner) */
export function StateMark({ id, at = '-bottom-2 right-2.5' }: { id: string; at?: string }) {
  const n = useDeploy(instancesOf(id));
  const m = useMessages(deployMessages);
  if (n === null) return null;
  return (
    <span
      data-state-mark={n > 0 ? 'deployed' : 'missing'}
      title={n > 0 ? m.chipDeployedTitle(n) : m.chipNotDeployedTitle}
      className={cn(
        'bp-pop-in absolute z-10 inline-flex items-center gap-1 rounded-full border bg-node px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide shadow-xs',
        at,
        n > 0 ? 'border-success/45 text-success' : 'border-dashed border-border-strong text-muted',
      )}
    >
      {n > 0 ? <Cloud className="h-2.5 w-2.5" /> : <CloudOff className="h-2.5 w-2.5" />}
      {n > 0 ? m.chipDeployed : m.chipNotDeployed}
    </span>
  );
}

const SHOWN = 24;

/** an instance's attributes, one per line; secrets masked until `reveal` */
export function AttributeList({ instance, reveal }: { instance: StateInstance; reveal: boolean }) {
  const m = useMessages(deployMessages);
  const [filter, setFilter] = useState('');
  const [all, setAll] = useState(false);
  const rows = useMemo(
    () =>
      Object.entries(instance.attributes)
        .filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
        .sort(([a], [b]) => a.localeCompare(b)),
    [instance],
  );
  const q = filter.trim().toLowerCase();
  const matching = q ? rows.filter(([k]) => k.toLowerCase().includes(q)) : rows;
  const shown = all || q ? matching : matching.slice(0, SHOWN);
  return (
    <div className="space-y-1.5">
      {rows.length > 12 ? (
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={m.attrFilter} aria-label={m.attrFilter} className="h-7 text-[12px]" />
      ) : null}
      <dl className="divide-y divide-border rounded-[8px] border bg-surface-2/40 text-[11px]">
        {shown.map(([key, value]) => {
          const secret = isSensitivePath(instance, key);
          const text = formatValue(value as Json);
          return (
            <div key={key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 px-2 py-1">
              <dt className="truncate font-mono text-muted" title={key} translate="no">
                {key}
              </dt>
              <dd className={cn('truncate font-mono', secret && !reveal ? 'italic text-faint' : 'text-foreground')} title={secret && !reveal ? undefined : text} translate="no">
                {secret && !reveal ? m.sensitive : text}
              </dd>
            </div>
          );
        })}
      </dl>
      {!all && !q && matching.length > SHOWN ? (
        <button type="button" onClick={() => setAll(true)} className="text-[11.5px] font-semibold text-primary hover:text-primary-hover">
          {m.showAll(matching.length)}
        </button>
      ) : null}
    </div>
  );
}

/** "Show sensitive values": per view, never remembered */
export function RevealToggle({ reveal, onChange }: { reveal: boolean; onChange(next: boolean): void }) {
  const m = useMessages(deployMessages);
  return (
    <button
      type="button"
      aria-pressed={reveal}
      aria-label={m.showSecrets}
      title={reveal ? m.hideSecrets : m.showSecrets}
      onClick={() => onChange(!reveal)}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors hover:bg-surface-2',
        reveal ? 'bg-warning/12 text-warning' : 'text-muted hover:text-foreground',
      )}
    >
      {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
    </button>
  );
}

const NONE: never[] = [];

const RANK: Record<ChangeAction, number> = { 'no-op': 0, read: 0, forget: 0, create: 1, update: 2, delete: 3, replace: 4 };

/** The inspector's view of a block in the open plan and state (nothing when neither is open). */
export function DeployedSection({ id }: { id: string }) {
  const m = useMessages(deployMessages);
  const tm = useMessages(terminalMessages);
  const plan = useDeploy((s) => s.plan?.plan);
  const hasState = useDeploy((s) => s.state !== null);
  const own = useDeploy((s) => s.state?.byNode.get(id));
  const resources = hasState ? (own ?? NONE) : null;
  const [reveal, setReveal] = useState(false);
  const [pick, setPick] = useState(0);
  const changes = useMemo(() => plan?.changes.filter((c) => c.node === id && isNoteworthy(c)) ?? [], [plan, id]);
  if (!plan && !resources) return null;
  const top = changes.reduce<(typeof changes)[number] | undefined>((a, c) => (!a || RANK[c.action] > RANK[a.action] ? c : a), undefined);
  const instances = resources?.flatMap((r) => r.instances) ?? [];
  const instance = instances[Math.min(pick, instances.length - 1)];
  return (
    <section className="space-y-2 rounded-[10px] border bg-surface-1 p-2.5" data-testid="deployed-section">
      {top ? (
        <button
          type="button"
          title={m.openInPlan}
          onClick={() => {
            useDeploy.setState({ focus: top.address });
            setDeployPanel(true, 'plan');
          }}
          className="-m-1 flex w-[calc(100%+0.5rem)] items-center gap-2 whitespace-nowrap rounded-[8px] p-1 text-left text-[12px] transition-colors hover:bg-surface-2"
        >
          <FileDiff className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="flex-1 text-muted">{m.inPlan}</span>
          <span className={cn('rounded-full bg-surface-2 px-2 py-px font-semibold', ACTION_TEXT[top.action])}>
            <span className="font-mono" translate="no">
              {top.action in PLAN_SYMBOL ? PLAN_SYMBOL[top.action as keyof typeof PLAN_SYMBOL] : ''}
            </span>{' '}
            {top.action in tm.mark ? tm.mark[top.action as keyof typeof tm.mark] : m.importing}
            {changes.length > 1 ? ` ×${changes.length}` : ''}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
        </button>
      ) : null}
      {resources ? (
        instance ? (
          <>
            <div className="flex items-center gap-2">
              <Cloud className="h-3.5 w-3.5 shrink-0 text-success" />
              <span className="min-w-0 flex-1 text-[12px] leading-snug">
                <span className="font-semibold">{m.chipDeployed}</span> <span className="text-muted">· {m.instances(instances.length)}</span>
              </span>
              <RevealToggle reveal={reveal} onChange={setReveal} />
            </div>
            {instances.length > 1 ? (
              <select
                value={pick}
                onChange={(e) => setPick(Number(e.target.value))}
                aria-label={m.instances(instances.length)}
                className="h-7 w-full rounded-sm border bg-surface-1 px-2 font-mono text-[11.5px]"
              >
                {instances.map((inst, i) => (
                  <option key={inst.address} value={i}>
                    {inst.address}
                  </option>
                ))}
              </select>
            ) : null}
            <AttributeList key={instance.address} instance={instance} reveal={reveal} />
          </>
        ) : (
          <p className="flex items-start gap-1.5 text-[12px] text-muted">
            <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {m.notInState}
          </p>
        )
      ) : null}
    </section>
  );
}
