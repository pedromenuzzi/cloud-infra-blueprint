/**
 * The inspector's "Repeat" section: set, change or remove a resource's
 * `count` / `for_each` — a number, a list of keys, or an expression. Every
 * change is one undo step; adding or removing repetition also re-keys the
 * references to the resource and, when the state is kept, writes the
 * `moved {}` block that tells Terraform where the existing object went
 * (see repeatOps.ts). `KeepStateToggle` is the same choice for renames.
 */
import { Plus, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button, Input, Select } from '@/components/ui';
import { movedBlocks } from '@/hcl/moved';
import { parseExpressionText } from '@/hcl/parser';
import { useMessages } from '@/i18n/messages';
import { exprMentions, lit } from '@/ir/expr';
import { exprText, instanceKey, repeatOf, type Repeat, type RepeatKind } from '@/ir/repeat';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { cn } from '@/lib/utils';
import { isHistoryMove, keepStateFor, useKeepState } from './movedSession';
import { RepeatBadge } from './RepeatBadge';
import { repeatLabel } from './repeatLabel';
import { repeatChange, specRepeat, type RepeatSpec } from './repeatOps';
import { repeatMessages } from './RepeatSection.messages';
import { useEditor } from './store';

type Mode = 'single' | RepeatKind;

interface Draft {
  mode: Mode;
  count: string;
  keys: string[];
  /** `for_each` written as an expression instead of a list of keys */
  asExpr: boolean;
  expr: string;
  /** adding for_each: the existing instance's key; removing: the instance kept */
  key: string;
}

