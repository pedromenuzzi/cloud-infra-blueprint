/**
 * The plan and state panel, docked on the canvas's left like the security
 * panel. Plan: what it does in numbers, what it risks, every change grouped
 * by action with its attribute diff, what it changes that this code doesn't
 * have. State: what's deployed, what isn't yet, what the state holds that
 * this code doesn't. Picking a change or a block selects it on the canvas.
 */
import {
  AlertTriangle,
  ChevronDown,
  Cloud,
  CloudOff,
  FileDiff,
  FileUp,
  FolderPlus,
  Loader2,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Input, useLayer } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { useEditor } from '@/features/editor/store';
import { PLAN_SYMBOL } from '@/features/learn/terminal/PlanMarks';
import { useMessages } from '@/i18n/messages';
import { nodeIds } from '@/ir/modules';
import { scrollBehavior } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { diffRows, isNoteworthy, planCounts, riskyChanges, type DiffValue, type PlanChange } from '@/deploy/plan';
import type { StateResource } from '@/deploy/state';
import { deployMessages } from './messages';
import { openFromState } from './fromStateStore';
import { AttributeList, ACTION_TEXT, RevealToggle } from './StateViews';
import {
  clearPlan,
  clearState,
  codeFingerprint,
  keepPlan,
  loadSamplePlan,
  pickAndOpen,
  setDeployPanel,
  useDeploy,
  type DeployTab,
} from './store';

type Group = 'delete' | 'replace' | 'update' | 'create' | 'other';
const GROUPS: Group[] = ['delete', 'replace', 'update', 'create', 'other'];
const groupOf = (c: PlanChange): Group => (c.action === 'delete' || c.action === 'replace' || c.action === 'update' || c.action === 'create' ? c.action : 'other');
/** rows a group shows before "Show more" */
const PAGE = 120;

const symbolOf = (c: PlanChange) => (c.action in PLAN_SYMBOL ? PLAN_SYMBOL[c.action as keyof typeof PLAN_SYMBOL] : c.importing !== undefined ? '←' : '→');

/** select a block and bring it into view */
function show(id: string) {
  if (!nodeIds(useEditor.getState().ir).has(id)) return;
  useEditor.getState().setSelection(id, 'canvas');
  requestAnimationFrame(() => canvasApi()?.focusNode(id));
}

function Value({ value }: { value?: DiffValue }) {
  const m = useMessages(deployMessages);
  if (!value) return null;
  if (value.kind === 'unknown') return <span className="italic text-faint">{m.knownAfter}</span>;
  if (value.kind === 'sensitive') return <span className="italic text-faint">{m.sensitive}</span>;
  return (
    <span className="break-all font-mono" translate="no">
      {value.text}
    </span>
  );
}

