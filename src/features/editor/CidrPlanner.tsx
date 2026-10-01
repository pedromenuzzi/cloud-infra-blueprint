/**
 * Address plan card in the inspector: for a VPC / VNet, how its range is
 * used and buttons that carve new subnets from the free space; for a subnet,
 * its size, usable addresses and share of the network.
 */
import { AlertTriangle, Columns3, Network, Plus } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { showToast } from '@/components/Toast';
import { Button, Select } from '@/components/ui';
import { intlTag } from '@/i18n/format';
import { useLocale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
import type { IR, ResourceNode } from '@/ir/types';
import { blockSize, formatAddress, formatCidrBlock, RESERVED_IPS, type CidrBlock } from '@/resources/cidr';
import { cn } from '@/lib/utils';
import { canvasApi } from './canvasApi';
import { cidrPlannerMessages } from './CidrPlanner.messages';
import {
  addSubnetOps,
  defaultPrefix,
  fitsBlocks,
  networkPlan,
  sizeChoices,
  splitAcrossZonesOps,
  subnetPlan,
  zonesFor,
  type NetworkPlan,
  type PlanOutcome,
  type PlanResult,
} from './cidrPlan';
import { useEditor } from './store';

const NETWORK_TYPES = new Set(['aws_vpc', 'azurerm_virtual_network', 'google_compute_network']);
const SUBNET_TYPES = new Set(['aws_subnet', 'azurerm_subnet', 'google_compute_subnetwork']);
const SPLIT_COUNTS = [2, 3, 4];

/** `65,536` / `65.536` — in the UI language in effect (the cards re-render on a switch) */
const fmt = (n: bigint | number) => new Intl.NumberFormat(intlTag()).format(n);
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary';

/** `0.4%` / `0,4%`, `<0.1%` — never a rounded-away 0% for a range that is in use */
function percent(part: bigint, whole: bigint): string {
  if (whole === 0n || part === 0n) return '0%';
  const value = Number((part * 100_000n) / whole) / 1000;
  const text = value < 0.05 ? '<0.1%' : `${value.toFixed(1).replace(/\.0$/, '')}%`;
  return intlTag() === 'pt-BR' ? text.replace('.', ',') : text;
}

function select(id: string) {
  useEditor.getState().setSelection(id, 'canvas');
  canvasApi()?.focusNode(id);
}

export function CidrPlanner({ node }: { node: ResourceNode }) {
  if (NETWORK_TYPES.has(node.type)) return <NetworkCard node={node} />;
  if (SUBNET_TYPES.has(node.type)) return <SubnetCard node={node} />;
  return null;
}

function Card({ children }: { children: React.ReactNode }) {
  const m = useMessages(cidrPlannerMessages);
  const id = useId();
  return (
    // inline-size containment: the selects' option widths must not widen the inspector (a fieldset sizes to min-content)
    <section aria-labelledby={id} data-testid="cidr-planner" className="rounded-[10px] border bg-surface-1 p-2.5 contain-inline-size">
      <h3 id={id} className="mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
        <Network className="h-3 w-3" aria-hidden="true" /> {m.title}
      </h3>
      {children}
    </section>
  );
}

function Note({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warning' }) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 text-[11px] leading-snug',
        tone === 'warning' ? 'font-medium text-warning' : 'text-muted',
      )}
    >
      {tone === 'warning' ? <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

interface RangeBarProps {
  range: CidrBlock;
  blocks: Array<{ id: string; block: CidrBlock }>;
  highlight?: string;
  label: string;
}

/**
 * One network range drawn to scale, with a segment where each subnet sits.
 * `highlight` picks out one subnet (the others fade).
 */
function RangeBar({ range, blocks, highlight, label }: RangeBarProps) {
  const size = Number(blockSize(range));
  return (
    <div role="img" aria-label={label} className="relative h-2.5 overflow-hidden rounded-full border bg-surface-2">
      {blocks
        .filter((b) => b.block.start >= range.start && b.block.end <= range.end)
        .map((b) => (
          <span
            key={`${b.id}:${b.block.start}`}
            className={cn(
              'absolute inset-y-0 transition-[left,width] duration-300',
              highlight && b.id !== highlight ? 'bg-primary/30' : 'bg-primary',
            )}
            style={{
              left: `${(Number(b.block.start - range.start) / size) * 100}%`,
              width: `max(3px, ${(Number(blockSize(b.block)) / size) * 100}%)`,
            }}
          />
        ))}
    </div>
  );
}

function blocksIn(plan: NetworkPlan) {
  return plan.rows.flatMap((r) => (r.block ? [{ id: r.node.id, block: r.block }] : []));
}

/* ------------------------------------------------------------- network */

function NetworkCard({ node }: { node: ResourceNode }) {
  const ir = useEditor((s) => s.ir);
  // the plan's row labels are text: build them again in the other language
  const locale = useLocale((s) => s.locale);
  const plan = useMemo(() => networkPlan(ir, node.id), [ir, node.id, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!plan) return null;
  return (
    <Card>
      <div className="space-y-2.5">
        <NetworkSummary plan={plan} />
        <SubnetList plan={plan} />
        {plan.blocked ? null : <PlannerActions ir={ir} plan={plan} />}
      </div>
    </Card>
  );
}

function NetworkSummary({ plan }: { plan: NetworkPlan }) {
  const m = useMessages(cidrPlannerMessages);
  const { blocked } = plan;
  if (blocked?.reason === 'none') {
    return <Note>{m.gcpNetwork}</Note>;
  }
  if (blocked) {
    const what = plan.network.node.type === 'aws_vpc' ? 'VPC' : 'VNet';
    const expression = m.expressionRange(what);
    return (
      <Note>
        {blocked.reason === 'invalid' ? (
          <>
            <code className="font-mono">{blocked.field}</code> <code className="font-mono">"{blocked.text}"</code>
            {m.invalidRange}
          </>
        ) : blocked.reason === 'missing' ? (
          <>{m.noRange(what)}</>
        ) : (
          <>
            {expression.before}
            <code className="break-all font-mono">{blocked.text}</code>
            {expression.after}
          </>
        )}
      </Note>
    );
  }
  const via = plan.network.ranges.find((r) => r.via)?.via;
  // the planner divides IPv4; IPv6 ranges are listed for completeness
  const ipv6 = plan.network.ranges.filter((r) => r.block?.family === 'ipv6').map((r) => r.text);
  const used = percent(plan.allocated, plan.total);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <code className="truncate font-mono text-[13px] font-semibold text-foreground">
          {plan.ranges.map(formatCidrBlock).join(', ')}
        </code>
        <span className="shrink-0 text-[11px] text-muted">{m.addresses(fmt(plan.total))}</span>
      </div>
      {via ? <p className="-mt-1 text-[10.5px] text-faint">{m.fromDefault(via)}</p> : null}
      {ipv6.length > 0 ? (
        <p className="-mt-1 truncate text-[10.5px] text-faint">
          {m.andIpv6}
          <span className="font-mono">{ipv6.join(', ')}</span>
        </p>
      ) : null}
      {plan.ranges.map((range) => (
        <RangeBar
          key={formatCidrBlock(range)}
          range={range}
          blocks={blocksIn(plan)}
          label={m.barLabel(formatCidrBlock(range), fmt(plan.allocated), fmt(plan.total), used)}
        />
      ))}
      <div className="flex justify-between gap-2 text-[11px] text-muted">
        <span>
          <span className="font-semibold text-foreground">{fmt(plan.allocated)}</span>
          {m.allocated}
          {used}
        </span>
        <span>
          <span className="font-semibold text-foreground">{fmt(plan.total - plan.allocated)}</span>
          {m.free}
        </span>
      </div>
    </div>
  );
}

function SubnetList({ plan }: { plan: NetworkPlan }) {
  const m = useMessages(cidrPlannerMessages);
  const gcp = plan.provider === 'gcp';
  if (plan.rows.length === 0) return <p className="text-[11px] text-faint">{m.noSubnets(gcp)}</p>;
  return (
    <div>
      <h4 className="mb-1 text-[10.5px] font-semibold text-muted">{m.subnetCount(plan.rows.length, gcp)}</h4>
      <ul className="max-h-56 space-y-1 overflow-y-auto" aria-label={m.subnetList(gcp)}>
        {plan.rows.map((row) => (
          <li key={row.instance ?? row.node.id}>
            <button
              type="button"
              onClick={() => select(row.node.id)}
              title={m.select(row.instance ?? row.node.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-[8px] border bg-surface-2/60 px-2 py-1.5 text-left transition-colors',
                'hover:border-border-strong hover:bg-surface-2',
                FOCUS,
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-foreground">{row.name}</span>
                <span className={cn('block truncate font-mono text-[10.5px]', row.block ? 'text-muted' : 'italic text-faint')}>
                  {row.label}
                  {row.zone ? <span className="text-faint"> · {row.zone}</span> : null}
                </span>
              </span>
              {row.block ? (
                <span className="shrink-0 text-right text-[10.5px] leading-tight text-faint">
                  <span className="block font-mono text-muted">/{row.block.prefix}</span>
                  {fmt(blockSize(row.block))}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {plan.unknown > 0 ? <p className="mt-1 text-[10.5px] text-faint">{m.unknownRanges(plan.unknown)}</p> : null}
    </div>
  );
}

function PlannerActions({ ir, plan }: { ir: IR; plan: NetworkPlan }) {
  const m = useMessages(cidrPlannerMessages);
  const applyOps = useEditor((s) => s.applyCanvasOps);
  const choices = useMemo(() => sizeChoices(plan), [plan]);
  const [picked, setPicked] = useState<number | undefined>();
  const [count, setCount] = useState(3);
  const hintId = useId();
  const prefix = picked !== undefined && choices.some((c) => c.prefix === picked) ? picked : defaultPrefix(choices);
  const choice = choices.find((c) => c.prefix === prefix);
  const aws = plan.provider === 'aws';
  if (choices.length === 0) return null;

  const run = (result: PlanOutcome, done: (r: PlanResult) => string) => {
    if ('error' in result) {
      showToast(result.error, 'error');
      return;
    }
    applyOps(result.ops);
    showToast(done(result), 'success');
  };
  const add = () =>
    prefix !== undefined &&
    run(addSubnetOps(ir, plan.network.node.id, prefix), ({ created: [c] }) => m.added(c.id, c.cidr, c.zone));
  const split = () =>
    prefix !== undefined &&
    run(splitAcrossZonesOps(ir, plan.network.node.id, prefix, count), ({ created }) =>
      m.addedAcross(created.length, created.map((c) => c.zone).join(', ')),
    );

  const splitFits = prefix !== undefined && fitsBlocks(plan, prefix, count);
  const splitHint = !plan.region
    ? m.setRegion
    : !splitFits
      ? m.noRoomSplit(count, prefix!)
      : m.splitPlan(count, prefix!, zonesFor(plan.region, count).join(', '));

  return (
    <div className="space-y-2 border-t pt-2.5">
      <div className="flex items-end gap-1.5">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] font-medium text-muted">{m.subnetSize}</span>
          <Select
            aria-label={m.subnetSizeLabel}
            value={prefix ?? ''}
            onChange={(e) => setPicked(Number(e.target.value))}
            disabled={prefix === undefined}
          >
            {choices.map((c) => (
              <option key={c.prefix} value={c.prefix} disabled={!c.fits}>
                /{c.prefix} · {fmt(c.addresses)}
                {c.fits ? '' : m.noRoom}
              </option>
            ))}
          </Select>
        </label>
        <Button className="shrink-0" onClick={add} disabled={!choice?.fits}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {m.addSubnet}
        </Button>
      </div>
      {choice ? (
        <p className="text-[10.5px] text-faint">{m.usablePerSubnet(fmt(choice.usable), plan.provider, RESERVED_IPS[plan.provider])}</p>
      ) : (
        <Note tone="warning">{m.full(plan.network.node.id)}</Note>
      )}
      {aws ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              className="min-w-0 flex-1"
              onClick={split}
              disabled={!plan.region || !splitFits}
              aria-label={m.splitLabel(count)}
              aria-describedby={hintId}
            >
              <Columns3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {/* reads on with the zone picker beside it: "Split across | 3 AZs" */}
              <span className="truncate">{m.splitAcross}</span>
            </Button>
            <div className="w-[84px] shrink-0">
              <Select
                aria-label={m.zonesLabel}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {SPLIT_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {m.zones(n)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p id={hintId} className="text-[10.5px] text-faint">
            {splitHint}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- subnet */

function SubnetCard({ node }: { node: ResourceNode }) {
  const m = useMessages(cidrPlannerMessages);
  const ir = useEditor((s) => s.ir);
  // the parent plan's row labels are text: build them again in the other language
  const locale = useLocale((s) => s.locale);
  const plan = useMemo(() => subnetPlan(ir, node.id), [ir, node.id, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!plan) return null;
  const { block, usable, parent, instances } = plan;
  const reserved = RESERVED_IPS[plan.provider];
  const networkWord = parent?.provider === 'azure' ? 'VNet' : 'VPC';
  return (
    <Card>
      <div className="space-y-2">
        {instances ? <InstanceList rows={instances} kind={plan.subnet.node.args.count ? 'count' : 'for_each'} /> : null}
        {block ? (
          <>
            {instances ? null : (
              <code className="block truncate font-mono text-[13px] font-semibold text-foreground">{formatCidrBlock(block)}</code>
            )}
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <Stat value={fmt(blockSize(block))} label={instances ? m.statEachAddresses : m.statAddresses} />
              <Stat value={usable ? fmt(usable.count) : '0'} label={instances ? m.statEachUsable : m.statUsable} />
              {plan.share !== undefined ? (
                <Stat
                  value={percent(BigInt(Math.round(plan.share * 1e6)), 1_000_000n)}
                  label={instances ? m.statAllOf(instances.length, networkWord) : m.statOf(networkWord)}
                />
              ) : (
                <Stat value={`/${block.prefix}`} label={m.statPrefix} />
              )}
            </div>
            {usable ? (
              <p className="text-[11px] text-muted">
                {instances ? <span className="font-mono text-foreground">{instances[0].name} · </span> : null}
                {m.usable}
                <span className="font-mono text-foreground">{formatAddress(usable.first, block.family)}</span> –{' '}
                <span className="font-mono text-foreground">{formatAddress(usable.last, block.family)}</span>
                <span className="block text-[10.5px] text-faint">{m.keepsEvery(plan.provider, reserved)}</span>
              </p>
            ) : (
              <Note tone="warning">{m.tooSmall(plan.provider, reserved)}</Note>
            )}
          </>
        ) : plan.unresolved ? (
          <Note>
            {m.subnetExpression.before}
            <code className="break-all font-mono">{plan.unresolved}</code>
            {m.subnetExpression.after}
          </Note>
        ) : (
          <Note>{plan.subnet.ranges[0] ? m.notIpv4(plan.subnet.ranges[0].text) : m.noIpv4}</Note>
        )}
        {plan.others.length > 0 ? (
          <ul className="space-y-0.5 text-[11px] text-muted">
            {plan.others.map((r) => (
              <li key={`${r.field}:${r.text}`} className="flex justify-between gap-2">
                <span>{r.field === 'secondary_ip_range' ? m.secondary : r.block?.family === 'ipv6' ? 'IPv6' : r.field}</span>
                <code className="truncate font-mono">{r.text}</code>
              </li>
            ))}
          </ul>
        ) : null}
        {plan.outside && parent ? <Note tone="warning">{m.outside(parent.network.node.id)}</Note> : null}
        {parent && block && !parent.blocked
          ? parent.ranges
              .filter((r) => r.start <= block.start && block.end <= r.end)
              .map((range) => (
                <RangeBar
                  key={formatCidrBlock(range)}
                  range={range}
                  blocks={blocksIn(parent)}
                  highlight={node.id}
                  label={m.inside(formatCidrBlock(block), parent.network.node.id, formatCidrBlock(range))}
                />
              ))
          : null}
        {parent ? (
          <button
            type="button"
            onClick={() => select(parent.network.node.id)}
            className={cn('block max-w-full truncate rounded-[4px] text-left text-[11px] font-medium text-primary hover:underline', FOCUS)}
          >
            {m.inNetwork(parent.network.node.id, parent.ranges.map(formatCidrBlock).join(', '))}
          </button>
        ) : null}
      </div>
    </Card>
  );
}

/** the instances of a repeated subnet: each one's range and zone */
function InstanceList({ rows, kind }: { rows: NetworkPlan['rows']; kind: 'count' | 'for_each' }) {
  const m = useMessages(cidrPlannerMessages);
  return (
    <div>
      <h4 className="mb-1 text-[10.5px] font-semibold text-muted">{m.instanceCount(rows.length, kind)}</h4>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto" aria-label={m.instanceCount(rows.length, kind)}>
        {rows.map((row) => (
          <li key={row.instance ?? row.name} className="flex items-baseline justify-between gap-2 text-[11.5px]">
            <span className="min-w-0 truncate font-mono font-semibold text-foreground">{row.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted">
              {row.label}
              {row.zone ? <span className="text-faint"> · {row.zone}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[8px] border bg-surface-2 px-1 py-1.5">
      <div className="truncate text-[13px] font-bold leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[9.5px] uppercase tracking-wide text-faint">{label}</div>
    </div>
  );
}
