/**
 * A repeated resource on the canvas: one node drawn as a stack of cards,
 * with a badge saying how many ("×3", "×0–1", "×?", "for_each: var.azs").
 */
import { Layers } from 'lucide-react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { RepeatLabel } from './repeatLabel';

/** the badge; `inline` sits in a container's header row, else it rides the node's top edge */
export function RepeatBadge({ repeat, inline = false }: { repeat: RepeatLabel; inline?: boolean }) {
  return (
    <span
      title={repeat.title}
      data-testid="repeat-badge"
      className={cn(
        'inline-flex max-w-[150px] shrink-0 items-center gap-1 rounded-full border bg-node px-1.5 py-px font-mono text-[10px] font-bold leading-tight text-(--cat-text) shadow-xs',
        !inline && 'absolute -top-2.5 left-3',
      )}
      style={{ borderColor: 'color-mix(in srgb, var(--cat) 45%, transparent)' }}
    >
      <Layers className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      <span className="truncate" translate="no">
        {repeat.text}
      </span>
    </span>
  );
}

/**
 * The cards behind a repeated node. Siblings painted before the node, so
 * they stay behind it whatever it does (hover lift, selection ring).
 * Containers are translucent: only the right and bottom edges peek out.
 */
export function RepeatStack({ container = false, dim = false, vars }: { container?: boolean; dim?: boolean; vars?: CSSProperties }) {
  const layer = (offset: number, opacity: number) => (
    <span
      key={offset}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0',
        container
          ? 'rounded-[16px] border-r-[1.5px] border-b-[1.5px] border-dashed'
          : 'rounded-[12px] border border-node-border bg-node shadow-xs',
        dim && 'bp-dim',
      )}
      style={{
        ...vars,
        transform: `translate(${offset}px, ${offset}px)`,
        opacity,
        ...(container ? { borderColor: 'color-mix(in srgb, var(--cat) 45%, transparent)' } : {}),
      }}
    />
  );
  return (
    <>
      {layer(container ? 12 : 10, 0.55)}
      {layer(container ? 6 : 5, 0.85)}
    </>
  );
}
