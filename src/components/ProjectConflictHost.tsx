import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal } from '@/components/ui';
import { useEditor } from '@/features/editor/store';

/**
 * The open project changed or was deleted in another tab while this one had
 * unsaved edits. Nothing is written until the user picks what to keep.
 * (Loaded lazily with the editor so the store stays out of the main chunk.)
 */
export default function ProjectConflictHost() {
  const navigate = useNavigate();
  const conflict = useEditor((s) => s.conflict);
  const name = useEditor((s) => s.projectName);
  const resolve = useEditor((s) => s.resolveConflict);
  if (!conflict) return null;

  const pick = (choice: Parameters<typeof resolve>[0]) => {
    const before = useEditor.getState().projectId;
    const next = resolve(choice);
    if (next === null) navigate('/dashboard', { replace: true });
    else if (next !== before) navigate(`/editor/${next}`, { replace: true });
  };

  const deleted = conflict === 'deleted';
  const title = deleted ? `“${name}” was deleted in another tab` : `“${name}” was changed in another tab`;
  return (
    // choosing is required: closing would leave edits that can't be saved
    <Modal open onClose={() => undefined} label={title}>
      <div className="p-5" role="alertdialog" aria-label={title}>
        <div className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/12 text-warning">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="break-words text-[15px] font-semibold">{title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {deleted
                ? 'This tab still has your latest changes. Put the project back, keep them as a new project, or let it go.'
                : 'This tab has changes that aren’t saved yet. Load the other tab’s version (your recent changes here are dropped) or keep yours (the other tab’s changes are overwritten).'}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {deleted ? (
            <>
              <Button variant="outline" onClick={() => pick('discard')}>
                Discard
              </Button>
              <Button variant="outline" onClick={() => pick('fork')}>
                Keep as new project
              </Button>
              <Button onClick={() => pick('restore')}>Restore project</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => pick('reload')}>
                Load other version
              </Button>
              <Button onClick={() => pick('overwrite')}>Keep mine</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
