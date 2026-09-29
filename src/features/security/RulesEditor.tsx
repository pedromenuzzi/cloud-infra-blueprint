/**
 * Full-width rules editor for AWS security groups & network ACLs, Azure NSGs
 * and GCP firewalls. Every change is a regular canvas op (undoable, patched
 * into the HCL). Only the fields the user touches are rewritten; rows written
 * with expressions the editor can't represent are read-only.
 */
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Code2, Info, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ContextMenu, type MenuEntry } from '@/components/ContextMenu';
import { Modal } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { useLayout } from '@/features/editor/layoutStore';
import { useEditor } from '@/features/editor/store';
import { exprPreview, lit } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { ResourceNode } from '@/ir/types';
import { scrollBehavior } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ResourceIcon } from '@/resources/icons';
import { getDef } from '@/resources/registry';
import type { RuleRisk } from '@/security/audit';
import { parseCidr } from '@/security/cidr';
import {
  addRuleOps,
  mixesStyles,
  PLACEHOLDER_CIDR,
  PRESETS,
  presetDraft,
  priorityRange,
  privateRangeOf,
  PUBLIC_PRESETS,
  removeRuleOps,
  ruleStyle,
  toDraft,
  updateRuleOps,
  usedPriorities,
  type RuleDraft,
} from '@/security/edit';
import {
  fromInternet,
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

const currentIr = () => useEditor.getState().ir;

function presetOf(d: RuleDraft): string {
  const hit = PRESETS.find((p) => p.protocol === d.protocol && p.fromPort === d.fromPort && p.toPort === d.toPort);
  return hit?.id ?? 'custom';
}

function portsText(rule: SecurityRule) {
  if (rule.portsExpr) return rule.portsExpr;
  if (rule.protocol === 'icmp' || (rule.protocol === 'all' && rule.fromPort === null)) return '';
  if (rule.fromPort === null || rule.toPort === null) return '0-65535';
  return rule.fromPort === rule.toPort ? String(rule.fromPort) : `${rule.fromPort}-${rule.toPort}`;
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

const peerKey = (p: RulePeer) => `${p.kind}:${'value' in p ? p.value : 'ref' in p ? p.ref : ''}`;

/** show the rule's Terraform in the code editor */
function revealInCode(id: string) {
  useSecurityUi.getState().openRules(null);
  useEditor.getState().revealInCode(id);
  if (!useLayout.getState().isOpen('code')) useLayout.getState().toggle('code');
}

// ------------------------------------------------------------ peer editor

function PeerEditor({
  kind,
  peers,
  onChange,
  groups,
  vpcCidr,
  multi,
  disabled,
}: {
  kind: OwnerKind;
  peers: RulePeer[];
  onChange(peers: RulePeer[]): void;
  groups: ResourceNode[];
  vpcCidr?: string;
  /** can hold several sources (inline SG rules) */
  multi: boolean;
  disabled?: boolean;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const set = (p: RulePeer) => onChange(multi ? [...peers.filter((x) => peerKey(x) !== peerKey(p)), p] : [p]);
  const label = (p: RulePeer) => peerLabel(p, (id) => id.split('.').slice(1).join('.'));
  const chip = (p: RulePeer) =>
    p.kind === 'any' && !p.implicit ? p.value : p.src?.expr.kind === 'ref' ? p.src.expr.path : label(p);
  const valid = (text: string) => !!parseCidr(text) && (kind !== 'nacl' || text.includes('/'));

  const entries: MenuEntry[] =
    kind === 'nsg'
      ? [
          { id: 'any', label: 'Any source (*)', onSelect: () => set({ kind: 'any', value: '*' }) },
          { id: 'internet', label: 'Internet (service tag)', onSelect: () => set({ kind: 'any', value: 'Internet' }) },
          { id: 'vnet', label: 'VirtualNetwork', onSelect: () => set({ kind: 'other', value: 'VirtualNetwork' }) },
          { id: 'lb', label: 'AzureLoadBalancer', onSelect: () => set({ kind: 'other', value: 'AzureLoadBalancer' }) },
        ]
      : [
          { id: 'any', label: 'Anywhere, IPv4 (0.0.0.0/0)', onSelect: () => set({ kind: 'any', value: '0.0.0.0/0' }) },
          { id: 'any6', label: 'Anywhere, IPv6 (::/0)', onSelect: () => set({ kind: 'any', value: '::/0' }) },
          ...(vpcCidr ? [{ id: 'vpc', label: `This VPC (${vpcCidr})`, onSelect: () => set({ kind: 'cidr', value: vpcCidr }) } as MenuEntry] : []),
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
        ];
  entries.push('separator', { id: 'custom', label: 'Custom CIDR…', onSelect: () => setCustom('') });

  return (
    <div className="flex flex-wrap items-center gap-1">
      {peers.map((p, i) => (
        <span
          key={i}
          title={label(p)}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-medium',
            p.kind === 'any' ? 'border-danger/40 bg-danger/8 text-danger' : 'bg-surface-2 text-foreground',
          )}
        >
          <span className="truncate font-mono">{chip(p)}</span>
          {!disabled && peers.length > 1 ? (
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
            if (e.key === 'Escape') {
              // this field's own Escape: don't also close the dialog
              e.preventDefault();
              setCustom(null);
            }
            if (e.key === 'Enter' && valid(custom)) {
              set({ kind: 'cidr', value: custom.trim() });
              setCustom(null);
            }
          }}
          className={cn(inputCls, 'h-6 w-32 font-mono', custom && !valid(custom) && 'border-danger')}
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

function PriorityInput({ rule, kind, owner, disabled, onCommit }: {
  rule: SecurityRule;
  kind: OwnerKind;
  owner: ResourceNode;
  disabled: boolean;
  onCommit(n: number): void;
}) {
  const [text, setText] = useState(rule.priority === undefined ? '' : String(rule.priority));
  useEffect(() => setText(rule.priority === undefined ? '' : String(rule.priority)), [rule.priority]);
  const [min, max] = priorityRange(kind)!;
  const problem = (() => {
    if (!/^\d+$/.test(text.trim())) return `Enter a number from ${min} to ${max}`;
    const n = Number(text);
    if (n < min || n > max) return `Must be between ${min} and ${max}`;
    if (n !== rule.priority && usedPriorities(currentIr(), owner, rule.direction, rule.id.split('#')[0]).has(n)) {
      return `Another ${rule.direction} rule already uses ${n}`;
    }
    return null;
  })();
  return (
    <input
      inputMode="numeric"
      aria-label={kind === 'nacl' ? 'Rule number' : 'Priority'}
      aria-invalid={problem !== null}
      title={problem ?? undefined}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (problem === null && Number(text) !== rule.priority) onCommit(Number(text));
        else setText(rule.priority === undefined ? '' : String(rule.priority));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cn(inputCls, 'font-mono', problem && 'border-danger')}
    />
  );
}

function RuleRow({
  rule,
  kind,
  node,
  groups,
  vpcCidr,
  risk,
  apply,
  onLastFirewallRule,
}: {
  rule: SecurityRule;
  kind: OwnerKind;
  node: ResourceNode;
  groups: ResourceNode[];
  vpcCidr?: string;
  risk?: RuleRisk;
  apply(ops: Op[]): void;
  onLastFirewallRule(at: { x: number; y: number }): void;
}) {
  const draft = toDraft(rule);
  const [ports, setPorts] = useState(portsText(rule));
  const [description, setDescription] = useState(draft.description ?? '');
  useEffect(() => setPorts(portsText(rule)), [rule.fromPort, rule.toPort, rule.protocol, rule.portsExpr]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setDescription(draft.description ?? ''), [rule.description]); // eslint-disable-line react-hooks/exhaustive-deps
  const readOnly = (rule.unmodeled?.length ?? 0) > 0;
  const element = rule.origin.element;
  // Azure: the protocol of a rule is shared by every port range it lists
  const sharedProtocol = kind === 'nsg' && element !== undefined;
  const sharedHint = element ? `Shared by the ${element.count} port ranges of this rule` : undefined;
  const update = (patch: Partial<RuleDraft>) => apply(updateRuleOps(currentIr(), rule, patch));
  const portsValid = readOnly || parsePorts(ports) !== null;
  const noPorts = draft.protocol === 'icmp' || (draft.protocol === 'all' && rule.fromPort === null);
  const resourceId = rule.origin.kind === 'resource' ? rule.origin.id : node.id;
  const multiPeer = kind === 'sg' && !(rule.origin.kind === 'resource' && resourceId.startsWith('aws_vpc_security_group_'));

  return (
    <tr className={cn('border-t transition-colors hover:bg-surface-2/40', readOnly && 'bg-surface-2/40')} data-rule={rule.id}>
      {kind === 'nacl' || kind === 'nsg' ? (
        <Cell className="w-16">
          <PriorityInput rule={rule} kind={kind} owner={node} disabled={readOnly} onCommit={(priority) => update({ priority })} />
        </Cell>
      ) : null}
      {kind !== 'sg' && kind !== 'firewall' ? (
        <Cell className="w-20">
          <select
            aria-label="Action"
            value={draft.action}
            disabled={readOnly}
            title={sharedHint}
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
            <option key={p.id} value={p.id} disabled={sharedProtocol && p.protocol !== draft.protocol}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </Cell>
      <Cell className="w-20">
        <select
          aria-label="Protocol"
          value={draft.protocol}
          disabled={readOnly || sharedProtocol}
          title={sharedProtocol ? `${sharedHint} — split them in code to change one` : undefined}
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
      <Cell className="w-24">
        <input
          aria-label="Port range"
          value={noPorts ? '' : ports}
          placeholder={noPorts ? 'all' : '443 or 8000-8080'}
          disabled={readOnly || noPorts}
          onChange={(e) => setPorts(e.target.value)}
          onBlur={() => {
            const p = parsePorts(ports);
            if (p && (p.fromPort !== draft.fromPort || p.toPort !== draft.toPort)) update(p);
            else if (!p) setPorts(portsText(rule));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={cn(inputCls, 'font-mono', !portsValid && 'border-danger')}
        />
      </Cell>
      {kind !== 'firewall' ? (
        <Cell className="min-w-[160px]">
          <PeerEditor
            kind={kind}
            peers={draft.peers}
            groups={groups.filter((g) => g.id !== node.id)}
            vpcCidr={vpcCidr}
            multi={multiPeer}
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
            title={kind === 'nsg' ? sharedHint : undefined}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              // an NSG rule can't be nameless
              if (kind === 'nsg' && !description.trim()) setDescription(draft.description ?? '');
              else if (description !== (draft.description ?? '')) update({ description: description || undefined });
            }}
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
      <Cell className="w-10 whitespace-nowrap text-right">
        {readOnly ? (
          <button
            type="button"
            aria-label="Edit in code"
            title={`Written with expressions (${rule.unmodeled!.join(', ')}) — edit it in code`}
            onClick={() => revealInCode(resourceId)}
            className="rounded-[6px] p-1 text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <Code2 className="h-3.5 w-3.5" />
          </button>
        ) : (
          <>
            {rule.origin.kind === 'resource' ? (
              <button
                type="button"
                title={`Defined in ${rule.origin.id}`}
                onClick={() => {
                  useSecurityUi.getState().openRules(null);
                  useEditor.getState().setSelection(resourceId, 'canvas');
                  canvasApi()?.focusNode(resourceId);
                }}
                className="rounded-[6px] p-1 text-faint hover:bg-surface-2 hover:text-foreground"
                aria-label="Show rule resource"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Delete rule"
              onClick={(e) => {
                const ops = removeRuleOps(currentIr(), rule);
                if (ops) apply(ops);
                else {
                  const r = e.currentTarget.getBoundingClientRect();
                  onLastFirewallRule({ x: r.right - 220, y: r.bottom + 4 });
                }
              }}
              className="rounded-[6px] p-1 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </Cell>
    </tr>
  );
}

// ------------------------------------------------------------ GCP settings

function FirewallSettings({ node, apply }: { node: ResourceNode; apply(ops: Op[]): void }) {
  const str = (k: string) => (node.args[k]?.kind === 'literal' ? String(node.args[k].value) : '');
  /** comma-separated literals, or null when the list holds expressions we must not rewrite */
  const listText = (k: string): string | null => {
    const e = node.args[k];
    if (!e) return '';
    if (e.kind !== 'list' || e.items.some((i) => i.kind !== 'literal')) return null;
    return e.items.map((i) => String((i as { value: unknown }).value)).join(', ');
  };
  const setList = (k: string, text: string) => {
    const items = text.split(',').map((t) => t.trim()).filter(Boolean);
    apply([
      items.length
        ? { kind: 'set_arg', nodeId: node.id, field: k, value: { kind: 'list', items: items.map((i) => lit(i)) } }
        : { kind: 'unset_arg', nodeId: node.id, field: k },
    ]);
  };
  const action = node.args.deny ? 'deny' : 'allow';
  const egress = str('direction') === 'EGRESS';
  const rangesKey = egress ? 'destination_ranges' : 'source_ranges';
  const listInput = (k: string, placeholder: string, mono?: boolean) => {
    const text = listText(k);
    return text === null ? (
      <input readOnly value={exprPreview(node.args[k])} title="Written with expressions — edit it in code" className={cn(inputCls, 'mt-1 bg-surface-2 text-faint', mono && 'font-mono')} />
    ) : (
      <input defaultValue={text} key={text} onBlur={(e) => e.target.value !== text && setList(k, e.target.value)} placeholder={placeholder} className={cn(inputCls, 'mt-1', mono && 'font-mono')} />
    );
  };
  return (
    <div className="grid grid-cols-2 gap-3 border-b px-5 py-4 sm:grid-cols-4">
      <label className="text-[11.5px] font-medium text-muted">
        Direction
        <select value={egress ? 'EGRESS' : 'INGRESS'} onChange={(e) => apply([{ kind: 'set_arg', nodeId: node.id, field: 'direction', value: lit(e.target.value) }])} className={cn(inputCls, 'mt-1')}>
          <option value="INGRESS">Ingress</option>
          <option value="EGRESS">Egress</option>
        </select>
      </label>
      <label className="text-[11.5px] font-medium text-muted">
        Action
        <select
          value={action}
          onChange={(e) => {
            const to = e.target.value;
            const value = node.args[action];
            if (to === action || !value) return;
            // one undo step: a firewall with neither block is invalid
            apply([
              { kind: 'unset_arg', nodeId: node.id, field: action },
              { kind: 'set_arg', nodeId: node.id, field: to, value },
            ]);
          }}
          className={cn(inputCls, 'mt-1', action === 'deny' ? 'text-danger' : 'text-success')}
        >
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
      </label>
      <label className="text-[11.5px] font-medium text-muted">
        {egress ? 'Destination ranges' : 'Source ranges'}
        {listInput(rangesKey, egress ? '0.0.0.0/0' : 'empty = 0.0.0.0/0', true)}
      </label>
      <label className="text-[11.5px] font-medium text-muted">
        Target tags
        {listInput('target_tags', 'web, ssh')}
      </label>
    </div>
  );
}

// ------------------------------------------------------------ editor

function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <p
      role={tone === 'warn' ? 'status' : undefined}
      className={cn(
        'flex items-start gap-2 border-b px-5 py-2 text-[11.5px] leading-relaxed',
        tone === 'warn' ? 'bg-warning/8 text-foreground' : 'bg-surface-2/50 text-muted',
      )}
    >
      {tone === 'warn' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
      <span>{children}</span>
    </p>
  );
}

export function RulesEditor() {
  const owner = useSecurityUi((s) => s.editing);
  const openRules = useSecurityUi((s) => s.openRules);
  const ir = useEditor((s) => s.ir);
  const node = owner ? ir.resources.find((r) => r.id === owner) : undefined;
  const kind = node ? OWNER_TYPES[node.type] : undefined;
  const [direction, setDirection] = useState<Direction>('inbound');
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [lastRuleMenu, setLastRuleMenu] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDirection('inbound');
    setNotice(null);
  }, [owner]);

  const audit = getAudit(ir);
  const rules = useMemo(() => (owner ? (audit.topology.rules.get(owner) ?? []) : []), [audit, owner]);
  if (!node || !kind) return null;

  const firewall = kind === 'firewall';
  const shown = firewall ? rules : rules.filter((r) => r.direction === direction);
  const count = (d: Direction) => rules.filter((r) => r.direction === d).length;
  const groups = ir.resources.filter((r) => r.type === 'aws_security_group' || r.type === 'aws_default_security_group');
  const vpcCidr = kind === 'sg' || kind === 'nacl' ? privateRangeOf(ir, node)?.[0] : undefined;
  const apply = (ops: Op[]) => {
    if (ops.length) useEditor.getState().applyCanvasOps(ops);
  };
  const current = () => currentIr().resources.find((r) => r.id === node.id) ?? node;
  const def = getDef(node.type);
  const style = ruleStyle(ir, node, direction);
  const hidden = (audit.topology.hidden.get(node.id) ?? []).filter((h) => firewall || h.directions.includes(direction));
  const disabled = node.args.disabled?.kind === 'literal' && node.args.disabled.value === true;

  const addPreset = (presetId: string) => {
    const now = currentIr();
    const owner = current();
    const inbound = firewall ? node.args.direction?.kind !== 'literal' || node.args.direction.value !== 'EGRESS' : direction === 'inbound';
    const { draft, placeholder } = presetDraft(now, owner, inbound ? 'inbound' : 'outbound', presetId);
    const addStyle = ruleStyle(now, owner, direction);
    apply(addRuleOps(now, owner, direction, draft));
    // GCP sources live on the firewall, not the rule: say so when they include the internet
    const openFirewall = firewall && inbound && !PUBLIC_PRESETS.has(presetId) && rules.some((r) => fromInternet(r));
    setNotice(
      openFirewall
        ? `This firewall's source ranges apply to every rule, and they include the internet — ${draft.description} is now open to it. Narrow the source ranges above.`
        : placeholder && !firewall
          ? `${draft.description} allows ${PLACEHOLDER_CIDR}, a placeholder private range — change the source to the network that needs it.`
          : addStyle.mode === 'resource'
            ? `Added as a ${addStyle.type} resource, like this ${KIND_INFO[kind].title.toLowerCase()}'s other rules.`
            : null,
    );
    requestAnimationFrame(() => tableRef.current?.scrollTo({ top: tableRef.current.scrollHeight, behavior: scrollBehavior() }));
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
        <Notice>{KIND_INFO[kind].note}</Notice>
        {disabled ? <Notice tone="warn">This firewall is disabled — its rules have no effect.</Notice> : null}
        {mixesStyles(ir, node) ? (
          <Notice tone="warn">
            This {KIND_INFO[kind].title.toLowerCase()} mixes inline rules with standalone rule resources — Terraform will keep
            undoing one with the other. Move them to one style in code.
          </Notice>
        ) : null}
        {hidden.length ? (
          <Notice tone="warn">
            Some rules are built with {hidden.map((h) => h.reason).join(', ')} and aren't listed here — edit them in code.
          </Notice>
        ) : null}
        {notice ? <Notice tone="warn">{notice}</Notice> : null}
        {shown.some((r) => r.unmodeled?.length) ? (
          <Notice>
            Greyed-out rows are written with expressions or syntax the editor can't rewrite safely — use{' '}
            <Code2 className="inline h-3 w-3 align-[-2px]" aria-label="Edit in code" /> to edit them in code.
          </Notice>
        ) : null}
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
            disabled={style.mode === 'blocked'}
            title={style.mode === 'blocked' ? style.reason : undefined}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setAddMenu({ x: r.right - 220, y: r.bottom + 4 });
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-[12.5px] font-semibold text-primary-fg shadow-xs hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add rule
          </button>
        </div>
        <div ref={tableRef} className="min-h-0 flex-1 overflow-auto px-5 pb-5 pt-3">
          {shown.length === 0 ? (
            <div className="rounded-[12px] border border-dashed px-4 py-8 text-center text-[12.5px] text-muted">
              {hidden.length
                ? 'No rules the editor can show.'
                : kind === 'sg' && direction === 'inbound'
                  ? 'No inbound rules — nothing can connect to resources in this group.'
                  : kind === 'sg'
                    ? 'No outbound rules — resources in this group cannot start connections.'
                    : 'No rules yet.'}{' '}
              {style.mode === 'blocked' ? style.reason : <>Use <b>Add rule</b> to start from a preset.</>}
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
                  <th className="px-2 py-2">
                    <span className="sr-only">Risk</span>
                  </th>
                  <th className="px-2 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="text-[12px]">
                {shown.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    kind={kind}
                    node={node}
                    groups={groups}
                    vpcCidr={vpcCidr}
                    risk={audit.risks.get(rule.id)}
                    apply={apply}
                    onLastFirewallRule={setLastRuleMenu}
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
      {lastRuleMenu ? (
        <ContextMenu
          x={lastRuleMenu.x}
          y={lastRuleMenu.y}
          label="Last rule of the firewall"
          onClose={() => setLastRuleMenu(null)}
          entries={[
            {
              id: 'delete-firewall',
              label: 'Delete the whole firewall',
              icon: Trash2,
              danger: true,
              onSelect: () => {
                openRules(null);
                useEditor.getState().deleteResources([node.id]);
              },
            },
            { id: 'keep', label: 'Keep it (a firewall needs one rule)', onSelect: () => setLastRuleMenu(null) },
          ]}
        />
      ) : null}
    </Modal>
  );
}
