import {
  ArrowRight,
  Copy,
  FileDown,
  FileUp,
  LayoutTemplate,
  Plus,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppRail } from '@/components/AppRail';
import { ProjectThumbnail } from '@/components/ProjectThumbnail';
import { showToast } from '@/components/Toast';
import { Button, Input, Kbd, LogoMark } from '@/components/ui';
import { MOD, usePalette } from '@/features/command/paletteStore';
import { TemplateModal } from '@/features/templates/TemplateModal';
import type { Provider } from '@/ir/types';
import { exportZip } from '@/lib/download';
import { readTerraformFiles } from '@/lib/importTf';
import {
  createProject,
  deleteProject,
  duplicateProject,
  ensureSeed,
  listProjects,
  type Project,
} from '@/lib/storage';
import { cn, slugify, timeAgo } from '@/lib/utils';
import { ProviderChip, ProviderDot, PROVIDER_LABELS } from '@/resources/icons';
import { getTemplate, scratchProject } from '@/templates';

const FILTERS = ['All', 'AWS', 'Azure', 'GCP', 'Multi-cloud'] as const;
type Filter = (typeof FILTERS)[number];

const FEATURED = ['aws-serverless-api', 'aws-web-app', 'aws-container-stack', 'gcp-cloud-run'];

function matchesFilter(project: Project, filter: Filter): boolean {
  if (filter === 'All') return true;
  if (filter === 'Multi-cloud') return project.providers.length > 1;
  const map: Record<string, Provider> = { AWS: 'aws', Azure: 'azure', GCP: 'gcp' };
  return project.providers.length === 1 && project.providers[0] === map[filter];
}

