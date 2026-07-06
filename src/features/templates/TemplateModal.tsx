import { ArrowRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ProjectThumbnail } from '@/components/ProjectThumbnail';
import { Badge, Button, Input, Modal } from '@/components/ui';
import type { Provider } from '@/ir/types';
import { createProject, type Project } from '@/lib/storage';
import { cn, slugify } from '@/lib/utils';
import { PROVIDER_LABELS, ProviderDot } from '@/resources/icons';
import { scratchProject, TEMPLATES, type TemplateDef } from '@/templates';

const FILTERS = ['All', 'AWS', 'Azure', 'GCP', 'Web Apps', 'Static Sites', 'Containers'] as const;
type Filter = (typeof FILTERS)[number];

const PROVIDER_FILTER: Partial<Record<Filter, Provider>> = {
  AWS: 'aws',
  Azure: 'azure',
  GCP: 'gcp',
};

function matches(t: TemplateDef, filter: Filter, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q && !`${t.name} ${t.description} ${t.tags.join(' ')}`.toLowerCase().includes(q)) {
    return false;
  }
  if (filter === 'All') return true;
  const provider = PROVIDER_FILTER[filter];
  if (provider) return t.providers.includes(provider);
  return t.tags.includes(filter);
}

function providerBadge(providers: Provider[]) {
  if (providers.length > 1) return <Badge variant="multi">Multi</Badge>;
  const p = providers[0];
  if (!p || p === 'other') return <Badge variant="multi">Multi</Badge>;
  return <Badge variant={p}>{PROVIDER_LABELS[p]}</Badge>;
}

export function TemplateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose(): void;
  onCreated(project: Project): void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [name, setName] = useState('');

  const visible = useMemo(
    () => TEMPLATES.filter((t) => matches(t, filter, query)),
    [filter, query],
  );

  const create = (template?: TemplateDef, scratch?: Provider) => {
    const projectName = name.trim() || (template ? template.name : 'my-app');
    const slug = slugify(projectName);
    const files = template ? template.build(slug) : scratchProject(scratch ?? 'aws', projectName);
    const project = createProject({
      name: projectName,
      files,
      templateSlug: template?.slug,
      description: template?.description,
    });
    onCreated(project);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={
        <div>
          <h2 className="text-[17px] font-bold">Start from a template</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Pre-built infrastructure patterns you can customize
          </p>
        </div>
      }
    >
      <div className="px-5 pb-5 pt-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input
              className="pl-8"
              placeholder="Search templates…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Input
            className="w-52"
            placeholder="Project name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Project name"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter templates">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                filter === f
                  ? 'border-foreground bg-foreground text-background'
                  : 'text-muted hover:border-border-strong hover:text-foreground',
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="mt-4 grid max-h-[46vh] grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((t) => {
            const preview = t.build('preview');
            return (
              <div
                key={t.slug}
                className="group flex flex-col overflow-hidden rounded-md border bg-surface-1 shadow-xs transition-shadow hover:shadow-md"
              >
                <div className="border-b bg-canvas p-3">
                  <ProjectThumbnail files={preview} className="h-24 w-full text-foreground" />
                </div>
                <div className="flex flex-1 flex-col p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13.5px] font-semibold">{t.name}</h3>
                    {providerBadge(t.providers)}
                  </div>
                  <p className="mt-1.5 line-clamp-2 flex-1 text-[12px] leading-relaxed text-muted">
                    {t.description}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] text-faint">{t.resourceCount} resources</span>
                    <button
                      type="button"
                      onClick={() => create(t)}
                      className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:text-primary-hover"
                    >
                      Use template <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {visible.length === 0 ? (
            <p className="col-span-full py-10 text-center text-[13px] text-muted">
              No templates match “{query}”.
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <span className="text-[12.5px] text-muted">Or start from scratch:</span>
          <div className="flex gap-2">
            {(['aws', 'azure', 'gcp'] as const).map((p) => (
              <Button key={p} variant="outline" size="sm" onClick={() => create(undefined, p)}>
                <ProviderDot provider={p} /> {PROVIDER_LABELS[p]}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
