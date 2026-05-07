import { Badge, Button, Input, Modal, cn, type ProviderId } from '@blueprint/ui';
import { ArrowRight, CloudOff, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useTemplates, type TemplateMeta } from '@/lib/useTemplates';

interface TemplatesGalleryProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user picks a template (slug matches the template's id). */
  onPick?: (slug: string) => void;
  /** Called when the user clicks "Or start from scratch". */
  onStartScratch?: () => void;
}

type Filter = 'all' | ProviderId | Tag;
type Tag = 'web-apps' | 'data' | 'containers' | 'static-sites';

const PILLS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'aws', label: 'AWS' },
  { id: 'azure', label: 'Azure' },
  { id: 'gcp', label: 'GCP' },
  { id: 'multi', label: 'Multi-cloud' },
  { id: 'web-apps', label: 'Web Apps' },
  { id: 'data', label: 'Data' },
  { id: 'containers', label: 'Containers' },
  { id: 'static-sites', label: 'Static Sites' },
];

export function TemplatesGallery({ open, onClose, onPick, onStartScratch }: TemplatesGalleryProps) {
  const { templates, loading, offline } = useTemplates();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (search && !`${t.name} ${t.description}`.toLowerCase().includes(search.toLowerCase()))
        return false;
      const provider = adaptProvider(t.provider);
      if (filter === 'all') return true;
      if (isProvider(filter)) return provider === filter;
      // Tag filters: derive from the template slug heuristically.
      if (filter === 'web-apps') return /web-app/.test(t.slug);
      if (filter === 'static-sites') return /static-site/.test(t.slug);
      if (filter === 'containers') return /container/.test(t.slug);
      if (filter === 'data') return /data|warehouse|pipeline/.test(t.slug);
      return true;
    });
  }, [filter, search, templates]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start from a template"
      description="Pre-built infrastructure patterns you can customize"
      className="max-w-4xl"
      footer={
        <>
          <Button variant="secondary" onClick={onStartScratch}>
            Or start from scratch
          </Button>
          <a
            className="text-sm font-medium text-primary hover:underline"
            href="https://github.com/cloud-blueprint/cloud-blueprint/tree/main/packages/templates"
            target="_blank"
            rel="noreferrer"
          >
            Browse community templates
          </a>
        </>
      }
    >
      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="pl-9"
          aria-label="Search templates"
        />
      </div>

      {/* Filter pills */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PILLS.map((p) => {
          const active = p.id === filter;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setFilter(p.id)}
              aria-pressed={active}
              className={cn(
                'inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors',
                active
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-card text-foreground hover:border-primary/40 hover:text-primary',
              )}
            >
              {p.label}
            </button>
          );
        })}
        {offline && (
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--warning-foreground))] dark:text-warning">
            <CloudOff className="h-3 w-3" /> Offline · showing bundled catalog
          </span>
        )}
      </div>

      {/* Grid */}
      {loading && filtered.length === 0 ? (
        <SkeletonGrid />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <TemplateCard key={t.slug} template={t} onPick={() => onPick?.(t.slug)} />
          ))}
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="mt-8 rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No templates match.
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Cards & helpers                                                            */
/* -------------------------------------------------------------------------- */

function TemplateCard({ template, onPick }: { template: TemplateMeta; onPick: () => void }) {
  const provider = adaptProvider(template.provider);
  return (
    <article className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <header className="flex items-center justify-end">
        <Badge variant={provider} size="sm" className="uppercase">
          {labelOf(provider)}
        </Badge>
      </header>

      <MiniDiagram template={template} />

      <div className="flex-1">
        <h3 className="text-sm font-semibold tracking-tight">{template.name}</h3>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.description}</p>
      </div>

      <button
        type="button"
        onClick={onPick}
        aria-label={`Use template ${template.name}`}
        className="focus-ring inline-flex items-center gap-1 self-start text-xs font-semibold text-primary transition-colors hover:text-primary-hover"
      >
        Use template <ArrowRight className="h-3 w-3" />
      </button>
    </article>
  );
}

function MiniDiagram({ template }: { template: TemplateMeta }) {
  const provider = adaptProvider(template.provider);
  const labels = derivedNodeLabels(template.slug);
  const tone =
    provider === 'aws'
      ? 'bg-provider-aws'
      : provider === 'azure'
        ? 'bg-provider-azure'
        : provider === 'gcp'
          ? 'bg-provider-gcp'
          : 'bg-provider-multi';
  return (
    <div className="flex h-24 items-center justify-center gap-2 rounded-lg bg-surface-1 px-3 dark:bg-surface-2">
      {labels.map((label, i) => (
        <div key={i} className="flex items-center gap-1">
          <span
            className={cn(
              'inline-flex h-9 w-12 items-center justify-center rounded-md text-[10px] font-bold text-white shadow-xs',
              tone,
            )}
          >
            {label}
          </span>
          {i < labels.length - 1 && <span className="h-px w-3 bg-foreground/30" />}
        </div>
      ))}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-44 animate-pulse rounded-xl border border-border bg-surface-1" />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isProvider(f: Filter): f is ProviderId {
  return f === 'aws' || f === 'azure' || f === 'gcp' || f === 'multi';
}

function adaptProvider(p: TemplateMeta['provider']): ProviderId {
  if (p === 'aws' || p === 'azure' || p === 'gcp') return p;
  return 'multi';
}

function labelOf(p: ProviderId): string {
  return { aws: 'AWS', azure: 'Azure', gcp: 'GCP', multi: 'Multi' }[p];
}

/** Heuristic to produce a tiny diagram per slug. */
function derivedNodeLabels(slug: string): string[] {
  if (slug.includes('web-app')) return ['VPC', 'EC2', 'RDS'];
  if (slug.includes('static-site')) return ['S3', 'CFN', 'R53'];
  if (slug.includes('container')) return ['ECS', 'ALB', 'ECR'];
  if (slug.includes('vnet')) return ['VNet', 'VM', 'NSG'];
  if (slug.includes('warehouse')) return ['BQ', 'P/S', 'DF'];
  return ['T', 'F', 'R'];
}
