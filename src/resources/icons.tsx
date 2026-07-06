import type { Provider } from '@/ir/types';
import { cn } from '@/lib/utils';
import type { Category } from './types';

export const PROVIDER_COLORS: Record<Provider, string> = {
  aws: '#FF9900',
  azure: '#0078D4',
  gcp: '#4285F4',
  other: '#64748B',
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
  other: 'Other',
};

const GLYPHS: Record<Category, React.ReactNode> = {
  compute: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8M8 12.5h5" />
      <path d="M9 19v2M15 19v2M9 3v2M15 3v2" />
    </>
  ),
  storage: (
    <>
      <path d="M5 6.5 L19 6.5 L17.5 19 A2 2 0 0 1 15.5 20.5 L8.5 20.5 A2 2 0 0 1 6.5 19 Z" />
      <ellipse cx="12" cy="6.5" rx="7" ry="2.6" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="5.5" r="2.4" />
      <circle cx="5.5" cy="17.5" r="2.4" />
      <circle cx="18.5" cy="17.5" r="2.4" />
      <path d="M10.8 7.6 L6.8 15.4M13.2 7.6 L17.2 15.4M7.9 17.5h8.2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.8" rx="7" ry="2.8" />
      <path d="M5 5.8v12.4c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V5.8" />
      <path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
    </>
  ),
  containers: (
    <>
      <path d="M12 3 L20 7.2 V16.8 L12 21 L4 16.8 V7.2 Z" />
      <path d="M4 7.2 L12 11.4 L20 7.2M12 11.4V21" />
    </>
  ),
  identity: (
    <>
      <path d="M12 3 L19 6v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6Z" />
      <circle cx="12" cy="10" r="2.2" />
      <path d="M8.8 15.6c.6-1.7 1.8-2.6 3.2-2.6s2.6.9 3.2 2.6" />
    </>
  ),
  edge: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.6 2.3 4 5.2 4 8.5s-1.4 6.2-4 8.5c-2.6-2.3-4-5.2-4-8.5s1.4-6.2 4-8.5Z" />
    </>
  ),
};

export function CategoryGlyph({
  category,
  className,
  strokeWidth = 1.7,
}: {
  category: Category;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {GLYPHS[category]}
    </svg>
  );
}

/** Provider-tinted icon square used on canvas nodes, palette and inspector. */
export function ResourceIcon({
  category,
  provider,
  size = 32,
  className,
}: {
  category: Category;
  provider: Provider;
  size?: number;
  className?: string;
}) {
  const color = PROVIDER_COLORS[provider];
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-[7px]', className)}
      style={{
        width: size,
        height: size,
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      <CategoryGlyph category={category} className="h-[62%] w-[62%]" />
    </span>
  );
}

/** Small provider mark (colored square with initial) used in tabs and badges. */
export function ProviderDot({ provider, size = 10 }: { provider: Provider; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block rounded-[3px]"
      style={{ width: size, height: size, background: PROVIDER_COLORS[provider] }}
    />
  );
}
