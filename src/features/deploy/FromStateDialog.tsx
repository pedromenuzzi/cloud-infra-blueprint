/**
 * "Create a project from a state": what the state becomes (resources,
 * references, secrets turned into variables), what it can't become and why,
 * then a new project, laid out on open, with the state kept on it in memory
 * so its canvas opens marked deployed.
 */
import { CheckCircle2, FolderPlus, KeyRound, Link2, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { showToast } from '@/components/Toast';
import { Button, Field, Input, Modal } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { createProject, uniqueProjectName } from '@/lib/storage';
import { loadSchema, resourceSchema, schemaProviderOf } from '@/schema/store';
import { stateToProject, type FromStateResult, type SkipReason } from '@/deploy/fromState';
import { stateByNode } from '@/deploy/state';
import { closeFromState, useFromState } from './fromStateStore';
import { deployMessages } from './messages';
import { useDeploy } from './store';

export default function FromStateDialog() {
  const m = useMessages(deployMessages);
  const navigate = useNavigate();
  const state = useFromState((s) => s.state);
  const fileName = useFromState((s) => s.fileName);
  const [result, setResult] = useState<FromStateResult | null>(null);
  const [name, setName] = useState(m.defaultName);

  // the provider schemas say which arguments Terraform computes: load them first
  useEffect(() => {
    if (!state) return;
    let alive = true;
    const providers = new Set(state.resources.map((r) => schemaProviderOf(r.type)).filter((p) => p !== undefined));
    void Promise.all([...providers].map((p) => loadSchema(p))).then(() => {
      if (alive) setResult(stateToProject(state, resourceSchema));
    });
    return () => {
      alive = false;
    };
  }, [state]);

  const skipped = useMemo(() => {
    const by = new Map<SkipReason, string[]>();
    for (const s of result?.skipped ?? []) by.set(s.reason, [...(by.get(s.reason) ?? []), s.address]);
    return [...by];
  }, [result]);

  const create = () => {
    if (!result || !state) return;
    let id: string;
    const projectName = uniqueProjectName(name.trim() || m.defaultName);
    try {
      id = createProject({ name: projectName, files: result.files, description: m.description }).id;
    } catch {
      return; // storage full: the storage notice says so
    }
    // the new canvas opens with the state on it (memory only, like any state)
    useDeploy.setState({ state: { state, name: fileName, byNode: stateByNode(state) }, plan: null, projectId: id, tab: 'state' });
    closeFromState();
    showToast(m.created(projectName), 'success');
    navigate(`/editor/${id}`);
  };

  const empty = result !== null && result.converted.length === 0;
  return (
    <Modal open onClose={closeFromState} title={<h2 className="text-[15px] font-semibold">{m.dialogTitle}</h2>} wide>
      <div className="space-y-4 px-5 py-4 max-sm:px-4">
        <p className="text-[12.5px] leading-relaxed text-muted">{m.dialogIntro}</p>
        {!result ? (
          <p role="status" className="flex items-center gap-2 text-[12.5px] text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> {m.reading}
          </p>
        ) : empty ? (
          <p role="status" className="rounded-[10px] border border-warning/40 bg-warning/8 p-3 text-[12.5px] text-warning">
            {m.nothing}
          </p>
        ) : (
          <ul className="space-y-1.5 text-[12.5px]" data-testid="from-state-summary">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-success" /> {m.written(result.converted.length, result.instances)}
            </li>
            {result.references > 0 ? (
              <li className="flex items-start gap-2">
                <Link2 className="mt-px h-4 w-4 shrink-0 text-primary" /> {m.references(result.references)}
              </li>
            ) : null}
            {result.secrets.length > 0 ? (
              <li className="flex items-start gap-2">
                <KeyRound className="mt-px h-4 w-4 shrink-0 text-warning" />
                <span>
                  {m.secrets(result.secrets.length)}{' '}
                  {result.secrets.map((v) => (
                    <code key={v} className="mr-1 rounded bg-surface-2 px-1 text-[11.5px]">
                      var.{v}
                    </code>
                  ))}
                </span>
              </li>
            ) : null}
          </ul>
        )}
        {result && (skipped.length > 0 || result.leftOut.length > 0) ? (
          <div className="space-y-1.5 rounded-[10px] border bg-surface-2/50 p-3 text-[12px]" data-testid="from-state-skipped">
            {skipped.length > 0 ? <p className="font-semibold">{m.notConverted}</p> : null}
            {skipped.map(([reason, addresses]) => (
              <details key={reason} className="group">
                <summary className="cursor-pointer text-muted marker:text-faint">
                  {addresses.length} · {m.skip[reason]}
                </summary>
                <ul className="mt-1 space-y-0.5 pl-4">
                  {addresses.map((a) => (
                    <li key={a}>
                      <code className="text-[11px]">{a}</code>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {result.leftOut.length > 0 ? (
              <details>
                <summary className="cursor-pointer font-semibold marker:text-faint">
                  {m.leftOutTitle} {result.leftOut.length}
                </summary>
                <ul className="mt-1 space-y-0.5 pl-4">
                  {result.leftOut.map((x) => (
                    <li key={`${x.address}:${x.path}`} className="text-muted">
                      <code className="text-[11px] text-foreground">
                        {x.address}.{x.path}
                      </code>{' '}
                      {m.leftOut[x.why]}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
        {result && !empty ? (
          <>
            <p className="text-[11.5px] leading-relaxed text-faint">{m.honest}</p>
            <Field label={m.nameLabel}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') create();
                }}
                data-autofocus
              />
            </Field>
          </>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t px-5 py-3 max-sm:px-4">
        <Button variant="ghost" onClick={closeFromState}>
          {m.cancel}
        </Button>
        <Button onClick={create} disabled={!result || empty}>
          <FolderPlus className="h-4 w-4" /> {m.create}
        </Button>
      </div>
    </Modal>
  );
}
