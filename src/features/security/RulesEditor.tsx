/**
 * Full-width rules editor for AWS security groups & network ACLs, Azure NSGs
 * and GCP firewalls. Every change is a regular canvas op (undoable, patched
 * into the HCL). Only the fields the user touches are rewritten; rows written
 * with expressions the editor can't represent are read-only.
 */
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Code2, Info, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ContextMenu, type MenuEntry } from '@/components/ContextMenu';
import { Modal, tabbables } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { useLayout } from '@/features/editor/layoutStore';
import { useEditor } from '@/features/editor/store';
import { useLocale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
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
  presetLabel,
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
import { securityUiMessages } from './messages';
import { SEVERITY_COLORS, getAudit, useAudit, useSecurityUi } from './securityStore';

/** what the editor tells the user after adding a rule (worded at render, so a language switch re-words it) */
type AddNotice =
  | { kind: 'open-firewall'; preset: string }
  | { kind: 'placeholder'; preset: string }
  | { kind: 'resource'; type: string };

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
  const m = useMessages(securityUiMessages);
  const locale = useLocale((s) => s.locale);
  const set = (p: RulePeer) => onChange(multi ? [...peers.filter((x) => peerKey(x) !== peerKey(p)), p] : [p]);
  const label = (p: RulePeer) => peerLabel(p, (id) => id.split('.').slice(1).join('.'), locale);
  const chip = (p: RulePeer) =>
    p.kind === 'any' && !p.implicit ? p.value : p.src?.expr.kind === 'ref' ? p.src.expr.path : label(p);
  const valid = (text: string) => !!parseCidr(text) && (kind !== 'nacl' || text.includes('/'));

  const entries: MenuEntry[] =
    kind === 'nsg'
      ? [
          { id: 'any', label: m.anySource, onSelect: () => set({ kind: 'any', value: '*' }) },
          { id: 'internet', label: m.internetTag, onSelect: () => set({ kind: 'any', value: 'Internet' }) },
          { id: 'vnet', label: 'VirtualNetwork', onSelect: () => set({ kind: 'other', value: 'VirtualNetwork' }) },
          { id: 'lb', label: 'AzureLoadBalancer', onSelect: () => set({ kind: 'other', value: 'AzureLoadBalancer' }) },
        ]
      : [
          { id: 'any', label: m.anywhereV4, onSelect: () => set({ kind: 'any', value: '0.0.0.0/0' }) },
          { id: 'any6', label: m.anywhereV6, onSelect: () => set({ kind: 'any', value: '::/0' }) },
          ...(vpcCidr ? [{ id: 'vpc', label: m.thisVpc(vpcCidr), onSelect: () => set({ kind: 'cidr', value: vpcCidr }) } as MenuEntry] : []),
          ...(kind === 'sg'
            ? ([
                'separator',
                ...groups.map((g) => ({
                  id: g.id,
                  label: m.groupOption(g.name),
                  onSelect: () => set({ kind: 'group', ref: g.id }),
                })),
                { id: 'self', label: m.itself, onSelect: () => set({ kind: 'self' }) },
              ] as MenuEntry[])
            : []),
        ];
  entries.push('separator', { id: 'custom', label: m.customCidr, onSelect: () => setCustom('') });

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
            <button type="button" aria-label={m.remove(label(p))} onClick={() => onChange(peers.filter((_, j) => j !== i))} className="text-faint hover:text-foreground">
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
          aria-label={m.customCidrLabel}
        />
      ) : !disabled ? (
        <button
          type="button"
          aria-label={multi ? m.addSource : m.changeSource}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 4 });
          }}
          className="inline-flex h-5 items-center gap-0.5 rounded-full border border-dashed px-1.5 text-[10.5px] text-muted hover:border-border-strong hover:text-foreground"
        >
          <Plus className="h-2.5 w-2.5" /> {multi ? m.add : m.change}
        </button>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} label={m.chooseSource} entries={entries} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------ rows

/**
 * A rule's cell. `cell` names its place in the stacked layout of a narrow
 * editor (global.css, `.bp-rules`), where `label` — the column's header —
 * is shown above the control.
 */
