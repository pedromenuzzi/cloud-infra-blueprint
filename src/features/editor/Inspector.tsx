import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  Code2,
  Globe,
  Lock,
  PanelRightClose,
  Plus,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CostLine } from '@/features/cost/CostLine';
import { AccessPaths } from '@/features/security/AccessPaths';
import { ComplianceBadges } from '@/features/security/ComplianceBadges';
import { SEVERITY_TEXT, useAudit, useSecurityUi } from '@/features/security/securityStore';
import { OWNER_TYPES, peerLabel, portLabel, portText, serviceName } from '@/security/model';
import { appliesToEach } from '@/security/instances';
import { richText } from '@/components/RichText';
import { showToast } from '@/components/Toast';
import { Badge, Button, Field, Input, Select } from '@/components/ui';
import { exprMentions, exprPreview, lit, literalString, pathTargets, ref } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import { appendReference, instanceRef, isListValued } from '@/ir/repeat';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { messagesFor, useMessages } from '@/i18n/messages';
import { cn, tfName } from '@/lib/utils';
import { fieldHelp, resourceDescription, resourceName } from '@/resources/i18n';
import { PROVIDER_LABELS, ResourceIcon } from '@/resources/icons';
import { withinBounds } from '@/resources/fieldRules';
import { docsUrl, getDef } from '@/resources/registry';
import type { FieldDef } from '@/resources/types';
import { canvasApi } from './canvasApi';
import { CidrPlanner } from './CidrPlanner';
import { looksLikeTraversal, removeConnectionOps } from './connections';
import { inspectorMessages } from './Inspector.messages';
import { layoutMessages } from './layout.messages';
import { MultiSelectPanel } from './MultiSelectPanel';
import { isHistoryMove, keepStateFor, useKeepState } from './movedSession';
import { renameOps } from './repeatOps';
import { KeepStateToggle, RepeatSection } from './RepeatSection';
import { useLayout } from './layoutStore';
import { SchemaFields } from './SchemaFields';
import { isModuleId } from '@/ir/modules';
import { ModuleInspector } from '@/features/modules/ModuleInspector';
import { orderedFiles, useEditor } from './store';

type Tab = 'rules' | 'properties' | 'connections';

/* ------------------------------------------------------------- field rows */

function useOps() {
  return useEditor((s) => s.applyCanvasOps);
}

function commitTextOp(ir: IR, node: ResourceNode, field: string, text: string): Op | null {
  const trimmed = text.trim();
  const current = node.args[field];
  if (trimmed === '') {
    return current ? { kind: 'unset_arg', nodeId: node.id, field } : null;
  }
  const value: Expression = looksLikeTraversal(trimmed, ir) ? ref(trimmed) : lit(trimmed);
  if (current && exprPreview(current) === exprPreview(value)) return null;
  return { kind: 'set_arg', nodeId: node.id, field, value };
}

/** Enter commits (by blurring), Escape puts the original value back first so the blur commits nothing. */
function editKeys(original: string) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    else if (e.key === 'Escape') {
      e.currentTarget.value = original;
      e.currentTarget.blur();
    }
  };
}

function RawValueNote({ expr }: { expr: Expression }) {
  const m = useMessages(inspectorMessages);
  return (
    <div className="rounded-sm border border-dashed bg-surface-2 px-2.5 py-1.5">
      <code className="block truncate font-mono text-[11px] text-muted" title={exprPreview(expr)}>
        {exprPreview(expr)}
      </code>
      <span className="text-[10.5px] text-faint">{m.complexExpression}</span>
    </div>
  );
}

function StringOrRefField({ node, field }: { node: ResourceNode; field: FieldDef }) {
  const m = useMessages(inspectorMessages);
  const applyOps = useOps();
  const ir = useEditor((s) => s.ir);
  const expr = node.args[field.name];
  const isComplex = expr && expr.kind !== 'literal' && expr.kind !== 'ref';

  if (isComplex) return <RawValueNote expr={expr} />;

  const currentText =
    expr?.kind === 'ref' ? expr.path : (literalString(expr) ?? (expr ? exprPreview(expr) : ''));

  if (field.refTo) {
    const candidates = ir.resources.filter((r) => field.refTo!.includes(r.type));
    const attr = field.refAttr ?? 'id';
    const matched = candidates.find((c) => expr?.kind === 'ref' && pathTargets(expr.path, c.id));
    return (
      <Select
        value={matched ? matched.id : currentText ? '__custom' : ''}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__custom') return;
          const op: Op | null =
            v === ''
              ? expr
                ? { kind: 'unset_arg', nodeId: node.id, field: field.name }
                : null
              : {
                  kind: 'set_arg',
                  nodeId: node.id,
                  field: field.name,
                  // one instance of a repeated target: `aws_subnet.private[0].id` (ir/repeat.ts)
                  value: instanceRef(candidates.find((c) => c.id === v)!, attr, { ir, from: node }),
                };
          if (op) applyOps([op]);
        }}
      >
        <option value="">{m.none}</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id}
          </option>
        ))}
        {!matched && currentText ? <option value="__custom">{currentText}</option> : null}
      </Select>
    );
  }

  return (
    <Input
      key={`${node.id}:${field.name}:${currentText}`}
      defaultValue={currentText}
      placeholder={field.placeholder}
      onBlur={(e) => {
        const op = commitTextOp(ir, node, field.name, e.target.value);
        if (op) applyOps([op]);
      }}
      onKeyDown={editKeys(currentText)}
    />
  );
}

