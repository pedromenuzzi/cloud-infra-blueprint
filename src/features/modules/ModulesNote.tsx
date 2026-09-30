/**
 * The security audit and the cost estimate look at the root module's
 * resources only: this line says which module calls they leave out — the
 * Registry / git ones can't be looked into here, the local ones aren't yet.
 */
import { Boxes } from 'lucide-react';
import { useEditor } from '@/features/editor/store';
import { useMessages } from '@/i18n/messages';
import { moduleSourceInfo } from '@/ir/modules';
import { modulesMessages } from './modules.messages';

export function ModulesNote({ area, onPick, className }: { area: 'security' | 'cost'; onPick?(id: string): void; className?: string }) {
  const m = useMessages(modulesMessages);
  const modules = useEditor((s) => s.ir.modules);
  if (modules.length === 0) return null;
  const local = modules.filter((x) => moduleSourceInfo(x)?.kind === 'local').length;
  return (
    <div className={className} data-testid={`modules-note-${area}`}>
      <p className="flex gap-1.5 text-[11.5px] leading-snug text-muted">
        <Boxes className="mt-px h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
        <span>{area === 'security' ? m.notAudited(modules.length, local) : m.notEstimated(modules.length, local)}</span>
      </p>
      {onPick ? (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-5">
          {modules.slice(0, 8).map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => onPick(x.id)}
              className="rounded-full border px-1.5 py-px font-mono text-[10.5px] text-muted transition-colors hover:border-primary/40 hover:text-primary"
            >
              {x.id}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
