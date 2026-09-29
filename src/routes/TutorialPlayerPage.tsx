import { ArrowLeft, ArrowRight, Check, ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { diffAddedLines, HclSnippet } from '@/components/HclSnippet';
import { ProjectThumbnail } from '@/components/ProjectThumbnail';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Badge, Button, LogoMark } from '@/components/ui';
import { createProject, findProjectByOrigin, uniqueProjectName } from '@/lib/storage';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { cn } from '@/lib/utils';
import { getTutorial } from '@/tutorials';

const FILE_ORDER = ['main.tf', 'variables.tf', 'outputs.tf', 'providers.tf', 'versions.tf'];

function orderFiles(files: Record<string, string>): string[] {
  const keys = Object.keys(files);
  return [
    ...FILE_ORDER.filter((f) => keys.includes(f)),
    ...keys.filter((f) => !FILE_ORDER.includes(f)).sort(),
  ];
}

/** `backticks` in tutorial prose render as inline code */
function rich(text: string): ReactNode[] {
  return text.split('`').map((seg, i) =>
    i % 2 === 1 ? (
      <code
        key={i}
        className="rounded-[4px] bg-surface-2 px-1 py-px font-mono text-[11.5px] text-primary"
      >
        {seg}
      </code>
    ) : (
      <span key={i}>{seg}</span>
    ),
  );
}

