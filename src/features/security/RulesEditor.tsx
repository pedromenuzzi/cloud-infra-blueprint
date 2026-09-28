/**
 * Full-width rules editor for AWS security groups & network ACLs, Azure NSGs
 * and GCP firewalls. Every change is a regular canvas op (undoable, patched
 * into the HCL); rows defined as standalone resources are shown read-only.
 */
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Info, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ContextMenu, type MenuEntry } from '@/components/ContextMenu';
import { Modal } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { useEditor } from '@/features/editor/store';
import { lit } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { IR, ResourceNode } from '@/ir/types';
import { cn } from '@/lib/utils';
import { ResourceIcon } from '@/resources/icons';
import { getDef } from '@/resources/registry';
import { ruleRisk } from '@/security/audit';
import {
  addRuleOp,
  nextPriority,
  PRESETS,
  removeRuleOp,
  updateRuleOp,
  type RuleDraft,
} from '@/security/edit';
import {
  OWNER_TYPES,
  peerLabel,
  type Direction,
  type OwnerKind,
  type RulePeer,
  type SecurityRule,
} from '@/security/model';
import { SEVERITY_COLORS, getAudit, useSecurityUi } from './securityStore';

const KIND_INFO: Record<OwnerKind, { title: string; note: string }> = {
  sg: {
    title: 'Security group',
    note: 'Stateful — replies to allowed traffic are let out automatically. Rules only allow; anything not listed is denied.',
  },
  nacl: {
    title: 'Network ACL',
    note: 'Stateless — evaluated in rule-number order, first match wins. Remember to allow return traffic on ephemeral ports (1024–65535).',
  },
  nsg: {
    title: 'Network security group',
    note: 'Evaluated by priority (lower first). Service tags like VirtualNetwork or Internet work as sources.',
  },
  firewall: {
    title: 'Firewall rule',
    note: 'Applies to instances in its network with matching target tags (all instances when none are set).',
  },
};

const inputCls =
  'h-7 w-full rounded-[6px] border bg-surface-1 px-2 text-[12px] text-foreground outline-none transition-colors focus:border-primary disabled:bg-surface-2 disabled:text-faint';

function toDraft(rule: SecurityRule): RuleDraft {
  const protocol = (['tcp', 'udp', 'icmp', 'all'].includes(rule.protocol) ? rule.protocol : 'tcp') as RuleDraft['protocol'];
  return {
    protocol,
    fromPort: rule.fromPort,
    toPort: rule.toPort,
    peers: rule.peers,
    description: rule.description,
    action: rule.action,
    priority: rule.priority,
  };
}

function presetOf(d: RuleDraft): string {
  const hit = PRESETS.find((p) => p.protocol === d.protocol && p.fromPort === d.fromPort && p.toPort === d.toPort);
  return hit?.id ?? 'custom';
}

function portsText(d: RuleDraft) {
  if (d.protocol === 'all' || d.protocol === 'icmp') return '';
  if (d.fromPort === null) return '0-65535';
  return d.fromPort === d.toPort ? String(d.fromPort) : `${d.fromPort}-${d.toPort}`;
}

function parsePorts(text: string): { fromPort: number | null; toPort: number | null } | null {
  const t = text.trim();
  if (t === '' || t === '*' || t === '0-65535') return { fromPort: null, toPort: null };
  const m = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(t);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  if (from > 65535 || to > 65535 || to < from) return null;
  return { fromPort: from, toPort: to };
}

const CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-f:]+\/\d{1,3}$/i;

/** VPC CIDR for an AWS owner, used for "VPC only" shortcuts */
function vpcCidrOf(ir: IR, node: ResourceNode): string | undefined {
  const e = node.args.vpc_id;
  if (e?.kind !== 'ref') return undefined;
  const [type, name] = e.path.split('.');
  const vpc = ir.resources.find((r) => r.id === `${type}.${name}`);
  const cidr = vpc?.args.cidr_block;
  return cidr?.kind === 'literal' ? String(cidr.value) : undefined;
}

