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

/** Read-only highlighted HCL block. */
export function HclSnippet({
  code,
  showLineNumbers = true,
  className,
}: {
  code: string;
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
        <div key={i} className="flex whitespace-pre rounded-[3px] px-1">
          {showLineNumbers ? (
            <span className="mr-3 w-6 shrink-0 select-none text-right text-[10.5px] leading-[1.85] text-faint">
              {i + 1}
            </span>
          ) : null}
          <span className="min-w-0 flex-1">{hlLine(line, i)}</span>
        </div>
      ))}
    </pre>
  );
}