function SelectField({ node, field }: { node: ResourceNode; field: FieldDef }) {
  const m = useMessages(inspectorMessages);
  const applyOps = useOps();
  const expr = node.args[field.name];
  if (expr && expr.kind !== 'literal') return <RawValueNote expr={expr} />;
  const current = literalString(expr) ?? (expr ? String(expr.value ?? '') : '');
  const options = field.options ?? [];
  return (
    <Select
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        const ops: Op[] = [
          v === ''
            ? { kind: 'unset_arg', nodeId: node.id, field: field.name }
            : { kind: 'set_arg', nodeId: node.id, field: field.name, value: lit(v) },
        ];
        // another engine's version (postgres 15.4 on mysql) would fail at apply
        if (field.name === 'engine' && node.args.engine_version) {
          ops.push({ kind: 'unset_arg', nodeId: node.id, field: 'engine_version' });
          showToast(messagesFor(inspectorMessages).engineCleared, 'info');
        }
        applyOps(ops);
      }}
    >
      <option value="">{m.none}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      {current && !options.includes(current) ? <option value={current}>{current}</option> : null}
    </Select>
  );
}

function BooleanField({ node, field }: { node: ResourceNode; field: FieldDef }) {
  const m = useMessages(inspectorMessages);
  const applyOps = useOps();
  const expr = node.args[field.name];
  if (expr && expr.kind !== 'literal') return <RawValueNote expr={expr} />;
  const current = expr?.kind === 'literal' ? String(expr.value) : '';
  return (
    <Select
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        applyOps([
          v === ''
            ? { kind: 'unset_arg', nodeId: node.id, field: field.name }
            : { kind: 'set_arg', nodeId: node.id, field: field.name, value: lit(v === 'true') },
        ]);
      }}
    >
      <option value="">{m.unset}</option>
      <option value="true">true</option>
      <option value="false">false</option>
    </Select>
  );
}

function NumberField({ node, field }: { node: ResourceNode; field: FieldDef }) {
  const applyOps = useOps();
  const expr = node.args[field.name];
  if (expr && expr.kind !== 'literal') return <RawValueNote expr={expr} />;
  const current = expr?.kind === 'literal' && expr.value !== null ? String(expr.value) : '';
  return (
    <Input
      key={`${node.id}:${field.name}:${current}`}
      type="number"
      min={field.min}
      max={field.max}
      defaultValue={current}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v === current) return;
        if (v !== '' && (!Number.isFinite(Number(v)) || !withinBounds(field, Number(v)))) {
          if (v !== '' && Number.isFinite(Number(v))) {
            showToast(
              messagesFor(inspectorMessages).outOfRange(field.name, String(field.min ?? '…'), String(field.max ?? '…')),
              'error',
            );
          }
          e.target.value = current;
          return;
        }
        applyOps([
          v === ''
            ? { kind: 'unset_arg', nodeId: node.id, field: field.name }
            : { kind: 'set_arg', nodeId: node.id, field: field.name, value: lit(Number(v)) },
        ]);
      }}
      onKeyDown={editKeys(current)}
    />
  );
}

