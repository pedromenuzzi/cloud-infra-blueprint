/**
 * "Import from GitHub": paste a link → list the Terraform root modules →
 * pick one → download it into a new local project. Everything runs in the
 * browser against GitHub's public endpoints (see lib/githubImport).
 */
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  FolderOpen,
  Gauge,
  GitBranch,
  Github,
  Info,
  KeyRound,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { richText } from '@/components/RichText';
import { showToast } from '@/components/Toast';
import { Badge, Button, Input, Modal } from '@/components/ui';
import { messagesFor, useMessages } from '@/i18n/messages';
import {
  fetchRootModule,
  findRootModules,
  formatBytes,
  githubWebUrl,
  GithubImportError,
  listGithub,
  listingLabel,
  parseGithubInput,
  planRootModule,
  resetTime,
  type GithubErrorCode,
  type GithubImport,
  type GithubOptions,
  type ImportProgress,
  type Listing,
  type RootModuleScan,
} from '@/lib/githubImport';
import { createProject, findProjectByOrigin, uniqueProjectName, type Project } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { closeGithubImport, useGithubImport } from './githubImportStore';
import { importMessages } from './messages';

type Step =
  | { name: 'source' }
  | { name: 'listing'; label: string; phase: 'repo' | 'tree' }
  | { name: 'pick'; listing: Listing; scan: RootModuleScan; selected: string }
  | { name: 'fetching'; listing: Listing; scan: RootModuleScan; selected: string; done: number; total: number }
  | { name: 'exists'; listing: Listing; scan: RootModuleScan; selected: string; result: GithubImport; existing: Project };

interface ShownError {
  message: string;
  code: GithubErrorCode | 'input' | 'storage';
}

const TOKEN_HELP = 'https://github.com/settings/personal-access-tokens/new';
/** codes a token can fix */
const TOKEN_FIXES = new Set<ShownError['code']>(['not-found', 'rate-limit', 'forbidden']);
const RETRYABLE = new Set<ShownError['code']>(['network', 'offline', 'server']);

