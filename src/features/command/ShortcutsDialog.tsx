import { Keyboard } from 'lucide-react';
import { useState } from 'react';
import { Kbd, Modal } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { keyCap, PLATFORM, type Key, type KeyPlatform } from '@/lib/keys';
import { cn } from '@/lib/utils';
import { commandMessages } from './messages';
import { usePalette } from './paletteStore';

type Words = (typeof commandMessages)['en'];

/** each shortcut as key caps; 'mod' and 'shift' are spelled per platform (src/lib/keys.ts) */
function sections(m: Words): Array<{ title: string; items: Array<[string, Key[]]> }> {
  const a = m.actions;
  const k = m.keys;
  return [
    {
      title: m.sections.anywhere,
      items: [
        // inside the code editor mod K belongs to Monaco's chords: use mod shift P there
        [a.palette, ['mod', 'K']],
        [a.paletteInCode, ['mod', 'shift', 'P']],
        [a.shortcuts, ['?']],
        [a.closeLayer, ['Esc']],
      ],
    },
    {
      title: m.sections.canvas,
      items: [
        [a.addAtCursor, [k.doubleClick]],
        [a.contextMenu, [k.rightClick]],
        [a.duplicate, ['mod', 'D']],
        [a.rename, ['F2']],
        [a.delete, ['Del']],
        [a.fitView, ['shift', '1']],
        [a.pan, [k.dragEmpty]],
        [a.panOver, [k.space, k.drag]],
        [a.zoom, [k.scroll]],
        [a.boxSelect, ['shift', k.drag]],
        [a.addToSelection, ['mod', k.click]],
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
        [a.undo, ['mod', 'Z']],
        [a.redo, ['mod', 'shift', 'Z']],
        [a.togglePalette, ['mod', 'B']],
        [a.toggleCode, ['mod', 'J']],
        [a.toggleInspector, ['mod', 'I']],
      ],
    },
    {
      title: m.sections.code,
      items: [
        [a.autocomplete, ['Ctrl', k.space]],
        [a.comment, ['mod', '/']],
        [a.find, ['mod', 'F']],
        [a.nextProblem, ['F8']],
      ],
    },
  ];
}

export function ShortcutsDialog() {
  const open = usePalette((s) => s.shortcuts);
  const setOpen = usePalette((s) => s.setShortcuts);
  const m = useMessages(commandMessages);
  // the keys as they read on this device, or on the other platform (people use both)
  const [platform, setPlatform] = useState<KeyPlatform>(PLATFORM);
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
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 text-[12px] text-muted">
        <span id="shortcuts-platform">{m.keysFor}</span>
        <div role="radiogroup" aria-labelledby="shortcuts-platform" className="inline-flex rounded-sm border bg-surface-1 p-0.5">
          {(['pc', 'mac'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={platform === p}
              onClick={() => setPlatform(p)}
              className={cn(
                'rounded-[5px] px-2.5 py-1 text-[12px] font-medium transition-colors',
                platform === p ? 'bg-surface-2 text-foreground shadow-sm' : 'text-muted hover:text-foreground',
              )}
            >
              {p === 'pc' ? m.platformPc : m.platformMac}
            </button>
          ))}
        </div>
      </div>
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
                      <Kbd key={key}>{keyCap(key, platform)}</Kbd>
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
