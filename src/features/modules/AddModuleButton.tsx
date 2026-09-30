/** The resource palette's way into "Add module…" (under the resource list). */
import { Plus } from 'lucide-react';
import { useEditor } from '@/features/editor/store';
import { useMessages } from '@/i18n/messages';
import { addModuleMessages } from './AddModuleDialog.messages';
import { openAddModule } from './addModuleStore';
import { ModuleIcon } from './ModuleIcon';

export function AddModuleButton() {
  const m = useMessages(addModuleMessages);
  const readOnly = useEditor((s) => s.readOnly);
  if (readOnly) return null;
  return (
    <div className="border-t p-2">
      <button
        type="button"
        onClick={openAddModule}
        className="group flex w-full items-center gap-2.5 rounded-[8px] border border-transparent px-2 py-1.5 text-left transition-colors outline-none hover:border-border hover:bg-surface-2 focus-visible:border-primary focus-visible:bg-surface-2"
      >
        <ModuleIcon size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium leading-tight">{m.open}</span>
          <span className="block truncate text-[10px] leading-tight text-faint">{m.openHint}</span>
        </span>
        <Plus className="h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    </div>
  );
}
