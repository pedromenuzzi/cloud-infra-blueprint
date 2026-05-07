import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './cn.js';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * Form input matching the design system spec (image 06): 36px tall (h-9),
 * 8px corner radius, single-pixel border, focus ring uses the primary color.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1.5 text-sm',
        'shadow-xs transition-colors',
        'placeholder:text-muted-foreground',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'focus-visible:ring-ring focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
