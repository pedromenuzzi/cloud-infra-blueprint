import { Keyboard } from 'lucide-react';
import { Kbd, Modal } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { commandMessages } from './messages';
import { MOD, usePalette } from './paletteStore';

type Words = (typeof commandMessages)['en'];

function sections(m: Words): Array<{ title: string; items: Array<[string, string[]]> }> {
  const a = m.actions;
  const k = m.keys;
  return [
    {
      title: m.sections.anywhere,
      items: [
        // inside the code editor MOD K belongs to Monaco's chords — use MOD ⇧ P there
        [a.palette, [MOD, 'K']],
        [a.paletteInCode, [MOD, '⇧', 'P']],
        [a.shortcuts, ['?']],
        [a.closeLayer, ['Esc']],
      ],
    },
    {
      title: m.sections.canvas,
      items: [
        [a.addAtCursor, [k.doubleClick]],
        [a.contextMenu, [k.rightClick]],
        [a.duplicate, [MOD, 'D']],
        [a.rename, ['F2']],
        [a.delete, ['Del']],
        [a.fitView, ['⇧', '1']],
        [a.pan, [k.dragEmpty]],
        [a.panOver, [k.space, k.drag]],
        [a.zoom, [k.scroll]],
        [a.boxSelect, ['⇧', k.drag]],
        [a.addToSelection, [MOD, k.click]],
      ],
    },
    {
      title: m.sections.palette,
      items: [
        [a.moveBetween, ['↑', '↓']],
        [a.collapse, ['←', '→']],
        [a.addFocused, ['Enter']],
      ],
    },
    {
      title: m.sections.editing,
      items: [
        [a.undo, [MOD, 'Z']],
        [a.redo, [MOD, '⇧', 'Z']],
        [a.togglePalette, [MOD, 'B']],
        [a.toggleCode, [MOD, 'J']],
        [a.toggleInspector, [MOD, 'I']],
      ],
    },
    {
      title: m.sections.code,
      items: [
        [a.autocomplete, ['Ctrl', k.space]],
        [a.comment, [MOD, '/']],
        [a.find, [MOD, 'F']],
        [a.nextProblem, ['F8']],
      ],
    },
  ];
}

export function ShortcutsDialog() {
  const open = usePalette((s) => s.shortcuts);
  const setOpen = usePalette((s) => s.setShortcuts);
  const m = useMessages(commandMessages);
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      wide
      title={
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Keyboard className="h-4 w-4 text-muted" aria-hidden="true" /> {m.shortcutsTitle}
        </h2>
      }
    >
      <div className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
        {sections(m).map((section) => (
          <section key={section.title}>
            <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-faint">
              {section.title}
            </h3>
            <ul className="space-y-1.5">
              {section.items.map(([label, keys]) => (
                <li key={label} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 text-muted">{label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
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
