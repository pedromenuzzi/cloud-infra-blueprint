/**
 * "Add module…": pick a popular Registry module (its common inputs come
 * prefilled, wired to the project's network when there is one) or type any
 * source, name the call, and it's written as a new `module` block — one
 * undo step — then selected on the canvas.
 */
import { ArrowUpRight, PencilLine } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { computeAbsoluteRects } from '@/components/ProjectThumbnail';
import { HclSnippet } from '@/components/HclSnippet';
import { richText } from '@/components/RichText';
import { showToast } from '@/components/Toast';
import { Button, Field, Input, Modal } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { useEditor } from '@/features/editor/store';
import { messagesFor, useMessages } from '@/i18n/messages';
import { NODE_H, NODE_W } from '@/ir/layout';
import { hasNode, moduleAddress, parseModuleSource, registryUrl, withModuleNodes } from '@/ir/modules';
import type { IR } from '@/ir/types';
import { cn, tfName } from '@/lib/utils';
import { PROVIDER_LABELS, ProviderDot } from '@/resources/icons';
import { addModuleMessages } from './AddModuleDialog.messages';
import { closeAddModule } from './addModuleStore';
import { ModuleIcon } from './ModuleIcon';
import { buildModuleNode, MODULE_PRESETS, previewModule, uniqueModuleName, type ModulePreset, type PresetId } from './presets';

type Choice = PresetId | 'custom';

/** A free spot for a new module: right of everything on the canvas, below the modules already there. */
export function freeModuleSpot(ir: IR): { x: number; y: number } {
  const rects = [...computeAbsoluteRects(withModuleNodes(ir)).values()];
  if (rects.length === 0) return { x: 40, y: 40 };
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const top = Math.min(...rects.map((r) => r.y));
  const x = right + 64;
  let y = top;
  const hit = (yy: number) => rects.some((r) => x < r.x + r.w && x + NODE_W > r.x && yy < r.y + r.h && yy + NODE_H > r.y);
  for (let guard = 0; hit(y) && guard < 200; guard++) y += NODE_H + 32;
  return { x, y };
}

export default function AddModuleDialog() {
  const m = useMessages(addModuleMessages);
  const ir = useEditor((s) => s.ir);
  const [choice, setChoice] = useState<Choice>('aws-vpc');
  const preset: ModulePreset | undefined = MODULE_PRESETS.find((p) => p.id === choice);
  const [names, setNames] = useState<Partial<Record<Choice, string>>>({});
  const [custom, setCustom] = useState({ source: '', version: '' });
  const nameId = useId();

  const defaultName = preset ? uniqueModuleName(ir, preset.name) : uniqueModuleName(ir, 'module');
  const name = names[choice] ?? defaultName;
  const clean = tfName(name);
  const source = preset ? preset.source : custom.source.trim();
  const version = preset ? preset.version : custom.version.trim();
  const inputs = useMemo(() => preset?.inputs(ir) ?? [], [preset, ir]);
  const wired = inputs.some(([k]) => k === 'vpc_id');
  const taken = hasNode(ir, moduleAddress(clean));
  const registry = source ? registryUrl(parseModuleSource(source), version) : null;
  const preview = previewModule({ name: clean, source: source || '…', version, inputs });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = messagesFor(addModuleMessages);
    if (!source) {
      showToast(t.sourceRequired, 'error');
      return;
    }
    if (taken) {
      showToast(t.nameTaken(moduleAddress(clean)), 'error');
      return;
    }
    const state = useEditor.getState();
    const node = buildModuleNode({ name: clean, source, version, inputs }, freeModuleSpot(state.ir));
    const before = state.filesRevision;
    state.applyCanvasOps([{ kind: 'add_module', node }], node.id);
    if (useEditor.getState().filesRevision === before) return; // refused (the toast says why)
    closeAddModule();
    showToast(t.added(node.id), 'success');
    setTimeout(() => canvasApi()?.focusNode(node.id), 80);
  };

  const option = (id: Choice, label: string, detail: string, icon: React.ReactNode) => (
    <label
      key={id}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-[9px] border px-2.5 py-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary',
        choice === id ? 'border-primary bg-primary-soft' : 'border-transparent hover:border-border hover:bg-surface-2',
      )}
    >
      <input type="radio" name="module-preset" value={id} checked={choice === id} onChange={() => setChoice(id)} className="sr-only" />
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold">{label}</span>
        <span className="block truncate font-mono text-[10.5px] text-faint">{detail}</span>
      </span>
    </label>
  );

  return (
    <Modal
      open
      onClose={closeAddModule}
      wide
      label={m.title}
      title={
        <div>
          <h2 className="text-[17px] font-bold">{m.title}</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">{m.subtitle}</p>
        </div>
      }
    >
      <form onSubmit={submit} className="grid gap-4 px-5 pb-5 pt-4 max-sm:px-4 sm:grid-cols-[240px_minmax(0,1fr)]">
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.presetsLabel}</legend>
          <div className="space-y-0.5" role="radiogroup" aria-label={m.presetsLabel}>
            {MODULE_PRESETS.map((p) =>
              option(
                p.id,
                m.presets[p.id],
                p.source.replace(/\/[^/]+$/, ''),
                <span className="relative">
                  <ModuleIcon size={30} />
                  <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface-1 p-[2px]" title={PROVIDER_LABELS[p.provider]}>
                    <ProviderDot provider={p.provider} size={7} />
                  </span>
                </span>,
              ),
            )}
            {option(
              'custom',
              m.custom,
              m.customHint,
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] border border-dashed border-border-strong text-muted">
                <PencilLine className="h-3.5 w-3.5" />
              </span>,
            )}
          </div>
        </fieldset>

        <div className="min-w-0 space-y-3">
          <Field label={m.name} hint={richText(m.nameHint(moduleAddress(clean)))}>
            <Input
              id={nameId}
              autoFocus
              value={name}
              onChange={(e) => setNames((n) => ({ ...n, [choice]: e.target.value }))}
              aria-invalid={taken || undefined}
              className={cn('font-mono text-[12.5px]', taken && 'border-danger')}
            />
          </Field>
          {taken ? <p className="-mt-2 text-[11.5px] text-danger">{m.nameTaken(moduleAddress(clean))}</p> : null}
          {preset ? null : (
            <>
              <Field label={m.source} hint={m.customHint}>
                <Input
                  value={custom.source}
                  placeholder={m.sourcePlaceholder}
                  onChange={(e) => setCustom((c) => ({ ...c, source: e.target.value }))}
                  className="font-mono text-[12.5px]"
                />
              </Field>
              <Field label={m.version} hint={m.versionHint}>
                <Input
                  value={custom.version}
                  placeholder={m.versionPlaceholder}
                  onChange={(e) => setCustom((c) => ({ ...c, version: e.target.value }))}
                  className="font-mono text-[12.5px]"
                />
              </Field>
            </>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">{m.preview}</span>
              {registry ? (
                <a
                  href={registry}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-[12px] font-medium text-primary hover:underline"
                >
                  {m.registryPage} <ArrowUpRight className="h-3 w-3" />
                </a>
              ) : null}
            </div>
            <HclSnippet code={preview} className="max-h-[36vh] border" />
            {wired ? <p className="mt-1.5 text-[11.5px] text-muted">{m.wiredToNetwork}</p> : null}
            {preset ? (
              <p className="mt-1 text-[11px] text-faint">
                {PROVIDER_LABELS[preset.provider]} · <code className="font-mono">{preset.source}</code>
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={closeAddModule}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={!source || taken}>
              {m.add}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
