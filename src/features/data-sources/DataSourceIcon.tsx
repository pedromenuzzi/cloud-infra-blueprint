/** The data source glyph on its tile (the canvas node, the inspector, the palette, ⌘K). Light: no React Flow here. */
import { ScanSearch } from 'lucide-react';
import { cn } from '@/lib/utils';

/** the tile's colors: a cyan that reads as "looked up", apart from every resource category */
export const DATA_TILE = { from: '#22d3ee', to: '#0e7490', solid: '#0891b2' } as const;

export function DataSourceIcon({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('relative flex shrink-0 items-center justify-center text-white', className)}
      // inline like ResourceIcon's tile: the PDF export reads the glyph from a gradient tile
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(5, Math.round(size * 0.26)),
        background: `linear-gradient(145deg, ${DATA_TILE.from}, ${DATA_TILE.to})`,
        boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.28), 0 1px 2px rgb(15 23 42 / 0.18), 0 2px 8px -2px color-mix(in srgb, ${DATA_TILE.solid} 55%, transparent)`,
      }}
    >
      <ScanSearch className="h-[58%] w-[58%]" strokeWidth={size < 24 ? 2.2 : 1.9} />
    </span>
  );
}