/** a `for_each` the key editor can show: literal keys written in place */
function literalKeys(rep: Repeat): string[] | undefined {
  if (rep.kind !== 'for_each' || !rep.keys || rep.via) return undefined;
  const text = exprText(rep.expr);
  return /^(toset\()?\s*\[/.test(text) ? rep.keys : undefined;
}

function draftOf(rep: Repeat | null): Draft {
  const base: Draft = { mode: 'single', count: '2', keys: [], asExpr: false, expr: '', key: '' };
  if (!rep) return base;
  if (rep.kind === 'count') return { ...base, mode: 'count', count: exprText(rep.expr) };
  const keys = literalKeys(rep);
  return keys ? { ...base, mode: 'for_each', keys } : { ...base, mode: 'for_each', asExpr: true, expr: exprText(rep.expr) };
}

/** the spec a draft stands for, or why it can't be applied */
function specOf(draft: Draft, m: (typeof repeatMessages)['en']): RepeatSpec | null | { error: string } {
  if (draft.mode === 'single') return null;
  if (draft.mode === 'count') {
    const text = draft.count.trim();
    if (/^\d+$/.test(text)) return { kind: 'count', expr: lit(Number(text)) };
    const e = text && !/^-/.test(text) ? parseExpressionText(text) : null;
    return e && !(e.kind === 'literal' && typeof e.value !== 'number') ? { kind: 'count', expr: e } : { error: m.invalidCount };
  }
  if (!draft.asExpr) {
    if (draft.keys.length === 0) return { error: m.noKeys };
    return { kind: 'for_each', expr: { kind: 'raw', hcl: `toset([${draft.keys.map((k) => JSON.stringify(k)).join(', ')}])` } };
  }
  const e = draft.expr.trim() ? parseExpressionText(draft.expr.trim()) : null;
  return e ? { kind: 'for_each', expr: e } : { error: m.invalidExpression };
}

const isSpec = (s: RepeatSpec | null | { error: string }): s is RepeatSpec | null => s === null || !('error' in s);

/** the instance a `moved { from = web  to = web["green"] }` block sent the existing object to */
function movedInstanceKey(ir: IR, address: string): string | undefined {
  for (const m of movedBlocks(ir)) {
    if (m.from !== address || !m.to.startsWith(`${address}[`) || !m.to.endsWith(']')) continue;
    const key = m.to.slice(address.length + 1, -1).trim();
    try {
      return key.startsWith('"') ? String(JSON.parse(key)) : key;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** does anything else in the project point at `id`? */
function referenced(ir: IR, id: string): boolean {
  const mentions = (args: Record<string, Expression>) => Object.values(args).some((e) => exprMentions(e, id));
  return ir.resources.some((r) => r.id !== id && mentions(r.args)) || ir.outputs.some((o) => mentions(o.args));
}

/** "Keep the state (write a moved block)" — per project, see movedSession.ts */
export function KeepStateToggle({ className }: { className?: string }) {
  const m = useMessages(repeatMessages);
  const projectId = useEditor((s) => s.projectId);
  const ir = useEditor((s) => s.ir);
  const readOnly = useEditor((s) => s.readOnly);
  const byProject = useKeepState((s) => s.byProject);
  const keep = keepStateFor(byProject, projectId, ir);
  const hintId = useId();
  if (readOnly) return null;
  return (
    <label className={cn('flex cursor-pointer items-start gap-2', className)}>
      <input
        type="checkbox"
        data-testid="keep-state"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--primary)]"
        checked={keep}
        aria-describedby={hintId}
        onChange={(e) => {
          if (projectId) useKeepState.getState().set(projectId, e.target.checked);
        }}
      />
      <span className="min-w-0">
        <span className="block text-[11.5px] font-medium text-foreground">{m.keepState}</span>
        <span id={hintId} className="block text-[10.5px] leading-snug text-faint">
          {m.keepStateHint}
        </span>
      </span>
    </label>
  );
}

function KeyEditor({ keys, onChange }: { keys: string[]; onChange(keys: string[]): void }) {
  const m = useMessages(repeatMessages);
  const [draft, setDraft] = useState('');
  const add = () => {
    const k = draft.trim();
    if (!k || keys.includes(k)) return;
    onChange([...keys, k]);
    setDraft('');
  };
  return (
    <div className="space-y-1.5">
      {keys.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label={m.keys}>
          {keys.map((k) => (
            <li key={k} className="flex items-center gap-1 rounded-full border bg-surface-2 py-0.5 pl-2 pr-1">
              <code className="font-mono text-[11px]">{k}</code>
              <button
                type="button"
                aria-label={m.removeKey(k)}
                className="rounded-full p-0.5 text-faint hover:text-danger"
                onClick={() => onChange(keys.filter((x) => x !== k))}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-1.5">
        <Input
          className="h-7.5"
          aria-label={m.keys}
          placeholder={m.keyPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="outline" size="icon" className="h-7.5 w-9" aria-label={m.addKey} onClick={add}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** the instance a change keeps or creates: a list when the choices are known, else a field */
function InstanceKeyField({
  label,
  hint,
  kind,
  choices,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  kind: RepeatKind;
  choices?: string[];
  value: string;
  onChange(v: string): void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {choices && choices.length > 0 ? (
        <Select id={id} className="h-7.5 font-mono text-[12px]" value={value} onChange={(e) => onChange(e.target.value)}>
          {choices.map((c) => (
            <option key={c} value={c}>
              {kind === 'count' ? `[${c}]` : `["${c}"]`}
            </option>
          ))}
        </Select>
      ) : (
        <Input id={id} className="h-7.5 font-mono text-[12px]" value={value} inputMode={kind === 'count' ? 'numeric' : undefined} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint ? <span className="mt-1 block text-[10.5px] text-faint">{hint}</span> : null}
    </div>
  );
}

export function RepeatSection({ node }: { node: ResourceNode }) {
  const m = useMessages(repeatMessages);
  const ir = useEditor((s) => s.ir);
  const projectId = useEditor((s) => s.projectId);
  const byProject = useKeepState((s) => s.byProject);
  const keep = keepStateFor(byProject, projectId, ir);
  const current = repeatOf(node, ir);
  const currentText = current ? `${current.kind}:${exprText(current.expr)}` : 'single';
  // a new resource, or the code changed the repetition: start from what is written
  const [state, setState] = useState<{ at: string; draft: Draft }>({ at: '', draft: draftOf(current) });
  const at = `${node.id}\u0000${currentText}`;
  const draft = state.at === at ? state.draft : draftOf(current);
  const update = (patch: Partial<Draft>) => setState({ at, draft: { ...draft, ...patch } });
  const modeName = useId();
  const titleId = useId();
  const readOnly = useEditor((s) => s.readOnly);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const spec = specOf(draft, m);
  const pending = isSpec(spec) && (spec === null ? current !== null : !current || current.kind !== spec.kind || exprText(current.expr) !== exprText(spec.expr));

  // which instance maps where when repetition comes or goes
  const adding = pending && !current && isSpec(spec) && spec !== null;
  const removing = pending && current !== null && spec === null;
  const addKeys = adding && spec.kind === 'for_each' ? specRepeat(spec, ir).keys : undefined;
  const removeChoices = removing
    ? current.kind === 'count'
      ? current.size !== undefined && current.size > 0
        ? Array.from({ length: Math.min(current.size, 50) }, (_, i) => String(i))
        : undefined
      : current.keys
    : undefined;
  // removing: keep the instance a moved block says the existing object went to
  const movedTo = removing ? movedInstanceKey(ir, node.id) : undefined;
  const keptKey = movedTo !== undefined && (!removeChoices || removeChoices.includes(movedTo)) ? movedTo : undefined;
  const defaultKey = adding
    ? spec.kind === 'count'
      ? '0'
      : (addKeys?.[0] ?? '')
    : removing
      ? (keptKey ?? removeChoices?.[0] ?? (current.kind === 'count' ? '0' : ''))
      : '';
  const key = draft.key !== '' && (!removeChoices || removeChoices.includes(draft.key)) && (!addKeys || addKeys.includes(draft.key)) ? draft.key : defaultKey;

  const change = pending && isSpec(spec) ? repeatChange(ir, node, spec, { keepState: keep, isHistory: isHistoryMove, key: key || undefined }) : null;

  /** the Apply / Cancel row goes away: keep the keyboard in the section (on its heading, so Ctrl+Z still undoes) */
  const refocus = () => requestAnimationFrame(() => headingRef.current?.focus());
  const apply = () => {
    if (!change || change.ops.length === 0) return;
    useEditor.getState().applyCanvasOps(change.ops);
    refocus();
  };
  const cancel = () => {
    setState({ at, draft: draftOf(current) });
    refocus();
  };
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    } else if (e.key === 'Escape' && pending) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  const example =
    (adding || removing) && key && referenced(ir, node.id)
      ? adding
        ? `${node.id}.id → ${node.id}[${instanceKey(spec!.kind, spec!.kind === 'count' ? 0 : key)}].id`
        : `${node.id}[${instanceKey(current!.kind, key)}].id → ${node.id}.id`
      : null;

  // a view link can't edit: a single resource has nothing to say here
  if (readOnly && !current) return null;
  return (
    <section aria-labelledby={titleId} className="rounded-[10px] border bg-surface-2/50 p-2.5" data-testid="repeat-section">
      <div className="mb-2 flex items-center gap-2">
        <h4 ref={headingRef} id={titleId} tabIndex={-1} className="flex-1 outline-none text-[10.5px] font-bold uppercase tracking-wider text-faint">
          {m.title}
        </h4>
        {current ? <RepeatBadge repeat={repeatLabel(current)} inline plain /> : null}
      </div>

      <div role="radiogroup" aria-label={m.mode} className="flex rounded-md border bg-surface-1 p-0.5">
        {(['single', 'count', 'for_each'] as const).map((mode) => (
          <label
            key={mode}
            className={cn(
              'relative flex h-6.5 flex-1 items-center justify-center rounded-[4px] px-2 text-[11.5px] font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary',
              draft.mode === mode ? 'bg-surface-2 text-foreground shadow-xs' : 'text-muted hover:text-foreground',
            )}
          >
            <input
              type="radio"
              name={modeName}
              value={mode}
              checked={draft.mode === mode}
              onChange={() => update({ mode, key: '' })}
              className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-[4px] outline-none"
            />
            {mode === 'single' ? m.single : <code className="font-mono text-[11px]">{mode}</code>}
          </label>
        ))}
      </div>

      {draft.mode === 'count' ? (
        <div className="mt-2.5">
          <label className="mb-1 block text-xs font-medium text-muted" htmlFor={`${titleId}-count`}>
            {m.howMany}
          </label>
          <Input
            id={`${titleId}-count`}
            className="h-7.5 font-mono text-[12px]"
            value={draft.count}
            onChange={(e) => update({ count: e.target.value })}
            onKeyDown={onEnter}
          />
          <span className="mt-1 block text-[10.5px] text-faint">{m.howManyHint}</span>
        </div>
      ) : null}

      {draft.mode === 'for_each' ? (
        <div className="mt-2.5 space-y-1.5">
          {draft.asExpr ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor={`${titleId}-expr`}>
                {m.expression}
              </label>
              <Input
                id={`${titleId}-expr`}
                className="h-7.5 font-mono text-[12px]"
                value={draft.expr}
                placeholder="var.azs"
                onChange={(e) => update({ expr: e.target.value })}
                onKeyDown={onEnter}
              />
              <span className="mt-1 block text-[10.5px] text-faint">{m.expressionHint}</span>
            </div>
          ) : (
            <div>
              <span className="mb-1 block text-xs font-medium text-muted">{m.keys}</span>
              <KeyEditor keys={draft.keys} onChange={(keys) => update({ keys })} />
              <span className="mt-1 block text-[10.5px] text-faint">{m.keysHint}</span>
            </div>
          )}
          <button type="button" className="text-[11px] font-medium text-primary hover:underline" onClick={() => update({ asExpr: !draft.asExpr })}>
            {draft.asExpr ? m.useKeys : m.useExpression}
          </button>
        </div>
      ) : null}

      {!isSpec(spec) && draft.mode !== 'single' && (draft.mode === 'count' ? draft.count.trim() : draft.asExpr ? draft.expr.trim() : 'x') ? (
        <p role="status" className="mt-1.5 text-[11px] text-warning">
          {spec.error}
        </p>
      ) : null}

      {pending && change ? (
        <div className="mt-2.5 space-y-2 border-t pt-2.5">
          {adding && spec!.kind === 'for_each' ? (
            <InstanceKeyField label={m.existingKey} hint={m.existingKeyHint} kind="for_each" choices={addKeys} value={key} onChange={(v) => update({ key: v })} />
          ) : null}
          {removing ? (
            <InstanceKeyField label={m.keepInstance} kind={current!.kind} choices={removeChoices} value={key} onChange={(v) => update({ key: v })} />
          ) : null}
          {keep && change.moves.length > 0 ? (
            <div data-testid="moved-preview">
              <span className="block text-[10.5px] text-faint">{m.moves(change.moves.length)}</span>
              <code className="mt-0.5 block space-y-1 rounded-sm border bg-surface-1 px-2 py-1 font-mono text-[10.5px] leading-snug text-muted [overflow-wrap:anywhere]">
                {change.moves.slice(0, 3).map((mv) => (
                  <span key={`${mv.from}>${mv.to}`} className="block">
                    <span className="block">from = {mv.from}</span>
                    <span className="block">to&nbsp;&nbsp; = {mv.to}</span>
                  </span>
                ))}
                {change.moves.length > 3 ? <span className="block">…</span> : null}
              </code>
            </div>
          ) : change.moves.length > 0 ? (
            <p className="text-[10.5px] leading-snug text-faint" data-testid="no-moved">
              {m.stateNotKept}
            </p>
          ) : current && spec && current.kind !== spec.kind ? (
            <p className="text-[10.5px] leading-snug text-faint">{m.noMove}</p>
          ) : null}
          {example ? (
            <div className="text-[10.5px] leading-snug text-faint">
              {m.referencesFollow}
              <code className="block font-mono [overflow-wrap:anywhere]">{example}</code>
            </div>
          ) : null}
          <div className="flex justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={cancel}>
              {m.cancel}
            </Button>
            <Button size="sm" onClick={apply} data-testid="repeat-apply">
              {m.apply}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
