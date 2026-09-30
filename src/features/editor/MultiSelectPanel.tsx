/**
 * The inspector for a multi-selection: arrange (align / distribute), shared
 * settings, a tag and a connection for all of them, delete — each one undo
 * step.
 */
import { Link2, Tag, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { showToast } from '@/components/Toast';
import { Button, Input, Select } from '@/components/ui';
import { MOD } from '@/features/command/paletteStore';
import { useMessages } from '@/i18n/messages';
import { exprPreview, lit } from '@/ir/expr';
import type { Expression } from '@/ir/types';
import { resourceName, resourceShortName } from '@/resources/i18n';
import { ResourceIcon } from '@/resources/icons';
import { getDef } from '@/resources/registry';
import type { FieldDef } from '@/resources/types';
import { ALIGN_ACTIONS, alignActionBlocker } from './alignActions';
import { bulkConnectOps, bulkSetOps, bulkTagOps, commonFields, connectTargets, selectedNodes, sharedValue } from './bulk';
import { canvasApi } from './canvasApi';
import { multiSelectMessages } from './MultiSelectPanel.messages';
import { useEditor } from './store';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-b px-3.5 py-3 last:border-b-0">
      <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-faint">{title}</h3>
      {children}
    </section>
  );
}

function SharedField({ field, ids }: { field: FieldDef; ids: string[] }) {
  const m = useMessages(multiSelectMessages);
  const ir = useEditor((s) => s.ir);
  const apply = useEditor((s) => s.applyCanvasOps);
  const nodes = selectedNodes(ir, ids);
  const shared = sharedValue(nodes, field.name);
  const mixed = shared === 'mixed';
  const complex = shared !== undefined && !mixed && shared.kind !== 'literal';
  const text = shared && !mixed && shared.kind === 'literal' && shared.value !== null ? String(shared.value) : '';
  const commit = (value: Expression | null) => {
    const ops = bulkSetOps(nodes, field.name, value);
    if (ops.length > 0) apply(ops);
  };
  const label = (
    <span className="mb-1 block font-mono text-[11px] text-muted">
      {field.name}
      {mixed ? <span className="ml-1.5 font-sans text-[10px] font-semibold uppercase text-faint">{m.mixed}</span> : null}
    </span>
  );
  if (complex) {
    return (
      <div>
        {label}
        <code className="block truncate rounded-sm border border-dashed bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-muted">
          {exprPreview(shared)}
        </code>
      </div>
    );
  }
  if (field.type === 'select' || field.type === 'boolean') {
    const options = field.type === 'boolean' ? ['true', 'false'] : (field.options ?? []);
    return (
      <label className="block">
        {label}
        <Select
          value={mixed ? '__mixed' : text}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__mixed') return;
            commit(v === '' ? null : field.type === 'boolean' ? lit(v === 'true') : lit(v));
          }}
        >
          {mixed ? <option value="__mixed">{m.mixedPick}</option> : null}
          <option value="">{m.none}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {text && !options.includes(text) ? <option value={text}>{text}</option> : null}
        </Select>
      </label>
    );
  }
  return (
    <label className="block">
      {label}
      <Input
        key={`${ids.join(',')}:${field.name}:${mixed ? '~' : text}`}
        type={field.type === 'number' ? 'number' : 'text'}
        min={field.min}
        max={field.max}
        defaultValue={text}
        placeholder={mixed ? m.mixedType : field.placeholder}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v === text) return;
          if (v === '') {
            // clearing a shared value removes it everywhere; an empty "mixed" field changes nothing
            if (!mixed && text) commit(null);
            return;
          }
          if (field.type === 'number' && !Number.isFinite(Number(v))) {
            e.target.value = text;
            return;
          }
          commit(field.type === 'number' ? lit(Number(v)) : lit(v));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            e.currentTarget.value = text;
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export function MultiSelectPanel({ ids }: { ids: string[] }) {
  const m = useMessages(multiSelectMessages);
  const ir = useEditor((s) => s.ir);
  const codeErrored = useEditor((s) => s.codeErrored);
  const readOnly = useEditor((s) => s.readOnly);
  const locked = codeErrored || readOnly;
  const apply = useEditor((s) => s.applyCanvasOps);
  const nodes = useMemo(() => selectedNodes(ir, ids), [ir, ids]);
  const fields = useMemo(() => commonFields(nodes), [nodes]);
  const targets = useMemo(() => connectTargets(ir, nodes), [ir, nodes]);
  const [tagKey, setTagKey] = useState('');
  const [tagValue, setTagValue] = useState('');
  const [target, setTarget] = useState('');

  const counts = new Map<string, number>();
  for (const n of nodes) {
    const name = resourceName(n.type);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const summary = [...counts].map(([name, n]) => `${name} ×${n}`).join(' · ');
  const arrangeHint = alignActionBlocker(ALIGN_ACTIONS[0], ir, ids);

  const clear = () => useEditor.getState().setSelectedIds([], null);

  const addTag = () => {
    const key = tagKey.trim();
    if (!key) return;
    const { ops, skipped } = bulkTagOps(nodes, key, tagValue);
    if (ops.length > 0) apply(ops);
    showToast(m.tagged(ops.length, key, tagValue, skipped.length), ops.length > 0 ? 'success' : 'info');
    setTagKey('');
    setTagValue('');
  };

  const connect = () => {
    const to = ir.resources.find((r) => r.id === target);
    if (!to) return;
    const { ops, already } = bulkConnectOps(nodes, to);
    if (ops.length > 0) apply(ops);
    showToast(ops.length > 0 ? m.connected(ops.length, to.id, already) : m.allConnected(to.id), ops.length > 0 ? 'success' : 'info');
    setTarget('');
  };

  return (
    <aside
      className="bp-pop-in flex w-full flex-col overflow-hidden rounded-[14px] border bg-surface-1 shadow-xl"
      aria-label={m.panel(nodes.length)}
    >
      <div className="flex items-start gap-2.5 border-b p-3.5">
        <span className="flex -space-x-2">
          {nodes.slice(0, 3).map((n) => (
            <ResourceIcon key={n.id} category={getDef(n.type)?.category ?? 'compute'} type={n.type} size={30} className="ring-2 ring-surface-1" />
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-semibold leading-tight">{m.heading(nodes.length)}</h2>
          <p className="truncate text-[11px] text-faint" title={summary}>
            {summary}
          </p>
        </div>
        <button
          type="button"
          aria-label={m.clear}
          title={m.clearTitle}
          onClick={clear}
          className="-mr-1 rounded-[6px] p-1 text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {codeErrored ? (
        <p role="status" className="border-b bg-warning/10 px-3.5 py-2 text-[11.5px] font-medium text-warning">
          {m.readOnly}
        </p>
      ) : null}

      <fieldset disabled={locked} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Section title={m.arrange}>
          <div className="grid grid-cols-8 gap-1" role="toolbar" aria-label={m.alignToolbar}>
            {ALIGN_ACTIONS.map((a) => {
              const blocked = alignActionBlocker(a, ir, ids);
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-label={a.label}
                  title={blocked ?? a.label}
                  disabled={blocked !== null}
                  onClick={() => {
                    const ops = a.ops(ir, ids);
                    if (ops.length > 0) apply(ops);
                  }}
                  className="flex aspect-square items-center justify-center rounded-sm border bg-surface-1 text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40"
                >
                  <a.icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
          {arrangeHint ? <p className="text-[11px] text-faint">{m.lineUpHint(arrangeHint)}</p> : null}
        </Section>

        {fields.length > 0 ? (
          <Section title={m.shared}>
            <div className="space-y-2.5">
              {fields.map((f) => (
                <SharedField key={f.name} field={f} ids={ids} />
              ))}
            </div>
          </Section>
        ) : null}

        <Section title={m.tagAll}>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              addTag();
            }}
          >
            <span className="w-2/5 shrink-0">
              <Input className="h-7.5" placeholder={m.tagKey} aria-label={m.tagKeyLabel} value={tagKey} onChange={(e) => setTagKey(e.target.value)} />
            </span>
            <span className="min-w-0 flex-1">
              <Input className="h-7.5" placeholder={m.tagValue} aria-label={m.tagValueLabel} value={tagValue} onChange={(e) => setTagValue(e.target.value)} />
            </span>
            <Button type="submit" variant="outline" size="icon" className="h-7.5 w-9" aria-label={m.addTag} disabled={!tagKey.trim()}>
              <Tag className="h-3.5 w-3.5" />
            </Button>
          </form>
        </Section>

        {targets.length > 0 ? (
          <Section title={m.connectAllTo}>
            <div className="flex gap-1.5">
              <span className="min-w-0 flex-1">
                <Select aria-label={m.connectTarget} value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">{m.pickResource}</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id}
                    </option>
                  ))}
                </Select>
              </span>
              <Button variant="outline" size="icon" className="w-9" aria-label={m.connectAll} disabled={!target} onClick={connect}>
                <Link2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Section>
        ) : null}

        <Section title={m.selected}>
          <ul className="space-y-0.5">
            {nodes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    useEditor.getState().setSelectedIds([n.id], n.id);
                    canvasApi()?.focusNode(n.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-surface-2"
                  title={m.selectOnly}
                >
                  <ResourceIcon category={getDef(n.type)?.category ?? 'compute'} type={n.type} size={20} />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{n.name}</span>
                  <span className="shrink-0 truncate text-[10.5px] text-faint">{resourceShortName(n.type)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      </fieldset>

      <div className={readOnly ? 'hidden' : 'border-t p-3'}>
        <Button
          variant="outline"
          size="sm"
          disabled={locked}
          className="w-full text-danger hover:border-danger/50 hover:bg-danger/8"
          onClick={() => {
            const count = useEditor.getState().deleteResources(ids);
            showToast(m.deleted(count, MOD), 'info');
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> {m.delete(nodes.length)}
        </Button>
      </div>
    </aside>
  );
}