// ------------------------------------------------------------ peer editor

function PeerEditor({
  kind,
  peers,
  onChange,
  groups,
  vpcCidr,
  disabled,
}: {
  kind: OwnerKind;
  peers: RulePeer[];
  onChange(peers: RulePeer[]): void;
  groups: ResourceNode[];
  vpcCidr?: string;
  disabled?: boolean;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const multi = kind === 'sg' || kind === 'firewall';
  const set = (p: RulePeer) => onChange(multi ? [...peers.filter((x) => JSON.stringify(x) !== JSON.stringify(p)), p] : [p]);
  const label = (p: RulePeer) => peerLabel(p, (id) => id.split('.').slice(1).join('.'));

  const entries: MenuEntry[] = [
    { id: 'any', label: 'Anywhere (0.0.0.0/0)', onSelect: () => set({ kind: 'any' }) },
    ...(vpcCidr ? [{ id: 'vpc', label: `This VPC (${vpcCidr})`, onSelect: () => set({ kind: 'cidr', value: vpcCidr }) } as MenuEntry] : []),
    ...(kind === 'nsg'
      ? ([
          { id: 'vnet', label: 'VirtualNetwork', onSelect: () => set({ kind: 'other', value: 'VirtualNetwork' }) },
          { id: 'lb', label: 'AzureLoadBalancer', onSelect: () => set({ kind: 'other', value: 'AzureLoadBalancer' }) },
        ] as MenuEntry[])
      : []),
    ...(kind === 'sg'
      ? ([
          'separator',
          ...groups.map((g) => ({
            id: g.id,
            label: `Security group · ${g.name}`,
            onSelect: () => set({ kind: 'group', ref: g.id }),
          })),
          { id: 'self', label: 'Itself (same group)', onSelect: () => set({ kind: 'self' }) },
        ] as MenuEntry[])
      : []),
    'separator',
    { id: 'custom', label: 'Custom CIDR…', onSelect: () => setCustom('') },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1">
      {peers.map((p, i) => (
        <span
          key={i}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-medium',
            p.kind === 'any' ? 'border-danger/40 bg-danger/8 text-danger' : 'bg-surface-2 text-foreground',
          )}
        >
          <span className="truncate font-mono">{label(p)}</span>
          {!disabled && (multi || peers.length > 1) ? (
            <button type="button" aria-label={`Remove ${label(p)}`} onClick={() => onChange(peers.filter((_, j) => j !== i))} className="text-faint hover:text-foreground">
              <X className="h-2.5 w-2.5" />
            </button>
          ) : null}
        </span>
      ))}
      {custom !== null ? (
        <input
          autoFocus
          value={custom}
          placeholder="10.0.0.0/16"
          onChange={(e) => setCustom(e.target.value)}
          onBlur={() => setCustom(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setCustom(null);
            if (e.key === 'Enter' && CIDR.test(custom.trim())) {
              set({ kind: 'cidr', value: custom.trim() });
              setCustom(null);
            }
          }}
          className={cn(inputCls, 'h-6 w-32 font-mono', custom && !CIDR.test(custom.trim()) && 'border-danger')}
          aria-label="Custom CIDR"
        />
      ) : !disabled ? (
        <button
          type="button"
          aria-label={multi ? 'Add source' : 'Change source'}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 4 });
          }}
          className="inline-flex h-5 items-center gap-0.5 rounded-full border border-dashed px-1.5 text-[10.5px] text-muted hover:border-border-strong hover:text-foreground"
        >
          <Plus className="h-2.5 w-2.5" /> {multi ? 'add' : 'change'}
        </button>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} label="Choose source" entries={entries} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------ rows

function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-2 py-1.5 align-middle', className)}>{children}</td>;
}

