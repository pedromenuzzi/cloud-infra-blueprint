import { Copy, FileDown, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppRail } from '@/components/AppRail';
import { ProjectThumbnail } from '@/components/ProjectThumbnail';
import { showToast } from '@/components/Toast';
import { Badge, Button, Input, LogoMark } from '@/components/ui';
import { TemplateModal } from '@/features/templates/TemplateModal';
import type { Provider } from '@/ir/types';
import { exportZip } from '@/lib/download';
import {
  deleteProject,
  duplicateProject,
  ensureSeed,
  listProjects,
  type Project,
} from '@/lib/storage';
import { cn, timeAgo } from '@/lib/utils';
import { PROVIDER_LABELS } from '@/resources/icons';

const FILTERS = ['All', 'AWS', 'Azure', 'GCP', 'Multi-cloud'] as const;
type Filter = (typeof FILTERS)[number];

function providerOf(project: Project): { label: string; variant: 'aws' | 'azure' | 'gcp' | 'multi' } {
  if (project.providers.length > 1) return { label: 'Multi', variant: 'multi' };
  const p: Provider = project.providers[0] ?? 'aws';
  if (p === 'other') return { label: 'Multi', variant: 'multi' };
  return { label: PROVIDER_LABELS[p], variant: p };
}

function matchesFilter(project: Project, filter: Filter): boolean {
  if (filter === 'All') return true;
  if (filter === 'Multi-cloud') return project.providers.length > 1;
  const map: Record<string, Provider> = { AWS: 'aws', Azure: 'azure', GCP: 'gcp' };
  return project.providers.length === 1 && project.providers[0] === map[filter];
}

function ProjectCard({
  project,
  onOpen,
  onChanged,
}: {
  project: Project;
  onOpen(): void;
  onChanged(): void;
}) {
  const badge = providerOf(project);
  return (
    <div
      className="group cursor-pointer overflow-hidden rounded-md border bg-surface-1 shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      aria-label={`Open project ${project.name}`}
    >
      <div className="relative border-b bg-canvas p-3">
        <ProjectThumbnail files={project.files} className="h-32 w-full text-foreground" />
        <Badge variant={badge.variant} className="absolute right-2.5 top-2.5">
          {badge.label}
        </Badge>
      </div>
      <div className="p-4">
        <h3 className="truncate text-[14px] font-semibold">{project.name}</h3>
        <p className="mt-1 line-clamp-2 min-h-8 text-[12px] leading-relaxed text-muted">
          {project.description ?? 'Cloud architecture blueprint.'}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11.5px] text-faint">Updated {timeAgo(project.updatedAt)}</span>
          <div
            className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Export Terraform zip"
              aria-label="Export Terraform zip"
              onClick={() => {
                exportZip(project.name, project.files);
                showToast('Terraform zip downloaded', 'success');
              }}
            >
              <FileDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Duplicate"
              aria-label="Duplicate project"
              onClick={() => {
                duplicateProject(project.id);
                onChanged();
                showToast('Project duplicated', 'success');
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:text-danger"
              title="Delete"
              aria-label="Delete project"
              onClick={() => {
                if (confirm(`Delete "${project.name}"? This cannot be undone.`)) {
                  deleteProject(project.id);
                  onChanged();
                  showToast('Project deleted');
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const projects = useMemo(() => {
    ensureSeed();
    return listProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter, templatesOpen]);

  const visible = projects.filter(
    (p) =>
      matchesFilter(p, filter) &&
      (query.trim() === '' || p.name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div className="flex h-full">
      <AppRail active="projects" onTemplates={() => setTemplatesOpen(true)} />

      {/* main */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[26px] font-bold tracking-[-0.01em]">Projects</h1>
              <p className="mt-1 text-[13.5px] text-muted">
                Manage your cloud infrastructure designs
              </p>
            </div>
            <Button onClick={() => setTemplatesOpen(true)}>
              New Project <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="relative w-72 max-w-full">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                className="pl-8"
                placeholder="Search projects…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div
              className="flex rounded-sm border bg-surface-1 p-0.5"
              role="group"
              aria-label="Filter by provider"
            >
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    'rounded-[5px] px-3 py-1 text-[12.5px] font-medium transition-colors',
                    filter === f
                      ? 'bg-surface-2 text-foreground shadow-xs'
                      : 'text-muted hover:text-foreground',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="mt-20 flex flex-col items-center text-center">
              <LogoMark size={44} />
              <h2 className="mt-5 text-[17px] font-semibold">
                {projects.length === 0 ? 'No projects yet' : 'Nothing matches your filters'}
              </h2>
              <p className="mt-1.5 max-w-sm text-[13px] text-muted">
                {projects.length === 0
                  ? 'Start from a battle-tested template or from a blank canvas — everything stays in your browser.'
                  : 'Try clearing the search or choosing another provider.'}
              </p>
              {projects.length === 0 ? (
                <Button className="mt-5" onClick={() => setTemplatesOpen(true)}>
                  New Project <Plus className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onOpen={() => navigate(`/editor/${p.id}`)}
                  onChanged={refresh}
                />
              ))}
            </div>
          )}

          <p className="mt-8 text-center text-[11.5px] text-faint">
            Showing {visible.length} of {projects.length}
          </p>
        </div>
      </main>

      <TemplateModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onCreated={(p) => {
          setTemplatesOpen(false);
          navigate(`/editor/${p.id}`);
        }}
      />
    </div>
  );
}
