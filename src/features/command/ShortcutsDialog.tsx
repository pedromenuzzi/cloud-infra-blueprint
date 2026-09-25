import { Keyboard } from 'lucide-react';
import { Kbd, Modal } from '@/components/ui';
import { MOD, usePalette } from './paletteStore';

const SECTIONS: Array<{ title: string; items: Array<[string, string[]]> }> = [
  {
    title: 'Anywhere',
    items: [
      ['Command palette', [MOD, 'K']],
      ['Keyboard shortcuts', ['?']],
    ],
  },
  {
    title: 'Canvas',
    items: [
      ['Add a resource at the cursor', ['Double-click']],
      ['Resource / canvas actions', ['Right-click']],
      ['Duplicate selected', [MOD, 'D']],
      ['Rename selected', ['F2']],
      ['Delete selected', ['Del']],
      ['Fit view', ['⇧', '1']],
      ['Pan', ['Space', 'Drag']],
      ['Multi-select', ['⇧', 'Drag']],
    ],
  },
  {
    title: 'Editing',
    items: [
      ['Undo', [MOD, 'Z']],
      ['Redo', [MOD, '⇧', 'Z']],
      ['Toggle resource palette', [MOD, 'B']],
      ['Toggle code editor', [MOD, 'J']],
      ['Toggle inspector', [MOD, 'I']],
    ],
  },
  {
    title: 'Code editor',
    items: [
      ['Autocomplete', ['Ctrl', 'Space']],
      ['Toggle comment', [MOD, '/']],
      ['Find', [MOD, 'F']],
      ['Next problem', ['F8']],
    ],
  },
];

export function ShortcutsDialog() {
  const open = usePalette((s) => s.shortcuts);
  const setOpen = usePalette((s) => s.setShortcuts);
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      wide
      title={
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <Keyboard className="h-4 w-4 text-muted" /> Keyboard shortcuts
        </span>
      }
    >
      <div className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-faint">
              {section.title}
            </h3>
            <ul className="space-y-1.5">
              {section.items.map(([label, keys]) => (
                <li key={label} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="text-muted">{label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
