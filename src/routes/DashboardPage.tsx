import {
  ArrowRight,
  Copy,
  FileDown,
  FileUp,
  Github,
  LayoutTemplate,
  Pencil,
  Plus,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppRail } from '@/components/AppRail';
import { confirmAction } from '@/components/Confirm';
import { ProjectThumbnail } from '@/components/ProjectThumbnail';
import { richText } from '@/components/RichText';
import { showToast } from '@/components/Toast';
import { Button, Input, Kbd, LogoMark, Select } from '@/components/ui';
import { MOD, usePalette } from '@/features/command/paletteStore';
import { DataPanel, StorageNudge } from '@/features/data/DataPanel';
import { OpenFolderButton } from '@/features/data/OpenFolderButton';
import { openGithubImport } from '@/features/import/githubImportStore';
import { TemplateModal } from '@/features/templates/TemplateModal';
import { useLocale, type Locale } from '@/i18n/locale';
import { messagesFor, useMessages } from '@/i18n/messages';
import type { Provider } from '@/ir/types';
import { exportZip } from '@/lib/download';
import { libMessages } from '@/lib/messages';
import { importNote, readDroppedTerraform, readTerraformFiles, type ImportedProject } from '@/lib/importTf';
import {
  blankProjectName,
  createProject,
  deleteProject,
  duplicateProject,
  ensureSeed,
  listProjects,
  safeStorage,
  subscribeProjects,
  uniqueProjectName,
  updateProject,
  type Project,
} from '@/lib/storage';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { cn, slugify, timeAgo } from '@/lib/utils';
import { ProviderChip, ProviderDot, PROVIDER_LABELS } from '@/resources/icons';
import { getTemplate, scratchProject } from '@/templates';
import { templateDescription, templateName } from '@/templates/i18n';
import { dashboardMessages } from './DashboardPage.messages';

/** filter ids (English); the buttons show them in the UI language */
const FILTERS = ['All', 'AWS', 'Azure', 'GCP', 'Multi-cloud'] as const;
type Filter = (typeof FILTERS)[number];

const SORTS = ['recent', 'name'] as const;
type Sort = (typeof SORTS)[number];
const SORT_KEY = 'cb-dashboard-sort';

const FEATURED = ['aws-serverless-api', 'aws-web-app', 'aws-container-stack', 'gcp-cloud-run'];

function matchesFilter(project: Project, filter: Filter): boolean {
  if (filter === 'All') return true;
  if (filter === 'Multi-cloud') return project.providers.length > 1;
  const map: Record<string, Provider> = { AWS: 'aws', Azure: 'azure', GCP: 'gcp' };
  return project.providers.length === 1 && project.providers[0] === map[filter];
}