function RuleRow({
  rule,
  kind,
  direction,
  node,
  groups,
  vpcCidr,
  apply,
}: {
  rule: SecurityRule;
  kind: OwnerKind;
  direction: Direction;
  node: ResourceNode;
  groups: ResourceNode[];
  vpcCidr?: string;
  apply(op: Op): void;
}) {
  const draft = toDraft(rule);
  const [ports, setPorts] = useState(portsText(draft));
  const [description, setDescription] = useState(draft.description ?? '');
  useEffect(() => setPorts(portsText(draft)), [rule.fromPort, rule.toPort, rule.protocol]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setDescription(draft.description ?? ''), [rule.description]); // eslint-disable-line react-hooks/exhaustive-deps
  const readOnly = rule.origin.kind === 'resource';
  const risk = ruleRisk(rule);
  const update = (patch: Partial<RuleDraft>) => {
    if (rule.origin.kind !== 'inline') return;
    apply(updateRuleOp(node, kind, direction, rule.origin.field, rule.origin.index, { ...draft, ...patch }));
  };
  const portsValid = parsePorts(ports) !== null;
  const noPorts = draft.protocol === 'all' || draft.protocol === 'icmp';

  return (
    <tr className={cn('border-t transition-colors hover:bg-surface-2/40', readOnly && 'bg-surface-2/40')} data-rule={rule.id}>
      {kind === 'nacl' || kind === 'nsg' ? (
        <Cell className="w-16">
          <input
            type="number"
            aria-label={kind === 'nacl' ? 'Rule number' : 'Priority'}
            defaultValue={rule.priority}
            disabled={readOnly}
            onBlur={(e) => Number(e.target.value) !== rule.priority && update({ priority: Number(e.target.value) })}
            className={cn(inputCls, 'font-mono')}
          />
        </Cell>
      ) : null}
      {kind !== 'sg' && kind !== 'firewall' ? (
        <Cell className="w-20">
          <select
            aria-label="Action"
            value={draft.action}
            disabled={readOnly}
            onChange={(e) => update({ action: e.target.value as 'allow' | 'deny' })}
            className={cn(inputCls, draft.action === 'deny' ? 'text-danger' : 'text-success')}
          >
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
        </Cell>
      ) : null}
      <Cell className="w-36">
        <select
          aria-label="Service"
          value={presetOf(draft)}
          disabled={readOnly}
          onChange={(e) => {
            const p = PRESETS.find((x) => x.id === e.target.value);
            if (p) update({ protocol: p.protocol, fromPort: p.fromPort, toPort: p.toPort });
          }}
          className={inputCls}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </Cell>
      <Cell className="w-24">
        <select
          aria-label="Protocol"
          value={draft.protocol}
          disabled={readOnly}
          onChange={(e) => {
            const protocol = e.target.value as RuleDraft['protocol'];
            update({ protocol, ...(protocol === 'all' || protocol === 'icmp' ? { fromPort: null, toPort: null } : {}) });
          }}
          className={inputCls}
        >
          <option value="tcp">TCP</option>
          <option value="udp">UDP</option>
          <option value="icmp">ICMP</option>
          <option value="all">All</option>
        </select>
      </Cell>
      <Cell className="w-28">
        <input
          aria-label="Port range"
          value={noPorts ? '' : ports}
          placeholder={noPorts ? 'all' : '443 or 8000-8080'}
          disabled={readOnly || noPorts}
          onChange={(e) => setPorts(e.target.value)}
          onBlur={() => {
            const p = parsePorts(ports);
            if (p && (p.fromPort !== draft.fromPort || p.toPort !== draft.toPort)) update(p);
            else if (!p) setPorts(portsText(draft));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={cn(inputCls, 'font-mono', !portsValid && 'border-danger')}
        />
      </Cell>
      {kind !== 'firewall' ? (
        <Cell className="min-w-[180px]">
          <PeerEditor
            kind={kind}
            peers={draft.peers}
            groups={groups.filter((g) => g.id !== node.id)}
            vpcCidr={vpcCidr}
            disabled={readOnly}
            onChange={(peers) => update({ peers })}
          />
        </Cell>
      ) : null}
      {kind === 'sg' || kind === 'nsg' ? (
        <Cell className="min-w-[140px]">
          <input
            aria-label={kind === 'nsg' ? 'Name' : 'Description'}
            value={description}
            placeholder={kind === 'nsg' ? 'rule name' : 'what is this for?'}
            disabled={readOnly}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== (draft.description ?? '') && update({ description: description || undefined })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className={inputCls}
          />
        </Cell>
      ) : null}
      <Cell className="w-8">
        {risk ? (
          <span title={risk.title} className="flex h-6 w-6 items-center justify-center rounded-full" style={{ color: SEVERITY_COLORS[risk.severity], background: `color-mix(in srgb, ${SEVERITY_COLORS[risk.severity]} 14%, transparent)` }}>
            <AlertTriangle className="h-3.5 w-3.5" aria-label={risk.title} />
          </span>
        ) : null}
      </Cell>
      <Cell className="w-10 text-right">
        {readOnly ? (
          <button
            type="button"
            title={`Defined in ${rule.origin.kind === 'resource' ? rule.origin.id : ''}`}
            onClick={() => {
              if (rule.origin.kind !== 'resource') return;
              useSecurityUi.getState().openRules(null);
              useEditor.getState().setSelection(rule.origin.id, 'canvas');
              canvasApi()?.focusNode(rule.origin.id);
            }}
            className="rounded-[6px] p-1 text-faint hover:bg-surface-2 hover:text-foreground"
            aria-label="Show rule resource"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Delete rule"
            onClick={() => rule.origin.kind === 'inline' && apply(removeRuleOp(node, rule.origin.field, rule.origin.index))}
            className="rounded-[6px] p-1 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </Cell>
    </tr>
  );
}

// ------------------------------------------------------------ GCP settings

function FirewallSettings({ node, apply }: { node: ResourceNode; apply(op: Op): void }) {
  const str = (k: string) => (node.args[k]?.kind === 'literal' ? String(node.args[k].value) : '');
  const listText = (k: string) => {
    const e = node.args[k];
    return e?.kind === 'list' ? e.items.map((i) => (i.kind === 'literal' ? String(i.value) : '')).join(', ') : '';
  };
  const setList = (k: string, text: string) => {
    const items = text.split(',').map((t) => t.trim()).filter(Boolean);
    apply(items.length ? { kind: 'set_arg', nodeId: node.id, field: k, value: { kind: 'list', items: items.map((i) => lit(i)) } } : { kind: 'unset_arg', nodeId: node.id, field: k });
  };
  const action = node.args.deny ? 'deny' : 'allow';
  const egress = str('direction') === 'EGRESS';
  return (
    <div className="grid grid-cols-2 gap-3 border-b px-5 py-4 sm:grid-cols-4">
      <label className="text-[11.5px] font-medium text-muted">
        Direction
        <select value={egress ? 'EGRESS' : 'INGRESS'} onChange={(e) => apply({ kind: 'set_arg', nodeId: node.id, field: 'direction', value: lit(e.target.value) })} className={cn(inputCls, 'mt-1')}>
          <option value="INGRESS">Ingress</option>
          <option value="EGRESS">Egress</option>
        </select>
      </label>
      <label className="text-[11.5px] font-medium text-muted">
        Action
        <select
          value={action}
          onChange={(e) => {
            if (e.target.value === action) return;
            const from = action;
            const to = e.target.value;
            const value = node.args[from];
            if (!value) return;
            apply({ kind: 'unset_arg', nodeId: node.id, field: from });
            apply({ kind: 'set_arg', nodeId: node.id, field: to, value });
          }}
          className={cn(inputCls, 'mt-1', action === 'deny' ? 'text-danger' : 'text-success')}
        >
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
      </label>
      <label className="text-[11.5px] font-medium text-muted">
        {egress ? 'Destination ranges' : 'Source ranges'}
        <input defaultValue={listText(egress ? 'destination_ranges' : 'source_ranges')} key={listText(egress ? 'destination_ranges' : 'source_ranges')} onBlur={(e) => setList(egress ? 'destination_ranges' : 'source_ranges', e.target.value)} placeholder="0.0.0.0/0" className={cn(inputCls, 'mt-1 font-mono')} />
      </label>
      <label className="text-[11.5px] font-medium text-muted">
        Target tags
        <input defaultValue={listText('target_tags')} key={listText('target_tags')} onBlur={(e) => setList('target_tags', e.target.value)} placeholder="web, ssh" className={cn(inputCls, 'mt-1')} />
      </label>
    </div>
  );
}

// ------------------------------------------------------------ editor

export function RulesEditor() {
  const owner = useSecurityUi((s) => s.editing);
  const openRules = useSecurityUi((s) => s.openRules);
  const ir = useEditor((s) => s.ir);
  const node = owner ? ir.resources.find((r) => r.id === owner) : undefined;
  const kind = node ? OWNER_TYPES[node.type] : undefined;
  const [direction, setDirection] = useState<Direction>('inbound');
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDirection('inbound'), [owner]);

  const audit = getAudit(ir);
  const rules = useMemo(() => (owner ? (audit.topology.rules.get(owner) ?? []) : []), [audit, owner]);
  if (!node || !kind) return null;

  const firewall = kind === 'firewall';
  const shown = firewall ? rules : rules.filter((r) => r.direction === direction);
  const count = (d: Direction) => rules.filter((r) => r.direction === d).length;
  const groups = ir.resources.filter((r) => r.type === 'aws_security_group');
  const vpcCidr = vpcCidrOf(ir, node);
  const apply = (op: Op) => useEditor.getState().applyCanvasOps([op]);
  const current = () => useEditor.getState().ir.resources.find((r) => r.id === node.id) ?? node;
  const def = getDef(node.type);

  const addPreset = (presetId: string) => {
    const p = PRESETS.find((x) => x.id === presetId)!;
    const web = p.id === 'https' || p.id === 'http';
    // safe defaults: only web traffic opens to the world; the rest starts VPC-only
    const peer: RulePeer =
      direction === 'outbound' || web || !vpcCidr
        ? kind === 'nsg' && !web && direction === 'inbound'
          ? { kind: 'other', value: 'VirtualNetwork' }
          : { kind: 'any' }
        : { kind: 'cidr', value: vpcCidr };
    const draft: RuleDraft = {
      protocol: p.protocol,
      fromPort: p.fromPort,
      toPort: p.toPort,
      peers: [peer],
      description: p.label,
      action: 'allow',
      priority: kind === 'nacl' || kind === 'nsg' ? nextPriority(current(), kind, direction) : undefined,
    };
    // GCP firewalls hold either allow or deny blocks — append to whichever it uses
    const field = firewall ? (current().args.deny ? 'deny' : 'allow') : undefined;
    apply(addRuleOp(current(), kind, direction, draft, field));
    requestAnimationFrame(() => tableRef.current?.scrollTo({ top: tableRef.current.scrollHeight, behavior: 'smooth' }));
  };

  return (
    <Modal
      open
      wide
      label={`Rules for ${node.name}`}
      onClose={() => openRules(null)}
      title={
        <div className="flex items-center gap-2.5">
          <ResourceIcon category={def?.category ?? 'identity'} type={node.type} size={30} />
          <div>
            <h2 className="text-[15px] font-semibold leading-tight">Rules · {node.name}</h2>
            <p className="text-[11.5px] text-faint">{KIND_INFO[kind].title} · {node.id}</p>
          </div>
        </div>
      }
    >
      <div className="flex max-h-[72vh] flex-col" aria-label="Rules editor">
        <p className="flex items-start gap-2 border-b bg-surface-2/50 px-5 py-2.5 text-[11.5px] leading-relaxed text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {KIND_INFO[kind].note}
        </p>
        {firewall ? <FirewallSettings node={node} apply={apply} /> : null}
        <div className="flex items-center gap-2 px-5 pt-3">
          {!firewall ? (
            <div className="flex rounded-[8px] border bg-surface-2 p-0.5" role="tablist" aria-label="Direction">
              {(['inbound', 'outbound'] as const).map((d) => (
                <button
                  key={d}
                  role="tab"
                  type="button"
                  aria-selected={direction === d}
                  onClick={() => setDirection(d)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-[6px] px-3 py-1 text-[12px] font-semibold transition-colors',
                    direction === d ? 'bg-surface-1 text-foreground shadow-xs' : 'text-muted hover:text-foreground',
                  )}
                >
                  {d === 'inbound' ? <ArrowDownToLine className="h-3.5 w-3.5" /> : <ArrowUpFromLine className="h-3.5 w-3.5" />}
                  {d === 'inbound' ? 'Inbound' : 'Outbound'}
                  <span className="rounded-full bg-surface-2 px-1.5 text-[10.5px] text-faint">{count(d)}</span>
                </button>
              ))}
            </div>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setAddMenu({ x: r.right - 220, y: r.bottom + 4 });
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-[12.5px] font-semibold text-primary-fg shadow-xs hover:bg-primary-hover"
          >
            <Plus className="h-3.5 w-3.5" /> Add rule
          </button>
        </div>
        <div ref={tableRef} className="min-h-0 flex-1 overflow-auto px-5 pb-5 pt-3">
          {shown.length === 0 ? (
            <div className="rounded-[12px] border border-dashed px-4 py-8 text-center text-[12.5px] text-muted">
              {kind === 'sg' && direction === 'inbound'
                ? 'No inbound rules — nothing can connect to resources in this group.'
                : kind === 'sg'
                  ? 'No outbound rules — resources in this group cannot start connections.'
                  : 'No rules yet.'}{' '}
              Use <b>Add rule</b> to start from a preset.
            </div>
          ) : (
            <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-[10px] border text-left">
              <thead className="bg-surface-2/70 text-[10.5px] font-bold uppercase tracking-wider text-faint">
                <tr>
                  {kind === 'nacl' ? <th className="px-2 py-2">Rule #</th> : null}
                  {kind === 'nsg' ? <th className="px-2 py-2">Priority</th> : null}
                  {kind === 'nacl' || kind === 'nsg' ? <th className="px-2 py-2">Action</th> : null}
                  <th className="px-2 py-2">Service</th>
                  <th className="px-2 py-2">Protocol</th>
                  <th className="px-2 py-2">Ports</th>
                  {!firewall ? <th className="px-2 py-2">{direction === 'inbound' ? 'Source' : 'Destination'}</th> : null}
                  {kind === 'sg' ? <th className="px-2 py-2">Description</th> : null}
                  {kind === 'nsg' ? <th className="px-2 py-2">Name</th> : null}
                  <th className="px-2 py-2" aria-label="Risk" />
                  <th className="px-2 py-2" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="text-[12px]">
                {shown.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    kind={kind}
                    direction={firewall ? rule.direction : direction}
                    node={node}
                    groups={groups}
                    vpcCidr={vpcCidr}
                    apply={apply}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {addMenu ? (
        <ContextMenu
          x={addMenu.x}
          y={addMenu.y}
          label="Add rule"
          onClose={() => setAddMenu(null)}
          entries={PRESETS.map((p) => ({
            id: p.id,
            label: p.label,
            shortcut: p.protocol === 'all' ? 'all' : p.fromPort === null ? p.protocol : String(p.fromPort),
            onSelect: () => addPreset(p.id),
          }))}
        />
      ) : null}
    </Modal>
  );
}
