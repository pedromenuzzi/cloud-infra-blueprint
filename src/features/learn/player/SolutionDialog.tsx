/**
 * The lesson's solution beside the learner's own code: each solution file
 * with the lines their code doesn't have yet highlighted (the tutorial
 * player's diff). "Use the solution" swaps it in as one undo step.
 */
import { Lightbulb } from 'lucide-react';
import { useMemo, useState } from 'react';
import { diffAddedLines, HclSnippet } from '@/components/HclSnippet';
import { showToast } from '@/components/Toast';
import { Button, Modal } from '@/components/ui';
import { orderedFiles, useEditor } from '@/features/editor/store';
import { useLocale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
import { textIn, type Lesson } from '@/learn/types';
import { cn } from '@/lib/utils';
import { playerMessages } from './player.messages';

export function SolutionDialog({ lesson, onClose }: { lesson: Lesson; onClose(): void }) {
  const m = useMessages(playerMessages);
  const locale = useLocale((s) => s.locale);
  const files = useEditor((s) => s.files);
  const names = orderedFiles(lesson.solution);
  // open on the first file the learner's code differs in
  const [file, setFile] = useState(() => names.find((f) => files[f] !== lesson.solution[f]) ?? names[0]);
  const solution = lesson.solution[file] ?? '';
  const added = useMemo(() => diffAddedLines(files[file] ?? '', solution), [files, file, solution]);

  const use = () => {
    useEditor.getState().replaceFiles({ ...lesson.solution });
    onClose();
    showToast(m.solutionApplied, 'success', { action: { label: m.undo, onClick: () => useEditor.getState().undo() }, page: true });
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/15 text-warning">
            <Lightbulb className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold leading-tight">{m.solutionTitle}</h2>
            <p className="text-[12px] text-muted">{textIn(lesson.title, locale)}</p>
          </div>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4 max-sm:px-4">
        {names.length > 1 ? (
          <div className="flex gap-0.5 overflow-x-auto border-b" role="tablist" aria-label={m.solutionTitle}>
            {names.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={f === file}
                onClick={() => setFile(f)}
                className={cn(
                  '-mb-px shrink-0 border-b-2 px-3 py-1.5 font-mono text-[11.5px] transition-colors',
                  f === file ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted hover:text-foreground',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        ) : null}
        <p className="flex items-center gap-2 text-[12px] text-muted" aria-live="polite">
          {added.size > 0 ? <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px] bg-success/30" /> : null}
          {added.size > 0 ? m.solutionLegend : m.solutionMatches}
        </p>
        <HclSnippet code={solution} addedLines={added} className="max-h-[52vh] border" />
      </div>
      <div className="flex justify-end gap-2 border-t px-5 py-3 max-sm:px-4">
        <Button variant="outline" onClick={onClose} data-autofocus>
          {m.close}
        </Button>
        <Button onClick={use}>
          {m.useSolution}
        </Button>
      </div>
    </Modal>
  );
}