/** What the search box matches: name, providers, template (its name in either language). */
function searchText(project: Project): string {
  const template = project.templateSlug ? getTemplate(project.templateSlug) : undefined;
  return [
    project.name,
    ...project.providers.flatMap((p) => [p, PROVIDER_LABELS[p]]),
    project.templateSlug,
    template?.name,
    template ? templateName(template, 'pt-BR') : undefined,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function resourceCount(project: Project): number {
  return Object.values(project.files).reduce(
    (n, text) => n + (text.match(/^\s*resource\s+"/gm)?.length ?? 0),
    0,
  );
}

function readSort(): Sort {
  return safeStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'recent';
}

/**
 * A project's description is the user's text — except the ones this app
 * wrote (a template's, the demo's), which follow the UI language.
 */
function displayDescription(project: Project, locale: Locale): string | undefined {
  const { description } = project;
  if (description === undefined) return undefined;
  const template = project.templateSlug ? getTemplate(project.templateSlug) : undefined;
  if (template && [templateDescription(template, 'en'), templateDescription(template, 'pt-BR')].includes(description)) {
    return templateDescription(template, locale);
  }
  if (project.demo && [libMessages.en.demoDescription, libMessages['pt-BR'].demoDescription].includes(description)) {
    return messagesFor(libMessages, locale).demoDescription;
  }
  return description;
}

const ACTION_BUTTON = 'h-7 w-7';

/**
 * A project card. The whole card is one "open" button stretched over the
 * content; the actions are siblings above it (no nested controls), visible
 * on hover, on keyboard focus, and always on touch screens.
 */
const ProjectCard = memo(function ProjectCard({
  project,
  onOpen,
  onChanged,
}: {
  project: Project;
  onOpen(id: string): void;
  onChanged(): void;
}) {
  const count = useMemo(() => resourceCount(project), [project]);
  const [renaming, setRenaming] = useState(false);
  const titleId = `project-title-${project.id}`;
  const m = useMessages(dashboardMessages);
  const locale = useLocale((s) => s.locale);

  const commitRename = (value: string) => {
    setRenaming(false);
    const name = value.trim();
    if (!name || name === project.name) return;
    const result = updateProject(project.id, { name });
    if (result.ok) onChanged();
    else if (result.reason === 'missing') showToast(messagesFor(dashboardMessages).gone, 'error');
  };

  return (
    <article
      aria-labelledby={titleId}
      className="group relative overflow-hidden rounded-[14px] border bg-surface-1 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg"
    >
      <div className="relative">
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
        </div>
        <div className="px-4 pb-4 pt-3.5">
          {renaming ? (
            <Input
              autoFocus
              aria-label={m.renameLabel}
              defaultValue={project.name}
              className="relative z-10 -mx-1 h-7 px-1 text-[14.5px] font-semibold"
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitRename(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  e.currentTarget.value = project.name;
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <h3 id={titleId} className="truncate text-[14.5px] font-semibold tracking-[-0.005em]">
              {project.name}
            </h3>
          )}
          <p className="mt-0.5 truncate text-[12.5px] text-muted">
            {displayDescription(project, locale) ?? m.defaultDescription}
          </p>
          <div className="mt-3 flex items-center gap-2 text-[11.5px] text-faint">
            <span className="font-medium text-muted">{m.resources(count)}</span>
            <span>·</span>
            <span>{m.updated(timeAgo(project.updatedAt))}</span>
            <ArrowRight className="ml-auto h-3.5 w-3.5 -translate-x-1 text-primary opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
          </div>
        </div>
      </div>
      {/* after the content so its focus ring paints on top; the actions sit above it */}
      <button
        type="button"
        onClick={() => onOpen(project.id)}
        aria-label={m.openProject(project.name)}
        className="absolute inset-0 z-[1] rounded-[14px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      />
      <div
        className="absolute right-2.5 top-2.5 z-10 flex gap-0.5 rounded-[9px] border bg-surface-1/95 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        role="group"
        aria-label={m.actionsFor(project.name)}
      >
        <Button
          variant="ghost"
          size="icon"
          className={ACTION_BUTTON}
          title={m.rename}
          aria-label={m.renameLabel}
          onClick={() => setRenaming(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={ACTION_BUTTON}
          title={m.exportZip}
          aria-label={m.exportZip}
          onClick={() => {
            exportZip(project.name, project.files);
            showToast(messagesFor(dashboardMessages).zipDownloaded, 'success');
          }}
        >
          <FileDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={ACTION_BUTTON}
          title={m.duplicate}
          aria-label={m.duplicateLabel}
          onClick={() => {
            try {
              duplicateProject(project.id);
            } catch {
              return; // storage full — the storage notice says so
            }
            onChanged();
            showToast(messagesFor(dashboardMessages).duplicated, 'success');
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(ACTION_BUTTON, 'hover:text-danger')}
          title={m.delete}
          aria-label={m.deleteLabel}
          onClick={async () => {
            const text = messagesFor(dashboardMessages);
            const ok = await confirmAction({
              title: text.deleteTitle(project.name),
              body: text.deleteBody,
              confirmLabel: text.deleteLabel,
              danger: true,
            });
            if (ok && deleteProject(project.id)) {
              onChanged();
              showToast(messagesFor(dashboardMessages).deleted);
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </article>
  );
});

export default function DashboardPage() {
  const m = useMessages(dashboardMessages);
  useDocumentTitle(m.title);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<Filter>('All');
  const [sort, setSort] = useState<Sort>(readSort);
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

  // another tab created, renamed or deleted projects
  useEffect(() => subscribeProjects(refresh), [refresh]);

  const projects = useMemo(() => {
    ensureSeed();
    return listProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, templatesOpen]);

  const index = useMemo(() => new Map(projects.map((p) => [p, searchText(p)] as const)), [projects]);

  const visible = useMemo(() => {
    const terms = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = projects.filter(
      (p) => matchesFilter(p, filter) && terms.every((t) => index.get(p)!.includes(t)),
    );
    if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return out;
  }, [projects, index, filter, deferredQuery, sort]);

  const openProject = useCallback((id: string) => navigate(`/editor/${id}`), [navigate]);

  /** Store and open an import; false when it could not be stored. */
  const create = (input: Parameters<typeof createProject>[0]): Project | null => {
    try {
      return createProject(input);
    } catch {
      return null; // storage full — the storage notice says so; stay on the dashboard
    }
  };

  const importProject = async (reading: Promise<ImportedProject | null>) => {
    let imported: ImportedProject | null;
    try {
      imported = await reading;
    } catch {
      imported = null;
    }
    const text = messagesFor(dashboardMessages);
    if (!imported) {
      showToast(text.noTfFound, 'error');
      return;
    }
    const project = create({
      name: uniqueProjectName(imported.name),
      files: imported.files,
      description: text.importedDescription(Object.keys(imported.files).length),
    });
    if (!project) return;
    const note = importNote(imported);
    showToast(note ?? text.importedToast(imported.name), note ? 'info' : 'success');
    navigate(`/editor/${project.id}`);
  };

  const startTemplate = (slug: string) => {
    const t = getTemplate(slug);
    if (!t) return;
    // the project is named in the UI language; its HCL (from the slug) stays code
    const name = templateName(t);
    const project = create({
      name: uniqueProjectName(name),
      files: t.build(slugify(name)),
      templateSlug: t.slug,
      description: templateDescription(t),
    });
    if (project) navigate(`/editor/${project.id}`);
  };

  const startBlank = (provider: Provider) => {
    const name = blankProjectName(provider);
    const project = create({ name, files: scratchProject(provider, name) });
    if (project) navigate(`/editor/${project.id}`);
  };

  const changeSort = (next: Sort) => {
    setSort(next);
    safeStorage.setItem(SORT_KEY, next);
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
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(false);
        // reads the DataTransfer synchronously (it's emptied when this handler returns)
        void importProject(readDroppedTerraform(e.dataTransfer));
      }}
    >
      <AppRail active="projects" onTemplates={() => setTemplatesOpen(true)} />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-bold tracking-[-0.02em]">{m.title}</h1>
              <p className="mt-1 text-[13.5px] text-muted">{m.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
              <button
                type="button"
                onClick={() => openPalette(true)}
                className="hidden h-8.5 items-center gap-2 rounded-sm border bg-surface-1 px-3 text-[12.5px] text-faint transition-colors hover:text-muted md:flex"
              >
                <Search className="h-3.5 w-3.5" /> {m.quickActions} <Kbd>{MOD} K</Kbd>
              </button>
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                <FileUp className="h-4 w-4" /> {m.importTf}
              </Button>
              <Button variant="outline" aria-label={m.importGithub} title={m.importGithub} onClick={() => openGithubImport()}>
                <Github className="h-4 w-4" /> <span className="max-sm:hidden">GitHub</span>
              </Button>
              <OpenFolderButton />
              <Button onClick={() => setTemplatesOpen(true)}>
                {m.newProject} <Plus className="h-4 w-4" />
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept=".tf,.zip"
                className="hidden"
                aria-label={m.importFilesLabel}
                onChange={(e) => {
                  // copy before resetting the input: its FileList is live and empties
                  if (e.target.files?.length) void importProject(readTerraformFiles([...e.target.files]));
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          <StorageNudge projects={projects} />

          {/* quick start */}
          <section className="mt-7" aria-label={m.quickStart}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-faint">{m.quickStart}</h2>
              <button
                type="button"
                onClick={() => setTemplatesOpen(true)}
                className="flex items-center gap-1 text-[12.5px] font-medium text-primary hover:text-primary-hover"
              >
                <LayoutTemplate className="h-3.5 w-3.5" /> {m.allTemplates}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {featured.map(({ template: t, files }) => (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => startTemplate(t.slug)}
                  className="group flex flex-col overflow-hidden rounded-[12px] border bg-surface-1 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
                >
                  <div className="bp-dots w-full border-b bg-canvas px-3 py-2">
                    <ProjectThumbnail files={files} className="h-16 w-full text-foreground" />
                  </div>
                  <div className="w-full px-3 py-2">
                    <div className="line-clamp-2 text-[12.5px] font-semibold leading-snug">{templateName(t)}</div>
                    <div className="truncate text-[11px] text-faint">
                      {m.templateMeta(t.resourceCount, t.providers.map((p) => PROVIDER_LABELS[p]).join(' + '))}
                    </div>
                  </div>
                </button>
              ))}
              <div className="col-span-2 flex flex-col justify-between rounded-[12px] border border-dashed bg-surface-1/60 p-3 lg:col-span-1">
                <div>
                  <div className="text-[12.5px] font-semibold">{m.blankCanvas}</div>
                  <div className="text-[11px] text-faint">{m.fromScratch}</div>
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
              {m.yourProjects} <span className="font-medium normal-case tracking-normal">({projects.length})</span>
            </h2>
            <div className="relative w-64 max-w-full">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                className="pl-8"
                type="search"
                aria-label={m.searchLabel}
                placeholder={m.searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="w-36 shrink-0">
              <Select aria-label={m.sortLabel} value={sort} onChange={(e) => changeSort(e.target.value as Sort)}>
                {SORTS.map((s) => (
                  <option key={s} value={s}>
                    {s === 'name' ? m.sortName : m.sortRecent}
                  </option>
                ))}
              </Select>
            </div>
            <div
              className="flex max-w-full overflow-x-auto rounded-sm border bg-surface-1 p-0.5"
              role="group"
              aria-label={m.filterLabel}
            >
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded-[5px] px-3 py-1 text-[12.5px] font-medium transition-colors',
                    filter === f ? 'bg-surface-2 text-foreground shadow-xs' : 'text-muted hover:text-foreground',
                  )}
                >
                  {f === 'All' ? m.all : f === 'Multi-cloud' ? m.multiCloud : f}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <LogoMark size={44} />
              <h2 className="mt-5 text-[17px] font-semibold">
                {projects.length === 0 ? m.noProjects : m.noMatches}
              </h2>
              <p className="mt-1.5 max-w-sm text-[13px] text-muted">
                {projects.length === 0 ? m.noProjectsHint : m.noMatchesHint}
              </p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={openProject} onChanged={refresh} />
              ))}
            </div>
          )}

          <DataPanel projects={projects} onChanged={refresh} />

          <p className="mt-10 text-center text-[11.5px] text-faint">{richText(m.tip)}</p>
        </div>
      </main>

      {dragging ? (
        <div className="bp-fade-in pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center rounded-[20px] border-2 border-dashed border-primary bg-primary-soft/80 backdrop-blur-sm">
          <UploadCloud className="h-10 w-10 text-primary" />
          <p className="mt-3 text-[16px] font-semibold text-foreground">{m.dropTitle}</p>
          <p className="mt-1 text-[12.5px] text-muted">{m.dropHint}</p>
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
