/** The module glyph on its tile (the canvas node, the inspector, the palette, ⌘K, the dialog). Light: no React Flow here. */
import { Boxes } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ModuleIcon({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('bp-module-icon relative flex shrink-0 items-center justify-center text-white', className)}
      style={{ width: size, height: size, borderRadius: Math.max(5, Math.round(size * 0.26)) }}
    >
      <Boxes className="h-[58%] w-[58%]" strokeWidth={size < 24 ? 2.2 : 1.9} />
    </span>
  );
}
