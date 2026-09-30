/**
 * Small flags drawn as SVG: flag emoji don't render on Windows (they show
 * as the letters "BR" / "US"), so the language picker can't rely on them.
 * Simplified for 14–20 px; decorative (the language name is the label).
 */
import { cn } from '@/lib/utils';

type FlagProps = { className?: string };

const frame = 'inline-block shrink-0 overflow-hidden rounded-[2px] ring-1 ring-black/15 dark:ring-white/20';
/** sized from the font size, inline so an icon slot's square h-/w- classes can't squash it */
const size = { width: '1.35em', height: '0.95em' } as const;

export function BrazilFlag({ className }: FlagProps) {
  return (
    <svg viewBox="0 0 20 14" aria-hidden="true" focusable="false" className={cn(frame, className)} style={size} preserveAspectRatio="none">
      <rect width="20" height="14" fill="#009c3b" />
      <path d="M10 1.6 18.2 7 10 12.4 1.8 7Z" fill="#ffdf00" />
      <circle cx="10" cy="7" r="3.1" fill="#002776" />
      <path d="M7.05 6.2a6.4 6.4 0 0 1 5.9 1.55" stroke="#fff" strokeWidth="0.55" fill="none" />
    </svg>
  );
}

export function UsFlag({ className }: FlagProps) {
  return (
    <svg viewBox="0 0 19 13" aria-hidden="true" focusable="false" className={cn(frame, className)} style={size} preserveAspectRatio="none">
      <rect width="19" height="13" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((y) => (
        <rect key={y} y={y} width="19" height="1" fill="#b22234" />
      ))}
      <rect width="7.6" height="7" fill="#3c3b6e" />
      {[1.2, 3.8, 6.4].flatMap((x) =>
        [1.3, 3.5, 5.7].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.45" fill="#fff" />),
      )}
    </svg>
  );
}