function Cell({ children, className, cell, label }: { children: ReactNode; className?: string; cell: string; label?: string }) {
  return (
    <td data-cell={cell} data-label={label} className={cn('px-2 py-1.5 align-middle', className)}>
      {children}
    </td>
  );
}

function PriorityInput({ rule, kind, owner, disabled, onCommit }: {
  rule: SecurityRule;
  kind: OwnerKind;
  owner: ResourceNode;
  disabled: boolean;
  onCommit(n: number): void;
}) {
  const m = useMessages(securityUiMessages);
  const [text, setText] = useState(rule.priority === undefined ? '' : String(rule.priority));
  useEffect(() => setText(rule.priority === undefined ? '' : String(rule.priority)), [rule.priority]);
  const [min, max] = priorityRange(kind)!;
  const problem = (() => {
    if (!/^\d+$/.test(text.trim())) return m.enterNumber(min, max);
    const n = Number(text);
    if (n < min || n > max) return m.between(min, max);
    if (n !== rule.priority && usedPriorities(currentIr(), owner, rule.direction, rule.id.split('#')[0]).has(n)) {
      return m.priorityTaken(rule.direction, n);
    }
    return null;
  })();
  return (
    <input
      inputMode="numeric"
      aria-label={kind === 'nacl' ? m.ruleNumber : m.priority}
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
  highlighted,
  apply,
  onLastFirewallRule,
}: {
  rule: SecurityRule;
  kind: OwnerKind;
  node: ResourceNode;
  groups: ResourceNode[];
  vpcCidr?: string;
  risk?: RuleRisk;
  /** the row the editor was opened for (a step of an access path) */
  highlighted?: boolean;
  apply(ops: Op[]): void;
  onLastFirewallRule(at: { x: number; y: number }): void;
}) {
  const m = useMessages(securityUiMessages);
  const draft = toDraft(rule);
  const [ports, setPorts] = useState(portsText(rule));
  const [description, setDescription] = useState(draft.description ?? '');
  useEffect(() => setPorts(portsText(rule)), [rule.fromPort, rule.toPort, rule.protocol, rule.portsExpr]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setDescription(draft.description ?? ''), [rule.description]); // eslint-disable-line react-hooks/exhaustive-deps
  const readOnly = (rule.unmodeled?.length ?? 0) > 0;
  const element = rule.origin.element;
  // Azure: the protocol of a rule is shared by every port range it lists
  const sharedProtocol = kind === 'nsg' && element !== undefined;
  const sharedHint = element ? m.sharedBy(element.count) : undefined;
  const update = (patch: Partial<RuleDraft>) => apply(updateRuleOps(currentIr(), rule, patch));
  const portsValid = readOnly || parsePorts(ports) !== null;
  const noPorts = draft.protocol === 'icmp' || (draft.protocol === 'all' && rule.fromPort === null);
  const resourceId = rule.origin.kind === 'resource' ? rule.origin.id : node.id;
  const multiPeer = kind === 'sg' && !(rule.origin.kind === 'resource' && resourceId.startsWith('aws_vpc_security_group_'));

  return (
    <tr
      className={cn(
        'border-t transition-colors hover:bg-surface-2/40',
        readOnly && 'bg-surface-2/40',
        highlighted && 'bg-primary-soft shadow-[inset_3px_0_0_var(--primary)] hover:bg-primary-soft',
      )}
      data-rule={rule.id}
      data-highlighted={highlighted ? '' : undefined}
      tabIndex={highlighted ? -1 : undefined}
    >
      {kind === 'nacl' || kind === 'nsg' ? (
        <Cell className="w-16" cell="priority" label={kind === 'nacl' ? m.ruleNo : m.priority}>
          <PriorityInput rule={rule} kind={kind} owner={node} disabled={readOnly} onCommit={(priority) => update({ priority })} />
        </Cell>
      ) : null}
      {kind !== 'sg' && kind !== 'firewall' ? (
        <Cell className="w-28" cell="action" label={m.action}>
          <select
            aria-label={m.action}
            value={draft.action}
            disabled={readOnly}
            title={sharedHint}
            onChange={(e) => update({ action: e.target.value as 'allow' | 'deny' })}
            className={cn(inputCls, draft.action === 'deny' ? 'text-danger' : 'text-success')}
          >
            <option value="allow">{m.allow}</option>
            <option value="deny">{m.deny}</option>
          </select>
        </Cell>
      ) : null}
      <Cell className="w-36" cell="service" label={m.service}>
        <select
          aria-label={m.service}
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
              {presetLabel(p)}
            </option>
          ))}
          <option value="custom">{m.custom}</option>
        </select>
      </Cell>
      <Cell className="w-24" cell="protocol" label={m.protocol}>
        <select
          aria-label={m.protocol}
          value={draft.protocol}
          disabled={readOnly || sharedProtocol}
          title={sharedProtocol && sharedHint ? m.splitInCode(sharedHint) : undefined}
          onChange={(e) => {
            const protocol = e.target.value as RuleDraft['protocol'];
            update({ protocol, ...(protocol === 'all' || protocol === 'icmp' ? { fromPort: null, toPort: null } : {}) });
          }}
          className={inputCls}
        >
          <option value="tcp">TCP</option>
          <option value="udp">UDP</option>
          <option value="icmp">ICMP</option>
          <option value="all">{m.allProtocols}</option>
        </select>
      </Cell>
      <Cell className="w-24" cell="ports" label={m.ports_}>
        <input
          aria-label={m.portRange}
          value={noPorts ? '' : ports}
          placeholder={noPorts ? m.allPorts : m.portsPlaceholder}
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
        <Cell className="min-w-[160px]" cell="peer" label={rule.direction === 'inbound' ? m.source : m.destination}>
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
        <Cell className="min-w-[140px]" cell="name" label={kind === 'nsg' ? m.name : m.description}>
          <input
            aria-label={kind === 'nsg' ? m.name : m.description}
            value={description}
            placeholder={kind === 'nsg' ? m.namePlaceholder : m.descriptionPlaceholder}
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
      <Cell className="w-8" cell="risk">
        {risk ? (
          <span title={risk.title} className="flex h-6 w-6 items-center justify-center rounded-full" style={{ color: SEVERITY_COLORS[risk.severity], background: `color-mix(in srgb, ${SEVERITY_COLORS[risk.severity]} 14%, transparent)` }}>
            <AlertTriangle className="h-3.5 w-3.5" aria-label={risk.title} />
          </span>
        ) : null}
      </Cell>
      <Cell className="w-10 whitespace-nowrap text-right" cell="actions">
        {readOnly ? (
          <button
            type="button"
            aria-label={m.editInCode}
            title={m.writtenWith(rule.unmodeled!.join(', '))}
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
                title={m.definedIn(rule.origin.id)}
                onClick={() => {
                  useSecurityUi.getState().openRules(null);
                  useEditor.getState().setSelection(resourceId, 'canvas');
                  canvasApi()?.focusNode(resourceId);
                }}
                className="rounded-[6px] p-1 text-faint hover:bg-surface-2 hover:text-foreground"
                aria-label={m.showRuleResource}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              aria-label={m.deleteRule}
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
  const m = useMessages(securityUiMessages);
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
      <input readOnly value={exprPreview(node.args[k])} title={m.writtenWithShort} className={cn(inputCls, 'mt-1 bg-surface-2 text-faint', mono && 'font-mono')} />
    ) : (
      <input defaultValue={text} key={text} onBlur={(e) => e.target.value !== text && setList(k, e.target.value)} placeholder={placeholder} className={cn(inputCls, 'mt-1', mono && 'font-mono')} />
    );
  };
  return (
    <div className="grid grid-cols-2 gap-3 border-b px-5 py-4 sm:grid-cols-4">
      <label className="text-[11.5px] font-medium text-muted">
        {m.direction}
        <select value={egress ? 'EGRESS' : 'INGRESS'} onChange={(e) => apply([{ kind: 'set_arg', nodeId: node.id, field: 'direction', value: lit(e.target.value) }])} className={cn(inputCls, 'mt-1')}>
          <option value="INGRESS">{m.ingress}</option>
          <option value="EGRESS">{m.egress}</option>
        </select>
      </label>
      <label className="text-[11.5px] font-medium text-muted">
        {m.action}
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
          <option value="allow">{m.allow}</option>
          <option value="deny">{m.deny}</option>
        </select>
      </label>
      <label className="text-[11.5px] font-medium text-muted">
        {egress ? m.destinationRanges : m.sourceRanges}
        {listInput(rangesKey, egress ? '0.0.0.0/0' : m.emptyMeansAny, true)}
      </label>
      <label className="text-[11.5px] font-medium text-muted">
        {m.targetTags}
        {listInput('target_tags', 'web, ssh')}
      </label>
    </div>
  );
}

