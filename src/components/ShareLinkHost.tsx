import { Info, Link2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { showToast } from '@/components/Toast';
import { Button, Modal } from '@/components/ui';
import { openGithubImport, readGithubFragment } from '@/features/import/githubImportStore';
import {
  clearShareFragment,
  readShareFromLocation,
  shareHash,
  type ShareError,
  type SharePayload,
} from '@/lib/share';
import { createProject, findProjectByOrigin, uniqueProjectName, type Project } from '@/lib/storage';

const ERRORS: Record<ShareError, string> = {
  invalid: 'This share link is damaged or incomplete — ask for a new one',
  'too-large': 'This share link is too large to open safely',
  version: 'This share link needs a newer version of Cloud Blueprint — reload and try again',
};

interface Pending {
  payload: SharePayload;
  origin: string;
  existing?: Project;
}

let offer: ((payload: SharePayload) => void) | null = null;

/**
 * Ask to import `payload` as a local copy — the same confirmation and dedupe
 * as opening its share link (the read-only viewer's "Make a copy to edit").
 */
export function offerShareImport(payload: SharePayload) {
  offer?.(payload);
}

/**
 * `#share=<deflated project>` links: on load and on every fragment change
 * (pasting a link into a tab that's already open), ask before importing and
 * offer the copy made from the same link earlier instead of duplicating it.
 */
export function ShareLinkHost() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const ask = (payload: SharePayload) => {
      const origin = `share:${shareHash(payload)}`;
      setPending({ payload, origin, existing: findProjectByOrigin(origin) });
    };
    const check = () => {
      // `#gh=owner/repo[/path][@ref]`: the GitHub import dialog, prefilled
      const gh = readGithubFragment(location.hash);
      if (gh) {
        clearShareFragment();
        openGithubImport(gh, { fromLink: true });
        return;
      }
      const result = readShareFromLocation();
      if (!result) return;
      clearShareFragment(); // handled once, whatever happens next
      if (!result.ok) {
        showToast(ERRORS[result.error], 'error');
        return;
      }
      ask(result.payload);
    };
    offer = ask;
    check();
    window.addEventListener('hashchange', check);
    return () => {
      offer = null;
      window.removeEventListener('hashchange', check);
    };
  }, []);

  useEffect(() => {
    if (pending) requestAnimationFrame(() => primaryRef.current?.focus());
  }, [pending]);

  if (!pending) return null;
  const { payload, origin, existing } = pending;
  const fileCount = Object.keys(payload.files).length;
  const close = () => setPending(null);

  const importCopy = () => {
    close();
    try {
      const project = createProject({
        name: uniqueProjectName(payload.name),
        files: payload.files,
        description: 'Imported from a share link.',
        origin,
      });
      showToast(`Imported “${payload.name}” from share link`, 'success');
      navigate(`/editor/${project.id}`);
    } catch {
      /* storage full — the storage notice already says so; stay here */
    }
  };

  const openExisting = () => {
    close();
    if (existing) navigate(`/editor/${existing.id}`);
  };

  return (
    <Modal open onClose={close} label={`Import a copy of ${payload.name}?`}>
      <div className="p-5">
        <div className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Link2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="break-words text-[15px] font-semibold">Import a copy of “{payload.name}”?</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {fileCount} Terraform file{fileCount === 1 ? '' : 's'} from a share link. The copy is saved in
              this browser only.
            </p>
            {existing ? (
              <p className="mt-2 text-[13px] leading-relaxed text-foreground">
                You already imported this link as “{existing.name}”.
              </p>
            ) : null}
          </div>
        </div>
        <p className="mt-4 flex gap-2 rounded-md border bg-surface-2/60 px-3 py-2 text-[12px] leading-relaxed text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            Review the code before running <code className="font-mono">terraform apply</code> — shared
            Terraform can run commands on your machine (e.g. <code className="font-mono">local-exec</code>{' '}
            provisioners).
          </span>
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          {existing ? (
            <>
              <Button variant="outline" onClick={importCopy}>
                Import another copy
              </Button>
              <Button ref={primaryRef} onClick={openExisting}>
                Open existing copy
              </Button>
            </>
          ) : (
            <Button ref={primaryRef} onClick={importCopy}>
              Import copy
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
