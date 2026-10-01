/**
 * The inspector of a data source: its type with the Terraform docs page,
 * its name (renaming rewrites every `data.type.name` reference), its
 * arguments (literals edited here, expressions and nested blocks in code),
 * the arguments its schema requires or offers, who reads it, resources it
 * could feed (`ami = data.aws_ami.ubuntu.id`, one click) and the attributes
 * it exposes. Every change is one canvas op, so one undo step.
 */
import { AlertTriangle, ArrowUpRight, Check, Code2, Copy, Link2, PanelRightClose, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { richText } from '@/components/RichText';
import { showToast } from '@/components/Toast';
import { Badge, Button, Field, Input, Select } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { inspectorMessages } from '@/features/editor/Inspector.messages';
import { layoutMessages } from '@/features/editor/layout.messages';
import { RepeatBadge } from '@/features/editor/RepeatBadge';
import { repeatLabel } from '@/features/editor/repeatLabel';
import { useEditor } from '@/features/editor/store';
import { commitLiteral, editableText, INPUT_NAME, parseInputText, placeholderFor } from '@/features/modules/inputValue';
import { useLocale } from '@/i18n/locale';
import { messagesFor, useMessages } from '@/i18n/messages';
import { findData, isDataId } from '@/ir/dataSources';
import { exprMentions, exprPreview, ref } from '@/ir/expr';
import { hasNode } from '@/ir/modules';
import { exprText, repeatOf } from '@/ir/repeat';
import type { DataNode, Expression } from '@/ir/types';
import { dataAddress } from '@/ir/types';
import { copyText } from '@/lib/download';
import { cn, tfName } from '@/lib/utils';
import { PROVIDER_LABELS } from '@/resources/icons';
import { exportedEntries, isRequired, settableEntries } from '@/schema/lookup';
import { requestDataSchemasFor, useDataSourceSchema } from '@/schema/store';
import type { SchemaEntry } from '@/schema/types';
import { dataDocsUrl, typeDef } from './catalog';
import { DataSourceIcon } from './DataSourceIcon';
import { dataSourceMessages } from './dataSources.messages';
import { dataSourceDescription, dataSourceName } from './i18n';
import { readersByAttribute } from './readers';

/** meta-arguments Terraform handles itself in a data block */
const META = new Set(['count', 'for_each', 'depends_on', 'provider', 'lifecycle']);
/** keys the parser gives verbatim sub-blocks (`dynamic "filter" #0`) */
const RAW_KEY = /[\s"]/;

/** Enter commits (by blurring), Escape puts the original value back first so the blur commits nothing. */
function editKeys(original: string) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      e.currentTarget.value = original;
      e.currentTarget.blur();
    }
  };
}

function Section({ title, hint, children, tone }: { title: string; hint?: string; children: React.ReactNode; tone?: 'warning' }) {
  return (
    <section className="space-y-2">
      <h3 className={cn('text-[10.5px] font-bold uppercase tracking-wider', tone === 'warning' ? 'text-warning' : 'text-faint')}>{title}</h3>
      {hint ? <p className="-mt-1 text-[11px] leading-snug text-faint">{hint}</p> : null}
      {children}
    </section>
  );
}

const useApply = () => useEditor((s) => s.applyCanvasOps);

/** `name = "name", values = [...]` for a nested block (read-only: edited in code) */
function blockSummary(e: Expression): string {
  const bodies = e.kind === 'block' ? [e.body] : e.kind === 'blocks' ? e.items : [];
  return bodies
    .map((body) => `{ ${Object.entries(body).map(([k, v]) => `${k} = ${exprText(v)}`).join(', ')} }`)
    .join(' ');
}

