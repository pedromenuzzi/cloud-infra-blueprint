import { Badge, ProviderIcon } from '@blueprint/ui';
import { CheckCircle2 } from 'lucide-react';

/**
 * Product mockup shown on the landing hero. Pure CSS/SVG — no real Monaco or
 * React Flow — so it stays light enough to render before any heavy chunk
 * loads. Mirrors image 05 of the spec: browser chrome, blue-tinted canvas
 * with a few resource nodes on the left, syntax-highlighted Terraform on the
 * right, "Saved" badge on top-left of the canvas, "Live sync" pill in the
 * middle, and an AWS chip on the bottom-right.
 */
export function ProductMockup() {
  return (
    <div className="mx-auto max-w-5xl rounded-2xl border border-border/60 bg-card shadow-lg">
      {/* macOS-style browser chrome */}
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
          <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
          <span className="h-3 w-3 rounded-full bg-[#28C840]" />
        </div>
        <div className="mx-auto flex max-w-md flex-1 items-center justify-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-success" />
          cloud-blueprint.dev/editor
        </div>
        <div className="w-12" />
      </div>

      {/* App body */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr]">
        {/* Canvas side */}
        <div className="bg-grid-dots relative h-[340px] overflow-hidden rounded-bl-2xl bg-surface-1 dark:bg-surface-1">
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
            <CheckCircle2 className="h-3 w-3" /> Saved
          </span>

          {/* VPC subflow */}
          <div className="absolute left-12 top-16 h-44 w-64 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-3">
            <div className="absolute -top-2.5 left-3 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-background px-2 py-0.5 text-[10px] font-semibold text-primary">
              <span aria-hidden>VPC</span>
              <span className="text-muted-foreground">production-web</span>
            </div>
            <MockNode label="EC2" sub="web-server" tone="aws" className="absolute left-3 top-7" />
            <MockNode label="RDS" sub="main-db" tone="aws" className="absolute right-3 top-7" />
            <MockNode
              label="S3"
              sub="assets"
              tone="aws"
              className="absolute bottom-3 left-1/2 -translate-x-1/2"
            />
          </div>

          {/* Live sync pill */}
          <span className="pointer-events-none absolute right-6 top-1/2 z-10 -translate-y-1/2 translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground shadow-md">
            ⇄ Live sync
          </span>

          {/* AWS chip */}
          <div className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold">
            <ProviderIcon provider="aws" size={12} /> AWS
          </div>
        </div>

        {/* Code side */}
        <div className="relative h-[340px] overflow-hidden rounded-br-2xl border-l border-border/60 bg-card">
          <div className="flex h-8 items-center gap-1 border-b border-border/60 bg-surface-1 px-2 text-[11px] font-medium text-muted-foreground">
            <span className="rounded bg-card px-2 py-0.5 text-foreground shadow-xs">main.tf</span>
            <span className="px-2 py-0.5">variables.tf</span>
            <span className="px-2 py-0.5">outputs.tf</span>
          </div>
          <pre className="h-[calc(100%-2rem)] overflow-hidden p-4 text-[11px] leading-relaxed">
            <code className="font-mono">
              <span className="text-muted-foreground">
                # Terraform · auto-generated from canvas
              </span>
              {'\n'}
              <span className="text-primary">resource</span>{' '}
              <span className="text-success">{'"aws_vpc"'}</span>{' '}
              <span className="text-success">{'"main"'}</span> {'{'}
              {'\n  '}cidr_block = <span className="text-warning">{'"10.0.0.0/16"'}</span>
              {'\n  '}tags = {'{'} Name = <span className="text-warning">{'"production-web"'}</span>{' '}
              {'}'}
              {'\n}'}
              {'\n\n'}
              <span className="text-primary">resource</span>{' '}
              <span className="text-success">{'"aws_instance"'}</span>{' '}
              <span className="text-success">{'"web"'}</span> {'{'}
              {'\n  '}ami = <span className="text-warning">{'"ami-0abc1234"'}</span>
              {'\n  '}instance_type = <span className="text-warning">{'"t3.medium"'}</span>
              {'\n  '}subnet_id = aws_subnet.public.id
              {'\n}'}
              {'\n\n'}
              <span className="text-primary">resource</span>{' '}
              <span className="text-success">{'"aws_db_instance"'}</span>{' '}
              <span className="text-success">{'"main"'}</span> {'{'}
              {'\n  '}engine = <span className="text-warning">{'"postgres"'}</span>
              {'\n  '}instance_class = <span className="text-warning">{'"db.t3.medium"'}</span>
              {'\n}'}
            </code>
          </pre>
          <Badge variant="aws" className="absolute bottom-3 right-3">
            aws
          </Badge>
        </div>
      </div>
    </div>
  );
}

function MockNode({
  label,
  sub,
  tone,
  className = '',
}: {
  label: string;
  sub: string;
  tone: 'aws' | 'azure' | 'gcp';
  className?: string;
}) {
  return (
    <div
      className={`flex h-12 w-24 items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 shadow-xs ${className}`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white ${
          tone === 'aws'
            ? 'bg-provider-aws'
            : tone === 'azure'
              ? 'bg-provider-azure'
              : 'bg-provider-gcp'
        }`}
      >
        {label}
      </span>
      <span className="min-w-0 truncate text-[10px] font-medium leading-tight">{sub}</span>
    </div>
  );
}
