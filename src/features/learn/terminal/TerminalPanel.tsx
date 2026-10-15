/**
 * The simulated Terraform terminal of a lesson: buttons for the five
 * commands and a prompt that takes `terraform plan` (`tf plan`, history on
 * ↑ / ↓, `help`, `clear`), output streamed in the CLI's own format and
 * colors, the approval question of apply and destroy, and tabs for the
 * state and the outputs the last apply left. Ctrl / ⌘ + Enter runs plan from
 * anywhere on the page.
 *
 * It keeps the lesson's runs and state through `useLearn` (recordRun) and
 * draws each plan on the canvas (./planMarks.ts). `init` counts as done
 * while 'init' is among the lesson's runs and the providers and modules
 * haven't changed since (like the real lock file); everything else is the
 * simulator's (src/learn/sim).
 */
import { ChevronDown, ChevronUp, Eraser, FlaskConical, TerminalSquare } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { hasOpenLayer } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { parseProject } from '@/hcl/parser';
import { useLearn } from '@/learn/progress';
import { decode, line, outputValueLines, problemLines, type Line, type Tone } from '@/learn/sim/render';
import { declaredBlocks, initFingerprint, simulate, type SimResult } from '@/learn/sim/simulate';
import type { Files, SimCommand } from '@/learn/types';
import { ariaShortcut, shortcut } from '@/lib/keys';
import { prefersReducedMotion } from '@/lib/motion';
import { safeStorage } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { parseTyped, SIM_COMMANDS } from './input';
import { clearPlan, showPlan } from './planMarks';
import { terminalMessages } from './terminal.messages';

export interface TerminalPanelProps {
  /** the lesson whose runs and simulated state this terminal keeps */
  slug: string;
  /** the lesson's code as it is now */
  files: Files;
  className?: string;
}

/** a line on screen: Terraform's (English, `cli`), the typed command (`cmd`) or the terminal's own hint (UI language) */
type Shown = Line & { key: number; kind: 'cli' | 'cmd' | 'note' };

type Tab = 'terminal' | 'state' | 'outputs';

const PREFS = 'cb-learn-terminal-v1';
const MIN_H = 150;
const MAX_LINES = 3000;

/** each lesson's screen, for as long as the page is open (leaving the lesson and coming back keeps it) */
const screens = new Map<string, Shown[]>();
/** what `init` installed, per lesson (after a reload, the code as it is counts as initialized) */
const installed = new Map<string, string>();
let seq = 0;
const shown = (l: Line, kind: Shown['kind'] = 'cli'): Shown => ({ ...l, key: ++seq, kind });

let runner: ((command: SimCommand) => void) | null = null;

/** run a command in the lesson's terminal, as its button does (no-op when no terminal is mounted) */
export function runCommand(command: SimCommand) {
  runner?.(command);
}

/** `height` null: never resized, the terminal takes `autoHeight` */
function readPrefs(): { height: number | null; collapsed: boolean } {
  try {
    const p = JSON.parse(safeStorage.getItem(PREFS) ?? '{}') as { height?: unknown; collapsed?: unknown };
    return { height: typeof p.height === 'number' && p.height >= MIN_H ? p.height : null, collapsed: p.collapsed === true };
  } catch {
    return { height: null, collapsed: false };
  }
}

/** until it's resized, the terminal takes a share of the window: a short screen keeps a comfortable canvas */
const autoHeight = (viewport: number) => Math.round(Math.min(360, Math.max(200, viewport * 0.3)));

const onWindowResize = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};

function isInitialized(slug: string, files: Files): boolean {
  if (!useLearn.getState().runs[slug]?.includes('init')) return false;
  const now = initFingerprint(files);
  if (!installed.has(slug)) installed.set(slug, now);
  return installed.get(slug) === now;
}

/* ------------------------------------------------------------------ lines */

