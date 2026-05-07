import { type ProviderId } from '@blueprint/ui';

interface ProjectThumbnailProps {
  provider: ProviderId;
}

/**
 * Tiny vector "preview" of an architecture diagram, used as the thumbnail on
 * project cards (image 03). Pure SVG so it stays sharp at every density and
 * weighs almost nothing.
 */
export function ProjectThumbnail({ provider }: ProjectThumbnailProps) {
  const fill =
    provider === 'aws'
      ? 'hsl(var(--provider-aws))'
      : provider === 'azure'
        ? 'hsl(var(--provider-azure))'
        : provider === 'gcp'
          ? 'hsl(var(--provider-gcp))'
          : 'hsl(var(--provider-multi))';

  return (
    <svg
      viewBox="0 0 200 100"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      className="block"
      aria-hidden
    >
      <defs>
        <pattern id={`grid-${provider}`} width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.6" fill="hsl(var(--border))" />
        </pattern>
      </defs>
      <rect width="200" height="100" fill={`url(#grid-${provider})`} />
      {/* dashed VPC subflow */}
      <rect
        x="20"
        y="22"
        width="160"
        height="56"
        rx="8"
        fill="hsl(var(--primary)/0.05)"
        stroke="hsl(var(--primary)/0.45)"
        strokeWidth="1.4"
        strokeDasharray="4 3"
      />
      {/* nodes */}
      <g>
        <rect x="36" y="38" width="34" height="22" rx="4" fill={fill} />
        <rect x="86" y="38" width="34" height="22" rx="4" fill={fill} fillOpacity="0.85" />
        <rect x="136" y="38" width="34" height="22" rx="4" fill={fill} fillOpacity="0.7" />
      </g>
      {/* connections */}
      <line x1="70" y1="49" x2="86" y2="49" stroke="hsl(var(--primary))" strokeWidth="1.2" />
      <line x1="120" y1="49" x2="136" y2="49" stroke="hsl(var(--primary))" strokeWidth="1.2" />
    </svg>
  );
}
