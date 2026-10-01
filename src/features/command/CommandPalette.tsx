/**
 * ⌘K / Ctrl+K — one searchable place for everything: add resources, jump to
 * a resource or file, run canvas/editor actions, start from a template,
 * navigate, switch theme.
 */
import { Command } from 'cmdk';
import {
  ArrowLeft,
  BookOpen,
  Boxes,
  Code2,
  CopyPlus,
  CornerDownLeft,
  Download,
  FileCode2,
  FileImage,
  FileText,
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
  Route,
  ScanEye,
  Share2,
  ShieldCheck,
  Sun,
  Trash2,
  Undo2,
  WandSparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { showToast } from '@/components/Toast';
import { focusIsLost, Kbd, restoreFocus, useLayer } from '@/components/ui';
import { backupAmong, openRestore } from '@/features/data/dataDialogs';
import { ALIGN_ACTIONS, alignActionBlocker } from '@/features/editor/alignActions';
import { arrangeMessages } from '@/features/editor/arrange.messages';
import { canvasApi } from '@/features/editor/canvasApi';
import { openExportPdf } from '@/features/export/ExportPdfDialog';
import { LayoutCommands } from '@/features/editor/layoutCommands';
import { useLayout } from '@/features/editor/layoutStore';
import { openGithubImport } from '@/features/import/githubImportStore';
import { fixAllFindings, getAudit, useSecurityUi } from '@/features/security/securityStore';
import { ResourceGroups, wordFilter } from '@/features/editor/ResourcePicker';
import { orderedFiles, useEditor } from '@/features/editor/store';
import { securityUiMessages } from '@/features/security/messages';
import { BrazilFlag, UsFlag } from '@/components/flags';
import { LOCALES, useLocale } from '@/i18n/locale';
import { copyText, exportZip } from '@/lib/download';
import { REPO_URL } from '@/lib/links';
import { shareLinkInfo } from '@/lib/share';
import { importNote, pickTerraformFiles, readTerraformFiles } from '@/lib/importTf';
import { createProject, detectProviders, listProjects, uniqueProjectName, type Project } from '@/lib/storage';
import { cn, slugify, timeAgo } from '@/lib/utils';
import { ResourceIcon } from '@/resources/icons';
import { messagesFor, useMessages } from '@/i18n/messages';
import { resourceName } from '@/resources/i18n';
import { getDef, isContainerType } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import { templateDescription, templateName, templateSearchText } from '@/templates/i18n';
import { useTheme } from '@/theme/useTheme';
import { commandMessages } from './messages';
import { addModuleMessages } from '@/features/modules/AddModuleDialog.messages';
import { openAddModule } from '@/features/modules/addModuleStore';
import { isModuleId } from '@/ir/modules';
import { ModuleIcon } from '@/features/modules/ModuleIcon';
import { modulesMessages } from '@/features/modules/modules.messages';
import { MOD, takePaletteReturnFocus, usePalette } from './paletteStore';

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

/** Store a new project; null when storage is full (the storage notice already says so). */
function tryCreate(input: Parameters<typeof createProject>[0]): Project | null {
  try {
    return createProject(input);
  } catch {
    return null;
  }
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
  const selectedIds = useEditor((s) => s.selectedIds);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const editorReady = inEditor && projectId !== null;
  const ir = useEditor((s) => s.ir);
  const am = useMessages(arrangeMessages);
  const m = useMessages(commandMessages);
  const sm = useMessages(securityUiMessages);
  const addm = useMessages(addModuleMessages);
  const modm = useMessages(modulesMessages);
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  const arrangeTarget = selection ? ir.resources.find((r) => r.id === selection) : undefined;
  const audit = editorReady ? getAudit(ir, locale) : null;
  const fixable = audit ? audit.findings.filter((f) => f.fix).length : 0;
  const projects = useMemo(
    () => (open ? listProjects().filter((p) => !(inEditor && p.id === projectId)) : []),
    [open, inEditor, projectId],
  );
  const preferred = useMemo(() => (editorReady ? detectProviders(files) : []), [editorReady, files]);

  // in the layer stack so page shortcuts stand down; cmdk (Radix) closes itself on Esc
  useLayer(open);

  useEffect(() => {
    if (open) return;
    setSearch('');
    setPage('root');
    // cmdk's dialog has no trigger to refocus, so focus would drop to <body>:
    // give it back to what had it (after Radix's own unmount-focus, a 0 ms timer)
    const target = takePaletteReturnFocus();
    const timer = setTimeout(() => {
      if (focusIsLost()) restoreFocus(target);
    }, 0);
    return () => clearTimeout(timer);
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
      label={m.label}
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
              <ArrowLeft className="h-3 w-3" /> {m.addResourceBack}
            </button>
          ) : null}
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder={page === 'add' ? m.searchResources : m.search}
            className="bp-cmd-input !border-0 !px-1"
          />
        </div>
        <Command.List className="bp-cmd-list" label={m.results}>
          <Command.Empty className="px-3 py-8 text-center text-[13px] text-faint">
            {m.noResults(search)}
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
                  <Command.Group heading={m.group.canvas}>
                    <Item
                      value="add-resource"
                      icon={Plus}
                      label={m.addResource}
                      keywords={m.kw.add}
                      hint={m.addResourceHint}
                      onSelect={() => {
                        setSearch('');
                        setPage('add');
                      }}
                    />
                    <Item
                      value="add-module"
                      icon={Boxes}
                      label={addm.open}
                      keywords={addm.keywords}
                      hint={addm.openHint}
                      onSelect={() => run(openAddModule)}
                    />
                    <Item value="fit" icon={Maximize} label={m.fitView} shortcut="⇧1" onSelect={() => run(() => canvasApi()?.fitView())} />
                    <Item value="tidy" icon={WandSparkles} label={am.command} keywords={am.keywords} onSelect={() => run(() => void canvasApi()?.tidy())} />
                    {arrangeTarget && isContainerType(arrangeTarget.type) && ir.resources.some((r) => r.parentId === arrangeTarget.id) ? (
                      <Item
                        value="arrange-inside"
                        icon={WandSparkles}
                        label={am.arrangeInside(arrangeTarget.name)}
                        keywords={am.keywords}
                        onSelect={() => run(() => canvasApi()?.arrangeInside(arrangeTarget.id))}
                      />
                    ) : null}
                    <Item value="minimap" icon={MapIcon} label={m.toggleMinimap} onSelect={() => run(() => canvasApi()?.toggleMinimap())} />
                    {selection ? (
                      <>
                        {isModuleId(selection) ? null : (
                          <Item value="duplicate" icon={CopyPlus} label={m.duplicateSelected} shortcut={`${MOD} D`} onSelect={() => run(() => canvasApi()?.duplicate(selection))} />
                        )}
                        <Item value="reveal" icon={Code2} label={m.revealSelected} onSelect={() => run(() => editor().revealInCode(selection))} />
                        <Item
                          value="delete-selected"
                          icon={Trash2}
                          label={m.deleteSelected}
                          shortcut="Del"
                          onSelect={() => run(() => editor().deleteResources([selection]))}
                        />
                      </>
                    ) : null}
                  </Command.Group>

                  <Command.Group heading={m.group.security}>
                    <Item
                      value="security-audit"
                      icon={ShieldCheck}
                      label={m.securityAudit}
                      hint={audit?.grade ? m.grade(audit.grade) : undefined}
                      keywords={m.kw.audit}
                      onSelect={() => run(() => useSecurityUi.getState().setPanel(true))}
                    />
                    {selection && audit?.topology.access.get(selection)?.open.length ? (
                      <Item
                        value="security-why"
                        icon={Route}
                        label={sm.whyReachable(selection.split('.').slice(1).join('.'))}
                        keywords={m.kw.why}
                        onSelect={() => run(() => useSecurityUi.getState().explain(selection))}
                      />
                    ) : null}
                    <Item
                      value="security-lens"
                      icon={ScanEye}
                      label={m.toggleLens}
                      keywords={m.kw.lens}
                      onSelect={() => run(() => useSecurityUi.getState().toggleLens())}
                    />
                    {fixable > 0 ? (
                      <Item
                        value="security-fix-all"
                        icon={Wrench}
                        label={m.fixSecurity(fixable)}
                        keywords={m.kw.fix}
                        onSelect={() => run(fixAllFindings)}
                      />
                    ) : null}
                  </Command.Group>

                  {selectedIds.length > 1 ? (
                    <Command.Group heading={m.group.selection(selectedIds.length)}>
                      {ALIGN_ACTIONS.map((a) => (
                        <Item
                          key={a.id}
                          value={a.id}
                          icon={a.icon}
                          label={a.label}
                          keywords={m.kw.align}
                          disabled={alignActionBlocker(a, ir, selectedIds) !== null}
                          onSelect={() => run(() => editor().applyCanvasOps(a.ops(editor().ir, editor().selectedIds)))}
                        />
                      ))}
                    </Command.Group>
                  ) : null}

                  <Command.Group heading={m.group.edit}>
                    <Item value="undo" icon={Undo2} label={m.undo} shortcut={`${MOD} Z`} disabled={!canUndo} onSelect={() => run(() => editor().undo())} />
                    <Item value="redo" icon={Redo2} label={m.redo} shortcut={`${MOD} ⇧ Z`} disabled={!canRedo} onSelect={() => run(() => editor().redo())} />
                    <Item
                      value="export-zip"
                      icon={Download}
                      label={m.exportZip}
                      keywords={m.kw.download}
                      onSelect={() =>
                        run(() => {
                          exportZip(editor().projectName, editor().files);
                          showToast(messagesFor(commandMessages).zipDownloaded, 'success');
                        })
                      }
                    />
                    <Item value="export-pdf" icon={FileText} label={m.exportPdf} keywords={m.kw.pdf} onSelect={() => run(openExportPdf)} />
                    <Item value="export-png" icon={ImageDown} label={m.exportPng} keywords={m.kw.png} onSelect={() => run(() => void canvasApi()?.exportImage('png'))} />
                    <Item value="export-svg" icon={FileImage} label={m.exportSvg} keywords={m.kw.svg} onSelect={() => run(() => void canvasApi()?.exportImage('svg'))} />
                    <Item
                      value="share"
                      icon={Share2}
                      label={m.copyShareLink}
                      onSelect={() =>
                        run(() => {
                          const link = shareLinkInfo({ name: editor().projectName, files: editor().files });
                          if (link.tooLarge) {
                            showToast(link.warning!, 'error');
                            return;
                          }
                          void copyText(link.url).then(
                            () => showToast(link.warning ?? messagesFor(commandMessages).shareCopied, link.warning ? 'info' : 'success'),
                            () => showToast(messagesFor(commandMessages).copyFailed, 'error'),
                          );
                        })
                      }
                    />
                  </Command.Group>

                  <Command.Group heading={m.group.view}>
                    <Item value="toggle-palette" icon={PanelLeft} label={m.togglePalette} shortcut={`${MOD} B`} onSelect={() => run(() => togglePanel('palette'))} />
                    <Item value="toggle-code" icon={Code2} label={m.toggleCode} shortcut={`${MOD} J`} onSelect={() => run(() => togglePanel('code'))} />
                    <Item value="toggle-inspector" icon={PanelRight} label={m.toggleInspector} shortcut={`${MOD} I`} onSelect={() => run(() => togglePanel('inspector'))} />
                    <LayoutCommands render={(c) => <Item key={c.value} value={c.value} icon={c.icon} label={c.label} keywords={c.keywords} onSelect={() => run(c.run)} />} />
                  </Command.Group>

                  {resources.length > 0 || ir.modules.length > 0 ? (
                    <Command.Group heading={m.group.goToResource}>
                      {resources.map((r) => {
                        const def = getDef(r.type);
                        const name = def ? resourceName(r.type, locale) : r.type;
                        return (
                          <Item
                            key={r.id}
                            value={`goto ${r.id}`}
                            label={r.name}
                            hint={name}
                            keywords={[r.id, r.type, name, def?.displayName ?? '']}
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
                      {ir.modules.map((mod) => (
                        <Item
                          key={mod.id}
                          value={`goto ${mod.id}`}
                          label={mod.name}
                          hint={modm.typeLabel}
                          keywords={[mod.id, modm.typeLabel]}
                          onSelect={() =>
                            run(() => {
                              editor().setSelection(mod.id, 'canvas');
                              canvasApi()?.focusNode(mod.id);
                            })
                          }
                        >
                          <ModuleIcon size={26} />
                        </Item>
                      ))}
                    </Command.Group>
                  ) : null}

                  <Command.Group heading={m.group.files}>
                    {orderedFiles(files).map((f) => (
                      <Item key={f} value={`file ${f}`} icon={FileCode2} label={f} keywords={m.kw.file} onSelect={() =>
                          run(() => {
                            editor().setActiveFile(f);
                            // a file picked while the code pane is hidden should show up
                            if (!useLayout.getState().isOpen('code')) togglePanel('code');
                          })
                        } />
                    ))}
                  </Command.Group>

                  {search ? (
                    <ResourceGroups
                      headingPrefix={m.addPrefix}
                      preferred={preferred}
                      onPick={(def) => run(() => canvasApi()?.addResource(def.type))}
                    />
                  ) : null}
                </>
              ) : null}

              <Command.Group heading={m.group.projects}>
                {projects.map((p) => (
                  <Item
                    key={p.id}
                    value={`project ${p.id}`}
                    icon={FolderOpen}
                    label={p.name}
                    hint={m.updated(timeAgo(p.updatedAt, locale))}
                    keywords={[...m.kw.project, p.description ?? '']}
                    onSelect={() => run(() => navigate(`/editor/${p.id}`))}
                  />
                ))}
                <Item
                  value="import-terraform"
                  icon={FileUp}
                  label={m.importTerraform}
                  keywords={m.kw.importTf}
                  onSelect={() =>
                    run(async () => {
                      const picked = await pickTerraformFiles();
                      if (!picked) return;
                      // one of this app's backups: the dashboard's restore dialog, not an import
                      const backup = await backupAmong(picked);
                      if (backup) {
                        openRestore(backup);
                        navigate('/dashboard');
                        return;
                      }
                      const imported = await readTerraformFiles(picked);
                      const t = messagesFor(commandMessages);
                      if (!imported) {
                        showToast(t.noTfFiles, 'error');
                        return;
                      }
                      const project = tryCreate({
                        name: imported.name,
                        files: imported.files,
                        description: t.importedDescription(Object.keys(imported.files).length),
                      });
                      if (!project) return;
                      showToast(importNote(imported) ?? t.importedToast(imported.name), 'success');
                      navigate(`/editor/${project.id}`);
                    })
                  }
                />
                <Item
                  value="import-github"
                  icon={Github}
                  label={m.importGithub}
                  keywords={m.kw.importGithub}
                  onSelect={() => run(() => openGithubImport())}
                />
              </Command.Group>

              <Command.Group heading={m.group.templates}>
                {TEMPLATES.map((t) => (
                  <Item
                    key={t.slug}
                    value={`template ${t.slug}`}
                    icon={LayoutTemplate}
                    label={templateName(t, locale)}
                    hint={t.providers.map((p) => p.toUpperCase()).join(' · ')}
                    keywords={[templateSearchText(t), ...m.kw.template]}
                    onSelect={() =>
                      run(() => {
                        const name = uniqueProjectName(templateName(t));
                        const project = tryCreate({
                          name,
                          files: t.build(slugify(name)),
                          templateSlug: t.slug,
                          description: templateDescription(t),
                        });
                        if (project) navigate(`/editor/${project.id}`);
                      })
                    }
                  />
                ))}
              </Command.Group>

              <Command.Group heading={m.group.goTo}>
                <Item value="nav-dashboard" icon={LayoutDashboard} label={m.navProjects} keywords={m.kw.dashboard} onSelect={() => run(() => navigate('/dashboard'))} />
                <Item value="nav-tutorials" icon={GraduationCap} label={m.navTutorials} keywords={m.kw.tutorials} onSelect={() => run(() => navigate('/tutorials'))} />
                <Item value="nav-landing" icon={BookOpen} label={m.navLanding} onSelect={() => run(() => navigate('/'))} />
                <Item
                  value="nav-github"
                  icon={Github}
                  label={m.navGithub}
                  onSelect={() => run(() => window.open(REPO_URL, '_blank', 'noopener'))}
                />
              </Command.Group>

              <Command.Group heading={m.group.preferences}>
                <Item value="theme-light" icon={Sun} label={m.theme.light} hint={theme === 'light' ? m.active : undefined} onSelect={() => run(() => setTheme('light'))} />
                <Item value="theme-dark" icon={Moon} label={m.theme.dark} hint={theme === 'dark' ? m.active : undefined} onSelect={() => run(() => setTheme('dark'))} />
                <Item value="theme-system" icon={Monitor} label={m.theme.system} hint={theme === 'system' ? m.active : undefined} onSelect={() => run(() => setTheme('system'))} />
                {LOCALES.map((l) => (
                  <Item
                    key={l.id}
                    value={`locale-${l.id}`}
                    label={l.label}
                    hint={locale === l.id ? m.active : undefined}
                    keywords={m.kw.language}
                    onSelect={() => run(() => setLocale(l.id))}
                  >
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] border bg-surface-2">
                      {l.id === 'pt-BR' ? <BrazilFlag className="text-[15px]" /> : <UsFlag className="text-[15px]" />}
                    </span>
                  </Item>
                ))}
                <Item value="shortcuts" icon={Keyboard} label={m.shortcuts} shortcut="?" onSelect={() => run(() => setShortcuts(true))} />
              </Command.Group>
            </>
          )}
        </Command.List>
        <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-faint">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {m.navigate}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft className="inline h-2.5 w-2.5" />
            </Kbd>{' '}
            {m.select}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> {m.close}
          </span>
          <span className={cn('ml-auto', page === 'add' ? '' : 'hidden')}>
            <Kbd>⌫</Kbd> {m.back}
          </span>
        </div>
      </div>
    </Command.Dialog>
  );
}
