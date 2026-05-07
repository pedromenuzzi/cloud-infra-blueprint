import { forwardRef, type SVGAttributes } from 'react';

import { cn } from './cn.js';

export interface LogoMarkProps extends SVGAttributes<SVGSVGElement> {
  /** Edge size in px. Defaults to 24 (matches the spec's lockup). */
  size?: number;
}

/**
 * Cloud Blueprint isometric cube mark. Flat geometric shape with three
 * differently shaded faces, matching the dark blue cube in image 06.
 *
 * Uses currentColor on the dark front face so callers can recolor the mark
 * (`text-foreground`, `text-primary`, etc.) without touching the SVG.
 */
export const LogoMark = forwardRef<SVGSVGElement, LogoMarkProps>(
  ({ size = 24, className, ...props }, ref) => (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      {...props}
    >
      {/* Top face — primary blue */}
      <path d="M16 3 L29 10 L16 17 L3 10 Z" fill="hsl(var(--primary))" />
      {/* Right face — primary-hover (darker) */}
      <path d="M29 10 L29 23 L16 30 L16 17 Z" fill="hsl(var(--primary-hover))" />
      {/* Left face — deep navy */}
      <path d="M3 10 L3 23 L16 30 L16 17 Z" fill="#0B1220" className="dark:fill-[#020617]" />
      {/* Subtle highlight edge on top */}
      <path d="M16 3 L29 10 L16 17 Z" fill="white" fillOpacity="0.08" />
    </svg>
  ),
);
LogoMark.displayName = 'LogoMark';

export interface LogoLockupProps {
  /** Variant of the lockup. `full` renders mark + wordmark, `mark` is icon-only. */
  variant?: 'full' | 'mark';
  /** Size token. Maps to typography scale. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP: Record<NonNullable<LogoLockupProps['size']>, { mark: number; text: string }> = {
  sm: { mark: 20, text: 'text-sm font-semibold tracking-tight' },
  md: { mark: 24, text: 'text-base font-semibold tracking-tight' },
  lg: { mark: 32, text: 'text-xl font-semibold tracking-tight' },
};

/**
 * Full Cloud Blueprint lockup: mark + wordmark, ready to drop in a header.
 * Wordmark is text-based (Inter) so it always matches the user's theme.
 */
export function LogoLockup({ variant = 'full', size = 'md', className }: LogoLockupProps) {
  const cfg = SIZE_MAP[size];
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark size={cfg.mark} />
      {variant === 'full' && <span className={cfg.text}>Cloud Blueprint</span>}
    </span>
  );
}