// ------------------------------------------------------------ editor

/** Below this width (px) a kind's table stacks its rules as cards: the widths of its columns (RuleRow). */
const STACK_BELOW: Record<OwnerKind, number> = { nsg: 890, nacl: 750, sg: 712, firewall: 410 };

/** Is the table's box too narrow for this kind's columns? */
function useStacked(ref: RefObject<HTMLElement | null>, kind: OwnerKind | undefined): boolean {
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !kind) return;
    const check = () => {
      const style = getComputedStyle(el);
      const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setStacked(width < STACK_BELOW[kind]);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, kind]);
  return stacked;
}

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
  const m = useMessages(securityUiMessages);
  const owner = useSecurityUi((s) => s.editing);
  const focusRule = useSecurityUi((s) => s.focusRule);
  const openRules = useSecurityUi((s) => s.openRules);
  const ir = useEditor((s) => s.ir);
  const node = owner ? ir.resources.find((r) => r.id === owner) : undefined;
  const kind = node ? OWNER_TYPES[node.type] : undefined;
  const [direction, setDirection] = useState<Direction>('inbound');
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [lastRuleMenu, setLastRuleMenu] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<AddNotice | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const focused = useRef<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const stacked = useStacked(tableRef, kind);

  // opened for one rule (a step of an access path): its direction, its row
  useEffect(() => {
    const target = focusRule && owner ? getAudit(currentIr()).topology.rules.get(owner)?.find((r) => r.id === focusRule) : undefined;
    setDirection(target?.direction ?? 'inbound');
    setNotice(null);
    setHighlight(target?.id ?? null);
    focused.current = null;
  }, [owner, focusRule]);

  // …brought into view, with focus on its first control (the row itself when it is read-only)
  useEffect(() => {
    if (!highlight || focused.current === highlight) return;
    const row = tableRef.current?.querySelector<HTMLElement>(`tr[data-rule="${CSS.escape(highlight)}"]`);
    if (!row) return;
    focused.current = highlight;
    row.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
    (tabbables(row)[0] ?? row).focus({ preventScroll: true });
  }, [highlight, direction]);

  const audit = useAudit();
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
        ? { kind: 'open-firewall', preset: presetId }
        : placeholder && !firewall
          ? { kind: 'placeholder', preset: presetId }
          : addStyle.mode === 'resource'
            ? { kind: 'resource', type: addStyle.type }
            : null,
    );
    requestAnimationFrame(() => tableRef.current?.scrollTo({ top: tableRef.current.scrollHeight, behavior: scrollBehavior() }));
  };

  const presetName = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    return p ? presetLabel(p) : id;
  };
  const noticeText =
    notice?.kind === 'open-firewall'
      ? m.openFirewall(presetName(notice.preset))
      : notice?.kind === 'placeholder'
        ? m.placeholderRange(presetName(notice.preset), PLACEHOLDER_CIDR)
        : notice?.kind === 'resource'
          ? m.addedAsResource(notice.type, kind)
          : null;

  return (
    <Modal
      open
      // priority and action columns: the room for the table on a laptop
      wide={kind === 'nsg' || kind === 'nacl' ? 'xl' : true}
      label={m.rulesFor(node.name)}
      onClose={() => openRules(null)}
      title={
        <div className="flex items-center gap-2.5">
          <ResourceIcon category={def?.category ?? 'identity'} type={node.type} size={30} />
          <div>
            <h2 className="text-[15px] font-semibold leading-tight">{m.rulesTitle(node.name)}</h2>
            <p className="text-[11.5px] text-faint">{m.kindTitle(kind)} · {node.id}</p>
          </div>
        </div>
      }
    >
      <div className="flex max-h-[72vh] flex-col" aria-label={m.rulesEditor}>
        <Notice>{m.kindNote(kind)}</Notice>
        {disabled ? <Notice tone="warn">{m.firewallDisabled}</Notice> : null}
        {mixesStyles(ir, node) ? <Notice tone="warn">{m.mixesStyles(kind)}</Notice> : null}
        {hidden.length ? <Notice tone="warn">{m.hiddenRules(hidden.map((h) => h.reason).join(', '))}</Notice> : null}
        {noticeText ? <Notice tone="warn">{noticeText}</Notice> : null}
        {shown.some((r) => r.unmodeled?.length) ? (
          <Notice>
            {m.greyedBefore} <Code2 className="inline h-3 w-3 align-[-2px]" aria-label={m.editInCode} /> {m.greyedAfter}
          </Notice>
        ) : null}
        {firewall ? <FirewallSettings node={node} apply={apply} /> : null}
        <div className="flex items-center gap-2 px-5 pt-3">
          {!firewall ? (
            <div className="flex rounded-[8px] border bg-surface-2 p-0.5" role="tablist" aria-label={m.direction}>
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
                  {d === 'inbound' ? m.inbound : m.outbound}
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
            className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm bg-primary px-3 text-[12.5px] font-semibold text-primary-fg shadow-xs hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> {m.addRule}
          </button>
        </div>
        {/* too narrow for the table (a phone, an NSG's nine columns at 768 px): each rule stacks as a card */}
        <div
          ref={tableRef}
          data-stacked={stacked || undefined}
          className="bp-rules min-h-0 flex-1 overflow-auto px-5 pb-5 pt-3 max-sm:px-4"
        >
          {shown.length === 0 ? (
            <div className="rounded-[12px] border border-dashed px-4 py-8 text-center text-[12.5px] text-muted">
              {hidden.length
                ? m.noRulesShown
                : kind === 'sg' && direction === 'inbound'
                  ? m.noInbound
                  : kind === 'sg'
                    ? m.noOutbound
                    : m.noRules}{' '}
              {style.mode === 'blocked' ? (
                style.reason
              ) : (
                <>
                  {m.usePresetBefore} <b>{m.addRule}</b> {m.usePresetAfter}
                </>
              )}
            </div>
          ) : (
            <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-[10px] border text-left">
              <thead className="bg-surface-2/70 text-[10.5px] font-bold uppercase tracking-wider text-faint">
                <tr>
                  {kind === 'nacl' ? <th className="px-2 py-2">{m.ruleNo}</th> : null}
                  {kind === 'nsg' ? <th className="px-2 py-2">{m.priority}</th> : null}
                  {kind === 'nacl' || kind === 'nsg' ? <th className="px-2 py-2">{m.action}</th> : null}
                  <th className="px-2 py-2">{m.service}</th>
                  <th className="px-2 py-2">{m.protocol}</th>
                  <th className="px-2 py-2">{m.ports_}</th>
                  {!firewall ? <th className="px-2 py-2">{direction === 'inbound' ? m.source : m.destination}</th> : null}
                  {kind === 'sg' ? <th className="px-2 py-2">{m.description}</th> : null}
                  {kind === 'nsg' ? <th className="px-2 py-2">{m.name}</th> : null}
                  <th className="px-2 py-2">
                    <span className="sr-only">{m.risk}</span>
                  </th>
                  <th className="px-2 py-2">
                    <span className="sr-only">{m.actions}</span>
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
                    highlighted={rule.id === highlight}
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
          label={m.addRule}
          onClose={() => setAddMenu(null)}
          entries={PRESETS.map((p) => ({
            id: p.id,
            label: presetLabel(p),
            shortcut: p.protocol === 'all' ? m.allShortcut : p.fromPort === null ? p.protocol : String(p.fromPort),
            onSelect: () => addPreset(p.id),
          }))}
        />
      ) : null}
      {lastRuleMenu ? (
        <ContextMenu
          x={lastRuleMenu.x}
          y={lastRuleMenu.y}
          label={m.lastRule}
          onClose={() => setLastRuleMenu(null)}
          entries={[
            {
              id: 'delete-firewall',
              label: m.deleteFirewall,
              icon: Trash2,
              danger: true,
              onSelect: () => {
                openRules(null);
                useEditor.getState().deleteResources([node.id]);
              },
            },
            { id: 'keep', label: m.keepFirewall, onSelect: () => setLastRuleMenu(null) },

          ]}
        />
      ) : null}
    </Modal>
  );
}