function ErrorBox({ error, onToken, onRetry }: { error: ShownError; onToken?(): void; onRetry?(): void }) {
  const m = useMessages(importMessages);
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2.5 text-[12.5px] leading-relaxed"
    >
      <AlertTriangle className="mt-[3px] h-3.5 w-3.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="break-words">{error.message}</p>
        {onToken || onRetry ? (
          <div className="mt-1.5 flex gap-3">
            {onToken ? (
              <button type="button" onClick={onToken} className="text-[12px] font-semibold text-primary hover:underline">
                {m.addToken}
              </button>
            ) : null}
            {onRetry ? (
              <button type="button" onClick={onRetry} className="text-[12px] font-semibold text-primary hover:underline">
                {m.tryAgain}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RateMeter() {
  const rate = useGithubImport((s) => s.rate);
  const token = useGithubImport((s) => s.token);
  const m = useMessages(importMessages);
  const fresh = rate && rate.resetAt > Date.now() ? rate : null;
  if (!fresh) {
    return (
      <span className="flex min-w-0 items-center gap-1 text-[11px] text-faint">
        <Gauge className="h-3 w-3 shrink-0" />
        <span className="truncate">{m.requestsAnHour(token !== '')}</span>
      </span>
    );
  }
  const low = fresh.remaining <= Math.max(3, fresh.limit * 0.1);
  return (
    <span
      className={cn('flex min-w-0 items-center gap-1 text-[11px] tabular-nums', low ? 'font-semibold text-warning' : 'text-faint')}
      title={m.rateTitle(resetTime(fresh))}
      data-testid="gh-rate"
    >
      <Gauge className="h-3 w-3 shrink-0" />
      <span className="truncate">
        {fresh.remaining === 0 ? m.rateReached(resetTime(fresh)) : m.requestsLeft(fresh.remaining, fresh.limit)}
      </span>
    </span>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t px-5 py-3 max-sm:flex-wrap max-sm:px-4">
      {/* phones: the meter gets its own row above the buttons */}
      <span className="mr-auto min-w-0 flex-1 max-sm:basis-full">
        <RateMeter />
      </span>
      {children}
    </div>
  );
}

function TokenField({ inputRef }: { inputRef: React.RefObject<HTMLInputElement> }) {
  const token = useGithubImport((s) => s.token);
  const id = useId();
  const hintId = useId();
  const m = useMessages(importMessages);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {m.token} <span className="font-normal text-faint">{m.optional}</span>
        </label>
        {token ? (
          <button
            type="button"
            onClick={() => {
              useGithubImport.setState({ token: '', rate: null });
              inputRef.current?.focus();
            }}
            className="text-[11.5px] font-semibold text-primary hover:underline"
          >
            {m.forgetToken}
          </button>
        ) : null}
      </div>
      <Input
        ref={inputRef}
        id={id}
        type="password"
        value={token}
        onChange={(e) => useGithubImport.setState({ token: e.target.value.trim(), rate: null })}
        placeholder="github_pat_…"
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hintId}
        data-1p-ignore=""
        data-lpignore="true"
        data-bwignore=""
        data-form-type="other"
      />
      <p id={hintId} className="mt-1.5 flex gap-1.5 text-[11px] leading-snug text-faint">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-success" />
        <span>
          {m.tokenHint}{' '}
          <a href={TOKEN_HELP} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
            {m.createToken}
            <ArrowUpRight className="ml-0.5 inline h-3 w-3" />
          </a>
        </span>
      </p>
    </div>
  );
}

export default function GithubImportDialog() {
  const navigate = useNavigate();
  const prefill = useGithubImport((s) => s.prefill);
  const fromLink = useGithubImport((s) => s.fromLink);
  const token = useGithubImport((s) => s.token);
  const [input, setInput] = useState(prefill);
  const [step, setStep] = useState<Step>({ name: 'source' });
  const [error, setError] = useState<ShownError | null>(null);
  const [tokenOpen, setTokenOpen] = useState(token !== '');
  const [filter, setFilter] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const errorId = useId();
  const hintId = useId();
  const m = useMessages(importMessages);
  /** what importing the picked root module takes: its files and those of the child modules it calls */
  const [plan, setPlan] = useState<{ dir: string; files: number; moduleFiles: number; moduleDirs: number } | 'counting' | null>(null);

  // counting what the pick takes reads its files (and its modules'): the import then reuses them
  const picking = step.name === 'pick' ? step : null;
  useEffect(() => {
    if (!picking) return;
    const module = picking.scan.modules.find((mod) => mod.dir === picking.selected);
    if (!module) return;
    const controller = new AbortController();
    setPlan('counting');
    const timer = setTimeout(() => {
      planRootModule(picking.listing, module, options(controller.signal))
        .then((p) => !controller.signal.aborted && setPlan({ dir: module.dir, ...p }))
        .catch(() => !controller.signal.aborted && setPlan(null));
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking?.listing, picking?.selected]);
  const pickedPlan = picking && plan !== 'counting' && plan?.dir === picking.selected ? plan : null;

  // closing the dialog stops whatever is in flight
  useEffect(() => () => abortRef.current?.abort(), []);

  // keep focus on something that exists as the steps swap (the old step's control is gone)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (step.name === 'listing' || step.name === 'fetching') cancelRef.current?.focus();
      else if (step.name === 'pick') listRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
      else if (step.name === 'exists') primaryRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [step.name]);

  const close = () => closeGithubImport();

  const options = (signal: AbortSignal, onProgress?: (p: ImportProgress) => void): GithubOptions => ({
    token: useGithubImport.getState().token || undefined,
    signal,
    onProgress,
    onRateLimit: (rate) => useGithubImport.setState({ rate }),
  });

  const fail = (err: unknown, back: Step) => {
    if (err instanceof GithubImportError && err.code === 'aborted') return;
    const shown: ShownError =
      err instanceof GithubImportError
        ? { message: err.message, code: err.code }
        : { message: messagesFor(importMessages).somethingWrong, code: 'server' };
    setError(shown);
    setStep(back);
    if (back.name === 'source') requestAnimationFrame(() => inputRef.current?.focus());
  };

  const find = async (e?: FormEvent) => {
    e?.preventDefault();
    const parsed = parseGithubInput(input);
    if (!parsed.ok) {
      setError({ message: parsed.error, code: 'input' });
      inputRef.current?.focus();
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setFilter('');
    const target = parsed.target;
    const label = target.kind === 'gist' ? m.theGist : `${target.owner}/${target.repo}`;
    setStep({ name: 'listing', label, phase: 'tree' });
    try {
      const listing = await listGithub(
        target,
        options(controller.signal, (p) => {
          if (p.phase === 'repo' || p.phase === 'tree') setStep({ name: 'listing', label, phase: p.phase });
        }),
      );
      if (controller.signal.aborted) return;
      const scan = findRootModules(listing.files, listing.basePath);
      if (scan.modules.length === 0) {
        const where = `${listingLabel(listing)}${listing.basePath ? `/${listing.basePath}` : ''}`;
        const text = messagesFor(importMessages);
        const why = scan.childModuleFiles > 0 ? text.onlyChildModules : listing.truncated ? text.tooLargeToList : '.';
        fail(new GithubImportError('no-terraform', `${text.noRootModule(where)}${why}`), { name: 'source' });
        return;
      }
      setStep({ name: 'pick', listing, scan, selected: scan.modules[0]!.dir });
    } catch (err) {
      if (!controller.signal.aborted) fail(err, { name: 'source' });
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (step.name === 'fetching') setStep({ name: 'pick', listing: step.listing, scan: step.scan, selected: step.selected });
    else {
      setStep({ name: 'source' });
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const store = (result: GithubImport) => {
    let project: Project;
    try {
      project = createProject({
        name: uniqueProjectName(result.imported.name),
        files: result.imported.files,
        description: result.description,
        origin: result.origin,
        rootPath: result.imported.rootDir,
      });
    } catch {
      setError({ message: messagesFor(importMessages).storageFull, code: 'storage' });
      return;
    }
    close();
    showToast(result.note ?? messagesFor(importMessages).imported(project.name), result.note ? 'info' : 'success');
    navigate(`/editor/${project.id}`);
  };

  const importSelected = async (e?: FormEvent) => {
    e?.preventDefault();
    if (step.name !== 'pick') return;
    const { listing, scan, selected } = step;
    const module = scan.modules.find((m) => m.dir === selected);
    if (!module) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    const back: Step = { name: 'pick', listing, scan, selected };
    setStep({ ...back, name: 'fetching', done: 0, total: module.files.length });
    try {
      const result = await fetchRootModule(
        listing,
        module,
        scan.childModuleFiles,
        options(controller.signal, (p) => {
          if (p.phase === 'files') setStep({ ...back, name: 'fetching', done: p.done, total: p.total });
        }),
      );
      if (controller.signal.aborted) return;
      // the same version imported before: offer it rather than a duplicate
      const existing = findProjectByOrigin(result.origin, result.imported.files);
      if (existing) {
        setStep({ ...back, name: 'exists', result, existing });
        return;
      }
      setStep(back);
      store(result);
    } catch (err) {
      if (!controller.signal.aborted) fail(err, back);
    }
  };

  const showToken = () => {
    setTokenOpen(true);
    requestAnimationFrame(() => tokenRef.current?.focus());
  };

  const errorActions = error
    ? {
        onToken: TOKEN_FIXES.has(error.code) && !token && !(tokenOpen && step.name === 'source') ? showToken : undefined,
        onRetry: RETRYABLE.has(error.code) ? () => void (step.name === 'pick' ? importSelected() : find()) : undefined,
      }
    : {};

  const title = (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-2 text-foreground">
        <Github className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-tight">{m.title}</span>
        <span className="block truncate text-[12px] text-muted">{m.subtitle}</span>
      </span>
    </span>
  );

  return (
    <Modal open onClose={close} title={title}>
      {step.name === 'source' ? (
        <>
          <form id="gh-import-form" onSubmit={(e) => void find(e)} className="space-y-4 p-5 max-sm:p-4" noValidate>
            <div>
              <label htmlFor="gh-import-url" className="mb-1 block text-xs font-medium text-muted">
                {m.linkLabel}
              </label>
              <Input
                ref={inputRef}
                id="gh-import-url"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (error?.code === 'input') setError(null);
                }}
                placeholder="github.com/owner/repo/tree/main/infra"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                inputMode="url"
                autoFocus={!fromLink}
                aria-invalid={error?.code === 'input' || undefined}
                aria-describedby={cn(hintId, error ? errorId : '') || undefined}
                className="font-mono text-[12.5px]"
              />
              <p id={hintId} className="mt-1.5 text-[11px] leading-snug text-faint">
                {richText(m.linkHint)}
              </p>
            </div>
            {error ? (
              <div id={errorId}>
                <ErrorBox error={error} {...errorActions} />
              </div>
            ) : null}
            {tokenOpen ? (
              <TokenField inputRef={tokenRef} />
            ) : (
              <button
                type="button"
                onClick={showToken}
                aria-expanded={false}
                className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
              >
                <KeyRound className="h-3.5 w-3.5" /> {m.useToken}
              </button>
            )}
          </form>
          <Footer>
            <Button variant="outline" onClick={close}>
              {m.cancel}
            </Button>
            <Button ref={primaryRef} type="submit" form="gh-import-form" data-autofocus={fromLink ? '' : undefined}>
              {m.findTerraform}
            </Button>
          </Footer>
        </>
      ) : null}

      {step.name === 'listing' ? (
        <>
          <div className="flex flex-col items-center px-5 py-10 text-center" role="status" aria-live="polite">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="mt-3 max-w-full truncate text-[13.5px] font-medium">{m.looking(step.label)}</p>
            <p className="mt-1 text-[12px] text-muted">
              {step.phase === 'repo' ? m.findingBranch : m.listingFiles}
            </p>
          </div>
          <Footer>
            <Button ref={cancelRef} variant="outline" onClick={cancel}>
              {m.cancel}
            </Button>
          </Footer>
        </>
      ) : null}

      {step.name === 'pick' || step.name === 'fetching' || step.name === 'exists' ? (
        <PickStep
          step={step}
          filter={filter}
          onFilter={setFilter}
          listRef={listRef}
          error={error}
          errorActions={errorActions}
          onSelect={(dir) => step.name === 'pick' && setStep({ ...step, selected: dir })}
          onSubmit={(e) => void importSelected(e)}
          plan={step.name === 'pick' ? (plan === 'counting' ? 'counting' : pickedPlan) : null}
          planId={`${hintId}-modules`}
        />
      ) : null}

      {step.name === 'pick' ? (
        <Footer>
          <Button
            variant="ghost"
            onClick={() => {
              setError(null);
              setStep({ name: 'source' });
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {m.back}
          </Button>
          <Button type="submit" form="gh-import-pick" aria-describedby={pickedPlan?.moduleFiles ? `${hintId}-modules` : undefined}>
            {m.importFiles(pickedPlan?.files ?? step.scan.modules.find((mod) => mod.dir === step.selected)?.files.length ?? 0)}
          </Button>
        </Footer>
      ) : null}

      {step.name === 'fetching' ? (
        <Footer>
          <Button ref={cancelRef} variant="outline" onClick={cancel}>
            {m.cancel}
          </Button>
          <Button disabled>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {m.importing}
          </Button>
        </Footer>
      ) : null}

      {step.name === 'exists' ? (
        <Footer>
          <Button
            variant="outline"
            onClick={() => {
              setStep({ name: 'pick', listing: step.listing, scan: step.scan, selected: step.selected });
              store(step.result);
            }}
          >
            {m.importAnotherCopy}
          </Button>
          <Button
            ref={primaryRef}
            onClick={() => {
              close();
              navigate(`/editor/${step.existing.id}`);
            }}
          >
            {m.openExistingCopy}
          </Button>
        </Footer>
      ) : null}
    </Modal>
  );
}

type PickLike = Extract<Step, { name: 'pick' | 'fetching' | 'exists' }>;

function PickStep({
  step,
  filter,
  onFilter,
  listRef,
  error,
  errorActions,
  onSelect,
  onSubmit,
  plan,
  planId,
}: {
  plan: { moduleFiles: number; moduleDirs: number } | 'counting' | null;
  planId: string;
  step: PickLike;
  filter: string;
  onFilter(value: string): void;
  listRef: React.RefObject<HTMLDivElement>;
  error: ShownError | null;
  errorActions: { onToken?(): void; onRetry?(): void };
  onSelect(dir: string): void;
  onSubmit(e: FormEvent): void;
}) {
  const { listing, scan, selected } = step;
  const busy = step.name !== 'pick';
  const groupId = useId();
  const m = useMessages(importMessages);
  const terms = filter.trim().toLowerCase();
  const shown = useMemo(
    () => (terms ? scan.modules.filter((mod) => (mod.dir || '/').toLowerCase().includes(terms)) : scan.modules),
    [scan.modules, terms],
  );
  const count = scan.modules.length;

  return (
    <form id="gh-import-pick" onSubmit={onSubmit} className="space-y-3 p-5 max-sm:p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <a
          href={githubWebUrl(listing)}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-1 text-[13px] font-semibold hover:text-primary hover:underline"
        >
          <span className="truncate">{listingLabel(listing)}</span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-faint" />
        </a>
        {listing.kind === 'repo' ? (
          <Badge variant="outline" className="max-w-[12rem] font-mono">
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate">{listing.ref}</span>
          </Badge>
        ) : null}
      </div>
      <p id={groupId} className="text-[12.5px] text-muted">
        {count === 1 ? m.oneModule : m.manyModules(count)}
      </p>
      {count > 8 ? (
        <Input
          type="search"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder={m.filterPlaceholder}
          aria-label={m.filterLabel}
          disabled={busy}
        />
      ) : null}
      <fieldset disabled={busy}>
        <div
          ref={listRef}
          role="radiogroup"
          aria-labelledby={groupId}
          className="max-h-[min(300px,42vh)] divide-y overflow-y-auto rounded-md border"
        >
          {shown.map((mod) => (
            <label
              key={mod.dir}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface-2',
                selected === mod.dir && 'bg-primary-soft hover:bg-primary-soft',
              )}
            >
              <input
                type="radio"
                name="gh-module"
                value={mod.dir}
                checked={selected === mod.dir}
                onChange={() => onSelect(mod.dir)}
                className="h-3.5 w-3.5 shrink-0 accent-primary"
              />
              <FolderOpen className={cn('h-4 w-4 shrink-0', selected === mod.dir ? 'text-primary' : 'text-faint')} />
              <span className="min-w-0 flex-1">
                {mod.dir ? (
                  <span className="block truncate font-mono text-[12px] font-medium" title={mod.dir}>
                    {mod.dir}
                  </span>
                ) : (
                  <span className="block truncate text-[12.5px] font-semibold">{m.repositoryRoot}</span>
                )}
                <span className="block text-[11px] text-faint">
                  {m.files(mod.files.length)} · {formatBytes(mod.bytes)}
                  {mod.linked && listing.basePath ? m.fromYourLink : ''}
                </span>
              </span>
            </label>
          ))}
          {shown.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12px] text-faint">{m.noFolderMatch(filter)}</p>
          ) : null}
        </div>
      </fieldset>
      {plan === 'counting' ? (
        <p role="status" className="flex items-center gap-1.5 text-[11.5px] leading-snug text-faint">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span>{m.countingModules}</span>
        </p>
      ) : plan && plan.moduleFiles > 0 ? (
        <p id={planId} role="status" className="flex gap-1.5 text-[11.5px] leading-snug text-muted">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{m.withModules(plan.moduleFiles, plan.moduleDirs)}</span>
        </p>
      ) : null}
      {scan.childModuleFiles > 0 ? (
        <p className="flex gap-1.5 text-[11.5px] leading-snug text-faint">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{richText(m.childModulesLeftOut(scan.childModuleFiles))}</span>
        </p>
      ) : null}
      {listing.truncated ? (
        <p className="flex gap-1.5 text-[11.5px] leading-snug text-warning">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{m.repoTruncated}</span>
        </p>
      ) : null}

      {step.name === 'fetching' ? (
        <div role="status" aria-live="polite" className="space-y-1.5">
          <div className="flex justify-between text-[12px] text-muted">
            <span>{m.downloading(step.done, step.total)}</span>
            <span className="tabular-nums">{step.total ? Math.round((step.done / step.total) * 100) : 0}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={m.downloadProgress}
            aria-valuemin={0}
            aria-valuemax={step.total}
            aria-valuenow={step.done}
            className="h-1.5 overflow-hidden rounded-full bg-surface-2"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${step.total ? (step.done / step.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : null}

      {step.name === 'exists' ? (
        <p role="status" className="rounded-md border bg-surface-2/60 px-3 py-2 text-[12.5px] leading-relaxed">
          {m.alreadyImported(step.existing.name)}
        </p>
      ) : null}

      {error ? <ErrorBox error={error} {...errorActions} /> : null}
    </form>
  );
}
