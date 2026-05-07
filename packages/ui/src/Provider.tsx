import { type SVGAttributes } from 'react';

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
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  aws: {
    id: 'aws',
    label: 'AWS',
    textClass: 'text-provider-aws',
    bgClass: 'bg-provider-aws/15',
    hex: '#FF9900',
  },
  azure: {
    id: 'azure',
    label: 'Azure',
    textClass: 'text-provider-azure',
    bgClass: 'bg-provider-azure/15',
    hex: '#0078D4',
  },
  gcp: {
    id: 'gcp',
    label: 'GCP',
    textClass: 'text-provider-gcp',
    bgClass: 'bg-provider-gcp/15',
    hex: '#4285F4',
  },
  multi: {
    id: 'multi',
    label: 'Multi-cloud',
    textClass: 'text-provider-multi',
    bgClass: 'bg-provider-multi/15',
    hex: '#7C3AED',
  },
};

export interface ProviderIconProps extends SVGAttributes<SVGSVGElement> {
  provider: ProviderId;
  /** Edge size in px. Defaults to 14. */
  size?: number;
}

/**
 * Tiny logical glyph per provider — a stylized monogram that doesn't infringe
 * on official cloud provider brand assets. Rendered in the canonical brand
 * hue from the design system.
 */
export function ProviderIcon({ provider, size = 14, className, ...rest }: ProviderIconProps) {
  const meta = PROVIDERS[provider];
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('shrink-0', meta.textClass, className)}
      {...rest}
    >
      {provider === 'aws' && (
        <>
          <path
            d="M2 9.5c2 1.5 4 2 6 2s4-.5 6-2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="5" cy="6" r="1.6" fill="currentColor" />
          <circle cx="11" cy="6" r="1.6" fill="currentColor" />
        </>
      )}
      {provider === 'azure' && (
        <path d="M7 2 L1.5 13 H6 L9 7.5 L11 13 H14.5 L9 2 Z" fill="currentColor" />
      )}
      {provider === 'gcp' && (
        <>
          <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path
            d="M8 3 V8 L11.5 11.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
        </>
      )}
      {provider === 'multi' && (
        <>
          <circle cx="6" cy="9" r="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
          <circle cx="10" cy="9" r="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
          <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </>
      )}
    </svg>
  );
}
