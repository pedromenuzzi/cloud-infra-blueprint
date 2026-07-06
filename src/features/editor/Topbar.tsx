import { Check, Download, Loader2, Redo2, Share2, Undo2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '@/components/ThemeToggle';
import { showToast } from '@/components/Toast';
import { Button, LogoMark } from '@/components/ui';
import { copyText, exportZip } from '@/lib/download';
import { shareUrl } from '@/lib/share';
import { useEditor } from './store';

export function Topbar() {
  const projectName = useEditor((s) => s.projectName);
  const renameProject = useEditor((s) => s.renameProject);
  const saveState = useEditor((s) => s.saveState);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  const doExport = () => {
    const { projectName: name, files } = useEditor.getState();
    exportZip(name, files);
    showToast('Terraform zip downloaded', 'success');
  };

  const doShare = () => {
    const { projectName: name, files } = useEditor.getState();
    void copyText(shareUrl({ name, files })).then(
      () => showToast('Share link copied — anyone can open this project', 'success'),
      () => showToast('Could not copy the link', 'error'),
    );
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-surface-1 px-3">
      <Link
        to="/dashboard"
        aria-label="Back to dashboard"
        className="rounded-sm p-1 hover:bg-surface-2"
      >
        <LogoMark size={22} />
      </Link>
      <nav className="flex min-w-0 items-center gap-1.5 text-[13px]" aria-label="Breadcrumb">
        <Link to="/dashboard" className="shrink-0 text-muted hover:text-foreground">
          Projects
        </Link>
        <span className="text-faint">/</span>
        <input
          key={projectName}
          defaultValue={projectName}
          aria-label="Project name"
          className="w-44 min-w-0 truncate rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 font-semibold text-foreground hover:border-border focus:border-primary focus:outline-none"
          onBlur={(e) => {
            if (e.target.value.trim() && e.target.value !== projectName) {
              renameProject(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </nav>

      <span
        className="ml-1 flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success"
        role="status"
      >
        {saveState === 'saved' ? (
          <>
            <Check className="h-3 w-3" /> Saved
          </>
        ) : (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> Saving
          </>
        )}
      </span>

      <div className="flex-1" />

      <Button variant="ghost" size="icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
        <Redo2 className="h-4 w-4" />
      </Button>

      <span className="mx-1 h-5 w-px bg-border" />

      <Button variant="outline" size="sm" onClick={doShare}>
        <Share2 className="h-3.5 w-3.5" /> Share
      </Button>
      <Button size="sm" onClick={doExport}>
        <Download className="h-3.5 w-3.5" /> Export
      </Button>
      <ThemeToggle />
    </header>
  );
}
