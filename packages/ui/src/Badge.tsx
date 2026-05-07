import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from './cn.js';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-semibold leading-none transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        success: 'border-transparent bg-success/15 text-success',
        warning:
          'border-transparent bg-warning/15 text-[hsl(var(--warning-foreground))] dark:text-warning',
        danger: 'border-transparent bg-danger/15 text-danger',
        aws: 'border-transparent bg-provider-aws/15 text-provider-aws',
        azure: 'border-transparent bg-provider-azure/15 text-provider-azure',
        gcp: 'border-transparent bg-provider-gcp/15 text-provider-gcp',
        multi: 'border-transparent bg-provider-multi/15 text-provider-multi',
      },
      size: {
        sm: 'h-5 px-1.5 text-[10px]',
        md: 'h-6 px-2 text-xs',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { badgeVariants };
