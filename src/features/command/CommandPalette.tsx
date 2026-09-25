/**
 * ⌘K / Ctrl+K — one searchable place for everything: add resources, jump to
 * a resource or file, run canvas/editor actions, start from a template,
 * navigate, switch theme.
 */
import { Command } from 'cmdk';
import {
  ArrowLeft,
  BookOpen,
  Code2,
  CopyPlus,
  CornerDownLeft,
  Download,
  FileCode2,
  FileImage,
  FileUp,
  FolderOpen,
  Github,
  GraduationCap,
  ImageDown,
  Keyboard,
  LayoutDashboard,
  LayoutTemplate,
  Map as MapIcon,
  Maximize,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  Share2,
  Sun,
  Trash2,
  Undo2,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { showToast } from '@/components/Toast';
import { Kbd } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { useLayout } from '@/features/editor/layoutStore';
import { ResourceGroups, wordFilter } from '@/features/editor/ResourcePicker';
import { orderedFiles, useEditor } from '@/features/editor/store';
import { copyText, exportZip } from '@/lib/download';
import { shareUrl } from '@/lib/share';
import { pickTerraformFiles, readTerraformFiles } from '@/lib/importTf';
import { createProject, detectProviders, listProjects } from '@/lib/storage';
import { cn, slugify, timeAgo } from '@/lib/utils';
import { ResourceIcon } from '@/resources/icons';
import { getDef } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import { useTheme } from '@/theme/useTheme';
import { MOD, usePalette } from './paletteStore';

function Item({
  value,
  icon: Icon,
  label,
  hint,
  shortcut,
  keywords,
  onSelect,
  disabled,
  children,
}: {
  value: string;
  icon?: LucideIcon;
  label: string;
  hint?: string;
  shortcut?: string;
  keywords?: string[];
  onSelect(): void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      keywords={[label, ...(keywords ?? [])]}
      onSelect={onSelect}
      disabled={disabled}
      className="bp-cmd-item"
    >
      {children ??
        (Icon ? (
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] border bg-surface-2 text-muted">
            <Icon className="h-3.5 w-3.5" />
          </span>
        ) : null)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="truncate text-[11.5px] text-faint">{hint}</span> : null}
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </Command.Item>
  );
}