function ListField({ node, field }: { node: ResourceNode; field: FieldDef }) {
  const m = useMessages(inspectorMessages);
  const applyOps = useOps();
  const ir = useEditor((s) => s.ir);
  const [draft, setDraft] = useState('');
  const expr = node.args[field.name];
  // a splat (`aws_subnet.private[*].id`) is the whole list: shown as one item
  if (expr && expr.kind !== 'list' && !isListValued(expr)) return <RawValueNote expr={expr} />;
  const items = expr?.kind === 'list' ? expr.items : expr ? [expr] : [];

  const commit = (next: Expression[]) => {
    applyOps([
      next.length === 0
        ? { kind: 'unset_arg', nodeId: node.id, field: field.name }
        : { kind: 'set_arg', nodeId: node.id, field: field.name, value: { kind: 'list', items: next } },
    ]);
  };
  /** add a value; every instance of a repeated resource is concatenated, not nested */
  const add = (value: Expression) => {
    const next = appendReference(expr, value);
    if (next) applyOps([{ kind: 'set_arg', nodeId: node.id, field: field.name, value: next }]);
  };
  const addTyped = (value: Expression) => (expr && expr.kind !== 'list' ? add(value) : commit([...items, value]));

  const attr = field.refAttr ?? 'id';
  const candidates = field.refTo
    ? ir.resources.filter(
        (r) =>
          field.refTo!.includes(r.type) &&
          !items.some((i) => (i.kind === 'ref' || i.kind === 'raw') && exprMentions(i, r.id)),
      )
    : [];

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <span
          key={i}
          className="flex items-center justify-between gap-2 rounded-sm border bg-surface-2 px-2 py-1"
        >
          <code className="truncate font-mono text-[11px] text-muted">{exprPreview(item)}</code>
          <button
            type="button"
            aria-label={m.removeItem}
            className="text-faint hover:text-danger"
            onClick={() => commit(items.filter((_, j) => j !== i))}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {field.refTo ? (
        candidates.length > 0 ? (
          <Select
            value=""
            onChange={(e) => {
              const target = candidates.find((c) => c.id === e.target.value);
              if (target) add(instanceRef(target, attr, { ir, from: node, all: true }));
            }}
          >
            <option value="">{m.addReference}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </Select>
        ) : items.length === 0 ? (
          <p className="text-[11px] text-faint">{m.noCandidates}</p>
        ) : null
      ) : (
        <div className="flex gap-1.5">
          <Input
            className="h-7.5"
            placeholder={m.addValuePlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                addTyped(looksLikeTraversal(draft.trim(), ir) ? ref(draft.trim()) : lit(draft.trim()));
                setDraft('');
              }
            }}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-7.5 w-9"
            aria-label={m.addValue}
            onClick={() => {
              if (!draft.trim()) return;
              addTyped(looksLikeTraversal(draft.trim(), ir) ? ref(draft.trim()) : lit(draft.trim()));
              setDraft('');
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function TagsField({ node, field }: { node: ResourceNode; field: FieldDef }) {
  const m = useMessages(inspectorMessages);
  const applyOps = useOps();
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const expr = node.args[field.name];
  // e.g. `tags = var.common_tags` — hooks above stay unconditional
  if (expr && expr.kind !== 'object') return <RawValueNote expr={expr} />;
  const entries = expr?.kind === 'object' ? Object.entries(expr.fields) : [];

  const commit = (fields: Record<string, Expression>) => {
    applyOps([
      Object.keys(fields).length === 0
        ? { kind: 'unset_arg', nodeId: node.id, field: field.name }
        : { kind: 'set_arg', nodeId: node.id, field: field.name, value: { kind: 'object', fields } },
    ]);
  };

  return (
    <div className="space-y-1.5">
      {entries.map(([key, value]) => (
        <span key={key} className="flex items-center gap-1.5">
          <code className="w-2/5 truncate rounded-sm border bg-surface-2 px-2 py-1 font-mono text-[11px]">
            {key}
          </code>
          <code className="flex-1 truncate rounded-sm border bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted">
            {exprPreview(value)}
          </code>
          <button
            type="button"
            aria-label={m.removeTag(key)}
            className="text-faint hover:text-danger"
            onClick={() => {
              const next = Object.fromEntries(entries.filter(([kk]) => kk !== key));
              commit(next);
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <div className="flex gap-1.5">
        <span className="w-2/5 shrink-0">
          <Input className="h-7.5" placeholder={m.keyPlaceholder} aria-label={m.tagKey} value={k} onChange={(e) => setK(e.target.value)} />
        </span>
        <span className="min-w-0 flex-1">
          <Input className="h-7.5" placeholder={m.valuePlaceholder} aria-label={m.tagValue} value={v} onChange={(e) => setV(e.target.value)} />
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-7.5 w-9"
          aria-label={m.addTag}
          onClick={() => {
            if (!k.trim()) return;
            commit({ ...Object.fromEntries(entries), [k.trim()]: lit(v) });
            setK('');
            setV('');
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** the editor for a field — also used by the schema's "All arguments" (SchemaFields) */
function fieldControl(node: ResourceNode, field: FieldDef): React.ReactNode {
  switch (field.type) {
    case 'select':
      return <SelectField node={node} field={field} />;
    case 'boolean':
      return <BooleanField node={node} field={field} />;
    case 'number':
      return <NumberField node={node} field={field} />;
    case 'list':
      return <ListField node={node} field={field} />;
    case 'tags':
      return <TagsField node={node} field={field} />;
    default:
      return <StringOrRefField node={node} field={field} />;
  }
}

function FieldRow({ node, field }: { node: ResourceNode; field: FieldDef }) {
  const m = useMessages(inspectorMessages);
  const missing = field.required && !node.args[field.name];
  const label = (
    <span className="flex items-center gap-1.5">
      <span className="font-mono" translate="no">
        {field.name}
      </span>
      {field.required ? (
        <span className={cn('text-[9px] font-bold uppercase', missing ? 'text-warning' : 'text-faint')}>
          {m.required}
        </span>
      ) : null}
    </span>
  );
  return (
    <Field label={label} hint={fieldHelp(node.type, field.name).doc ?? field.doc}>
      {fieldControl(node, field)}
    </Field>
  );
}

/* ------------------------------------------------------------ inspector */

const RISK_TONE = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#64748b' } as const;
const EXPOSURE_TONE = { internet: '#0ea5e9', unknown: '#f59e0b', restricted: '#10b981', isolated: '#64748b' } as const;
/** the same tones as text, at AA contrast in both themes */
const EXPOSURE_TEXT = {
  internet: 'text-[#0369a1] dark:text-[#38bdf8]',
  unknown: 'text-warning',
  restricted: 'text-success',
  isolated: 'text-muted',
} as const;
const portList = (ports: string[]) => ports.map((p) => (/^\d/.test(p) ? `:${p}` : portText(p))).join(', ');

/** Security summary for a workload: exposure and why, protecting groups, findings. */
function ExposureCard({ node }: { node: ResourceNode }) {
  const m = useMessages(inspectorMessages);
  const audit = useAudit();
  const exposure = audit.topology.exposure.get(node.id);
  const access = audit.topology.access.get(node.id);
  const findings = audit.findings.filter((f) => f.resource === node.id);
  // a repeated workload: what's said here holds for every instance
  const ir = useEditor((s) => s.ir);
  const each = appliesToEach(node, ir, audit.locale);
  if (!exposure && findings.length === 0) return null;
  // the internet's way in is spelled out per port below
  const inbound = audit.topology.flows.filter((f) => f.to === node.id && !(f.from === 'internet' && access?.open.length));
  const tone = EXPOSURE_TONE[exposure?.level ?? 'isolated'];
  return (
    <div className="rounded-[10px] border p-2.5" style={{ borderColor: `color-mix(in srgb, ${tone} 35%, transparent)` }}>
      {exposure ? (
        <div className={cn('flex items-center gap-1.5 text-[12px] font-semibold', EXPOSURE_TEXT[exposure.level])}>
          {exposure.level === 'internet' ? (
            <Globe className="h-3.5 w-3.5" />
          ) : exposure.level === 'unknown' ? (
            <ShieldQuestion className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          {exposure.level === 'internet'
            ? m.internetFacing(portList(exposure.ports))
            : exposure.level === 'unknown'
              ? m.unverifiable
              : exposure.level === 'restricted'
                ? m.restricted
                : m.isolated}
        </div>
      ) : null}
      {exposure?.reason ? <p className="mt-1 text-[11px] leading-snug text-muted">{exposure.reason}</p> : null}
      {each ? <p className="mt-1 text-[11px] leading-snug text-muted">{each}</p> : null}
      {inbound.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted">
          {inbound.map((f) => (
            <li key={f.id} className="flex justify-between gap-2">
              <span className="truncate">{m.from(f.from === 'internet' ? 'Internet' : f.from.split('.').slice(1).join('.'))}</span>
              <span className="shrink-0 font-mono">{portList(f.ports)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {exposure && exposure.owners.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{m.protectedBy}</span>
          {exposure.owners.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => useSecurityUi.getState().openRules(o)}
              className="rounded-full border bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-foreground hover:border-border-strong"
              title={m.editRules}
            >
              {o.split('.').slice(1).join('.')}
            </button>
          ))}
        </div>
      ) : null}
      {access ? (
        <div className="mt-2.5 border-t pt-2.5" data-testid="access-explanation">
          <AccessPaths access={access} />
        </div>
      ) : null}
      {findings.map((f) => (
        <div key={f.id} className="mt-2 flex items-start gap-1.5 text-[11.5px]">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: RISK_TONE[f.severity] }} />
          <span className="min-w-0 flex-1 text-foreground">
            {f.title}
            <ComplianceBadges controls={f.controls} className="mt-1" />
          </span>
          {f.fix ? (
            // a long fix wraps under itself rather than squeezing the finding
            <button
              type="button"
              onClick={() => {
                const ops = f.fix!.ops(useEditor.getState().ir);
                if (ops.length) useEditor.getState().applyCanvasOps(ops);
              }}
              className="max-w-[45%] shrink-0 text-right font-semibold text-primary hover:underline"
            >
              {f.fix.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Rules summary for SGs / NACLs / NSGs / firewalls; the full editor opens in a modal. */
function RulesTab({ node }: { node: ResourceNode }) {
  const m = useMessages(inspectorMessages);
  const audit = useAudit();
  const rules = audit.topology.rules.get(node.id) ?? [];
  const protects = audit.topology.protects.get(node.id) ?? [];
  const nacledSubnets = [...audit.topology.subnetNacls].filter(([, n]) => n.includes(node.id)).map(([s]) => s);
  const findings = audit.findings.filter((f) => f.resource === node.id);
  const hidden = audit.topology.hidden.get(node.id) ?? [];
  const open = () => useSecurityUi.getState().openRules(node.id);
  const name = (id: string) => id.split('.').slice(1).join('.');
  return (
    <div className="space-y-3.5 p-3.5">
      {findings.length > 0 ? (
        <div className="space-y-1.5">
          {findings.map((f) => (
            <div key={f.id} className="rounded-[9px] border p-2" style={{ borderColor: `color-mix(in srgb, ${RISK_TONE[f.severity]} 40%, transparent)`, background: `color-mix(in srgb, ${RISK_TONE[f.severity]} 6%, transparent)` }}>
              <div className={cn('flex items-start gap-1.5 text-[11.5px] font-semibold', SEVERITY_TEXT[f.severity])}>
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {f.title}
              </div>
              <ComplianceBadges controls={f.controls} className="mt-1 pl-5" />
              {f.fix ? (
                <button
                  type="button"
                  onClick={() => {
                    const ops = f.fix!.ops(useEditor.getState().ir);
                    if (ops.length) useEditor.getState().applyCanvasOps(ops);
                  }}
                  className="mt-1 pl-5 text-[11.5px] font-semibold text-primary hover:underline"
                >
                  {f.fix.label}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {(['inbound', 'outbound'] as const).map((direction) => {
        const list = rules.filter((r) => r.direction === direction);
        const unreadable = hidden.filter((h) => h.directions.includes(direction));
        if (node.type === 'google_compute_firewall' && list.length === 0 && unreadable.length === 0) return null;
        return (
          <div key={direction}>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
              {direction === 'inbound' ? <ArrowDownToLine className="h-3 w-3" /> : <ArrowUpFromLine className="h-3 w-3" />}
              {m.direction[direction]} <span className="font-medium normal-case tracking-normal">({list.length})</span>
            </h4>
            {unreadable.length > 0 ? (
              <p className="mb-1 text-[11.5px] text-warning">
                {m.hiddenRules(unreadable.map((h) => h.reason).join(', '))}
              </p>
            ) : null}
            {list.length === 0 ? (
              unreadable.length === 0 ? (
                <p className="text-[11.5px] text-faint">{direction === 'inbound' ? m.nothingIn : m.nothingOut}</p>
              ) : null
            ) : (
              <ul className="space-y-1">
                {list.map((r) => {
                  const risk = audit.risks.get(r.id);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={open}
                        className="flex w-full items-center gap-2 rounded-[8px] border bg-surface-1 px-2 py-1.5 text-left transition-colors hover:border-border-strong"
                      >
                        {r.action === 'deny' ? (
                          <span className="rounded-[4px] bg-danger/12 px-1 text-[9.5px] font-bold uppercase text-danger">{m.deny}</span>
                        ) : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold">
                            {serviceName(r)}{' '}
                            {/* "All traffic" already says which ports */}
                            {r.protocol === 'all' && r.fromPort === null && !r.portsExpr ? null : (
                              <span className="font-mono text-[11px] font-normal text-muted">{portText(portLabel(r))}</span>
                            )}
                          </span>
                          <span className="block truncate text-[11px] text-muted">
                            {direction === 'inbound' ? m.peersFrom : m.peersTo}
                            {r.peers.map((p) => peerLabel(p, name)).join(', ') || '—'}
                          </span>
                        </span>
                        {risk ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: RISK_TONE[risk.severity] }} aria-label={risk.title} /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      <Button className="w-full" size="sm" onClick={open}>
        <ShieldCheck className="h-3.5 w-3.5" /> {m.editRules}
      </Button>
      {protects.length > 0 || nacledSubnets.length > 0 ? (
        <div>
          <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.appliesTo}</h4>
          <div className="flex flex-wrap gap-1">
            {[...protects, ...nacledSubnets].map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  useEditor.getState().setSelection(id, 'canvas');
                  canvasApi()?.focusNode(id);
                }}
                className="rounded-full border bg-surface-2 px-2 py-0.5 font-mono text-[10.5px] hover:border-border-strong"
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-faint">{m.notAttached}</p>
      )}
    </div>
  );
}

function PropertiesTab({ node }: { node: ResourceNode }) {
  const m = useMessages(inspectorMessages);
  const applyOps = useOps();
  const ir = useEditor((s) => s.ir);
  const def = getDef(node.type);
  // count / for_each have their own section (RepeatSection)
  const knownFields = useMemo(() => new Set([...(def?.fields.map((f) => f.name) ?? []), 'count', 'for_each']), [def]);
  const extraArgs = Object.keys(node.args).filter((k) => !knownFields.has(k) && !/[\s"]/.test(k));

  return (
    <div className="space-y-3.5 p-3.5">
      <ExposureCard node={node} />
      <CostLine node={node} />
      <CidrPlanner node={node} />
      {/* the block label, not the `name` argument most resources also have */}
      <Field label={m.terraformName} hint={richText(m.referencedAs(node.id))}>
        <Input
          id="inspector-tf-name"
          key={`${node.id}:name`}
          defaultValue={node.name}
          onBlur={(e) => {
            const next = tfName(e.target.value);
            if (next === node.name) return;
            if (ir.resources.some((r) => r.type === node.type && r.name === next)) {
              showToast(messagesFor(inspectorMessages).alreadyExists(`${node.type}.${next}`), 'error');
              e.target.value = node.name;
              return;
            }
            // references follow; with the state kept, a `moved {}` block too (repeatOps.ts)
            const keepState = keepStateFor(useKeepState.getState().byProject, useEditor.getState().projectId, ir);
            applyOps(renameOps(ir, node, next, { keepState, isHistory: isHistoryMove }), `${node.type}.${next}`);
          }}
          onKeyDown={editKeys(node.name)}
        />
      </Field>
      <KeepStateToggle className="-mt-2" />
      <RepeatSection node={node} />

      {def?.fields.map((f) => <FieldRow key={f.name} node={node} field={f} />)}

      {/* the provider schema's other arguments and blocks, once loaded; until then the plain list */}
      <SchemaFields
        node={node}
        curated={knownFields}
        renderControl={(field) => fieldControl(node, field)}
        fallback={
          extraArgs.length > 0 ? (
            <div className="border-t pt-3">
              <h4 className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.otherArguments}</h4>
              <div className="space-y-3">
                {extraArgs.map((name) => (
                  <FieldRow key={name} node={node} field={{ name, type: 'string' }} />
                ))}
              </div>
            </div>
          ) : null
        }
      />
    </div>
  );
}

function ConnectionsTab({ node }: { node: ResourceNode }) {
  const m = useMessages(inspectorMessages);
  const edges = useEditor((s) => s.edges);
  const ir = useEditor((s) => s.ir);
  const applyOps = useOps();
  const outgoing = edges.filter((e) => e.source === node.id);
  const incoming = edges.filter((e) => e.target === node.id);

  const row = (edge: (typeof edges)[number], dir: 'in' | 'out') => {
    const otherId = dir === 'out' ? edge.target : edge.source;
    return (
      <div key={edge.id} className="flex items-center gap-2 rounded-sm border bg-surface-2 px-2.5 py-1.5">
        {dir === 'out' ? (
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-primary" />
        ) : (
          <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-success" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium">{otherId}</span>
          <span className="block truncate font-mono text-[10px] text-faint">
            {dir === 'out' ? edge.field : m.referencedVia(edge.field)}
          </span>
        </span>
        {dir === 'out' ? (
          <button
            type="button"
            aria-label={m.removeConnection}
            className="text-faint hover:text-danger"
            onClick={() => {
              const ops = removeConnectionOps(ir, edge);
              if (ops.length === 0) showToast(messagesFor(inspectorMessages).editConnectionInCode, 'info');
              else applyOps(ops);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-4 p-3.5">
      <div>
        <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.outgoing(outgoing.length)}</h4>
        <div className="space-y-1.5">
          {outgoing.map((e) => row(e, 'out'))}
          {outgoing.length === 0 ? (
            <p className="text-[11.5px] text-faint">{m.noOutgoing}</p>
          ) : null}
        </div>
      </div>
      <div>
        <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.incoming(incoming.length)}</h4>
        <div className="space-y-1.5">
          {incoming.map((e) => row(e, 'in'))}
          {incoming.length === 0 ? (
            <p className="text-[11.5px] text-faint">{m.noIncoming}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Project summary — opened from the canvas stats pill. */
export function ProjectOverview({ onNavigate }: { onNavigate?(): void }) {
  const m = useMessages(inspectorMessages);
  const projectName = useEditor((s) => s.projectName);
  const renameProject = useEditor((s) => s.renameProject);
  const readOnly = useEditor((s) => s.readOnly);
  const ir = useEditor((s) => s.ir);
  const edges = useEditor((s) => s.edges);
  const files = useEditor((s) => s.files);
  const warnings = useEditor((s) => s.warnings);

  const openFile = (f: string) => {
    useEditor.getState().setActiveFile(f);
    if (!useLayout.getState().isOpen('code')) useLayout.getState().toggle('code');
    onNavigate?.();
  };

  return (
    <div className="space-y-4 p-3.5">
      <Field label={m.projectName}>
        <Input
          key={projectName}
          defaultValue={projectName}
          readOnly={readOnly}
          onBlur={(e) => {
            if (e.target.value.trim() && e.target.value !== projectName) {
              renameProject(e.target.value);
            }
          }}
          onKeyDown={editKeys(projectName)}
        />
      </Field>

      <div className="grid grid-cols-4 gap-1.5 text-center">
        {[
          [ir.resources.length, m.counts.resources],
          [edges.length, m.counts.links],
          [ir.variables.length, m.counts.variables],
          [ir.outputs.length, m.counts.outputs],
        ].map(([n, label]) => (
          <div key={String(label)} className="rounded-[8px] border bg-surface-2 px-1 py-2">
            <div className="text-[16px] font-bold leading-none">{n}</div>
            <div className="mt-1 text-[9.5px] uppercase tracking-wide text-faint">{label}</div>
          </div>
        ))}
      </div>

      <div>
        <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.files}</h4>
        <div className="space-y-1">
          {orderedFiles(files).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => openFile(f)}
              className="flex w-full justify-between rounded-[7px] bg-surface-2 px-2.5 py-1.5 text-left transition-colors hover:bg-primary-soft hover:text-primary"
            >
              <code className="font-mono text-[11.5px]">{f}</code>
              <span className="text-[11px] text-faint">{m.lines(files[f].split('\n').length)}</span>
            </button>
          ))}
        </div>
      </div>

      {warnings.length > 0 ? (
        <div>
          <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-warning">
            {m.warnings(warnings.length)}
          </h4>
          <div className="space-y-1">
            {warnings.slice(0, 8).map((w, i) => (
              <button
                key={i}
                type="button"
                disabled={!w.nodeId}
                onClick={() => {
                  if (!w.nodeId) return;
                  useEditor.getState().setSelection(w.nodeId, 'canvas');
                  canvasApi()?.focusNode(w.nodeId);
                  onNavigate?.();
                }}
                className="w-full rounded-[7px] border border-warning/25 bg-warning/8 px-2 py-1.5 text-left text-[11px] leading-snug text-muted transition-colors hover:border-warning/50 disabled:cursor-default"
              >
                {w.message}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The selected resource's settings. `docked`: a full-height column beside
 * the canvas instead of a card floating over it. `onMinimize`: the page can
 * fold it into a slim tab (the editor; the viewer can't).
 */
export function Inspector({ docked = false, onMinimize }: { docked?: boolean; onMinimize?(): void } = {}) {
  const lm = useMessages(layoutMessages);
  const m = useMessages(inspectorMessages);
  const selection = useEditor((s) => s.selection);
  const selectedIds = useEditor((s) => s.selectedIds);
  const ir = useEditor((s) => s.ir);
  const codeErrored = useEditor((s) => s.codeErrored);
  const readOnly = useEditor((s) => s.readOnly);
  const [tabChoice, setTab] = useState<Tab>('properties');
  const node = selection ? ir.resources.find((r) => r.id === selection) : undefined;
  const isOwner = node ? OWNER_TYPES[node.type] !== undefined : false;
  const tabs: Tab[] = isOwner ? ['rules', 'properties', 'connections'] : ['properties', 'connections'];
  const tab: Tab = tabs.includes(tabChoice) ? tabChoice : 'properties';
  const compactCode = tabs.length > 2;
  // security groups & co open on their rules
  useEffect(() => {
    if (isOwner) setTab('rules');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);
  const def = node ? getDef(node.type) : undefined;

  if (selectedIds.length > 1) {
    return docked ? (
      <div className="flex min-h-0 flex-1 p-2">
        <MultiSelectPanel ids={selectedIds} />
      </div>
    ) : (
      <MultiSelectPanel ids={selectedIds} />
    );
  }
  // a module call has an inspector of its own
  if (!node) return selection && isModuleId(selection) ? <ModuleInspector docked={docked} onMinimize={onMinimize} /> : null;
  return (
    <aside
      className={cn(
        'flex w-full flex-col overflow-hidden bg-surface-1',
        docked ? 'min-h-0 flex-1' : 'bp-pop-in rounded-[14px] border shadow-xl',
      )}
      aria-label={m.label}
    >
      {
        <>
          <div className="border-b p-3.5">
            <div className="flex items-center gap-2.5">
              <ResourceIcon category={def?.category ?? 'compute'} type={node.type} size={38} />
              <div className="min-w-0 flex-1">
                {/* long names ("Grupo de segurança de rede") wrap to a second line rather than lose their end */}
                <h2 className="line-clamp-2 break-words text-[13.5px] font-semibold leading-tight">
                  {def ? resourceName(node.type) : node.type}
                </h2>
                <code className="block truncate font-mono text-[10.5px] text-faint" data-testid="inspector-address">
                  {node.id}
                </code>
              </div>
              {node.provider !== 'other' ? (
                <Badge variant={node.provider}>{PROVIDER_LABELS[node.provider]}</Badge>
              ) : null}
              {onMinimize ? (
                <button
                  type="button"
                  aria-label={lm.hide.inspector}
                  title={lm.hide.inspector}
                  data-minimize
                  onClick={onMinimize}
                  className="-mr-1 rounded-[6px] p-1 text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <PanelRightClose className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={m.close}
                title={m.closeTitle}
                onClick={() => useEditor.getState().setSelection(null)}
                className="-mr-1 rounded-[6px] p-1 text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {def?.description ? (
              <p className="mt-2 text-[11.5px] leading-snug text-muted">
                {resourceDescription(node.type)}
                {docsUrl(node.type) ? (
                  <>
                    {' · '}
                    <a
                      href={docsUrl(node.type)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
                    >
                      {m.terraformDocs} <ArrowUpRight className="h-3 w-3" />
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
            <div className="mt-3 flex items-stretch gap-1.5">
              <div className="flex min-w-0 flex-1 rounded-sm border bg-surface-2 p-0.5" role="tablist">
                {tabs.map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      'min-w-0 truncate rounded-[5px] px-1.5 py-1 text-[11.5px] font-semibold capitalize transition-colors',
                      // three tabs: each as wide as its word, so "Propriedades" and "Connections" fit
                      compactCode ? 'flex-auto' : 'flex-1',
                      tab === t ? 'bg-surface-1 text-foreground shadow-xs' : 'text-muted hover:text-foreground',
                    )}
                  >
                    {m.tab[t]}
                  </button>
                ))}
              </div>
              {/* not a tab: the block is shown where it lives, in the code editor, highlighted */}
              <button
                type="button"
                title={lm.codeButtonTitle}
                aria-label={compactCode ? lm.codeButton : undefined}
                onClick={() => useEditor.getState().revealInCode(node.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-sm border bg-surface-2 text-[11.5px] font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary',
                  compactCode ? 'px-1.5' : 'px-2',
                )}
              >
                <Code2 className="h-3.5 w-3.5" />
                {/* with three tabs the row has room for the icon only */}
                {compactCode ? null : lm.codeButton}
              </button>
            </div>
          </div>

          {readOnly ? (
            <p role="status" className="border-b bg-surface-2/60 px-3.5 py-2 text-[11.5px] font-medium text-muted">
              {m.readOnlyView}
            </p>
          ) : codeErrored ? (
            <p role="status" className="border-b bg-warning/10 px-3.5 py-2 text-[11.5px] font-medium text-warning">
              {m.readOnlyUntilParses}
            </p>
          ) : null}
          {/* disabled, nothing inside takes focus: the scroll area itself must, for keyboard scrolling */}
          <div
            role={codeErrored || readOnly ? 'group' : undefined}
            tabIndex={codeErrored || readOnly ? 0 : undefined}
            aria-label={codeErrored || readOnly ? m.settingsReadOnly : undefined}
            className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          >
            <fieldset disabled={codeErrored || readOnly} className="min-w-0">
              {tab === 'rules' ? <RulesTab node={node} /> : null}
              {tab === 'properties' ? <PropertiesTab node={node} /> : null}
              {tab === 'connections' ? <ConnectionsTab node={node} /> : null}
            </fieldset>
          </div>

          {readOnly ? null : (
            <div className="border-t p-3">
              <Button
                variant="outline"
                size="sm"
                disabled={codeErrored}
                className="w-full text-danger hover:border-danger/50 hover:bg-danger/8"
                onClick={() => useEditor.getState().deleteResources([node.id])}
              >
                <Trash2 className="h-3.5 w-3.5" /> {m.deleteResource}
              </Button>
            </div>
          )}
        </>
      }
    </aside>
  );
}
