/**
 * The security audit and the cost estimate look inside local modules; this
 * line says which module calls they still leave out: Registry / git ones
 * (their contents aren't in the project), local ones whose folder is
 * missing or whose code doesn't parse.
 */
import { Boxes } from 'lucide-react';
import { useEditor } from '@/features/editor/store';
import { useMessages } from '@/i18n/messages';
import { moduleTarget } from '@/ir/localModules';
import { moduleInstances, pathLabel } from '@/ir/moduleInstance';
import type { IR } from '@/ir/types';
import { modulesMessages } from './modules.messages';

/** Module calls, anywhere in the project, whose contents the analyses can't read: their labels, and the root's own ids. */
export function unanalysedCalls(root: IR, files: Record<string, string>): Array<{ label: string; rootId?: string }> {
  const out: Array<{ label: string; rootId?: string }> = [];
  const visit = (ir: IR, path: string[]) => {
    for (const call of ir.modules) {
      const target = moduleTarget(files, call);
      if (target.kind === 'local' && target.module && !target.module.broken) continue;
      out.push({ label: pathLabel([...path, call.name]), ...(path.length === 0 ? { rootId: call.id } : {}) });
    }
  };
  visit(root, []);
  const walk = (list: ReturnType<typeof moduleInstances>) => {
    for (const m of list) {
      visit(m.ir, m.path);
      walk(m.nested);
    }
  };
  walk(moduleInstances(root, files));
  return out;
}

export function ModulesNote({ area, onPick, className }: { area: 'security' | 'cost'; onPick?(id: string): void; className?: string }) {
  const m = useMessages(modulesMessages);
  const root = useEditor((s) => s.rootIr);
  const files = useEditor((s) => s.files);
  if (root.modules.length === 0) return null;
  const left = unanalysedCalls(root, files);
  if (left.length === 0) return null;
  return (
    <div className={className} data-testid={`modules-note-${area}`}>
      <p className="flex gap-1.5 text-[11.5px] leading-snug text-muted">
        <Boxes className="mt-px h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
        <span>{area === 'security' ? m.notAudited(left.length) : m.notEstimated(left.length)}</span>
      </p>
      {onPick ? (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-5">
          {left.slice(0, 8).map((x) =>
            x.rootId ? (
              <button
                key={x.label}
                type="button"
                onClick={() => onPick(x.rootId!)}
                className="rounded-full border px-1.5 py-px font-mono text-[10.5px] text-muted transition-colors hover:border-primary/40 hover:text-primary"
              >
                {x.label}
              </button>
            ) : (
              <span key={x.label} className="rounded-full border px-1.5 py-px font-mono text-[10.5px] text-muted">
                {x.label}
              </span>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