export default function TutorialPlayerPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const tutorial = slug ? getTutorial(slug) : undefined;
  useDocumentTitle(tutorial ? `${tutorial.title} — Tutorials` : 'Tutorials');

  // the step lives in the URL (?step=2, 1-based) so a refresh or a shared link keeps it
  const [params, setParams] = useSearchParams();
  const total = tutorial?.steps.length ?? 1;
  const requested = Number.parseInt(params.get('step') ?? '1', 10);
  const stepIdx = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), total) - 1 : 0;
  const setStepIdx = useCallback(
    (next: number | ((i: number) => number)) => {
      const i = typeof next === 'function' ? next(stepIdx) : next;
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (i <= 0) out.delete('step');
          else out.set('step', String(i + 1));
          return out;
        },
        { replace: true },
      );
    },
    [setParams, stepIdx],
  );
  const step = tutorial?.steps[stepIdx];
  const [activeFile, setActiveFile] = useState('main.tf');

  useEffect(() => {
    if (!tutorial) navigate('/tutorials', { replace: true });
  }, [tutorial, navigate]);

  useEffect(() => {
    if (step) setActiveFile(step.focusFile ?? 'main.tf');
  }, [stepIdx, step]);

  const added = useMemo(() => {
    if (!tutorial || !step) return new Set<number>();
    // a file that first appears in this step counts as entirely new
    const prev = stepIdx > 0 ? (tutorial.steps[stepIdx - 1].files[activeFile] ?? '') : undefined;
    return diffAddedLines(prev, step.files[activeFile] ?? '');
  }, [tutorial, step, stepIdx, activeFile]);

  if (!tutorial || !step) return null;

  const openInEditor = () => {
    // reuse the untouched copy of this step made earlier instead of piling up duplicates
    const origin = `tutorial:${tutorial.slug}:${stepIdx + 1}`;
    const existing = findProjectByOrigin(origin, step.files);
    if (existing) {
      navigate(`/editor/${existing.id}`);
      return;
    }
    try {
      const project = createProject({
        name: uniqueProjectName(`${tutorial.title} — step ${stepIdx + 1}`),
        files: { ...step.files },
        description: `From the "${tutorial.title}" tutorial.`,
        origin,
      });
      navigate(`/editor/${project.id}`);
    } catch {
      /* storage full — the storage notice says so */
    }
  };

  const files = orderFiles(step.files);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-surface-1 px-2 sm:gap-3 sm:px-3">
        <Link to="/" aria-label="Home" className="shrink-0 rounded-sm p-1 hover:bg-surface-2">
          <LogoMark size={22} />
        </Link>
        <Link
          to="/tutorials"
          aria-label="Tutorials"
          className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Tutorials</span>
        </Link>
        <span className="hidden text-faint sm:inline">/</span>
        <h1 className="min-w-0 truncate text-[13.5px] font-semibold">{tutorial.title}</h1>
        <span className="hidden shrink-0 md:inline-flex">
          <Badge variant={tutorial.level === 'Beginner' ? 'success' : 'default'}>{tutorial.level}</Badge>
        </span>
        <div className="flex-1" />
        <span className="hidden shrink-0 text-[12px] text-faint sm:inline">
          Step {stepIdx + 1} of {tutorial.steps.length}
        </span>
        <Button size="sm" className="shrink-0" onClick={openInEditor} aria-label="Open this step in the editor">
          <span className="hidden lg:inline">Open this step in the editor</span>
          <span className="lg:hidden">Open in editor</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <LanguageSwitcher />
        <ThemeToggle />
      </header>

      {/* phones: lesson stacked above the diagram + code, the page scrolls */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        {/* lesson column */}
        <aside
          className="flex shrink-0 flex-col border-b bg-surface-1 md:w-80 md:border-b-0 md:border-r"
          aria-label="Lesson"
        >
          <nav className="border-b p-3" aria-label="Steps">
            {tutorial.steps.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStepIdx(i)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-[12.5px] transition-colors',
                  i === stepIdx
                    ? 'bg-primary-soft font-semibold text-primary'
                    : 'text-muted hover:bg-surface-2 hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-bold',
                    i < stepIdx
                      ? 'border-success bg-success text-white'
                      : i === stepIdx
                        ? 'border-primary text-primary'
                        : 'border-border-strong text-faint',
                  )}
                >
                  {i < stepIdx ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="truncate">{s.title}</span>
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 p-4 md:overflow-y-auto">
            <h2 className="text-[15px] font-semibold">{step.title}</h2>
            {step.body.map((p, i) => (
              <p key={i} className="mt-3 text-[13px] leading-relaxed text-muted">
                {rich(p)}
              </p>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 border-t p-3">
            <Button
              variant="outline"
              size="sm"
              disabled={stepIdx === 0}
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Previous
            </Button>
            <span className="flex gap-1" aria-hidden="true">
              {tutorial.steps.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    i === stepIdx ? 'bg-primary' : i < stepIdx ? 'bg-success/60' : 'bg-border-strong',
                  )}
                />
              ))}
            </span>
            {stepIdx < tutorial.steps.length - 1 ? (
              <Button size="sm" onClick={() => setStepIdx((i) => i + 1)}>
                Next <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button size="sm" onClick={openInEditor}>
                Keep building <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </aside>

        {/* diagram + code */}
        <main className="flex min-w-0 flex-1 flex-col">
          <section
            className="bp-dots relative h-64 shrink-0 border-b bg-canvas p-4 md:h-[42%]"
            aria-label="Diagram"
          >
            <ProjectThumbnail
              key={`${tutorial.slug}-${stepIdx}`}
              files={step.files}
              detailed
              className="h-full w-full text-foreground"
            />
            <span className="absolute left-3 top-3 rounded-full border bg-surface-1 px-2.5 py-0.5 text-[11px] font-medium text-muted shadow-xs">
              Blueprint — updates with each step
            </span>
          </section>

          <section className="flex min-h-[360px] flex-1 flex-col md:min-h-0" aria-label="Code">
            <div className="flex items-center gap-0.5 overflow-x-auto border-b bg-surface-1 px-1.5 pt-1">
              {files.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setActiveFile(f)}
                  className={cn(
                    'shrink-0 rounded-t-[6px] border border-b-0 px-3 py-1.5 font-mono text-[11.5px] transition-colors',
                    activeFile === f
                      ? 'border-border bg-surface-2 font-semibold text-foreground'
                      : 'border-transparent text-muted hover:text-foreground',
                  )}
                >
                  {f}
                </button>
              ))}
              <span className="ml-auto hidden shrink-0 items-center gap-1.5 pb-1 pr-2 text-[10.5px] text-faint sm:flex">
                <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-success/25" /> lines added
                in this step
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-surface-2/50 p-3">
              <HclSnippet
                code={step.files[activeFile] ?? ''}
                addedLines={activeFile === (step.focusFile ?? 'main.tf') || added.size > 0 ? added : undefined}
                className="min-h-full border"
              />
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