/** a change's attributes, Terraform style: `- before` / `+ after` under each path */
function Diff({ change }: { change: PlanChange }) {
  const m = useMessages(deployMessages);
  const [unchanged, setUnchanged] = useState(false);
  const { rows, truncated } = useMemo(() => diffRows(change), [change]);
  const same = rows.filter((r) => r.status === 'same').length;
  const shown = unchanged ? rows : rows.filter((r) => r.status !== 'same');
  return (
    <div className="mt-2 space-y-1.5">
      {shown.length === 0 && same === 0 ? <p className="text-[11.5px] text-faint">{m.noAttributes}</p> : null}
      <ul className="space-y-1 text-[11px]">
        {shown.map((r) => (
          <li
            key={r.path}
            data-diff-row={r.path}
            data-forces={r.forces || undefined}
            className={cn('rounded-[6px] px-2 py-1', r.forces ? 'bg-danger/8 ring-1 ring-danger/35' : 'bg-surface-2/50')}
          >
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate font-semibold text-foreground" title={r.path}>
                {r.path}
              </code>
              {r.forces ? <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-danger">{m.forces}</span> : null}
            </div>
            {r.status === 'same' ? (
              <div className="pl-3 text-muted">
                <Value value={r.after} />
              </div>
            ) : (
              <>
                {r.before ? (
                  <div className="flex gap-1.5 text-danger">
                    <span aria-hidden className="w-2 shrink-0 font-mono font-bold">
                      -
                    </span>
                    <span className="sr-only">{m.before}</span>
                    <span className="min-w-0 text-foreground/80">
                      <Value value={r.before} />
                    </span>
                  </div>
                ) : null}
                {r.after ? (
                  <div className="flex gap-1.5 text-success">
                    <span aria-hidden className="w-2 shrink-0 font-mono font-bold">
                      +
                    </span>
                    <span className="sr-only">{m.after}</span>
                    <span className="min-w-0 text-foreground">
                      <Value value={r.after} />
                    </span>
                  </div>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      {same > 0 ? (
        <button type="button" onClick={() => setUnchanged(!unchanged)} className="text-[11px] font-semibold text-primary hover:text-primary-hover">
          {unchanged ? m.hideUnchanged : m.showUnchanged(same)}
        </button>
      ) : null}
      {truncated ? <p className="text-[11px] text-faint">{m.truncated}</p> : null}
    </div>
  );
}

function ChangeRow({ change, open, onToggle, flash }: { change: PlanChange; open: boolean; onToggle(): void; flash: boolean }) {
  const m = useMessages(deployMessages);
  const diffId = useId();
  const reason = change.reason ? m.reason[change.reason] : undefined;
  return (
    <li
      data-change={change.address}
      className={cn('rounded-[10px] border bg-surface-1 transition-colors', open && 'border-border-strong', flash && 'animate-[bp-flash_1.6s_ease-out_both]')}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={diffId}
        aria-label={m.toggleDiff(change.address)}
        onClick={() => {
          onToggle();
          show(change.node);
        }}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
      >
        <span className={cn('mt-px w-6 shrink-0 font-mono text-[11.5px] font-bold', ACTION_TEXT[change.action] ?? 'text-muted')} aria-hidden translate="no">
          {symbolOf(change)}
        </span>
        <span className="min-w-0 flex-1">
          <code className="block truncate text-[12px] font-semibold text-foreground" title={change.address}>
            {change.address}
          </code>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] text-muted">
            {change.importing !== undefined ? <span className="rounded-full bg-primary-soft px-1.5 font-semibold text-primary">{m.importing}</span> : null}
            {change.previousAddress ? (
              <span>
                {m.movedFrom} <code translate="no">{change.previousAddress}</code>
              </span>
            ) : null}
            {change.replacePaths.length > 0 ? <span className="text-danger">{m.forcedBy(change.replacePaths.join(', '))}</span> : null}
            {change.createFirst ? <span>{m.createFirst}</span> : null}
            {reason ? <span>{reason}</span> : null}
          </span>
        </span>
        <ChevronDown className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div id={diffId} className="border-t px-2.5 pb-2.5">
          <Diff change={change} />
        </div>
      ) : null}
    </li>
  );
}

function ChangeList({ id, title, hint, changes, open, setOpen, flash }: {
  id?: string;
  title: ReactNode;
  hint?: string;
  changes: PlanChange[];
  open: string | null;
  setOpen(address: string | null): void;
  flash: string | null;
}) {
  const m = useMessages(deployMessages);
  const [limit, setLimit] = useState(PAGE);
  if (changes.length === 0) return null;
  return (
    <section id={id} className="px-3.5 pt-4">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
        {title} <span className="font-semibold normal-case tracking-normal">{changes.length}</span>
      </h3>
      {hint ? <p className="mb-2 text-[11.5px] leading-snug text-muted">{hint}</p> : null}
      <ul className="space-y-1.5">
        {changes.slice(0, limit).map((c) => (
          <ChangeRow key={c.address} change={c} open={open === c.address} onToggle={() => setOpen(open === c.address ? null : c.address)} flash={flash === c.address} />
        ))}
      </ul>
      {changes.length > limit ? (
        <button type="button" onClick={() => setLimit(limit + PAGE * 4)} className="mt-2 text-[11.5px] font-semibold text-primary hover:text-primary-hover">
          {m.showMore(changes.length - limit)}
        </button>
      ) : null}
    </section>
  );
}

function EmptyState({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children: ReactNode }) {
  return (
    <div className="bp-fade-in px-4 py-6 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">{icon}</span>
      <p className="mt-3 text-[13.5px] font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-[30ch] text-[12px] leading-relaxed text-muted">{body}</p>
      <div className="mt-4 flex flex-col items-stretch gap-2">{children}</div>
    </div>
  );
}

function Commands({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="mt-2 rounded-[10px] border bg-surface-2/60 p-2.5 text-left">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-faint">{label}</p>
      {lines.map((l) => (
        <code key={l} className="mt-1 block break-all text-[11px] text-foreground">
          {l}
        </code>
      ))}
    </div>
  );
}

function FileBar({ name, badge, meta, onOpen, onClear }: { name: string; badge?: string; meta?: string; onOpen(): void; onClear(): void }) {
  const m = useMessages(deployMessages);
  return (
    <div className="flex items-center gap-2 border-b px-3.5 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold" title={name}>
            {name}
          </span>
          {badge ? <span className="shrink-0 rounded-full bg-primary-soft px-1.5 text-[10px] font-bold uppercase tracking-wide text-primary">{badge}</span> : null}
        </div>
        {meta ? <div className="truncate text-[10.5px] text-faint">{meta}</div> : null}
      </div>
      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={m.openAnother} title={m.openAnother} onClick={onOpen}>
        <FileUp className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={onClear}>
        <X className="h-3.5 w-3.5" /> {m.clear}
      </Button>
    </div>
  );
}

function PlanTab() {
  const m = useMessages(deployMessages);
  const loaded = useDeploy((s) => s.plan);
  const focus = useDeploy((s) => s.focus);
  const rootIr = useEditor((s) => s.rootIr);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const declared = useMemo(() => nodeIds(rootIr), [rootIr]);
  const fingerprint = useMemo(() => codeFingerprint(rootIr), [rootIr]);
  const stale = loaded ? loaded.baseline !== fingerprint : false;
  const changes = useMemo(() => loaded?.plan.changes.filter(isNoteworthy) ?? [], [loaded]);
  const counts = useMemo(() => planCounts(changes), [changes]);
  const risky = useMemo(() => riskyChanges(changes), [changes]);
  const q = query.trim().toLowerCase();
  const matching = q ? changes.filter((c) => c.address.toLowerCase().includes(q)) : changes;
  const inCode = matching.filter((c) => declared.has(c.node));
  const orphans = matching.filter((c) => !declared.has(c.node));

  // the inspector's "Show in the plan": that change open, in view
  useEffect(() => {
    if (!focus) return;
    useDeploy.setState({ focus: null });
    setQuery('');
    setOpen(focus);
    setFlash(focus);
    requestAnimationFrame(() =>
      ref.current?.querySelector(`[data-change="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }),
    );
  }, [focus]);

  if (!loaded) {
    return (
      <EmptyState icon={<FileDiff className="h-6 w-6" />} title={m.planEmptyTitle} body={m.planEmptyBody}>
        <Button onClick={() => void pickAndOpen('plan')}>
          <FileUp className="h-4 w-4" /> {m.openPlan}
        </Button>
        <Button variant="outline" onClick={loadSamplePlan}>
          <Sparkles className="h-4 w-4" /> {m.trySample}
        </Button>
        <Commands label={m.makeOne} lines={['terraform plan -out=tfplan', 'terraform show -json tfplan > plan.json']} />
        <p className="text-[11px] text-faint">{m.privacy}</p>
      </EmptyState>
    );
  }
  const { plan } = loaded;
  const chips = (['create', 'update', 'replace', 'delete'] as const).filter((a) => counts[a] > 0);
  return (
    <div ref={ref}>
      <FileBar name={loaded.name} badge={loaded.sample ? m.sample : undefined} meta={plan.terraformVersion ? `Terraform ${plan.terraformVersion}` : undefined} onOpen={() => void pickAndOpen('plan')} onClear={clearPlan} />
      {stale ? (
        <div role="status" className="mx-3.5 mt-3 rounded-[10px] border border-warning/40 bg-warning/8 p-2.5 text-[12px]">
          <p className="flex items-center gap-1.5 font-semibold text-warning">
            <RefreshCw className="h-3.5 w-3.5 shrink-0" /> {m.stale}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{m.staleHint}</p>
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-[11.5px]" onClick={keepPlan}>
              {m.keep}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11.5px]" onClick={clearPlan}>
              {m.clearPlan}
            </Button>
          </div>
        </div>
      ) : null}
      {plan.errored || !plan.complete ? (
        <p role="status" className="mx-3.5 mt-3 flex items-start gap-1.5 rounded-[10px] border border-warning/40 bg-warning/8 p-2.5 text-[11.5px] text-warning">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {plan.errored ? m.errored : m.incomplete}
        </p>
      ) : null}

      <section className="px-3.5 pt-3.5" aria-label={m.tab.plan}>
        {changes.length === 0 ? (
          <p className="rounded-[10px] border border-dashed px-3 py-4 text-center text-[12px] text-muted">{m.noChanges}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5" data-testid="plan-counts">
              {chips.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => document.getElementById(`plan-group-${a}`)?.scrollIntoView({ block: 'start', behavior: scrollBehavior() })}
                  className={cn('inline-flex items-center gap-1 rounded-full border bg-surface-1 px-2 py-0.5 text-[11.5px] font-semibold transition-colors hover:border-border-strong', ACTION_TEXT[a])}
                >
                  <span className="font-mono" translate="no">
                    {PLAN_SYMBOL[a]}
                  </span>
                  {m.counts[a](counts[a])}
                </button>
              ))}
              {counts.imports ? <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11.5px] font-semibold text-primary">{m.imports(counts.imports)}</span> : null}
              {counts.moved ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-semibold text-muted">{m.moved(counts.moved)}</span> : null}
            </div>
            <code className="mt-2 block text-[10.5px] text-faint">{`Plan: ${counts.add} to add, ${counts.change} to change, ${counts.destroy} to destroy.`}</code>
          </>
        )}
        {risky.length > 0 ? (
          <div className="mt-3 rounded-[12px] border border-danger/40 bg-danger/6 p-3" data-testid="plan-risk">
            <p className="flex items-start gap-1.5 text-[12.5px] font-semibold text-danger">
              <ShieldAlert className="mt-px h-4 w-4 shrink-0" /> {m.risk(risky.length)}
            </p>
            <p className="mt-0.5 pl-5.5 text-[11.5px] leading-snug text-muted">{m.riskHint}</p>
            <ul className="mt-2 space-y-1 pl-5.5">
              {risky.map((c) => (
                <li key={c.address}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(c.address);
                      show(c.node);
                      requestAnimationFrame(() => ref.current?.querySelector(`[data-change="${CSS.escape(c.address)}"]`)?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }));
                    }}
                    className="block w-full min-w-0 text-left text-[11.5px] hover:underline"
                  >
                    <code className="block truncate font-semibold text-foreground">{c.address}</code>
                    <span className="block text-danger">
                      {c.action === 'delete' ? m.destroyed : m.replaced}
                      {c.replacePaths.length ? `, ${m.forcedBy(c.replacePaths.join(', '))}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {changes.length > 8 ? (
          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m.searchPlaceholder} aria-label={m.search} className="h-8 pl-8 text-[12.5px]" />
          </label>
        ) : null}
      </section>

      {q && matching.length === 0 ? <p className="px-3.5 pt-4 text-[12px] text-muted">{m.noMatch(query.trim())}</p> : null}
      {GROUPS.map((g) => (
        <ChangeList
          key={g}
          id={`plan-group-${g}`}
          title={m.group[g]}
          changes={inCode.filter((c) => groupOf(c) === g)}
          open={open}
          setOpen={setOpen}
          flash={flash}
        />
      ))}
      <ChangeList
        title={
          <>
            <CloudOff className="h-3 w-3" /> {m.orphans}
          </>
        }
        hint={m.orphansHint}
        changes={orphans}
        open={open}
        setOpen={setOpen}
        flash={flash}
      />
      {plan.outputs.length > 0 && !q ? (
        <section className="px-3.5 pt-4">
          <h3 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.outputs}</h3>
          <ul className="flex flex-wrap gap-1">
            {plan.outputs.map((o) => (
              <li key={o.name} className="rounded-full border bg-surface-2/60 px-2 py-0.5 text-[11px]">
                <span className={cn('mr-1 font-mono font-bold', ACTION_TEXT[o.action])} translate="no">
                  {o.action in PLAN_SYMBOL ? PLAN_SYMBOL[o.action as keyof typeof PLAN_SYMBOL] : ''}
                </span>
                <code>{o.name}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="h-4" />
    </div>
  );
}

function DriftRow({ resource, reveal }: { resource: StateResource; reveal: boolean }) {
  const m = useMessages(deployMessages);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(0);
  const id = useId();
  const instance = resource.instances[Math.min(pick, resource.instances.length - 1)];
  return (
    <li className="rounded-[10px] border bg-surface-1" data-drift={resource.address}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
        <code className="min-w-0 flex-1 truncate text-[12px] font-semibold" title={resource.address}>
          {resource.address}
        </code>
        {resource.instances.length > 1 ? <span className="shrink-0 text-[10.5px] text-muted">{m.instances(resource.instances.length)}</span> : null}
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && instance ? (
        <div id={id} className="space-y-1.5 border-t px-2.5 pb-2.5 pt-2">
          {resource.instances.length > 1 ? (
            <select value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label={m.instances(resource.instances.length)} className="h-7 w-full rounded-sm border bg-surface-1 px-2 font-mono text-[11.5px]">
              {resource.instances.map((inst, i) => (
                <option key={inst.address} value={i}>
                  {inst.address}
                </option>
              ))}
            </select>
          ) : null}
          <AttributeList key={instance.address} instance={instance} reveal={reveal} />
        </div>
      ) : null}
    </li>
  );
}

function StateTab() {
  const m = useMessages(deployMessages);
  const loaded = useDeploy((s) => s.state);
  const rootIr = useEditor((s) => s.rootIr);
  const [reveal, setReveal] = useState(false);
  const blocks = useMemo(() => [...rootIr.resources, ...rootIr.modules], [rootIr]);
  if (!loaded) {
    return (
      <EmptyState icon={<Cloud className="h-6 w-6" />} title={m.stateEmptyTitle} body={m.stateEmptyBody}>
        <p className="flex items-start gap-1.5 rounded-[10px] border border-warning/40 bg-warning/8 p-2.5 text-left text-[11.5px] leading-snug text-muted">
          <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0 text-warning" /> {m.stateWarning}
        </p>
        <Button onClick={() => void pickAndOpen('state')}>
          <FileUp className="h-4 w-4" /> {m.openState}
        </Button>
        <Button variant="outline" onClick={() => openFromState()}>
          <FolderPlus className="h-4 w-4" /> {m.fromState}
        </Button>
        <Commands label={m.remoteBackend} lines={['terraform state pull > terraform.tfstate']} />
      </EmptyState>
    );
  }
  const { state, byNode } = loaded;
  const deployed = blocks.filter((b) => byNode.has(b.id));
  const missing = blocks.filter((b) => !byNode.has(b.id));
  const declared = new Set(blocks.map((b) => b.id));
  const drift = state.resources.filter((r) => r.mode === 'managed' && r.instances.length > 0 && !declared.has(r.node));
  const reads = state.resources.filter((r) => r.mode === 'data').length;
  const pct = blocks.length ? Math.round((deployed.length / blocks.length) * 100) : 0;
  return (
    <div>
      <FileBar name={loaded.name} meta={m.stateMeta(state.serial, state.terraformVersion)} onOpen={() => void pickAndOpen('state')} onClear={clearState} />
      <section className="px-3.5 pt-3.5">
        <p className="text-[12.5px] font-semibold">{m.deployed(deployed.length, blocks.length)}</p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" role="presentation">
          <div className="h-full rounded-full bg-success transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
        {reads > 0 ? <p className="mt-1.5 text-[11px] text-faint">{m.dataSources(reads)}</p> : null}
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => openFromState(state, loaded.name)}>
          <FolderPlus className="h-3.5 w-3.5" /> {m.fromThisState}
        </Button>
      </section>

      <section className="px-3.5 pt-4">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
          <CloudOff className="h-3 w-3" /> {m.notDeployed} <span className="font-semibold normal-case tracking-normal">{missing.length}</span>
        </h3>
        {missing.length === 0 ? (
          <p className="text-[12px] text-muted">{m.allDeployed}</p>
        ) : (
          <>
            <p className="mb-2 text-[11.5px] leading-snug text-muted">{m.notDeployedHint}</p>
            <ul className="flex flex-wrap gap-1">
              {missing.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => show(b.id)}
                    title={m.showOnCanvas(b.id)}
                    className="max-w-full truncate rounded-full border border-dashed bg-surface-1 px-2 py-0.5 font-mono text-[11px] text-foreground transition-colors hover:border-border-strong"
                  >
                    {b.id}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="px-3.5 pb-4 pt-4" data-testid="state-drift">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
          <Radar className="h-3 w-3" /> {m.drift} <span className="font-semibold normal-case tracking-normal">{drift.length}</span>
        </h3>
        {drift.length === 0 ? (
          <p className="text-[12px] text-muted">{m.noDrift}</p>
        ) : (
          <>
            <div className="mb-2 flex items-start gap-2">
              <p className="flex-1 text-[11.5px] leading-snug text-muted">{m.driftHint}</p>
              <RevealToggle reveal={reveal} onChange={setReveal} />
            </div>
            <ul className="space-y-1.5">
              {drift.map((r) => (
                <DriftRow key={r.address} resource={r} reveal={reveal} />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

export function DeployPanel() {
  const m = useMessages(deployMessages);
  const tab = useDeploy((s) => s.tab);
  const hasPlan = useDeploy((s) => s.plan !== null);
  const hasState = useDeploy((s) => s.state !== null);
  const busy = useDeploy((s) => s.busy);
  const panelRef = useRef<HTMLElement>(null);
  useLayer(true, () => setDeployPanel(false), { kind: 'panel', node: panelRef });
  const tabs: Array<{ id: DeployTab; dot: boolean }> = [
    { id: 'plan', dot: hasPlan },
    { id: 'state', dot: hasState },
  ];
  return (
    <aside ref={panelRef} aria-label={m.panel} data-testid="deploy-panel" className="bp-drawer-left mt-10 flex w-full flex-col overflow-hidden rounded-[14px] border bg-surface-1 shadow-xl">
      <div className="flex items-center gap-2 border-b px-3.5 py-3">
        <FileDiff className="h-4 w-4 text-primary" />
        <h2 className="flex-1 text-[13.5px] font-semibold">{m.panel}</h2>
        <button type="button" aria-label={m.close} onClick={() => setDeployPanel(false)} className="rounded-[6px] p-1 text-faint transition-colors hover:bg-surface-2 hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="border-b px-3.5 py-2">
        <div className="flex rounded-sm border bg-surface-2 p-0.5" role="tablist" aria-label={m.panel}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => useDeploy.setState({ tab: t.id })}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 py-1 text-[12px] font-semibold transition-colors',
                tab === t.id ? 'bg-surface-1 text-foreground shadow-xs' : 'text-muted hover:text-foreground',
              )}
            >
              {m.tab[t.id]}
              {t.dot ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden /> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel" aria-label={m.tab[tab]} aria-busy={busy}>
        {busy ? (
          <p role="status" className="bp-fade-in flex items-center gap-2 border-b bg-surface-2/60 px-3.5 py-2 text-[12px] text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {m.readingFile}
          </p>
        ) : null}
        {tab === 'plan' ? <PlanTab /> : <StateTab />}
      </div>
    </aside>
  );
}