export function CommandPalette() {
  const { open, setOpen, setShortcuts } = usePalette();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<'root' | 'add'>('root');
  const { theme, setTheme } = useTheme();
  const togglePanel = useLayout((s) => s.toggle);

  const inEditor = location.pathname.startsWith('/editor/');
  const projectId = useEditor((s) => s.projectId);
  const resources = useEditor((s) => s.ir.resources);
  const files = useEditor((s) => s.files);
  const selection = useEditor((s) => s.selection);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const editorReady = inEditor && projectId !== null;
  const projects = useMemo(
    () => (open ? listProjects().filter((p) => !(inEditor && p.id === projectId)) : []),
    [open, inEditor, projectId],
  );
  const preferred = useMemo(() => (editorReady ? detectProviders(files) : []), [editorReady, files]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setPage('root');
    }
  }, [open]);

  const run = (fn: () => unknown) => {
    setOpen(false);
    // let the dialog close (and return focus) before acting
    requestAnimationFrame(() => void fn());
  };

  const editor = () => useEditor.getState();

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      filter={wordFilter}
      loop
      overlayClassName="bp-palette-overlay"
      contentClassName="bp-palette"
      onKeyDown={(e) => {
        if (page === 'add' && e.key === 'Backspace' && search === '') {
          e.preventDefault();
          setPage('root');
        }
      }}
    >
      <div className="bp-cmd flex max-h-[min(560px,72vh)] flex-col">
        <div className="flex items-center gap-2 border-b pl-3">
          {page === 'add' ? (
            <button
              type="button"
              onClick={() => setPage('root')}
              className="flex items-center gap-1 rounded-[6px] bg-primary-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-primary"
            >
              <ArrowLeft className="h-3 w-3" /> Add resource
            </button>
          ) : null}
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder={page === 'add' ? 'Search 80+ AWS, Azure and GCP resources…' : 'Search or run a command…'}
            className="bp-cmd-input !border-0 !px-1"
          />
        </div>
        <Command.List className="bp-cmd-list">
          <Command.Empty className="px-3 py-8 text-center text-[13px] text-faint">
            No results for “{search}”.
          </Command.Empty>

          {page === 'add' ? (
            <ResourceGroups
              preferred={preferred}
              onPick={(def) => run(() => canvasApi()?.addResource(def.type))}
            />
          ) : (
            <>
              {editorReady ? (
                <>
                  <Command.Group heading="Canvas">
                    <Item
                      value="add-resource"
                      icon={Plus}
                      label="Add resource…"
                      keywords={['new', 'create', 'drop']}
                      hint="Double-click the canvas"
                      onSelect={() => {
                        setSearch('');
                        setPage('add');
                      }}
                    />
                    <Item value="fit" icon={Maximize} label="Fit view" shortcut="⇧1" onSelect={() => run(() => canvasApi()?.fitView())} />
                    <Item value="tidy" icon={WandSparkles} label="Tidy up layout" keywords={['auto layout', 'arrange', 'organize']} onSelect={() => run(() => void canvasApi()?.tidy())} />
                    <Item value="minimap" icon={MapIcon} label="Toggle minimap" onSelect={() => run(() => canvasApi()?.toggleMinimap())} />
                    {selection ? (
                      <>
                        <Item value="duplicate" icon={CopyPlus} label="Duplicate selected resource" shortcut={`${MOD} D`} onSelect={() => run(() => canvasApi()?.duplicate(selection))} />
                        <Item value="reveal" icon={Code2} label="Show selected resource in code" onSelect={() => run(() => editor().revealInCode(selection))} />
                        <Item
                          value="delete-selected"
                          icon={Trash2}
                          label="Delete selected resource"
                          shortcut="Del"
                          onSelect={() => run(() => editor().deleteResources([selection]))}
                        />
                      </>
                    ) : null}
                  </Command.Group>

                  <Command.Group heading="Edit & export">
                    <Item value="undo" icon={Undo2} label="Undo" shortcut={`${MOD} Z`} disabled={!canUndo} onSelect={() => run(() => editor().undo())} />
                    <Item value="redo" icon={Redo2} label="Redo" shortcut={`${MOD} ⇧ Z`} disabled={!canRedo} onSelect={() => run(() => editor().redo())} />
                    <Item
                      value="export-zip"
                      icon={Download}
                      label="Export Terraform (.zip)"
                      keywords={['download']}
                      onSelect={() =>
                        run(() => {
                          exportZip(editor().projectName, editor().files);
                          showToast('Terraform zip downloaded', 'success');
                        })
                      }
                    />
                    <Item value="export-png" icon={ImageDown} label="Export diagram as PNG" keywords={['image', 'download']} onSelect={() => run(() => void canvasApi()?.exportImage('png'))} />
                    <Item value="export-svg" icon={FileImage} label="Export diagram as SVG" keywords={['image', 'vector']} onSelect={() => run(() => void canvasApi()?.exportImage('svg'))} />
                    <Item
                      value="share"
                      icon={Share2}
                      label="Copy share link"
                      onSelect={() =>
                        run(() =>
                          void copyText(shareUrl({ name: editor().projectName, files: editor().files })).then(
                            () => showToast('Share link copied', 'success'),
                            () => showToast('Could not copy the link', 'error'),
                          ),
                        )
                      }
                    />
                  </Command.Group>

                  <Command.Group heading="View">
                    <Item value="toggle-palette" icon={PanelLeft} label="Toggle resource palette" shortcut={`${MOD} B`} onSelect={() => run(() => togglePanel('palette'))} />
                    <Item value="toggle-code" icon={Code2} label="Toggle code editor" shortcut={`${MOD} J`} onSelect={() => run(() => togglePanel('code'))} />
                    <Item value="toggle-inspector" icon={PanelRight} label="Toggle inspector" shortcut={`${MOD} I`} onSelect={() => run(() => togglePanel('inspector'))} />
                  </Command.Group>

                  {resources.length > 0 ? (
                    <Command.Group heading="Go to resource">
                      {resources.map((r) => {
                        const def = getDef(r.type);
                        return (
                          <Item
                            key={r.id}
                            value={`goto ${r.id}`}
                            label={r.name}
                            hint={def?.displayName ?? r.type}
                            keywords={[r.id, r.type, def?.displayName ?? '']}
                            onSelect={() =>
                              run(() => {
                                editor().setSelection(r.id, 'canvas');
                                canvasApi()?.focusNode(r.id);
                              })
                            }
                          >
                            <ResourceIcon category={def?.category ?? 'compute'} type={r.type} size={26} />
                          </Item>
                        );
                      })}
                    </Command.Group>
                  ) : null}

                  <Command.Group heading="Files">
                    {orderedFiles(files).map((f) => (
                      <Item key={f} value={`file ${f}`} icon={FileCode2} label={f} keywords={['open', 'tab']} onSelect={() => run(() => editor().setActiveFile(f))} />
                    ))}
                  </Command.Group>

                  {search ? (
                    <ResourceGroups
                      headingPrefix="Add · "
                      preferred={preferred}
                      onPick={(def) => run(() => canvasApi()?.addResource(def.type))}
                    />
                  ) : null}
                </>
              ) : null}

              <Command.Group heading="Projects">
                {projects.map((p) => (
                  <Item
                    key={p.id}
                    value={`project ${p.id}`}
                    icon={FolderOpen}
                    label={p.name}
                    hint={`Updated ${timeAgo(p.updatedAt)}`}
                    keywords={['open', 'project', p.description ?? '']}
                    onSelect={() => run(() => navigate(`/editor/${p.id}`))}
                  />
                ))}
                <Item
                  value="import-terraform"
                  icon={FileUp}
                  label="Import Terraform files…"
                  keywords={['upload', '.tf', 'zip', 'folder', 'existing']}
                  onSelect={() =>
                    run(async () => {
                      const picked = await pickTerraformFiles();
                      if (!picked) return;
                      const imported = await readTerraformFiles(picked);
                      if (!imported) {
                        showToast('No .tf files found in that selection', 'error');
                        return;
                      }
                      const project = createProject({
                        name: imported.name,
                        files: imported.files,
                        description: `Imported from ${Object.keys(imported.files).length} Terraform file(s).`,
                      });
                      showToast(`Imported “${imported.name}”`, 'success');
                      navigate(`/editor/${project.id}`);
                    })
                  }
                />
              </Command.Group>

              <Command.Group heading="New project from template">
                {TEMPLATES.map((t) => (
                  <Item
                    key={t.slug}
                    value={`template ${t.slug}`}
                    icon={LayoutTemplate}
                    label={t.name}
                    hint={t.providers.map((p) => p.toUpperCase()).join(' · ')}
                    keywords={[t.description, ...t.tags, 'new', 'create']}
                    onSelect={() =>
                      run(() => {
                        const project = createProject({
                          name: t.name,
                          files: t.build(slugify(t.name)),
                          templateSlug: t.slug,
                          description: t.description,
                        });
                        navigate(`/editor/${project.id}`);
                      })
                    }
                  />
                ))}
              </Command.Group>

              <Command.Group heading="Go to">
                <Item value="nav-dashboard" icon={LayoutDashboard} label="Projects" keywords={['dashboard', 'home']} onSelect={() => run(() => navigate('/dashboard'))} />
                <Item value="nav-tutorials" icon={GraduationCap} label="Tutorials" keywords={['learn', 'lessons']} onSelect={() => run(() => navigate('/tutorials'))} />
                <Item value="nav-landing" icon={BookOpen} label="About Cloud Blueprint" onSelect={() => run(() => navigate('/'))} />
                <Item
                  value="nav-github"
                  icon={Github}
                  label="Source on GitHub"
                  onSelect={() => run(() => window.open('https://github.com/pedromenuzzi/cloud-infra-blueprint', '_blank', 'noopener'))}
                />
              </Command.Group>

              <Command.Group heading="Preferences">
                <Item value="theme-light" icon={Sun} label="Light theme" hint={theme === 'light' ? 'active' : undefined} onSelect={() => run(() => setTheme('light'))} />
                <Item value="theme-dark" icon={Moon} label="Dark theme" hint={theme === 'dark' ? 'active' : undefined} onSelect={() => run(() => setTheme('dark'))} />
                <Item value="theme-system" icon={Monitor} label="System theme" hint={theme === 'system' ? 'active' : undefined} onSelect={() => run(() => setTheme('system'))} />
                <Item value="shortcuts" icon={Keyboard} label="Keyboard shortcuts" shortcut="?" onSelect={() => run(() => setShortcuts(true))} />
              </Command.Group>
            </>
          )}
        </Command.List>
        <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-faint">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft className="inline h-2.5 w-2.5" />
            </Kbd>{' '}
            select
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> close
          </span>
          <span className={cn('ml-auto', page === 'add' ? '' : 'hidden')}>
            <Kbd>⌫</Kbd> back
          </span>
        </div>
      </div>
    </Command.Dialog>
  );
}
