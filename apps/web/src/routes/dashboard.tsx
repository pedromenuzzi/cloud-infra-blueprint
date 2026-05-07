import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  Input,
  PROVIDERS,
  ProviderIcon,
  cn,
  type ProviderId,
} from '@blueprint/ui';
import { Bell, ChevronDown, CloudOff, LayoutGrid, List, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AppRail } from '@/components/AppRail';
import { ProjectThumbnail } from '@/components/ProjectThumbnail';
import { TemplatesGallery } from '@/features/templates/TemplatesGallery';
import { api } from '@/lib/api';
import { useProjects, type ProjectMeta } from '@/lib/useProjects';
import { ThemeToggle } from '@/theme';

/**
 * Project list dashboard — mirrors image 03 of the spec. Reads projects from
 * the backend via `useProjects` (with offline-first fallback to demo data),
 * lets the user filter/search/sort, and opens the templates gallery to
 * create a new project.
 */
export function DashboardRoute() {
  const { projects, loading, offline, addLocal, refresh } = useProjects();
  const [filter, setFilter] = useState<'all' | ProviderId>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (filter !== 'all' && p.provider !== filter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [projects, filter, search]);

  /**
   * Create a new project from a template slug. Tries the API first; on
   * failure we still navigate with a synthetic id so the user can keep
   * building offline (the IR will be wired to localStorage in F4).
   */
  const handlePickTemplate = async (slug: string) => {
    setTemplatesOpen(false);
    try {
      const created = await api.post<{ id: string; name: string; defaultProvider: string }>(
        '/projects?orgId=local',
        {
          name: slug,
          description: `Created from template ${slug}`,
          defaultProvider: slug.includes('azure') ? 'azure' : slug.includes('gcp') ? 'gcp' : 'aws',
        },
      );
      addLocal({
        id: created.id,
        name: created.name,
        description: `Created from template ${slug}`,
        provider: 'aws',
        updatedAgo: 'just now',
        collaborators: [],
      });
      navigate(`/editor/${created.id}`);
    } catch {
      navigate(`/editor/${slug}`);
    }
  };

  return (
    <div className="flex h-full min-h-screen bg-surface-1">
      <AppRail activeLabel="Projects" />

      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopbar />

        <main className="flex-1 overflow-y-auto px-8 py-8" aria-label="Projects">
          <div className="mx-auto max-w-7xl">
            <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
                  Projects
                  {offline && (
                    <span
                      title="API unavailable. Showing bundled demo projects."
                      className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-[11px] font-medium text-[hsl(var(--warning-foreground))] dark:text-warning"
                    >
                      <CloudOff className="h-3 w-3" /> Offline mode
                    </span>
                  )}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Manage your cloud infrastructure designs
                </p>
              </div>
              <div className="flex items-center gap-2">
                {offline && (
                  <Button variant="ghost" size="sm" onClick={refresh}>
                    Retry connection
                  </Button>
                )}
                <Button onClick={() => setTemplatesOpen(true)}>
                  <Plus className="h-4 w-4" /> New Project
                </Button>
              </div>
            </header>

            <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-1 flex-col items-stretch gap-3 md:flex-row md:items-center">
                <div className="relative max-w-xs flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects..."
                    className="pl-9"
                    aria-label="Search projects"
                  />
                </div>
                <FilterPills value={filter} onChange={setFilter} />
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary">
                  Recent <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <div
                  className="flex h-9 items-center rounded-md border border-border bg-card p-0.5"
                  role="group"
                  aria-label="View mode"
                >
                  <button
                    type="button"
                    onClick={() => setView('grid')}
                    aria-label="Grid view"
                    aria-pressed={view === 'grid'}
                    className={cn(
                      'flex h-7 w-8 items-center justify-center rounded-sm transition-colors',
                      view === 'grid'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('list')}
                    aria-label="List view"
                    aria-pressed={view === 'list'}
                    className={cn(
                      'flex h-7 w-8 items-center justify-center rounded-sm transition-colors',
                      view === 'list'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {loading && filtered.length === 0 ? (
              <SkeletonGrid />
            ) : view === 'grid' ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filtered.map((p) => (
                  <ProjectRow key={p.id} project={p} />
                ))}
              </div>
            )}

            {filtered.length === 0 && !loading && (
              <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
                No projects match your filters.
              </div>
            )}

            <footer className="mt-8 flex items-center justify-center text-xs text-muted-foreground">
              Showing {filtered.length} of {projects.length}
            </footer>
          </div>
        </main>
      </div>

      <TemplatesGallery
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onPick={handlePickTemplate}
        onStartScratch={() => {
          setTemplatesOpen(false);
          navigate('/editor/new');
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Topbar                                                                     */
/* -------------------------------------------------------------------------- */

function DashboardTopbar() {
  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b border-border/60 bg-card px-6">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold">Cloud Blueprint</span>
        <span className="text-muted-foreground">|</span>
        <span className="text-muted-foreground">Acme Corp</span>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">Projects</span>
      </div>
      <div className="hidden flex-1 items-center justify-center md:flex">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search" className="pl-9" aria-label="Global search" />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-4 w-4" />
        </Button>
        <span className="ml-1">
          <Avatar name="Pedro" size={32} />
        </span>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Filter pills                                                               */
/* -------------------------------------------------------------------------- */

function FilterPills({
  value,
  onChange,
}: {
  value: 'all' | ProviderId;
  onChange: (v: 'all' | ProviderId) => void;
}) {
  const pills: { id: 'all' | ProviderId; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'aws', label: 'AWS' },
    { id: 'azure', label: 'Azure' },
    { id: 'gcp', label: 'GCP' },
    { id: 'multi', label: 'Multi-cloud' },
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Filter by provider"
    >
      {pills.map((p) => {
        const active = p.id === value;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground hover:border-primary/40 hover:text-primary',
            )}
          >
            {p.id !== 'all' && <ProviderIcon provider={p.id} size={12} />}
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Project cards                                                              */
/* -------------------------------------------------------------------------- */

function ProjectCard({ project }: { project: ProjectMeta }) {
  const meta = PROVIDERS[project.provider];
  return (
    <Link to={`/editor/${project.id}`} className="focus-ring group block rounded-xl">
      <Card variant="hover" className="overflow-hidden">
        <div className="relative h-32 overflow-hidden bg-surface-1">
          <ProjectThumbnail provider={project.provider} />
          <Badge variant={project.provider} className="absolute right-3 top-3 uppercase">
            {meta.label}
          </Badge>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-semibold tracking-tight">{project.name}</h2>
          <p className="line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
          <div className="mt-2 flex items-center justify-between">
            <AvatarGroup max={3}>
              {project.collaborators.map((name) => (
                <Avatar key={name} name={name} size={22} />
              ))}
            </AvatarGroup>
            <span className="text-[11px] text-muted-foreground">Updated {project.updatedAgo}</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ProjectRow({ project }: { project: ProjectMeta }) {
  const meta = PROVIDERS[project.provider];
  return (
    <Link
      to={`/editor/${project.id}`}
      className="focus-ring flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/30"
    >
      <div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-1">
        <ProviderIcon provider={project.provider} size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{project.name}</h2>
          <Badge variant={project.provider} size="sm" className="uppercase">
            {meta.label}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">{project.description}</p>
      </div>
      <AvatarGroup max={3}>
        {project.collaborators.map((name) => (
          <Avatar key={name} name={name} size={22} />
        ))}
      </AvatarGroup>
      <span className="text-xs text-muted-foreground">Updated {project.updatedAgo}</span>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-52 animate-pulse rounded-xl border border-border bg-card" />
      ))}
    </div>
  );
}
