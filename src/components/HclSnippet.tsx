import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Tiny static HCL highlighter (comments / strings / keywords). */
export function hlLine(line: string, key: number): ReactNode {
  if (/^\s*#/.test(line) || /^\s*\/\//.test(line)) {
    return (
      <span key={key} className="text-faint italic">
        {line}
      </span>
    );
  }
  const parts: ReactNode[] = [];
  const re =
    /("(?:[^"\\]|\\.)*")|\b(resource|variable|output|provider|terraform|module|data|locals)\b|\b(true|false|null)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    if (m[1]) {
      parts.push(
        <span key={k++} className="text-success">
          {m[1]}
        </span>,
      );
    } else if (m[2]) {
      parts.push(
        <span key={k++} className="text-primary">
          {m[2]}
        </span>,
      );
    } else {
      parts.push(
        <span key={k++} className="text-warning">
          {m[3]}
        </span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return <span key={key}>{parts}</span>;
}

/**
 * Read-only highlighted HCL block. `addedLines` (1-based) get a green tint —
 * used by tutorials to show what each step introduces.
 */
export function HclSnippet({
  code,
  addedLines,
  showLineNumbers = true,
  className,
}: {
  code: string;
  addedLines?: Set<number>;
  showLineNumbers?: boolean;
  className?: string;
}) {
  const lines = code.replace(/\n$/, '').split('\n');
  return (
    <pre
      className={cn(
        'overflow-auto rounded-sm bg-surface-1 p-3 font-mono text-[12px] leading-[1.7] text-muted',
        className,
      )}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            'flex whitespace-pre rounded-[3px] px-1',
            addedLines?.has(i + 1) && 'bg-success/12',
          )}
        >
          {showLineNumbers ? (
            <span className="mr-3 w-6 shrink-0 select-none text-right text-[10.5px] leading-[1.85] text-faint/70">
              {i + 1}
            </span>
          ) : null}
          <span className="min-w-0 flex-1">{hlLine(line, i)}</span>
          {addedLines?.has(i + 1) ? (
            <span className="ml-2 select-none self-center rounded-[3px] bg-success/20 px-1 text-[8.5px] font-bold uppercase text-success">
              new
            </span>
          ) : null}
        </div>
      ))}
    </pre>
  );
}

/** 1-based line numbers present in `current` but not in `previous` (multiset diff). */
export function diffAddedLines(previous: string | undefined, current: string): Set<number> {
  const added = new Set<number>();
  if (previous === undefined) return added;
  const budget = new Map<string, number>();
  for (const line of previous.replace(/\n$/, '').split('\n')) {
    const key = line.trim();
    budget.set(key, (budget.get(key) ?? 0) + 1);
  }
  current
    .replace(/\n$/, '')
    .split('\n')
    .forEach((line, i) => {
      const key = line.trim();
      const left = budget.get(key) ?? 0;
      if (left > 0) budget.set(key, left - 1);
      else if (key !== '') added.add(i + 1);
    });
  return added;
}
