import { Modal } from '@blueprint/ui';

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

const GROUPS: { title: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Navigation',
    rows: [
      { keys: ['Ctrl', 'K'], label: 'Command palette' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
      { keys: ['/'], label: 'Focus search' },
      { keys: ['Esc'], label: 'Close overlays' },
    ],
  },
  {
    title: 'Editor (preview)',
    rows: [
      { keys: ['Space', '+ drag'], label: 'Pan canvas' },
      { keys: ['Ctrl', 'Z'], label: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo' },
      { keys: ['Ctrl', 'S'], label: 'Save (auto-saves in F4)' },
      { keys: ['Del'], label: 'Delete selected node' },
    ],
  },
  {
    title: 'Theme',
    rows: [{ keys: ['Ctrl', 'K', '→', 'theme'], label: 'Switch theme via palette' }],
  },
];

export function ShortcutsHelp({ open, onClose }: ShortcutsHelpProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Move faster with your keyboard. Most shortcuts work everywhere."
      className="max-w-lg"
    >
      <div className="space-y-5">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {g.title}
            </h3>
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {g.rows.map((row) => (
                <li key={row.label} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{row.label}</span>
                  <span className="flex items-center gap-1">
                    {row.keys.map((k) => (
                      <kbd
                        key={k}
                        className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-surface-1 px-1 font-mono text-[10px] text-foreground"
                      >
                        {k}
                      </kbd>
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
