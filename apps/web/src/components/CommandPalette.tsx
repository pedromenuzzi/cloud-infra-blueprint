import { cn } from '@blueprint/ui';
import {
  Boxes,
  Cpu,
  FilePlus,
  HardDrive,
  Home,
  Keyboard,
  LayoutDashboard,
  Monitor,
  Moon,
  Redo2,
  Search,
  Settings,
  Sun,
  Undo2,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { useIRStore } from '@/store/useIRStore';
import { useTheme, type ThemeMode } from '@/theme';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: 'Navigation' | 'Theme' | 'Resources' | 'Editing' | 'Help';
  icon: ReactNode;
  /** Search keywords beyond `label` + `hint`. */
  keywords?: string[];
  /** When true, the command is greyed out and Enter does nothing. */
  disabled?: boolean;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Cursor / VSCode-style command palette. Opens with `Ctrl+K` (Cmd+K on macOS),
 * navigates with arrow keys, runs on Enter. Esc closes.
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const setMode = useTheme((s) => s.setMode);
  // Subscribe to past/future length so the disabled state stays in sync as
  // the user edits the canvas while the palette is open.
  const canUndo = useIRStore((s) => s.past.length > 0);
  const canRedo = useIRStore((s) => s.future.length > 0);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands: Command[] = useMemo(() => {
    const themeCmd = (label: string, value: ThemeMode, icon: ReactNode): Command => ({
      id: `theme:${value}`,
      label,
      group: 'Theme',
      icon,
      run: () => setMode(value),
    });
    const navCmd = (id: string, label: string, path: string, icon: ReactNode): Command => ({
      id: `nav:${id}`,
      label,
      group: 'Navigation',
      icon,
      run: () => navigate(path),
    });

    return [
      navCmd('home', 'Home — landing page', '/', <Home className="h-4 w-4" />),
      navCmd('dashboard', 'Open dashboard', '/dashboard', <LayoutDashboard className="h-4 w-4" />),
      navCmd('editor', 'Open editor', '/editor/new', <Boxes className="h-4 w-4" />),
      {
        id: 'project:new',
        label: 'New project from template',
        group: 'Navigation',
        icon: <FilePlus className="h-4 w-4" />,
        keywords: ['create', 'project'],
        run: () => navigate('/dashboard?new=1'),
      },
      navCmd(
        'settings',
        'Settings (placeholder)',
        '/dashboard?settings=1',
        <Settings className="h-4 w-4" />,
      ),

      themeCmd('Theme — Light', 'light', <Sun className="h-4 w-4" />),
      themeCmd('Theme — Dark', 'dark', <Moon className="h-4 w-4" />),
      themeCmd('Theme — System', 'system', <Monitor className="h-4 w-4" />),

      {
        id: 'edit:undo',
        label: 'Undo',
        hint: 'Ctrl+Z',
        group: 'Editing',
        icon: <Undo2 className="h-4 w-4" />,
        keywords: ['revert', 'desfazer'],
        disabled: !canUndo,
        run: () => useIRStore.getState().undo(),
      },
      {
        id: 'edit:redo',
        label: 'Redo',
        hint: 'Ctrl+Shift+Z',
        group: 'Editing',
        icon: <Redo2 className="h-4 w-4" />,
        keywords: ['refazer'],
        disabled: !canRedo,
        run: () => useIRStore.getState().redo(),
      },

      {
        id: 'resources:add-vpc',
        label: 'Add aws_vpc to canvas',
        group: 'Resources',
        icon: <HardDrive className="h-4 w-4" />,
        run: () => navigate('/editor/new?resource=aws_vpc'),
      },
      {
        id: 'resources:add-ec2',
        label: 'Add aws_instance to canvas',
        group: 'Resources',
        icon: <Cpu className="h-4 w-4" />,
        run: () => navigate('/editor/new?resource=aws_instance'),
      },

      {
        id: 'help:shortcuts',
        label: 'Show keyboard shortcuts',
        hint: '?',
        group: 'Help',
        icon: <Keyboard className="h-4 w-4" />,
        run: () => window.dispatchEvent(new CustomEvent('blueprint:open-shortcuts')),
      },
      {
        id: 'help:docs',
        label: 'Open documentation',
        group: 'Help',
        icon: <Search className="h-4 w-4" />,
        run: () =>
          window.open(
            'https://github.com/cloud-blueprint/cloud-blueprint/tree/main/docs',
            '_blank',
            'noopener',
          ),
      },
    ];
  }, [navigate, setMode, canUndo, canRedo]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = [c.label, c.hint ?? '', c.group, ...(c.keywords ?? [])].join(' ').toLowerCase();
      return q.split(/\s+/).every((token) => hay.includes(token));
    });
  }, [commands, query]);

  const grouped = useMemo(() => {
    const map = new Map<Command['group'], Command[]>();
    for (const c of filtered) {
      const arr = map.get(c.group) ?? [];
      arr.push(c);
      map.set(c.group, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // Reset state on open + focus the input
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Re-clamp active when filtered list shrinks
  useEffect(() => {
    if (active >= filtered.length) setActive(Math.max(0, filtered.length - 1));
  }, [filtered.length, active]);

  // Keep the active item in view
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-cmd-idx="${active}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [active]);

  const runCommand = useCallback(
    (cmd: Command) => {
      if (cmd.disabled) return;
      onClose();
      cmd.run();
    },
    [onClose],
  );

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[active];
      if (cmd) runCommand(cmd);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="animate-in fade-in fixed inset-0 z-[60] flex items-start justify-center bg-foreground/30 p-4 pt-[15vh] backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Type a command or search…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Command palette input"
            aria-autocomplete="list"
          />
          <kbd className="hidden rounded border border-border bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matches for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group}>
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </div>
                {items.map((cmd) => {
                  const idx = filtered.indexOf(cmd);
                  const isActive = idx === active;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      data-cmd-idx={idx}
                      disabled={cmd.disabled}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => runCommand(cmd)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        cmd.disabled
                          ? 'cursor-not-allowed text-muted-foreground opacity-60'
                          : isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-surface-1',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                          isActive ? 'bg-primary text-primary-foreground' : 'bg-surface-2',
                        )}
                      >
                        {cmd.icon}
                      </span>
                      <span className="flex-1 truncate">{cmd.label}</span>
                      {cmd.hint && (
                        <kbd className="rounded border border-border bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {cmd.hint}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-2">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navigate
          </span>
          <span className="flex items-center gap-2">
            <Kbd>↵</Kbd>
            run
          </span>
          <span className="flex items-center gap-2">
            <Kbd>Esc</Kbd>
            close
          </span>
        </footer>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[18px] items-center justify-center rounded border border-border bg-surface-1 px-1 py-0.5 font-mono text-[10px]">
      {children}
    </kbd>
  );
}
