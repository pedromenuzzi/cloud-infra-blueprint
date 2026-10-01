/**
 * The inspector of a module call: its name, where it comes from (with the
 * Registry page for Registry modules), its version, the inputs it's given
 * (literals edited here, expressions in code), inputs to add, the outputs
 * other blocks read and — for a module of this project — what's inside it.
 * Every change is one canvas op, so one undo step.
 */
import { AlertTriangle, ArrowUpRight, Code2, FolderOpen, PanelRightClose, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { richText } from '@/components/RichText';
import { showToast } from '@/components/Toast';
import { Badge, Button, Field, Input, Select } from '@/components/ui';
import { inspectorMessages } from '@/features/editor/Inspector.messages';
import { layoutMessages } from '@/features/editor/layout.messages';
import { useEditor } from '@/features/editor/store';
import { formatList } from '@/i18n/format';
import { useLocale } from '@/i18n/locale';
import { messagesFor, useMessages } from '@/i18n/messages';
import { exprPreview, lit, literalString } from '@/ir/expr';
import { moduleTarget, type LocalModule } from '@/ir/localModules';
import {
  findNode,
  hasNode,
  isModuleId,
  moduleAddress,
  moduleInputs,
  moduleMetaArgs,
  moduleVersion,
  referencedOutputs,
  registryUrl,
} from '@/ir/modules';
import { moduleMoveOps } from '@/ir/moduleMoved';
import { isHistoryMove, keepStateFor, useKeepState } from '@/features/editor/movedSession';
import { KeepStateToggle } from '@/features/editor/RepeatSection';
import type { Op } from '@/ir/ops';
import type { Expression, ModuleNode } from '@/ir/types';
import { cn, tfName } from '@/lib/utils';
import { resourceName } from '@/resources/i18n';
import { ResourceIcon } from '@/resources/icons';
import { getDef } from '@/resources/registry';
import { commitLiteral, editableText, INPUT_NAME, parseInputText, placeholderFor } from './inputValue';
import { ModuleIcon } from './ModuleIcon';
import { moduleInspectorMessages } from './ModuleInspector.messages';
import { modulesMessages } from './modules.messages';
import { openModuleView } from './moduleViewStore';

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

function Section({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'warning' }) {
  return (
    <section className="space-y-2">
      <h3 className={cn('text-[10.5px] font-bold uppercase tracking-wider', tone === 'warning' ? 'text-warning' : 'text-faint')}>{title}</h3>
      {children}
    </section>
  );
}

function useApply() {
  return useEditor((s) => s.applyCanvasOps);
}

/** One input: an editable literal, or an expression shown read-only with a way to the code. */
function InputRow({
  node,
  name,
  value,
  required,
  unknown,
  hint,
}: {
  node: ModuleNode;
  name: string;
  value: Expression;
  required?: boolean;
  unknown?: boolean;
  hint?: string;
}) {
  const m = useMessages(moduleInspectorMessages);
  const apply = useApply();
  const text = editableText(value);
  const id = `module-input-${name}`;
  const commit = (next: Expression | null) => {
    if (next) apply([{ kind: 'set_arg', nodeId: node.id, field: name, value: next }]);
  };
  return (
    <div className="rounded-[8px] border bg-surface-2/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <label htmlFor={text !== null ? id : undefined} className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-semibold text-foreground">
          {name}
        </label>
        {required ? <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{m.required}</span> : null}
        {unknown ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-warning" title={m.notAnInput}>
            <AlertTriangle className="h-3 w-3" />
          </span>
        ) : null}
        <button
          type="button"
          aria-label={m.removeInput(name)}
          title={m.removeInput(name)}
          onClick={() => apply([{ kind: 'unset_arg', nodeId: node.id, field: name }])}
          className="rounded-[5px] p-0.5 text-faint transition-colors hover:bg-surface-1 hover:text-danger"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1.5">
        {text === null ? (
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-[5px] bg-surface-1 px-1.5 py-1 font-mono text-[11px] text-muted ring-1 ring-border" title={exprPreview(value)}>
              {exprPreview(value)}
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
      {unknown ? <p className="mt-1 text-[10.5px] text-warning">{m.notAnInput}</p> : hint ? <p className="mt-1 text-[10.5px] leading-snug text-faint">{hint}</p> : null}
    </div>
  );
}

function AddInput({ node }: { node: ModuleNode }) {
  const m = useMessages(moduleInspectorMessages);
  const apply = useApply();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const add = () => {
    const name = key.trim();
    const t = messagesFor(moduleInspectorMessages);
    if (!INPUT_NAME.test(name)) {
      showToast(t.badKey, 'error');
      return;
    }
    if (node.args[name] !== undefined) {
      showToast(t.inputExists(name), 'info');
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
      <Input
        aria-label={m.inputName}
        placeholder={m.keyPlaceholder}
        className="h-7.5 font-mono text-[12px]"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <Input
        aria-label={m.inputValue}
        placeholder={m.valuePlaceholder}
        className="h-7.5 font-mono text-[12px]"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline" className="w-full" disabled={key.trim() === ''}>
        <Plus className="h-3.5 w-3.5" /> {m.addInput}
      </Button>
    </form>
  );
}

function NameField({ node }: { node: ModuleNode }) {
  const im = useMessages(inspectorMessages);
  const m = useMessages(moduleInspectorMessages);
  const apply = useApply();
  // renaming a module without a `moved` block re-creates everything in it
  return (
    <div className="space-y-1.5">
      <Field label={im.terraformName} hint={richText(m.referencedAs(node.id))}>
        <Input
          id="inspector-tf-name"
          key={`${node.id}:name`}
          defaultValue={node.name}
          onBlur={(e) => {
            const next = tfName(e.target.value);
            if (next === node.name) return;
            const ir = useEditor.getState().ir;
            const to = moduleAddress(next);
            if (hasNode(ir, to)) {
              showToast(messagesFor(moduleInspectorMessages).alreadyExists(to), 'error');
              e.target.value = node.name;
              return;
            }
            // the same keep-state choice as resource renames (one per project)
            const keepState = keepStateFor(useKeepState.getState().byProject, useEditor.getState().projectId, ir);
            const ops: Op[] = [
              { kind: 'rename_resource', nodeId: node.id, newName: next },
              ...(keepState ? moduleMoveOps(ir, node.id, to, isHistoryMove) : []),
            ];
            apply(ops, to);
          }}
          onKeyDown={editKeys(node.name)}
        />
      </Field>
      <KeepStateToggle />
    </div>
  );
}

/** A literal-string argument (`source`, `version`) edited in place; set to '' removes it (version only). */
function LiteralArg({
  node,
  field,
  label,
  hint,
  placeholder,
  removable,
}: {
  node: ModuleNode;
  field: string;
  label: string;
  hint?: React.ReactNode;
  placeholder?: string;
  removable?: boolean;
}) {
  const apply = useApply();
  const value = literalString(node.args[field]) ?? '';
  return (
    <Field label={label} hint={hint}>
      <Input
        key={`${node.id}:${field}:${value}`}
        className="font-mono text-[12px]"
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(e) => {
          const next = e.target.value.trim();
          if (next === value) return;
          const ops: Op[] =
            next === '' && removable
              ? [{ kind: 'unset_arg', nodeId: node.id, field }]
              : next === ''
                ? []
                : [{ kind: 'set_arg', nodeId: node.id, field, value: lit(next) }];
          if (ops.length > 0) apply(ops);
          else e.target.value = value;
        }}
        onKeyDown={editKeys(value)}
      />
    </Field>
  );
}

function LocalContents({ child, node }: { child: LocalModule; node: ModuleNode }) {
  const m = useMessages(moduleInspectorMessages);
  const locale = useLocale((s) => s.locale);
  return (
    <>
      <Section title={m.resourcesInside(child.ir.resources.length)}>
        {child.ir.resources.length === 0 ? (
          <p className="text-[11.5px] text-faint">{m.noResources}</p>
        ) : (
          <ul className="space-y-1">
            {child.ir.resources.slice(0, 12).map((r) => {
              const def = getDef(r.type);
              return (
                <li key={r.id} className="flex items-center gap-2 rounded-[7px] bg-surface-2 px-2 py-1">
                  <ResourceIcon category={def?.category ?? 'compute'} type={r.type} size={20} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium">{r.name}</span>
                    <span className="block truncate text-[10px] text-faint">{def ? resourceName(r.type, locale) : r.type}</span>
                  </span>
                </li>
              );
            })}
            {child.ir.resources.length > 12 ? <li className="px-2 text-[11px] text-faint">+{child.ir.resources.length - 12}</li> : null}
          </ul>
        )}
        {child.ir.modules.length > 0 ? (
          <p className="text-[11.5px] text-muted">
            {m.nestedModules(child.ir.modules.length)}: <code className="font-mono text-[11px]">{child.ir.modules.map((x) => x.name).join(', ')}</code>
          </p>
        ) : null}
        <Button size="sm" variant="outline" className="w-full" onClick={() => openModuleView(child.dir, node.name)}>
          <FolderOpen className="h-3.5 w-3.5" /> {m.openModule}
        </Button>
      </Section>
      {child.outputs.length > 0 ? (
        <Section title={m.declaredOutputs(child.outputs.length)}>
          <p className="font-mono text-[11px] leading-relaxed text-muted">{child.outputs.map((o) => o.name).join(', ')}</p>
        </Section>
      ) : null}
    </>
  );
}

export function ModuleInspector({ docked = false, onMinimize }: { docked?: boolean; onMinimize?(): void }) {
  const lm = useMessages(layoutMessages);
  const im = useMessages(inspectorMessages);
  const m = useMessages(moduleInspectorMessages);
  const mm = useMessages(modulesMessages);
  const locale = useLocale((s) => s.locale);
  const selection = useEditor((s) => s.selection);
  const ir = useEditor((s) => s.ir);
  const files = useEditor((s) => s.files);
  const warnings = useEditor((s) => s.warnings);
  const codeErrored = useEditor((s) => s.codeErrored);
  const readOnly = useEditor((s) => s.readOnly);
  const apply = useApply();
  const node = selection && isModuleId(selection) ? (findNode(ir, selection) as ModuleNode | undefined) : undefined;
  if (!node) return null;

  const target = moduleTarget(files, node);
  const info = target.kind === 'none' ? null : target.info;
  const child = target.kind === 'local' ? target.module : null;
  const registry = info && target.kind === 'remote' ? registryUrl(info, moduleVersion(node)) : null;
  const inputs = moduleInputs(node);
  const passed = new Set(inputs.map(([k]) => k));
  const vars = child && !child.broken ? new Map(child.variables.map((v) => [v.name, v] as const)) : null;
  const missing = vars ? [...vars.values()].filter((v) => v.required && !passed.has(v.name)) : [];
  const optional = vars ? [...vars.values()].filter((v) => !v.required && !passed.has(v.name)) : [];
  const outputs = referencedOutputs(ir, node.id);
  const own = warnings.filter((w) => w.nodeId === node.id);
  const locked = codeErrored || readOnly;
  const sourceIsLiteral = node.args.source === undefined || literalString(node.args.source) !== undefined;

  return (
    <aside
      className={cn('flex w-full flex-col overflow-hidden bg-surface-1', docked ? 'min-h-0 flex-1' : 'bp-pop-in rounded-[14px] border shadow-xl')}
      aria-label={m.label}
    >
      <div className="border-b p-3.5">
        <div className="flex items-center gap-2.5">
          <ModuleIcon size={38} />
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 break-words text-[13.5px] font-semibold leading-tight">{m.title}</h2>
            <code className="block truncate font-mono text-[10.5px] text-faint" data-testid="inspector-address">
              {node.id}
            </code>
          </div>
          {info ? <Badge>{mm.kind[info.kind]}</Badge> : null}
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
        <div className="mt-3 flex items-stretch gap-1.5">
          {child ? (
            <Button size="sm" variant="outline" className="min-w-0 flex-1" onClick={() => openModuleView(child.dir, node.name)}>
              <FolderOpen className="h-3.5 w-3.5" /> {m.openModule}
            </Button>
          ) : registry ? (
            <a
              href={registry}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm border bg-surface-1 px-2.5 text-[12.5px] font-medium text-primary transition-colors hover:bg-surface-2"
            >
              {m.registryPage} <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            title={lm.codeButtonTitle}
            onClick={() => useEditor.getState().revealInCode(node.id)}
            className="flex shrink-0 items-center gap-1 rounded-sm border bg-surface-2 px-2 text-[11.5px] font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary"
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
        aria-label={locked ? m.settingsReadOnly : undefined}
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <fieldset disabled={locked} className="min-w-0 space-y-4 p-3.5">
          {own.length > 0 ? (
            <ul className="space-y-1" aria-label={mm.hasWarnings}>
              {own.map((w, i) => (
                <li key={i} className="flex gap-1.5 rounded-[7px] border border-warning/25 bg-warning/8 px-2 py-1.5 text-[11px] leading-snug text-muted">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-warning" />
                  <span>{w.message.replace(`${node.id}: `, '')}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <NameField node={node} />

          {sourceIsLiteral ? (
            <LiteralArg
              node={node}
              field="source"
              label={m.source}
              hint={info ? m.sourceHint[info.kind] : undefined}
            />
          ) : (
            <Field label={m.source} hint={m.sourceExpression}>
              <code className="block truncate rounded-sm border bg-surface-2 px-2.5 py-2 font-mono text-[12px]">{exprPreview(node.args.source)}</code>
            </Field>
          )}
          {target.kind === 'local' ? (
            <p className={cn('-mt-2 text-[11px] leading-snug', child ? 'text-muted' : 'text-warning')}>
              {child ? (
                <>
                  {m.folder}: <code className="font-mono">{m.folderFiles(child.dir, child.files.length)}</code>
                </>
              ) : (
                m.folderMissing(target.dir)
              )}
            </p>
          ) : null}
          {child?.broken ? <p className="-mt-2 text-[11px] text-warning">{m.brokenModule}</p> : null}

          {info?.kind === 'registry' || moduleVersion(node) !== undefined ? (
            <LiteralArg node={node} field="version" label={m.version} hint={m.versionHint} placeholder={m.versionPlaceholder} removable />
          ) : info?.ref ? (
            <p className="-mt-2 text-[11px] text-muted">{m.pinnedBy(info.ref)}</p>
          ) : null}

          {moduleMetaArgs(node).length > 0 ? (
            <Section title={m.meta}>
              <dl className="space-y-1">
                {moduleMetaArgs(node).map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-2 rounded-[7px] bg-surface-2 px-2 py-1">
                    <dt className="font-mono text-[11px] font-semibold">{k}</dt>
                    <dd className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={exprPreview(v)}>
                      {exprPreview(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          ) : null}

          <Section title={m.inputs(inputs.length)}>
            {inputs.length === 0 ? <p className="text-[11.5px] text-faint">{m.noInputs}</p> : null}
            <div className="space-y-1.5">
              {inputs.map(([k, v]) => (
                <InputRow
                  key={k}
                  node={node}
                  name={k}
                  value={v}
                  required={vars?.get(k)?.required}
                  unknown={vars !== null && !vars.has(k)}
                  hint={vars?.get(k)?.description}
                />
              ))}
            </div>
          </Section>

          {missing.length > 0 ? (
            <Section title={m.missingRequired(missing.length)} tone="warning">
              <ul className="space-y-1">
                {missing.map((v) => (
                  <li key={v.name} className="flex items-center gap-2 rounded-[7px] border border-warning/30 bg-warning/8 px-2 py-1">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11.5px] font-semibold">{v.name}</span>
                      {v.type || v.description ? (
                        <span className="block truncate text-[10.5px] text-faint">{[v.type, v.description].filter(Boolean).join(' · ')}</span>
                      ) : null}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={m.addThis(v.name)}
                      onClick={() => apply([{ kind: 'set_arg', nodeId: node.id, field: v.name, value: placeholderFor(v.type) }])}
                    >
                      <Plus className="h-3 w-3" /> {m.add}
                    </Button>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {optional.length > 0 ? (
            <details className="group">
              <summary className="cursor-pointer text-[10.5px] font-bold uppercase tracking-wider text-faint hover:text-muted">
                {m.optionalInputs(optional.length)}
              </summary>
              <ul className="mt-2 space-y-1">
                {optional.map((v) => (
                  <li key={v.name} className="flex items-center gap-2 rounded-[7px] bg-surface-2 px-2 py-1">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11.5px]">{v.name}</span>
                      <span className="block truncate font-mono text-[10px] text-faint">
                        {m.defaultValue(v.default ? exprPreview(v.default) : 'null')}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={m.addThis(v.name)}
                      title={m.addThis(v.name)}
                      onClick={() =>
                        apply([{ kind: 'set_arg', nodeId: node.id, field: v.name, value: v.default ?? placeholderFor(v.type) }])
                      }
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
            <Section title={m.addInput}>
              <AddInput node={node} />
            </Section>
          )}

          <Section title={m.outputsUsed}>
            {outputs.size === 0 ? (
              <p className="text-[11.5px] text-faint">{m.noOutputsUsed}</p>
            ) : (
              <ul className="space-y-1">
                {[...outputs].map(([output, by]) => (
                  <li key={output} className="rounded-[7px] bg-surface-2 px-2 py-1">
                    <span className="block truncate font-mono text-[11.5px] font-semibold">{output || m.wholeModule}</span>
                    <span className="block text-[10.5px] text-faint">
                      {m.readBy(formatList(by, 'conjunction', locale))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {child && !child.broken ? <LocalContents child={child} node={node} /> : null}

          <p className="rounded-[8px] border border-dashed px-2.5 py-2 text-[11px] leading-snug text-faint">
            {target.kind === 'local' ? m.opaqueLocal : m.opaqueRemote}
          </p>
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
            <Trash2 className="h-3.5 w-3.5" /> {m.deleteModule}
          </Button>
        </div>
      )}
    </aside>
  );
}