function resourceCount(project: Project): number {
  return Object.values(project.files).reduce(
    (n, text) => n + (text.match(/^\s*resource\s+"/gm)?.length ?? 0),
    0,
  );
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
  const count = resourceCount(project);
  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-[14px] border bg-surface-1 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      aria-label={`Open project ${project.name}`}
    >
      <div className="bp-dots relative overflow-hidden border-b bg-canvas px-4 py-3">
        <ProjectThumbnail
          files={project.files}
          className="h-36 w-full text-foreground transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <div className="absolute left-3 top-3 flex gap-1">
          {project.providers
            .filter((p) => p !== 'other')
            .map((p) => (
              <ProviderChip key={p} provider={p} className="bg-surface-1/90" />
            ))}
        </div>
        <div
          className="absolute right-2.5 top-2.5 flex gap-0.5 rounded-[9px] border bg-surface-1/95 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
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
      <div className="px-4 pb-4 pt-3.5">
        <h3 className="truncate text-[14.5px] font-semibold tracking-[-0.005em]">{project.name}</h3>
        <p className="mt-0.5 truncate text-[12.5px] text-muted">
          {project.description ?? 'Cloud architecture blueprint.'}
        </p>
        <div className="mt-3 flex items-center gap-2 text-[11.5px] text-faint">
          <span className="font-medium text-muted">
            {count} resource{count === 1 ? '' : 's'}
          </span>
          <span>·</span>
          <span>Updated {timeAgo(project.updatedAt)}</span>
          <ArrowRight className="ml-auto h-3.5 w-3.5 -translate-x-1 text-primary opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [templatesOpen, setTemplatesOpen] = useState(params.get('new') === '1');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const openPalette = usePalette((s) => s.setOpen);
  const featured = useMemo(
    () =>
      FEATURED.map((slug) => getTemplate(slug))
        .filter((t) => t !== undefined)
        .map((t) => ({ template: t, files: t.build('preview') })),
    [],
  );

  useEffect(() => {
    if (params.get('new') === '1') {
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const projects = useMemo(() => {
    ensureSeed();
    return listProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, templatesOpen]);

  const visible = projects.filter(
    (p) =>
      matchesFilter(p, filter) &&
      (query.trim() === '' || p.name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  const importFiles = async (list: Iterable<File>) => {
    const imported = await readTerraformFiles(list);
    if (!imported) {
      showToast('No .tf files found — drop Terraform files, a folder or a .zip', 'error');
      return;
    }
    const count = Object.keys(imported.files).length;
    const project = createProject({
      name: imported.name,
      files: imported.files,
      description: `Imported from ${count} Terraform file${count === 1 ? '' : 's'}.`,
    });
    showToast(`Imported “${imported.name}” — tidy the layout from the canvas toolbar`, 'success');
    navigate(`/editor/${project.id}`);
  };

  const startTemplate = (slug: string) => {
    const t = getTemplate(slug);
    if (!t) return;
    const project = createProject({
      name: t.name,
      files: t.build(slugify(t.name)),
      templateSlug: t.slug,
      description: t.description,
    });
    navigate(`/editor/${project.id}`);
  };

  const startBlank = (provider: Provider) => {
    const project = createProject({
      name: `my-${provider}-app`,
      files: scratchProject(provider, `my-${provider}-app`),
    });
    navigate(`/editor/${project.id}`);
  };

  return (
    <div
      className="relative flex h-full"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as HTMLElement)) {
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void importFiles(e.dataTransfer.files);
      }}
    >
      <AppRail active="projects" onTemplates={() => setTemplatesOpen(true)} />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-bold tracking-[-0.02em]">Projects</h1>
              <p className="mt-1 text-[13.5px] text-muted">
                Your cloud architecture designs — saved in this browser, exportable as Terraform.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openPalette(true)}
                className="hidden h-8.5 items-center gap-2 rounded-sm border bg-surface-1 px-3 text-[12.5px] text-faint transition-colors hover:text-muted md:flex"
              >
                <Search className="h-3.5 w-3.5" /> Quick actions <Kbd>{MOD} K</Kbd>
              </button>
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                <FileUp className="h-4 w-4" /> Import .tf
              </Button>
              <Button onClick={() => setTemplatesOpen(true)}>
                New Project <Plus className="h-4 w-4" />
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept=".tf,.zip"
                className="hidden"
                aria-label="Import Terraform files"
                onChange={(e) => {
                  if (e.target.files?.length) void importFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          {/* quick start */}
          <section className="mt-7" aria-label="Quick start">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-faint">Quick start</h2>
              <button
                type="button"
                onClick={() => setTemplatesOpen(true)}
                className="flex items-center gap-1 text-[12.5px] font-medium text-primary hover:text-primary-hover"
              >
                <LayoutTemplate className="h-3.5 w-3.5" /> All templates
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {featured.map(({ template: t, files }) => (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => startTemplate(t.slug)}
                  className="group overflow-hidden rounded-[12px] border bg-surface-1 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
                >
                  <div className="bp-dots border-b bg-canvas px-3 py-2">
                    <ProjectThumbnail files={files} className="h-16 w-full text-foreground" />
                  </div>
                  <div className="px-3 py-2">
                    <div className="truncate text-[12.5px] font-semibold">{t.name}</div>
                    <div className="truncate text-[11px] text-faint">
                      {t.resourceCount} resources · {t.providers.map((p) => PROVIDER_LABELS[p]).join(' + ')}
                    </div>
                  </div>
                </button>
              ))}
              <div className="col-span-2 flex flex-col justify-between rounded-[12px] border border-dashed bg-surface-1/60 p-3 lg:col-span-1">
                <div>
                  <div className="text-[12.5px] font-semibold">Blank canvas</div>
                  <div className="text-[11px] text-faint">Start from scratch</div>
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  {(['aws', 'azure', 'gcp'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => startBlank(p)}
                      className="flex items-center gap-2 rounded-[7px] border bg-surface-1 px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:border-border-strong hover:bg-surface-2"
                    >
                      <ProviderDot provider={p} size={8} /> {PROVIDER_LABELS[p]}
                      <Plus className="ml-auto h-3 w-3 text-faint" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-[11px] font-bold uppercase tracking-wider text-faint">
              Your projects <span className="font-medium normal-case tracking-normal">({projects.length})</span>
            </h2>
            <div className="relative w-64 max-w-full">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                className="pl-8"
                placeholder="Search projects…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="flex rounded-sm border bg-surface-1 p-0.5" role="group" aria-label="Filter by provider">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    'rounded-[5px] px-3 py-1 text-[12.5px] font-medium transition-colors',
                    filter === f ? 'bg-surface-2 text-foreground shadow-xs' : 'text-muted hover:text-foreground',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <LogoMark size={44} />
              <h2 className="mt-5 text-[17px] font-semibold">
                {projects.length === 0 ? 'No projects yet' : 'Nothing matches your filters'}
              </h2>
              <p className="mt-1.5 max-w-sm text-[13px] text-muted">
                {projects.length === 0
                  ? 'Start from a template above, drop existing .tf files here, or open a blank canvas.'
                  : 'Try clearing the search or choosing another provider.'}
              </p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={() => navigate(`/editor/${p.id}`)} onChanged={refresh} />
              ))}
            </div>
          )}

          <p className="mt-10 text-center text-[11.5px] text-faint">
            Tip: drop a folder of <code className="font-mono">.tf</code> files or a{' '}
            <code className="font-mono">.zip</code> anywhere on this page to import it.
          </p>
        </div>
      </main>

      {dragging ? (
        <div className="bp-fade-in pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center rounded-[20px] border-2 border-dashed border-primary bg-primary-soft/80 backdrop-blur-sm">
          <UploadCloud className="h-10 w-10 text-primary" />
          <p className="mt-3 text-[16px] font-semibold text-foreground">Drop Terraform to import</p>
          <p className="mt-1 text-[12.5px] text-muted">.tf files, a folder, or a .zip — we’ll draw the diagram</p>
        </div>
      ) : null}

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
