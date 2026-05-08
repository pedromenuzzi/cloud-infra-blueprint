import { type HTMLAttributes } from 'react';

import { cn } from './cn.js';

export type ProviderId = 'aws' | 'azure' | 'gcp' | 'multi';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** Tailwind class hooked to the canonical provider color. */
  textClass: string;
  bgClass: string;
  /** Hex value (canonical brand color from spec). */
  hex: string;
  /** Short monogram rendered inside the chip glyph. */
  abbr: string;
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  aws: {
    id: 'aws',
    label: 'AWS',
    textClass: 'text-provider-aws',
    bgClass: 'bg-provider-aws/15',
    hex: '#FF9900',
    abbr: 'aws',
  },
  azure: {
    id: 'azure',
    label: 'Azure',
    textClass: 'text-provider-azure',
    bgClass: 'bg-provider-azure/15',
    hex: '#0078D4',
    abbr: 'Az',
  },
  gcp: {
    id: 'gcp',
    label: 'GCP',
    textClass: 'text-provider-gcp',
    bgClass: 'bg-provider-gcp/15',
    hex: '#4285F4',
    abbr: 'GCP',
  },
  multi: {
    id: 'multi',
    label: 'Multi-cloud',
    textClass: 'text-provider-multi',
    bgClass: 'bg-provider-multi/15',
    hex: '#7C3AED',
    abbr: 'M+',
  },
};

export interface ProviderIconProps extends HTMLAttributes<HTMLSpanElement> {
  provider: ProviderId;
  /** Edge size in px. Defaults to 16. */
  size?: number;
}

/**
 * Provider glyph rendered as a colored monogram chip — a deliberately small,
 * brand-neutral mark that doesn't infringe on official cloud provider logos.
 *
 * Previous implementation tried to draw stylized 16x16 SVG monograms but at
 * tab/filter sizes (12–14px) they degenerated into illegible blobs. Letters
 * stay readable down to 10px and ship with the canonical brand hue.
 */
export function ProviderIcon({ provider, size = 16, className, ...rest }: ProviderIconProps) {
  const meta = PROVIDERS[provider];
  const fontSize = Math.max(7, Math.round(size * 0.5));
  return (
    <span
      role="img"
      aria-label={meta.label}
      style={{
        width: size,
        height: size,
        fontSize,
        backgroundColor: meta.hex,
      }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[4px] font-bold leading-none text-white',
        className,
      )}
      {...rest}
    >
      {meta.abbr}
    </span>
  );
}