const TONE_CLASS: Partial<Record<Tone, string>> = {
  success: 'font-bold text-emerald-400',
  strong: 'font-bold text-slate-50',
  muted: 'text-slate-400',
};
const SYMBOL_CLASS: Partial<Record<Tone, string>> = {
  add: 'text-emerald-400',
  change: 'text-amber-300',
  destroy: 'text-red-400',
};

/** a diff line: only its symbol is colored, like the CLI (`-/+` red and green, `<=` cyan); `# forces replacement` in red */
function DiffLine({ text, tone }: { text: string; tone: Tone }) {
  const m = /^(\s*)(-\/\+|\+\/-|<=|[+~-])( .*|$)/.exec(text);
  if (!m) return <>{text}</>;
  const [, lead, symbol, rest] = m;
  const forces = rest.endsWith(' # forces replacement');
  const body = forces ? rest.slice(0, -' # forces replacement'.length) : rest;
  return (
    <>
      {lead}
      {symbol.length === 3 ? (
        <span className="font-bold">
          <span className={symbol[0] === '-' ? 'text-red-400' : 'text-emerald-400'}>{symbol[0]}</span>
          <span className="text-slate-400">/</span>
          <span className={symbol[2] === '+' ? 'text-emerald-400' : 'text-red-400'}>{symbol[2]}</span>
        </span>
      ) : (
        <span className={cn('font-bold', symbol === '<=' ? 'text-cyan-300' : (SYMBOL_CLASS[tone] ?? SYMBOL_CLASS[symbol === '+' ? 'add' : symbol === '-' ? 'destroy' : 'change']))}>
          {symbol}
        </span>
      )}
      {tone === 'replace' && symbol.length !== 3 ? <span className="font-bold">{body}</span> : body}
      {forces ? <span className="text-red-400"> # forces replacement</span> : null}
    </>
  );
}

function LineView({ l }: { l: Shown }) {
  if (l.kind === 'cmd') {
    return (
      <div className="whitespace-pre-wrap break-all" translate="no" lang="en">
        <span className="select-none text-cyan-300">$ </span>
        <span className="font-semibold text-slate-50">{l.text}</span>
      </div>
    );
  }
  if (l.kind === 'note') return <div className="whitespace-pre-wrap text-sky-300">{l.text}</div>;
  const { tone, text } = l;
  let body: React.ReactNode = text || ' ';
  if (tone === 'add' || tone === 'change' || tone === 'destroy' || tone === 'replace') body = <DiffLine text={text} tone={tone} />;
  else if (tone === 'error' || tone === 'warning') {
    const color = tone === 'error' ? 'text-red-400' : 'text-amber-300';
    const m = /^([╷│╵])( (?:Error|Warning):)?(.*)$/.exec(text);
    body = m ? (
      <>
        <span className={color}>{m[1]}</span>
        {m[2] ? <span className={cn('font-bold', color)}>{m[2]}</span> : null}
        <span className={m[2] ? 'font-bold' : undefined}>{m[3]}</span>
      </>
    ) : (
      <span className={color}>{text}</span>
    );
  }
  return (
    <div className={cn('whitespace-pre-wrap break-words', tone && TONE_CLASS[tone])} translate="no" lang="en">
      {body}
    </div>
  );
}

/* ------------------------------------------------------------------ the panel */

export function TerminalPanel({ slug, files, className }: TerminalPanelProps) {
  const m = useMessages(terminalMessages);
  const ids = useId();
  const sim = useLearn((s) => s.sims[slug] ?? null);
  const [lines, setLines] = useState<Shown[]>(() => screens.get(slug) ?? []);
  const [tab, setTab] = useState<Tab>('terminal');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<{ command: 'apply' | 'destroy'; rest: Line[]; result: SimResult } | null>(null);
  const [said, setSaid] = useState('');
  const [prefs, setPrefs] = useState(readPrefs);
  const viewport = useSyncExternalStore(onWindowResize, () => window.innerHeight);
  const height = prefs.height ?? autoHeight(viewport);
  const history = useRef<string[]>([]);
  const browsing = useRef(-1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queue = useRef<{ items: Shown[]; done?: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // the latest props for callbacks that outlive a render (timers, the global shortcut)
  const live = useRef({ slug, files });
  live.current = { slug, files };

  // another lesson in the same panel: its own screen
  const [screenOf, setScreenOf] = useState(slug);
  if (screenOf !== slug) {
    setScreenOf(slug);
    setLines(screens.get(slug) ?? []);
    setAsking(null);
  }

  useEffect(() => {
    screens.set(slug, lines);
  }, [slug, lines]);

  const savePrefs = (next: typeof prefs) => {
    setPrefs(next);
    safeStorage.setItem(PREFS, JSON.stringify(next));
  };

  const append = useCallback((more: Shown[]) => {
    if (more.length > 0) setLines((prev) => (prev.length + more.length > MAX_LINES ? [...prev, ...more].slice(-MAX_LINES) : [...prev, ...more]));
  }, []);

  /** show what's left of the output at once (and run what comes after it) */
  const flush = useCallback(() => {
    const q = queue.current;
    if (!q) return;
    clearTimeout(timer.current);
    queue.current = null;
    append(q.items);
    setBusy(false);
    q.done?.();
  }, [append]);

  /** print lines as if they came in: fast, a beat on `Creating...`, all at once with reduced motion */
  const stream = useCallback(
    (items: Shown[], done?: () => void) => {
      flush();
      if (items.length === 0 || prefersReducedMotion()) {
        append(items);
        done?.();
        return;
      }
      const base = Math.min(14, 650 / items.length);
      const pauses = items.filter((l) => l.pause).length;
      const pauseMs = pauses > 0 ? Math.min(150, 900 / pauses) : 0;
      queue.current = { items: [...items], done };
      setBusy(true);
      const step = () => {
        const q = queue.current;
        if (!q) return;
        const batch: Shown[] = [];
        for (let budget = 16; q.items.length > 0 && budget > 0; budget -= base) {
          const l = q.items.shift()!;
          batch.push(l);
          if (l.pause) break;
        }
        append(batch);
        if (q.items.length > 0) timer.current = setTimeout(step, batch.at(-1)?.pause ? pauseMs : 16);
        else {
          queue.current = null;
          setBusy(false);
          q.done?.();
        }
      };
      step();
    },
    [append, flush],
  );

  const note = useCallback((text: string) => shown(line(text), 'note'), []);

  /** a command ran: remember it (and the state it left), announce it, put the canvas back */
  const finish = useCallback(
    (command: SimCommand, result: SimResult) => {
      const { slug: lesson } = live.current;
      if (result.ok) useLearn.getState().recordRun(lesson, command, command === 'apply' || command === 'destroy' ? (result.state ?? null) : undefined);
      if (command === 'apply' || command === 'destroy') clearPlan();
      const p = result.plan;
      setSaid(
        !result.ok
          ? m.done.failed(command)
          : command === 'init' || command === 'validate'
            ? m.done[command]
            : command === 'destroy'
              ? m.done.destroy(p?.destroy ?? 0)
              : p && p.changes.length === 0
                ? m.done.noChanges
                : command === 'plan'
                  ? m.done.plan(p?.add ?? 0, p?.change ?? 0, p?.destroy ?? 0)
                  : m.done.apply(p?.add ?? 0, p?.change ?? 0, p?.destroy ?? 0),
      );
    },
    [m],
  );

  /** answer Terraform's question: `yes` goes on, anything else cancels */
  const answer = useCallback(
    (text: string) => {
      const a = asking;
      if (!a) return;
      setAsking(null);
      append([shown(line(`  Enter a value: ${text}`, 'strong'))]);
      if (text.trim() === 'yes') {
        stream(a.rest.map((l) => shown(l)), () => finish(a.command, a.result));
      } else {
        append([shown(line()), shown(line(`${a.command === 'apply' ? 'Apply' : 'Destroy'} cancelled.`, 'strong'))]);
        clearPlan();
        setSaid(m.done.cancelled);
      }
    },
    [asking, append, stream, finish, m],
  );

  const runSim = useCallback(
    (command: SimCommand, autoApprove = false, echo = true) => {
      flush();
      if (asking) answer('no');
      setTab('terminal');
      const { slug: lesson, files: code } = live.current;
      if (echo) append([shown(line(`terraform ${command}${autoApprove ? ' -auto-approve' : ''}`), 'cmd')]);
      const initialized = isInitialized(lesson, code);
      const wasInit = useLearn.getState().runs[lesson]?.includes('init') ?? false;
      const result = simulate(command, code, useLearn.getState().sims[lesson] ?? null, { initialized, autoApprove });
      if (command === 'init' && result.ok) installed.set(lesson, initFingerprint(code));
      if (result.plan && (command === 'plan' || result.confirmAt !== undefined)) showPlan(result.plan, declaredBlocks(code));
      else if (command === 'plan') clearPlan();
      const items = result.lines.map((l) => shown(l));
      if (result.confirmAt !== undefined) {
        const at = result.confirmAt;
        stream(items.slice(0, at), () => {
          setAsking({ command: command as 'apply' | 'destroy', rest: result.lines.slice(at + 1), result });
          setSaid(m.done.waiting);
          inputRef.current?.focus({ preventScroll: true });
        });
        return;
      }
      if (!result.ok && command !== 'init' && !initialized) items.push(note(wasInit ? m.initAgain : m.needsInit));
      stream(items, () => finish(command, result));
    },
    [flush, asking, answer, append, stream, finish, note, m],
  );

  // other parts of the page (the lesson player) can run a command
  useEffect(() => {
    runner = (command) => runSim(command);
    return () => {
      runner = null;
    };
  }, [runSim]);

  // Ctrl / ⌘ + Enter: plan, from anywhere on the lesson page (the code editor included: a run shortcut,
  // like a playground's, over Monaco's "insert line below"); not behind a dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.isComposing || hasOpenLayer(['modal'])) return;
      e.preventDefault();
      e.stopPropagation();
      runSim('plan');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [runSim]);

  // the code changed: the plan on the canvas is stale
  const filesKey = useMemo(() => JSON.stringify(files), [files]);
  const lastFiles = useRef(filesKey);
  useEffect(() => {
    if (filesKey === lastFiles.current) return;
    lastFiles.current = filesKey;
    clearPlan();
  }, [filesKey]);

  // leaving the lesson: finish what's printing (its run counts) and take the plan off the canvas
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      flushRef.current();
      clearPlan();
    },
    [],
  );

  // follow the output while the reader is at the bottom (measured against the height before these lines)
  const seen = useRef<{ el: HTMLElement | null; height: number }>({ el: null, height: 0 });
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const before = seen.current;
    if (before.el !== el || el.scrollTop + el.clientHeight >= before.height - 24) el.scrollTop = el.scrollHeight;
    seen.current = { el, height: el.scrollHeight };
  }, [lines, asking, tab, busy]);

  const submit = () => {
    const text = typed;
    setTyped('');
    browsing.current = -1;
    if (asking) return answer(text);
    if (text.trim() && history.current.at(-1) !== text.trim()) history.current.push(text.trim());
    const t = parseTyped(text);
    if (t.kind === 'clear') {
      flush();
      setLines([]);
      return;
    }
    append([shown(line(text.trim()), 'cmd')]);
    switch (t.kind) {
      case 'empty':
        return;
      case 'help':
        return append(m.help.map((h) => shown(line(h), 'note')));
      case 'sim':
        return runSim(t.command, t.autoApprove, false);
      case 'version':
        return append([shown(line('Terraform v1.13.4')), shown(line('on linux_amd64'))]);
      case 'state-list': {
        const state = useLearn.getState().sims[slug];
        const addresses = Object.keys(state?.resources ?? {});
        return append(
          addresses.length > 0
            ? addresses.map((a) => shown(line(a)))
            : [
                shown(line('No state file was found!', 'error')),
                shown(line()),
                shown(line('State management commands require a state file. Run this command')),
                shown(line('in a directory where Terraform has been run or use the -state flag')),
                shown(line('to point the command to a specific state location.')),
              ],
        );
      }
      case 'output':
        return append(outputLines().map((l) => shown(l)));
      case 'not-here':
        return append([note(m.notHere(t.sub))]);
      case 'no-such':
        return append(
          [`Terraform has no command named "${t.sub}".`, '', "To see all of Terraform's top-level commands, run:", '  terraform -help'].map((s) => shown(line(s))),
        );
      case 'not-found':
        return append([shown(line(`zsh: command not found: ${t.word}`)), ...(t.guess ? [note(m.didYouMean(t.guess))] : [])]);
    }
  };

  /** the outputs the state holds, as `terraform output` prints them */
  function outputLines(): Line[] {
    const outputs = Object.entries(sim?.outputs ?? {});
    if (outputs.length === 0) {
      return problemLines({
        severity: 'warning',
        summary: 'No outputs found',
        detail: 'The state file either has no outputs defined, or all the defined outputs\nare empty. Please define an output in your configuration with the `output`\nkeyword and run `terraform apply` for it to become available.',
      });
    }
    const { ir } = parseProject(files);
    const secret = new Set(ir.outputs.filter((o) => o.args.sensitive?.kind === 'literal' && o.args.sensitive.value === true).map((o) => o.name));
    return outputs.sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, v]) => outputValueLines(name, decode(v), secret.has(name)));
  }

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && (busy || asking)) {
      // the terminal's own Esc: skip ahead, or say no to the question (Ctrl+C in a real one)
      e.preventDefault();
      if (busy) flush();
      else answer('no');
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !asking) {
      const list = history.current;
      if (list.length === 0) return;
      e.preventDefault();
      let i = browsing.current === -1 ? list.length : browsing.current;
      i = e.key === 'ArrowUp' ? Math.max(0, i - 1) : i + 1;
      browsing.current = i >= list.length ? -1 : i;
      setTyped(i >= list.length ? '' : list[i]);
    }
  };

  /* ------------------------------------------------------------------ resizing */

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    let h = startH;
    const max = () => Math.max(MIN_H, Math.round(window.innerHeight * 0.75));
    const onMove = (ev: PointerEvent) => {
      h = Math.min(max(), Math.max(MIN_H, startH + startY - ev.clientY));
      setPrefs((p) => ({ ...p, height: h }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      savePrefs({ collapsed: false, height: h });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onResizeKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const h = Math.min(Math.round(window.innerHeight * 0.75), Math.max(MIN_H, height + (e.key === 'ArrowUp' ? 24 : -24)));
    savePrefs({ collapsed: false, height: h });
  };

  const resources = Object.entries(sim?.resources ?? {});
  const outputs = Object.entries(sim?.outputs ?? {});
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'terminal', label: m.terminal },
    { id: 'state', label: m.state, count: resources.length },
    { id: 'outputs', label: m.outputs, count: outputs.length },
  ];

  return (
    <section
      aria-label={m.region}
      data-testid="terminal-panel"
      // a container: the header and the prompt row compact themselves in a narrow terminal (code mode, small screens)
      className={cn('@container relative flex min-h-0 flex-col overflow-hidden border-t border-slate-800 bg-[#0b1120] text-[#d5dbe5] [font-variant-ligatures:none] dark:border-slate-700/60', className)}
      style={prefs.collapsed ? undefined : { height }}
    >
      {prefs.collapsed ? null : (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={m.resize}
          aria-valuenow={height}
          aria-valuemin={MIN_H}
          aria-valuemax={Math.max(MIN_H, Math.round(window.innerHeight * 0.75))}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={onResizeKey}
          className="group absolute inset-x-0 top-0 z-10 flex h-2 cursor-row-resize justify-center focus-visible:outline-none"
        >
          <span className="mt-0.5 h-1 w-10 rounded-full bg-slate-600/60 transition-colors group-hover:bg-slate-400 group-focus-visible:bg-cyan-300" />
        </div>
      )}

      {/* header: tabs, the "simulated" notice, clear and collapse */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-[#0f172a] pl-2 pr-1.5 pt-0.5">
        <TerminalSquare className="ml-1 h-4 w-4 shrink-0 text-cyan-300" aria-hidden />
        <div role="tablist" aria-label={m.tabs} className="flex min-w-0 items-center gap-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${ids}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={tab === t.id ? `${ids}-panel-${t.id}` : undefined}
              onClick={() => {
                setTab(t.id);
                if (prefs.collapsed) savePrefs({ ...prefs, collapsed: false });
              }}
              className={cn(
                'relative flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-cyan-300',
                tab === t.id ? 'bg-white/[0.07] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
              )}
            >
              {t.label}
              {t.count ? <span className="rounded-full bg-white/10 px-1.5 text-[10.5px] font-semibold tabular-nums text-slate-300">{t.count}</span> : null}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {/* the whole sentence when there's room, else "Simulated", else the flask alone (the sentence in its tooltip and for screen readers) */}
        <span
          title={m.simulatedLong}
          data-testid="sim-badge"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400/10 px-1.5 py-1 text-[11.5px] font-medium text-amber-200 ring-1 ring-amber-300/25 @lg:px-2.5"
        >
          <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="sr-only @3xl:not-sr-only">{m.simulatedLong}</span>
          <span className="hidden @lg:inline @3xl:hidden" aria-hidden>
            {m.simulated}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            flush();
            setLines([]);
          }}
          aria-label={m.clear}
          title={m.clear}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          <Eraser className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => savePrefs({ ...prefs, collapsed: !prefs.collapsed })}
          aria-label={prefs.collapsed ? m.expand : m.collapse}
          aria-expanded={!prefs.collapsed}
          title={prefs.collapsed ? m.expand : m.collapse}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          {prefs.collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {prefs.collapsed ? null : (
        <>
          <div
            role="tabpanel"
            id={`${ids}-panel-${tab}`}
            aria-labelledby={`${ids}-tab-${tab}`}
            // the views fill it and scroll inside (a percentage height of a flex item's child doesn't hold)
            className="relative min-h-0 flex-1 [&>*]:absolute [&>*]:inset-0"
          >
            {tab === 'terminal' ? (
              <div
                ref={logRef}
                role="log"
                aria-label={m.log}
                aria-live="off"
                tabIndex={0}
                title={busy ? m.skip : undefined}
                onClick={() => busy && flush()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && busy) {
                    e.preventDefault();
                    flush();
                  }
                }}
                className="h-full overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-[1.55] focus-visible:outline-none [scrollbar-color:#334155_transparent]"
              >
                {lines.length === 0 ? <div className="font-sans text-[13px] text-slate-400">{m.welcome}</div> : null}
                {lines.map((l) => (
                  <LineView key={l.key} l={l} />
                ))}
                {busy ? <span aria-hidden className="inline-block h-[1.05em] w-[0.55em] translate-y-[2px] animate-pulse bg-slate-300" /> : null}
              </div>
            ) : tab === 'state' ? (
              <StateView slug={slug} />
            ) : (
              <div className="h-full overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-[1.55]">
                {outputs.length === 0 ? (
                  <p className="font-sans text-[13px] text-slate-400">{m.emptyOutputs}</p>
                ) : (
                  outputLines().map((l, i) => <LineView key={i} l={{ ...l, key: i, kind: 'cli' }} />)
                )}
              </div>
            )}
          </div>

          {/* the prompt and the command buttons */}
          {/* one row down to a narrow terminal (compact buttons, no shortcut hint); wraps only past that */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-t border-white/[0.07] bg-[#0d1424] px-3 py-2 @2xl:gap-x-3">
            <label className="flex min-w-[120px] flex-1 items-center gap-2 font-mono text-[13px] @2xl:min-w-[220px]">
              <span className={cn('select-none font-semibold', asking ? 'text-amber-300' : 'text-cyan-300')} translate="no" lang="en">
                {asking ? 'Enter a value:' : '$'}
              </span>
              <input
                ref={inputRef}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={onInputKey}
                aria-label={asking ? m.waiting : m.input}
                placeholder={asking ? m.approvePlaceholder : m.placeholder}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                className="h-8 min-w-0 flex-1 text-ellipsis bg-transparent text-slate-50 caret-cyan-300 outline-none placeholder:font-sans placeholder:text-[12.5px] placeholder:text-slate-400"
              />
            </label>
            {asking ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => answer('yes')}
                  className="h-7 rounded-md bg-emerald-500 px-3 text-[12.5px] font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                >
                  {m.approve}
                </button>
                <button
                  type="button"
                  onClick={() => answer('no')}
                  className="h-7 rounded-md px-3 text-[12.5px] font-medium text-slate-300 ring-1 ring-white/15 transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-cyan-300"
                >
                  {m.cancel}
                </button>
              </div>
            ) : (
              <div role="group" aria-label={m.commands} className="flex flex-wrap items-center gap-1">
                {SIM_COMMANDS.map((command) => (
                  <button
                    key={command}
                    type="button"
                    onClick={() => runSim(command)}
                    aria-label={m.run(command)}
                    aria-keyshortcuts={command === 'plan' ? ariaShortcut('mod', 'Enter') : undefined}
                    title={`${m.what[command]}${command === 'plan' ? ` (${shortcut('mod', 'Enter')})` : ''}`}
                    data-command={command}
                    className={cn(
                      'flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-300 @2xl:px-2.5',
                      command === 'plan'
                        ? 'bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-300/40 hover:bg-cyan-400/25'
                        : command === 'apply'
                          ? 'text-emerald-300 ring-1 ring-emerald-400/25 hover:bg-emerald-400/10'
                          : command === 'destroy'
                            ? 'text-red-300 ring-1 ring-red-400/25 hover:bg-red-400/10'
                            : 'text-slate-200 ring-1 ring-white/12 hover:bg-white/[0.06]',
                    )}
                  >
                    {command}
                    {command === 'plan' ? (
                      <kbd className="hidden rounded-[4px] bg-black/30 px-1 font-sans text-[10px] font-semibold text-cyan-200/80 @2xl:inline" translate="no">
                        {shortcut('mod', 'Enter')}
                      </kbd>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <p className="sr-only" aria-live="polite" role="status">
        {said}
      </p>
    </section>
  );
}

/** the state the last apply left: each address and its attributes */
function StateView({ slug }: { slug: string }) {
  const m = useMessages(terminalMessages);
  const sim = useLearn((s) => s.sims[slug] ?? null);
  const entries = Object.entries(sim?.resources ?? {});
  if (!sim || entries.length === 0) {
    return <p className="h-full overflow-y-auto px-4 py-3 text-[13px] text-slate-400">{m.emptyState}</p>;
  }
  return (
    <div className="h-full overflow-y-auto px-3 py-2.5">
      <p className="mb-2 px-1 text-[11.5px] text-slate-400">
        {m.resources(entries.length)} · {m.stateVersion(sim.serial)}
      </p>
      <ul className="space-y-1.5">
        {entries.map(([address, attrs]) => (
          <li key={address}>
            <details open={entries.length <= 3} className="group rounded-lg bg-white/[0.03] ring-1 ring-white/[0.07] open:bg-white/[0.045]">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[12.5px] focus-visible:outline-2 focus-visible:outline-cyan-300" translate="no">
                <ChevronDown className="h-3.5 w-3.5 shrink-0 -rotate-90 text-slate-500 transition-transform group-open:rotate-0" aria-hidden />
                <span className="font-semibold text-slate-50">{address}</span>
                <span className="truncate text-slate-400">{attrs.id}</span>
              </summary>
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-0.5 px-3 pb-2.5 pl-9 font-mono text-[11.5px]" translate="no">
                {Object.keys(attrs)
                  .sort()
                  .map((k) => (
                    <div key={k} className="contents">
                      <dt className="text-slate-400">{k}</dt>
                      <dd className="break-all text-slate-200">{attrs[k]}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
