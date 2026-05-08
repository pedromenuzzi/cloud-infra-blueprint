import { cn } from '@blueprint/ui';
import { Maximize2, Minus, Plus } from 'lucide-react';

interface CanvasPaneProps {
  className?: string;
}

/**
 * Canvas placeholder for F1. Displays:
 *
 * - dotted grid background (matches image 01),
 * - a sample VPC subflow with EC2/RDS/S3 mock nodes,
 * - resource counter pill at top,
 * - zoom + fit controls at bottom-left,
 * - minimap mock at bottom-right.
 *
 * F2 will swap this whole component with React Flow + dagre layout, but the
 * surrounding chrome (counter, controls, minimap) stays.
 */
export function CanvasPane({ className }: CanvasPaneProps) {
  return (
    <section
      className={cn('bg-grid-dots relative isolate overflow-hidden bg-surface-1', className)}
      aria-label="Canvas"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData('application/blueprint-resource');
        if (type) {
          // F2 will dispatch an apply([{ kind: 'add_resource', node: ... }]) here.
          console.info('drop', type);
        }
      }}
    >
      {/* Resource counter (top center) */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-border bg-card/95 px-3 py-1 text-xs font-medium shadow-sm backdrop-blur">
        12 resources, 8 connections
      </div>

      {/* Mock canvas content */}
      <MockCanvasContent />

      {/* Zoom controls */}
      <div className="absolute bottom-3 left-3 flex flex-col items-center rounded-md border border-border bg-card shadow-sm">
        <ControlButton aria-label="Zoom in">
          <Plus className="h-3.5 w-3.5" />
        </ControlButton>
        <span className="h-px w-full bg-border" />
        <ControlButton aria-label="Zoom out">
          <Minus className="h-3.5 w-3.5" />
        </ControlButton>
        <span className="h-px w-full bg-border" />
        <ControlButton aria-label="Fit to screen">
          <Maximize2 className="h-3.5 w-3.5" />
        </ControlButton>
      </div>
      <span className="absolute bottom-[5.5rem] left-3 text-[10px] font-medium text-muted-foreground">
        fit
      </span>

      {/* Minimap */}
      <div className="absolute bottom-3 right-3 h-20 w-32 overflow-hidden rounded-md border border-border bg-card/95 shadow-sm backdrop-blur">
        <MockMinimap />
      </div>
    </section>
  );
}

function ControlButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="focus-ring flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      {...props}
    >
      {children}
    </button>
  );
}

function MockCanvasContent() {
  return (
    <div className="relative h-full w-full">
      {/* ALB at top */}
      <CanvasNode
        label="ALB"
        sub="ALB"
        provider="aws"
        className="absolute left-1/2 top-12 -translate-x-1/2"
      />

      {/* S3 to the right */}
      <CanvasNode label="S3" sub="" provider="aws" className="absolute right-24 top-16" compact />

      {/* VPC subflow */}
      <div className="absolute left-1/2 top-44 h-[260px] w-[480px] -translate-x-1/2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-4">
        <span className="absolute -top-3 left-4 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-background px-2 py-0.5 text-[11px] font-semibold text-primary">
          <span className="text-foreground">VPC:</span> production-vpc
        </span>

        {/* Public Subnet A */}
        <SubnetGroup label="Public Subnet A" className="absolute left-4 top-9 h-44 w-52">
          <CanvasNode
            label="EC2"
            sub="web-server"
            tag="t3.medium"
            provider="aws"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          />
        </SubnetGroup>

        {/* Public Subnet B */}
        <SubnetGroup label="Public Subnet B" className="absolute right-4 top-9 h-44 w-52">
          <CanvasNode
            label="RDS"
            sub="main-db"
            tag="PostgreSQL 15"
            provider="aws"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          />
        </SubnetGroup>

        {/* Security group between them */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] font-semibold text-[hsl(var(--warning-foreground))] shadow-sm dark:text-warning">
          <span className="block text-center">
            Security
            <br />
            Group
          </span>
        </div>
      </div>

      {/* Connections (svg overlay) */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill="hsl(var(--primary))" />
          </marker>
        </defs>
        <g stroke="hsl(var(--primary))" strokeWidth="1.5" fill="none">
          {/* SVG <path d=...> doesn't accept %, but <line> does — use it for the
              decorative ALB → VPC connector. */}
          <line x1="50%" y1="80" x2="50%" y2="200" markerEnd="url(#arrow)" />
        </g>
      </svg>
    </div>
  );
}

function SubnetGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-lg border border-success/40 bg-success/5 p-2', className)}>
      <span className="inline-flex items-center gap-1 rounded-sm border border-success/30 bg-background px-1.5 py-0.5 text-[10px] font-semibold text-success">
        {label}
      </span>
      {children}
    </div>
  );
}

interface CanvasNodeProps {
  label: string;
  sub: string;
  tag?: string;
  provider: 'aws' | 'azure' | 'gcp';
  className?: string;
  compact?: boolean;
}

function CanvasNode({ label, sub, tag, provider, className, compact = false }: CanvasNodeProps) {
  const tone =
    provider === 'aws'
      ? 'bg-provider-aws'
      : provider === 'azure'
        ? 'bg-provider-azure'
        : 'bg-provider-gcp';
  if (compact) {
    return (
      <div
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-md border border-border bg-card shadow-sm',
          className,
        )}
      >
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded text-[10px] font-bold text-white',
            tone,
          )}
        >
          {label}
        </span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'group flex h-14 w-44 items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 shadow-sm transition-shadow hover:shadow-md',
        className,
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded text-xs font-bold text-white',
          tone,
        )}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold leading-tight">{sub || label}</p>
        {tag && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{tag}</p>}
      </div>
    </div>
  );
}

function MockMinimap() {
  return (
    <svg viewBox="0 0 128 80" className="h-full w-full">
      <rect width="128" height="80" fill="hsl(var(--surface-1))" />
      <rect
        x="20"
        y="14"
        width="88"
        height="48"
        rx="4"
        fill="hsl(var(--primary)/0.12)"
        stroke="hsl(var(--primary)/0.3)"
        strokeDasharray="2 2"
      />
      <rect x="32" y="26" width="20" height="14" rx="2" fill="hsl(var(--provider-aws))" />
      <rect x="78" y="26" width="20" height="14" rx="2" fill="hsl(var(--provider-aws))" />
      <rect x="56" y="46" width="16" height="10" rx="2" fill="hsl(var(--provider-aws))" />
      <rect
        x="6"
        y="6"
        width="50"
        height="32"
        rx="2"
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeOpacity="0.4"
      />
    </svg>
  );
}