/** One argument: an editable literal, or an expression / nested block shown read-only with a way to the code. */
function ArgRow({ node, name, value, entry }: { node: DataNode; name: string; value: Expression; entry?: SchemaEntry }) {
  const m = useMessages(dataSourceMessages);
  const apply = useApply();
  const text = editableText(value);
  const id = `data-arg-${name}`;
  const nested = value.kind === 'block' || value.kind === 'blocks';
  const commit = (next: Expression | null) => {
    if (next) apply([{ kind: 'set_arg', nodeId: node.id, field: name, value: next }]);
  };
  // code as written (strings quoted): `["099720109477"]`, `{ name = "name", values = [...] }`
  const preview = nested ? blockSummary(value) : exprText(value);
  return (
    <div className="rounded-[8px] border bg-surface-2/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <label htmlFor={text !== null ? id : undefined} className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-semibold text-foreground" translate="no">
          {name}
        </label>
        {entry && isRequired(entry) ? <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{m.required}</span> : null}
        <button
          type="button"
          aria-label={m.removeArgument(name)}
          title={m.removeArgument(name)}
          onClick={() => apply([{ kind: 'unset_arg', nodeId: node.id, field: name }])}
          className="rounded-[5px] p-0.5 text-faint transition-colors hover:bg-surface-1 hover:text-danger"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1.5">
        {text === null ? (
          <div className="flex items-center gap-1.5">
            <code
              className="min-w-0 flex-1 truncate rounded-[5px] bg-surface-1 px-1.5 py-1 font-mono text-[11px] text-muted ring-1 ring-border"
              title={preview}
            >
              {preview}
            </code>
            <button
              type="button"
              onClick={() => useEditor.getState().revealInCode(node.id)}
              title={m.complexValue}
              className="inline-flex shrink-0 items-center gap-1 rounded-[6px] border bg-surface-1 px-1.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Code2 className="h-3 w-3" /> {m.editInCode}
            </button>
          </div>
        ) : value.kind === 'literal' && typeof value.value === 'boolean' ? (
          <Select id={id} className="h-7.5" value={String(value.value)} onChange={(e) => commit(commitLiteral(value, e.target.value, useEditor.getState().ir))}>
            <option value="true">true</option>
            <option value="false">false</option>
          </Select>
        ) : (
          <Input
            id={id}
            key={`${node.id}:${name}:${text}`}
            className="h-7.5 font-mono text-[12px]"
            inputMode={value.kind === 'literal' && typeof value.value === 'number' ? 'decimal' : undefined}
            defaultValue={text}
            onBlur={(e) => commit(commitLiteral(value, e.target.value, useEditor.getState().ir))}
            onKeyDown={editKeys(text)}
          />
        )}
      </div>
      {entry?.description ? <p className="mt-1 text-[10.5px] leading-snug text-faint">{entry.description}</p> : null}
    </div>
  );
}

function NameField({ node }: { node: DataNode }) {
  const im = useMessages(inspectorMessages);
  const m = useMessages(dataSourceMessages);
  const apply = useApply();
  return (
    <Field label={im.terraformName} hint={richText(m.referencedAs(node.id))}>
      <Input
        id="inspector-tf-name"
        key={`${node.id}:name`}
        defaultValue={node.name}
        onBlur={(e) => {
          const next = tfName(e.target.value);
          if (next === node.name) return;
          const to = dataAddress(node.type, next);
          if (hasNode(useEditor.getState().ir, to)) {
            showToast(messagesFor(dataSourceMessages).alreadyExists(to), 'error');
            e.target.value = node.name;
            return;
          }
          // every `data.type.name…` reference follows; a data source has no state to keep
          apply([{ kind: 'rename_resource', nodeId: node.id, newName: next }], to);
        }}
        onKeyDown={editKeys(node.name)}
      />
    </Field>
  );
}

function AddArgument({ node }: { node: DataNode }) {
  const m = useMessages(dataSourceMessages);
  const apply = useApply();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const add = () => {
    const name = key.trim();
    const t = messagesFor(dataSourceMessages);
    if (!INPUT_NAME.test(name)) {
      showToast(t.badKey, 'error');
      return;
    }
    if (node.args[name] !== undefined) {
      showToast(t.argumentExists(name), 'info');
      return;
    }
    apply([{ kind: 'set_arg', nodeId: node.id, field: name, value: parseInputText(value, useEditor.getState().ir) }]);
    setKey('');
    setValue('');
  };
  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <Input aria-label={m.argumentName} placeholder={m.keyPlaceholder} className="h-7.5 font-mono text-[12px]" value={key} onChange={(e) => setKey(e.target.value)} />
      <Input aria-label={m.argumentValue} placeholder={m.valuePlaceholder} className="h-7.5 font-mono text-[12px]" value={value} onChange={(e) => setValue(e.target.value)} />
      <Button type="submit" size="sm" variant="outline" className="w-full" disabled={key.trim() === ''}>
        <Plus className="h-3.5 w-3.5" /> {m.addArgument}
      </Button>
    </form>
  );
}

