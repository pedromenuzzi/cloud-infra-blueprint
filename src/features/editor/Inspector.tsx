import { ArrowDownLeft, ArrowUpRight, Copy, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { showToast } from '@/components/Toast';
import { Badge, Button, Field, Input, Select } from '@/components/ui';
import { emitResource } from '@/hcl/emitter';
import { exprPreview, lit, literalString, ref } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { Expression, ResourceNode } from '@/ir/types';
import { copyText } from '@/lib/download';
import { cn, tfName } from '@/lib/utils';
import { PROVIDER_LABELS, ResourceIcon } from '@/resources/icons';
import { getDef } from '@/resources/registry';
import type { FieldDef } from '@/resources/types';
import { looksLikeTraversal, removeConnectionOps } from './connections';
import { orderedFiles, useEditor } from './store';

type Tab = 'properties' | 'connections' | 'code';

/* ------------------------------------------------------------- field rows */

function useOps() {
  return useEditor((s) => s.applyCanvasOps);
}

function commitTextOp(node: ResourceNode, field: string, text: string): Op | null {
  const trimmed = text.trim();
  const current = node.args[field];
  if (trimmed === '') {
    return current ? { kind: 'unset_arg', nodeId: node.id, field } : null;
  }
  const value: Expression = looksLikeTraversal(trimmed) ? ref(trimmed) : lit(trimmed);
  if (current && exprPreview(current) === exprPreview(value)) return null;
  return { kind: 'set_arg', nodeId: node.id, field, value };
}

function RawValueNote({ expr }: { expr: Expression }) {
  return (
    <div className="rounded-sm border border-dashed bg-surface-2 px-2.5 py-1.5">
      <code className="block truncate font-mono text-[11px] text-muted" title={exprPreview(expr)}>
        {exprPreview(expr)}
      </code>
      <span className="text-[10.5px] text-faint">complex expression — edit in code</span>
    </div>
  );
}

function StringOrRefField({ node, field }: { node: ResourceNode; field: FieldDef }) {
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
    const matched = candidates.find(
      (c) => expr?.kind === 'ref' && expr.path.startsWith(`${c.id}.`),
    );
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
                  value: ref(`${v}.${attr}`),
                };
          if (op) applyOps([op]);
        }}
      >
        <option value="">— none —</option>
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
        const op = commitTextOp(node, field.name, e.target.value);
        if (op) applyOps([op]);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function SelectField({ node, field }: { node: ResourceNode; field: FieldDef }) {
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
        applyOps([
          v === ''
            ? { kind: 'unset_arg', nodeId: node.id, field: field.name }
            : { kind: 'set_arg', nodeId: node.id, field: field.name, value: lit(v) },
        ]);
      }}
    >
      <option value="">— none —</option>
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
      <option value="">— unset —</option>
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
      defaultValue={current}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v === current) return;
        applyOps([
          v === ''
            ? { kind: 'unset_arg', nodeId: node.id, field: field.name }
            : { kind: 'set_arg', nodeId: node.id, field: field.name, value: lit(Number(v)) },
        ]);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function ListField({ node, field }: { node: ResourceNode; field: FieldDef }) {
  const applyOps = useOps();
  const ir = useEditor((s) => s.ir);
  const [draft, setDraft] = useState('');
  const expr = node.args[field.name];
  if (expr && expr.kind !== 'list') return <RawValueNote expr={expr} />;
  const items = expr?.kind === 'list' ? expr.items : [];

  const commit = (next: Expression[]) => {
    applyOps([
      next.length === 0
        ? { kind: 'unset_arg', nodeId: node.id, field: field.name }
        : { kind: 'set_arg', nodeId: node.id, field: field.name, value: { kind: 'list', items: next } },
    ]);
  };

  const attr = field.refAttr ?? 'id';
  const candidates = field.refTo
    ? ir.resources.filter(
        (r) =>
          field.refTo!.includes(r.type) &&
          !items.some((i) => i.kind === 'ref' && i.path.startsWith(`${r.id}.`)),
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
            aria-label="Remove item"
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
              if (e.target.value) commit([...items, ref(`${e.target.value}.${attr}`)]);
            }}
          >
            <option value="">+ add reference…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </Select>
        ) : items.length === 0 ? (
          <p className="text-[11px] text-faint">No matching resources on the canvas yet.</p>
        ) : null
      ) : (
        <div className="flex gap-1.5">
          <Input
            className="h-7.5"
            placeholder="add value…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                commit([
                  ...items,
                  looksLikeTraversal(draft.trim()) ? ref(draft.trim()) : lit(draft.trim()),
                ]);
                setDraft('');
              }
            }}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-7.5 w-9"
            aria-label="Add value"
            onClick={() => {
              if (!draft.trim()) return;
              commit([
                ...items,
                looksLikeTraversal(draft.trim()) ? ref(draft.trim()) : lit(draft.trim()),
              ]);
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
  const applyOps = useOps();
  const expr = node.args[field.name];
  if (expr && expr.kind !== 'object') return <RawValueNote expr={expr} />;
  const entries = expr?.kind === 'object' ? Object.entries(expr.fields) : [];
  const [k, setK] = useState('');
  const [v, setV] = useState('');

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
            aria-label={`Remove tag ${key}`}
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
        <Input className="h-7.5 w-2/5" placeholder="key" value={k} onChange={(e) => setK(e.target.value)} />
        <Input className="h-7.5 flex-1" placeholder="value" value={v} onChange={(e) => setV(e.target.value)} />
        <Button
          variant="outline"
          size="icon"
          className="h-7.5 w-9"
          aria-label="Add tag"
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

function FieldRow({ node, field }: { node: ResourceNode; field: FieldDef }) {
  const missing = field.required && !node.args[field.name];
  const label = (
    <span className="flex items-center gap-1.5">
      <span className="font-mono">{field.name}</span>
      {field.required ? (
        <span className={cn('text-[9px] font-bold uppercase', missing ? 'text-warning' : 'text-faint')}>
          required
        </span>
      ) : null}
    </span>
  );
  let control: React.ReactNode;
  switch (field.type) {
    case 'select':
      control = <SelectField node={node} field={field} />;
      break;
    case 'boolean':
      control = <BooleanField node={node} field={field} />;
      break;
    case 'number':
      control = <NumberField node={node} field={field} />;
      break;
    case 'list':
      control = <ListField node={node} field={field} />;
      break;
    case 'tags':
      control = <TagsField node={node} field={field} />;
      break;
    default:
      control = <StringOrRefField node={node} field={field} />;
  }
  return (
    <Field label={label} hint={field.doc}>
      {control}
    </Field>
  );
}

/* ------------------------------------------------------------ inspector */

function PropertiesTab({ node }: { node: ResourceNode }) {
  const applyOps = useOps();
  const ir = useEditor((s) => s.ir);
  const def = getDef(node.type);
  const knownFields = new Set(def?.fields.map((f) => f.name) ?? []);
  const extraArgs = Object.keys(node.args).filter((k) => !knownFields.has(k) && !/[\s"]/.test(k));

  return (
    <div className="space-y-3.5 p-3.5">
      <Field label={<span className="font-mono">name</span>}>
        <Input
          key={`${node.id}:name`}
          defaultValue={node.name}
          onBlur={(e) => {
            const next = tfName(e.target.value);
            if (next === node.name) return;
            if (ir.resources.some((r) => r.type === node.type && r.name === next)) {
              showToast(`${node.type}.${next} already exists`, 'error');
              e.target.value = node.name;
              return;
            }
            applyOps([{ kind: 'rename_resource', nodeId: node.id, newName: next }], `${node.type}.${next}`);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </Field>

      {def?.fields.map((f) => <FieldRow key={f.name} node={node} field={f} />)}

      {extraArgs.length > 0 ? (
        <div className="border-t pt-3">
          <h4 className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-faint">
            Other arguments
          </h4>
          <div className="space-y-3">
            {extraArgs.map((name) => (
              <FieldRow key={name} node={node} field={{ name, type: 'string' }} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConnectionsTab({ node }: { node: ResourceNode }) {
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
            {dir === 'out' ? edge.field : `referenced via ${edge.field}`}
          </span>
        </span>
        {dir === 'out' ? (
          <button
            type="button"
            aria-label="Remove connection"
            className="text-faint hover:text-danger"
            onClick={() => {
              const ops = removeConnectionOps(ir, edge);
              if (ops.length === 0) showToast('Edit this connection in code', 'info');
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
        <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
          Outgoing ({outgoing.length})
        </h4>
        <div className="space-y-1.5">
          {outgoing.map((e) => row(e, 'out'))}
          {outgoing.length === 0 ? (
            <p className="text-[11.5px] text-faint">
              Drag from this node's right handle to another resource to connect.
            </p>
          ) : null}
        </div>
      </div>
      <div>
        <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
          Incoming ({incoming.length})
        </h4>
        <div className="space-y-1.5">
          {incoming.map((e) => row(e, 'in'))}
          {incoming.length === 0 ? (
            <p className="text-[11.5px] text-faint">Nothing references this resource yet.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CodeTab({ node }: { node: ResourceNode }) {
  const hcl = useMemo(() => emitResource(node), [node]);
  return (
    <div className="p-3.5">
      <div className="relative rounded-sm border bg-surface-2">
        <pre className="max-h-[50vh] overflow-auto p-3 font-mono text-[11px] leading-[1.65] text-foreground">
          {hcl}
        </pre>
        <Button
          variant="outline"
          size="icon"
          className="absolute right-2 top-2 h-7 w-7"
          aria-label="Copy block"
          onClick={() => {
            void copyText(hcl).then(() => showToast('Block copied', 'success'));
          }}
        >
          <Copy className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function ProjectPanel() {
  const projectName = useEditor((s) => s.projectName);
  const renameProject = useEditor((s) => s.renameProject);
  const ir = useEditor((s) => s.ir);
  const edges = useEditor((s) => s.edges);
  const files = useEditor((s) => s.files);
  const warnings = useEditor((s) => s.warnings);

  return (
    <div className="space-y-4 p-3.5">
      <Field label="Project name">
        <Input
          key={projectName}
          defaultValue={projectName}
          onBlur={(e) => {
            if (e.target.value.trim() && e.target.value !== projectName) {
              renameProject(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2 text-center">
        {[
          [ir.resources.length, 'resources'],
          [edges.length, 'connections'],
          [ir.variables.length, 'variables'],
          [ir.outputs.length, 'outputs'],
        ].map(([n, label]) => (
          <div key={String(label)} className="rounded-sm border bg-surface-2 px-2 py-2.5">
            <div className="text-[17px] font-bold leading-none">{n}</div>
            <div className="mt-1 text-[10.5px] uppercase tracking-wide text-faint">{label}</div>
          </div>
        ))}
      </div>

      <div>
        <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Files</h4>
        <div className="space-y-1">
          {orderedFiles(files).map((f) => (
            <div key={f} className="flex justify-between rounded-sm bg-surface-2 px-2.5 py-1.5">
              <code className="font-mono text-[11.5px]">{f}</code>
              <span className="text-[11px] text-faint">{files[f].split('\n').length} lines</span>
            </div>
          ))}
        </div>
      </div>

      {warnings.length > 0 ? (
        <div>
          <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-warning">
            Warnings ({warnings.length})
          </h4>
          <div className="space-y-1">
            {warnings.slice(0, 6).map((w, i) => (
              <p key={i} className="rounded-sm border border-warning/25 bg-warning/8 px-2 py-1.5 text-[11px] leading-snug text-muted">
                {w.message}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-[11px] leading-relaxed text-faint">
        Select a resource on the canvas to edit its properties — or edit the Terraform directly;
        the blueprint follows along.
      </p>
    </div>
  );
}

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const ir = useEditor((s) => s.ir);
  const applyOps = useOps();
  const [tab, setTab] = useState<Tab>('properties');
  const node = selection ? ir.resources.find((r) => r.id === selection) : undefined;
  const def = node ? getDef(node.type) : undefined;

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l bg-surface-1" aria-label="Inspector">
      {node ? (
        <>
          <div className="border-b p-3.5">
            <div className="flex items-center gap-2.5">
              <ResourceIcon
                category={def?.category ?? 'compute'}
                provider={node.provider}
                size={34}
              />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[13.5px] font-semibold leading-tight">
                  {def?.displayName ?? node.type}
                </h2>
                <code className="block truncate font-mono text-[10.5px] text-faint">{node.id}</code>
              </div>
              {node.provider !== 'other' ? (
                <Badge variant={node.provider}>{PROVIDER_LABELS[node.provider]}</Badge>
              ) : null}
            </div>
            <div className="mt-3 flex rounded-sm border bg-surface-2 p-0.5" role="tablist">
              {(['properties', 'connections', 'code'] as Tab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    'flex-1 rounded-[5px] px-2 py-1 text-[11.5px] font-semibold capitalize transition-colors',
                    tab === t ? 'bg-surface-1 text-foreground shadow-xs' : 'text-muted hover:text-foreground',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'properties' ? <PropertiesTab node={node} /> : null}
            {tab === 'connections' ? <ConnectionsTab node={node} /> : null}
            {tab === 'code' ? <CodeTab node={node} /> : null}
          </div>

          <div className="border-t p-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-danger hover:border-danger/50 hover:bg-danger/8"
              onClick={() => applyOps([{ kind: 'remove_resource', nodeId: node.id }], null)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete resource
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="border-b p-3.5">
            <h2 className="text-[13.5px] font-semibold">Project</h2>
            <p className="mt-0.5 text-[11.5px] text-faint">No resource selected</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ProjectPanel />
          </div>
        </>
      )}
    </aside>
  );
}
