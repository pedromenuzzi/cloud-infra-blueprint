import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from './cn.js';

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** Display name used to derive initials and the alt text. */
  name: string;
  /** Optional image URL. If absent or fails to load, initials are shown. */
  src?: string;
  /** Diameter, in px. Defaults to 28 (matches collaborator pills in image 01). */
  size?: number;
  /** Show a colored ring (used for "online" / focused collaborator). */
  ring?: 'success' | 'primary' | 'warning' | 'none';
}

/**
 * Lightweight avatar with deterministic color from the name. Renders an `<img>`
 * if `src` is provided, otherwise a colored circle with initials. No external
 * deps; falls back gracefully if the image fails to load.
 */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  ({ name, src, size = 28, ring = 'none', className, ...props }, ref) => {
    const initials = getInitials(name);
    const hue = nameToHue(name);
    const ringClass =
      ring === 'success'
        ? 'ring-2 ring-success ring-offset-2 ring-offset-background'
        : ring === 'primary'
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
          : ring === 'warning'
            ? 'ring-2 ring-warning ring-offset-2 ring-offset-background'
            : '';
    return (
      <span
        ref={ref}
        role="img"
        title={name}
        aria-label={name}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(10, Math.round(size * 0.38)),
          backgroundColor: src ? 'transparent' : `hsl(${hue}, 65%, 50%)`,
        }}
        className={cn(
          'relative inline-flex select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white',
          ringClass,
          className,
        )}
        {...props}
      >
        {src ? (
          <img
            src={src}
            alt={name}
            width={size}
            height={size}
            className="h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <span aria-hidden>{initials}</span>
        )}
      </span>
    );
  },
);
Avatar.displayName = 'Avatar';

export interface AvatarGroupProps extends HTMLAttributes<HTMLDivElement> {
  max?: number;
}

/**
 * Stack of avatars with overlap, like the collaborator pile in the editor topbar.
 * Children should be `<Avatar />` instances.
 */
export const AvatarGroup = forwardRef<HTMLDivElement, AvatarGroupProps>(
  ({ max = 3, className, children, ...props }, ref) => {
    const items = Array.isArray(children) ? children : [children];
    const visible = items.slice(0, max);
    const overflow = items.length - visible.length;
    return (
      <div ref={ref} className={cn('flex items-center -space-x-2', className)} {...props}>
        {visible.map((child, index) => (
          <span
            key={index}
            className="ring-background rounded-full ring-2"
            style={{ zIndex: visible.length - index }}
          >
            {child}
          </span>
        ))}
        {overflow > 0 && (
          <span
            role="img"
            className="ring-background ring-2"
            style={{ zIndex: 0 }}
            aria-label={`${overflow} more`}
          >
            <span
              aria-hidden
              className="bg-muted text-muted-foreground relative inline-flex select-none items-center justify-center overflow-hidden rounded-full text-xs font-semibold"
              style={{ width: 28, height: 28 }}
            >
              +{overflow}
            </span>
          </span>
        )}
      </div>
    );
  },
);
AvatarGroup.displayName = 'AvatarGroup';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function nameToHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}
