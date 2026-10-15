import { ChevronDown, FileUp, FolderOpen, Github } from 'lucide-react';
import { useRef, useState } from 'react';
import { ContextMenu, type MenuEntry } from '@/components/ContextMenu';
import { Button } from '@/components/ui';
import { dataMessages } from '@/features/data/messages';
import { useOpenFolder } from '@/features/data/OpenFolderButton';
import { useMessages } from '@/i18n/messages';
import { openGithubImport } from './githubImportStore';
import { importMenuMessages, importMessages } from './messages';

/**
 * The dashboard's one way in for existing Terraform: files (a backup .zip
 * among them opens the restore dialog), a GitHub repository, or a folder
 * kept in sync (Chromium only). A menu button: Enter, Space or ↓ opens it on
 * its first item; Esc closes it and gives focus back.
 */
export function ImportMenu({ onFiles }: { onFiles(files: File[]): void }) {
  const m = useMessages(importMenuMessages);
  const github = useMessages(importMessages);
  const data = useMessages(dataMessages);
  const folder = useOpenFolder();
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const open = (trigger: HTMLElement) => {
    const r = trigger.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 6 });
  };

  const entries: MenuEntry[] = [
    { id: 'files', label: m.files, hint: m.filesHint, icon: FileUp, onSelect: () => input.current?.click() },
    { id: 'github', label: m.github, hint: github.subtitle, icon: Github, onSelect: () => openGithubImport() },
  ];
  if (folder.supported) {
    entries.push({ id: 'folder', label: data.openFolder, hint: m.folderHint, icon: FolderOpen, disabled: folder.busy, onSelect: folder.open });
  }

  return (
    <>
      <Button
        variant="outline"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(e) => open(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown') return;
          e.preventDefault();
          open(e.currentTarget);
        }}
      >
        <FileUp className="h-4 w-4" /> {m.import} <ChevronDown className="-mr-0.5 h-3.5 w-3.5 text-muted" />
      </Button>
      {menu ? <ContextMenu x={menu.x} y={menu.y} label={m.import} entries={entries} onClose={() => setMenu(null)} /> : null}
      <input
        ref={input}
        type="file"
        multiple
        accept=".tf,.zip"
        className="hidden"
        aria-label={m.filesLabel}
        onChange={(e) => {
          // copy before resetting the input: its FileList is live and empties
          if (e.target.files?.length) onFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
    </>
  );
}
