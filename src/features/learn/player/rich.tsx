import { Fragment, type ReactNode } from 'react';

/**
 * Lesson prose (body, asides, goals, hints): `backticks` are inline code and
 * *stars* emphasis; inside code, stars are just stars. An unpaired star stays
 * as written.
 */
export function rich(text: string): ReactNode {
  return text.split('`').map((segment, i) => {
    if (i % 2 === 1) {
      return (
        <code key={i} className="rounded-[4px] bg-surface-2 px-1 py-px font-mono text-[0.88em] text-primary">
          {segment}
        </code>
      );
    }
    const parts = segment.split('*');
    if (parts.length % 2 === 0) return <Fragment key={i}>{segment}</Fragment>;
    return parts.map((part, j) =>
      j % 2 === 1 ? (
        <em key={`${i}.${j}`} className="font-semibold not-italic text-foreground">
          {part}
        </em>
      ) : (
        <Fragment key={`${i}.${j}`}>{part}</Fragment>
      ),
    );
  });
}

/** the same text without its marks, for announcements and titles */
export const plain = (text: string): string => text.replace(/[`*]/g, '');