/** a schema entry not written yet: a starting value for it */
function startValue(entry: SchemaEntry): Expression {
  if (entry.kind === 'block') return entry.nesting === 'single' ? { kind: 'block', body: {} } : { kind: 'blocks', items: [{}] };
  return placeholderFor(entry.type);
}

/** Resources of this project that usually read this data source, with a one-click connection. */
function UseIn({ node }: { node: DataNode }) {
  const m = useMessages(dataSourceMessages);
  const ir = useEditor((s) => s.ir);
  const apply = useApply();
  const feeds = typeDef(node.type)?.feeds ?? [];
  const rows = feeds.flatMap((feed) =>
    ir.resources
      .filter((r) => feed.resourceTypes.includes(r.type))
      .map((r) => ({ resource: r, arg: feed.arg, value: `${node.id}.${feed.read}` })),
  );
  if (rows.length === 0) return null;
  return (
    <Section title={m.useIn} hint={m.useInHint}>
      <ul className="space-y-1">
        {rows.map(({ resource, arg, value }) => {
          const current = resource.args[arg];
          const connected = current !== undefined && exprMentions(current, node.id);
          const target = `${resource.id}.${arg}`;
          return (
            <li key={target} className="flex items-center gap-2 rounded-[7px] bg-surface-2 px-2 py-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11.5px] font-semibold" translate="no">
                  {resource.id}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-faint" translate="no">
                  {arg} = {connected ? exprPreview(current) : value}
                </span>
              </span>
              {connected ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-success">
                  <Check className="h-3 w-3" /> {m.connected}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  title={m.connectTitle(target, value)}
                  aria-label={m.connectTitle(target, value)}
                  onClick={() => apply([{ kind: 'set_arg', nodeId: resource.id, field: arg, value: ref(value) }])}
                >
                  <Link2 className="h-3 w-3" /> {m.connect}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** What the data source exposes: from its schema once loaded, else what the catalog knows. */
function Attributes({ node, entries, status }: { node: DataNode; entries: SchemaEntry[] | undefined; status?: string }) {
  const m = useMessages(dataSourceMessages);
  const fallback = typeDef(node.type)?.attributes ?? (node.type === 'terraform_remote_state' ? ['outputs'] : []);
  const names = entries ? entries.map((e) => ({ name: e.name, detail: e.kind === 'attribute' ? e.type : e.nesting, description: e.description })) : fallback.map((name) => ({ name, detail: '', description: undefined }));
  const copy = (reference: string) => void copyText(reference).then(() => showToast(messagesFor(dataSourceMessages).copied(reference), 'success'));
  return (
    <Section title={m.attributes(names.length)} hint={names.length > 0 ? m.attributesHint : undefined}>
      {names.length === 0 ? (
        <p className="text-[11.5px] text-faint">{status === 'loading' ? m.attributesLoading : m.attributesUnknown}</p>
      ) : (
        <ul className="space-y-1">
          {names.slice(0, 40).map((a) => {
            const reference = `${node.id}.${a.name}`;
            return (
              <li key={a.name} className="flex items-center gap-2 rounded-[7px] bg-surface-2 px-2 py-1" title={a.description}>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" translate="no">
                  {a.name}
                  {a.detail ? <span className="ml-1.5 text-[10px] text-faint">{a.detail}</span> : null}
                </span>
                <button
                  type="button"
                  aria-label={m.copyReference(reference)}
                  title={m.copyReference(reference)}
                  onClick={() => copy(reference)}
                  className="rounded-[5px] p-1 text-faint transition-colors hover:bg-surface-1 hover:text-primary"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </li>
            );
          })}
          {names.length > 40 ? <li className="px-2 text-[11px] text-faint">+{names.length - 40}</li> : null}
        </ul>
      )}
    </Section>
  );
}

export function DataInspector({ docked = false, onMinimize }: { docked?: boolean; onMinimize?(): void }) {
  const lm = useMessages(layoutMessages);
  const im = useMessages(inspectorMessages);
  const m = useMessages(dataSourceMessages);
  const locale = useLocale((s) => s.locale);
  const selection = useEditor((s) => s.selection);
  const ir = useEditor((s) => s.ir);
  const warnings = useEditor((s) => s.warnings);
  const codeErrored = useEditor((s) => s.codeErrored);
  const readOnly = useEditor((s) => s.readOnly);
  const apply = useApply();
  const node = selection && isDataId(selection) ? findData(ir, selection) : undefined;
  const type = node?.type ?? '';
  const { block, status } = useDataSourceSchema(type);
  useEffect(() => {
    if (type) requestDataSchemasFor([type]);
  }, [type]);
  if (!node) return null;

  const locked = codeErrored || readOnly;
  const docs = dataDocsUrl(node.type);
  const own = warnings.filter((w) => w.nodeId === node.id);
  const args = Object.entries(node.args).filter(([k]) => !META.has(k) && !RAW_KEY.test(k));
  const meta = Object.entries(node.args).filter(([k]) => META.has(k) || RAW_KEY.test(k));
  const settable = block ? settableEntries(block) : [];
  const byName = new Map(settable.map((e) => [e.name, e] as const));
  const missing = settable.filter((e) => isRequired(e) && node.args[e.name] === undefined);
  const optional = settable.filter((e) => !isRequired(e) && node.args[e.name] === undefined && !META.has(e.name));
  // what it exposes: the computed attributes first (exportedEntries orders them so)
  const exposed = block ? exportedEntries(block).filter((e) => e.kind === 'block' || e.computed) : undefined;
  const readers = readersByAttribute(ir, node.id);
  const rep = repeatOf(node, ir);
  const firstAttr = exposed?.[0]?.name ?? typeDef(node.type)?.attributes[0] ?? 'id';

  return (
    <aside
      className={cn('flex w-full flex-col overflow-hidden bg-surface-1', docked ? 'min-h-0 flex-1' : 'bp-pop-in rounded-[14px] border shadow-xl')}
      aria-label={m.label}
    >
      <div className="border-b p-3.5">
        <div className="flex items-center gap-2.5">
          <DataSourceIcon size={38} />
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 break-words text-[13.5px] font-semibold leading-tight">{dataSourceName(node.type, locale)}</h2>
            <code className="block truncate font-mono text-[10.5px] text-faint" data-testid="inspector-address">
              {node.id}
            </code>
          </div>
          {node.provider !== 'other' ? <Badge variant={node.provider}>{PROVIDER_LABELS[node.provider]}</Badge> : null}
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
            aria-label={im.close}
            title={im.closeTitle}
            onClick={() => useEditor.getState().setSelection(null)}
            className="-mr-1 rounded-[6px] p-1 text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {dataSourceDescription(node.type, locale) ? (
          <p className="mt-2 text-[11.5px] leading-snug text-muted">{dataSourceDescription(node.type, locale)}</p>
        ) : null}
        <div className="mt-3 flex items-stretch gap-1.5">
          {docs ? (
            <a
              href={docs}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm border bg-surface-1 px-2.5 text-[12.5px] font-medium text-primary transition-colors hover:bg-surface-2"
            >
              {m.docs} <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            title={lm.codeButtonTitle}
            onClick={() => useEditor.getState().revealInCode(node.id)}
            className="flex shrink-0 items-center gap-1 rounded-sm border bg-surface-2 px-2 py-1.5 text-[11.5px] font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Code2 className="h-3.5 w-3.5" />
            {lm.codeButton}
          </button>
        </div>
      </div>

      {readOnly ? (
        <p role="status" className="border-b bg-surface-2/60 px-3.5 py-2 text-[11.5px] font-medium text-muted">
          {im.readOnlyView}
        </p>
      ) : codeErrored ? (
        <p role="status" className="border-b bg-warning/10 px-3.5 py-2 text-[11.5px] font-medium text-warning">
          {im.readOnlyUntilParses}
        </p>
      ) : null}

      <div
        role={locked ? 'group' : undefined}
        tabIndex={locked ? 0 : undefined}
        aria-label={locked ? m.readOnlyArgs : undefined}
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <fieldset disabled={locked} className="min-w-0 space-y-4 p-3.5">
          {own.length > 0 ? (
            <ul className="space-y-1" aria-label={m.hasWarnings}>
              {own.map((w, i) => (
                <li key={i} className="flex gap-1.5 rounded-[7px] border border-warning/25 bg-warning/8 px-2 py-1.5 text-[11px] leading-snug text-muted">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-warning" />
                  <span>{w.message.replace(`${node.id}: `, '')}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <NameField node={node} />

          {meta.length > 0 ? (
            <Section title={m.meta}>
              {rep ? <RepeatBadge repeat={repeatLabel(rep, locale)} inline plain /> : null}
              <dl className="space-y-1">
                {meta.map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-2 rounded-[7px] bg-surface-2 px-2 py-1">
                    <dt className="font-mono text-[11px] font-semibold">{RAW_KEY.test(k) ? k.replace(/ #\d+.*$/, '') : k}</dt>
                    <dd className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={exprPreview(v)}>
                      {v.kind === 'block' || v.kind === 'blocks' ? blockSummary(v) : exprPreview(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          ) : null}

          <Section title={m.arguments(args.length)}>
            {args.length === 0 ? <p className="text-[11.5px] text-faint">{m.noArguments}</p> : null}
            <div className="space-y-1.5">
              {args.map(([k, v]) => (
                <ArgRow key={k} node={node} name={k} value={v} entry={byName.get(k)} />
              ))}
            </div>
          </Section>

          {missing.length > 0 ? (
            <Section title={m.missingRequired(missing.length)} tone="warning">
              <ul className="space-y-1">
                {missing.map((e) => (
                  <li key={e.name} className="flex items-center gap-2 rounded-[7px] border border-warning/30 bg-warning/8 px-2 py-1">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11.5px] font-semibold">{e.name}</span>
                      {e.description ? <span className="block truncate text-[10.5px] text-faint">{e.description}</span> : null}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={m.addThis(e.name)}
                      onClick={() => apply([{ kind: 'set_arg', nodeId: node.id, field: e.name, value: startValue(e) }])}
                    >
                      <Plus className="h-3 w-3" /> {m.add}
                    </Button>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {optional.length > 0 && !readOnly ? (
            <details className="group">
              <summary className="cursor-pointer text-[10.5px] font-bold uppercase tracking-wider text-faint hover:text-muted">
                {m.optionalArguments(optional.length)}
              </summary>
              <ul className="mt-2 space-y-1">
                {optional.map((e) => (
                  <li key={e.name} className="flex items-center gap-2 rounded-[7px] bg-surface-2 px-2 py-1" title={e.description}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11.5px]">{e.name}</span>
                      <span className="block truncate font-mono text-[10px] text-faint">{e.kind === 'attribute' ? e.type : e.nesting}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={m.addThis(e.name)}
                      title={m.addThis(e.name)}
                      onClick={() => apply([{ kind: 'set_arg', nodeId: node.id, field: e.name, value: startValue(e) }])}
                      className="rounded-[5px] p-1 text-faint transition-colors hover:bg-surface-1 hover:text-primary"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {readOnly ? null : (
            <Section title={m.addArgument}>
              <AddArgument node={node} />
            </Section>
          )}

          <Section title={m.readers}>
            {readers.length === 0 ? (
              <p className="text-[11.5px] leading-snug text-faint">{richText(m.notReadYet(`${node.id}.${firstAttr}`))}</p>
            ) : (
              <ul className="space-y-1">
                {readers.map(({ attribute, readers: by }) => (
                  <li key={attribute} className="rounded-[7px] bg-surface-2 px-2 py-1">
                    <span className="block truncate font-mono text-[11.5px] font-semibold" translate="no">
                      {attribute || m.wholeObject}
                    </span>
                    <span className="flex flex-wrap gap-x-1.5 text-[10.5px] text-faint">
                      {by.map((r) =>
                        hasNode(ir, r.id) ? (
                          <button
                            key={r.id}
                            type="button"
                            className="font-mono text-primary hover:underline"
                            onClick={() => {
                              useEditor.getState().setSelection(r.id, 'canvas');
                              canvasApi()?.focusNode(r.id);
                            }}
                          >
                            {r.label}
                          </button>
                        ) : (
                          <code key={r.id} className="font-mono">
                            {r.label}
                          </code>
                        ),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {readOnly ? null : <UseIn node={node} />}

          <Attributes node={node} entries={exposed} status={status} />

          <p className="rounded-[8px] border border-dashed px-2.5 py-2 text-[11px] leading-snug text-faint">{m.lookupNote}</p>
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
            <Trash2 className="h-3.5 w-3.5" /> {m.deleteDataSource}
          </Button>
        </div>
      )}
    </aside>
  );
}
