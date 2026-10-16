import {
  ArrowRight,
  Award,
  Boxes,
  Check,
  FileDown,
  FileUp,
  Footprints,
  Github,
  GraduationCap,
  Keyboard,
  Lock,
  MousePointerClick,
  PenTool,
  Play,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Trophy,
  WandSparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hlLine } from '@/components/HclSnippet';
import { ProjectThumbnail } from '@/components/ProjectThumbnail';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, buttonClass, Kbd, Logo } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { REPO_URL } from '@/lib/links';
import { createProject, openDemoProject, uniqueProjectName } from '@/lib/storage';
import { otherShortcut, PLATFORM, shortcut } from '@/lib/keys';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { cn, slugify } from '@/lib/utils';
import { resourceShortName } from '@/resources/i18n';
import { CATEGORY_COLORS, ProviderChip, ProviderDot, ResourceIcon } from '@/resources/icons';
import { allDefs, getDef } from '@/resources/registry';
import type { Category } from '@/resources/types';
import { getTemplate, TEMPLATES } from '@/templates';
import { templateDescription, templateName } from '@/templates/i18n';
import { prefersReducedMotion, scrollBehavior } from '@/lib/motion';
import { prefetchWhenIdle, warmOn } from '@/lib/routeChunks';
import { landingMessages } from './LandingPage.messages';

type Text = (typeof landingMessages)['en'];

/* ------------------------------------------------------------ hero demo */

const HERO_CODE = `resource "aws_apigatewayv2_api" "api" {
  name          = "orders-api"
  protocol_type = "HTTP"
}

resource "aws_lambda_function" "handler" {
  function_name = "orders-handler"
  runtime       = "nodejs22.x"
  role          = aws_iam_role.lambda.arn
  environment {
    variables = { TABLE = aws_dynamodb_table.orders.name }
  }
}

resource "aws_dynamodb_table" "orders" {
  name         = "orders"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
}

resource "aws_iam_role" "lambda" {
  name               = "orders-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda.json
}

resource "aws_sqs_queue" "events" {
  name = "order-events"
}`.split('\n');

const NODE_W = 172;
const NODE_H = 58;
/** subtitles: code (`nodejs22.x`), a product name, or a word from the messages */
const HERO_NODES = [
  { id: 'api', type: 'aws_apigatewayv2_api', subtitle: (_: Text) => 'HTTP API', x: 20, y: 30 },
  { id: 'handler', type: 'aws_lambda_function', subtitle: (_: Text) => 'nodejs22.x', x: 222, y: 30 },
  { id: 'orders', type: 'aws_dynamodb_table', subtitle: (m: Text) => m.subtitleOnDemand, x: 424, y: 30 },
  { id: 'lambda', type: 'aws_iam_role', subtitle: (m: Text) => m.subtitleRole, x: 222, y: 180 },
  { id: 'events', type: 'aws_sqs_queue', subtitle: (m: Text) => m.subtitleQueue, x: 424, y: 180 },
] as const;
const HERO_EDGES: Array<[string, string, 'reference' | 'security']> = [
  ['api', 'handler', 'reference'],
  ['handler', 'orders', 'reference'],
  ['handler', 'lambda', 'security'],
  ['handler', 'events', 'reference'],
];
const CANVAS_W = 616;
const CANVAS_H = 268;

/** first/last line of each resource block in HERO_CODE */
function blockRange(id: string): [number, number] {
  const start = HERO_CODE.findIndex((l) => new RegExp(`^resource "\\w+" "${id}"`).test(l));
  let end = start;
  while (end < HERO_CODE.length && HERO_CODE[end] !== '}') end++;
  return [start, end];
}

function useFitScale(baseWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / baseWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [baseWidth]);
  return { ref, scale };
}

function HeroDemo() {
  const m = useMessages(landingMessages);
  const [active, setActive] = useState(1);
  // the dots travelling the edges are SVG animations: CSS's reduced-motion rule doesn't reach them
  const [still] = useState(prefersReducedMotion);
  const { ref, scale } = useFitScale(CANVAS_W);
  const codeRef = useRef<HTMLDivElement>(null);

  // walk through the resources to show the diagram ↔ code sync
  useEffect(() => {
    if (still) return;
    const t = setInterval(() => setActive((i) => (i + 1) % HERO_NODES.length), 2600);
    return () => clearInterval(t);
  }, [still]);

  const activeId = HERO_NODES[active].id;
  const [from, to] = blockRange(activeId);

  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    // two lines of context above the block, landing on a line's edge (12 px: the list's top padding)
    el.scrollTo({ top: Math.max(0, 12 + (from - 2) * 18), behavior: scrollBehavior() });
  }, [from]);

  const pos = new Map(HERO_NODES.map((n) => [n.id, n] as const));
  const side = (a: (typeof HERO_NODES)[number], b: (typeof HERO_NODES)[number]) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? { x: a.x + NODE_W, y: a.y + NODE_H / 2 } : { x: a.x, y: a.y + NODE_H / 2 };
    }
    return dy >= 0 ? { x: a.x + NODE_W / 2, y: a.y + NODE_H } : { x: a.x + NODE_W / 2, y: a.y };
  };

  return (
    <div className="relative mx-auto mt-16 w-full max-w-5xl">
      <div className="bp-hero-glow" aria-hidden="true" />
      <div className="relative overflow-hidden rounded-[18px] border bg-surface-1 shadow-[0_30px_80px_-20px_rgb(15_23_42/0.35)]">
        <div className="flex items-center gap-2 border-b bg-surface-2/70 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <div className="ml-3 flex h-6 items-center gap-2 rounded-[7px] border bg-surface-1 px-3 text-[11px] text-faint">
            <Lock className="h-3 w-3" /> cloud-blueprint · orders-service
          </div>
          <span className="ml-auto hidden items-center gap-1 text-[11px] text-faint sm:flex">
            <Kbd>{shortcut('mod', 'K')}</Kbd>
          </span>
        </div>
        {/* minmax(0, …): the code's long lines must not widen the canvas column past the frame */}
        <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div ref={ref} className="bp-dots relative border-b bg-canvas md:border-b-0 md:border-r" style={{ height: CANVAS_H * scale + 40 }}>
            <div
              className="absolute left-1/2 top-5 origin-top"
              style={{ width: CANVAS_W, height: CANVAS_H, transform: `translateX(-50%) scale(${scale})` }}
            >
              <svg className="absolute inset-0 overflow-visible" width={CANVAS_W} height={CANVAS_H} aria-hidden="true">
                {HERO_EDGES.map(([s, t, kind]) => {
                  const a = pos.get(s as never)!;
                  const b = pos.get(t as never)!;
                  const p1 = side(a, b);
                  const p2 = side(b, a);
                  const horizontal = p1.y === p2.y || Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y);
                  const d = horizontal
                    ? `M${p1.x},${p1.y} C${(p1.x + p2.x) / 2},${p1.y} ${(p1.x + p2.x) / 2},${p2.y} ${p2.x},${p2.y}`
                    : `M${p1.x},${p1.y} C${p1.x},${(p1.y + p2.y) / 2} ${p2.x},${(p1.y + p2.y) / 2} ${p2.x},${p2.y}`;
                  const hot = s === activeId || t === activeId;
                  const color = kind === 'security' ? 'var(--edge-security)' : 'var(--edge-ref)';
                  return (
                    <g key={`${s}-${t}`}>
                      <path d={d} fill="none" stroke={color} strokeWidth={hot ? 2.2 : 1.6} strokeOpacity={hot ? 1 : 0.5} strokeDasharray={kind === 'security' ? '6 5' : undefined} />
                      {hot && !still ? (
                        <circle r={3.5} fill={color} className="bp-edge-dot">
                          <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
                        </circle>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
              {HERO_NODES.map((n, i) => {
                const def = getDef(n.type)!;
                const selected = n.id === activeId;
                const c = CATEGORY_COLORS[def.category];
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setActive(i)}
                    className="absolute flex items-center gap-2.5 rounded-[11px] border bg-node px-2.5 text-left shadow-sm transition-all duration-300"
                    style={{
                      left: n.x,
                      top: n.y,
                      width: NODE_W,
                      height: NODE_H,
                      borderColor: selected ? 'transparent' : 'var(--node-border)',
                      boxShadow: selected
                        ? `0 0 0 2px ${c.solid}, 0 12px 28px -10px color-mix(in srgb, ${c.solid} 60%, transparent)`
                        : undefined,
                      transform: selected ? 'translateY(-2px)' : undefined,
                    }}
                  >
                    <ResourceIcon category={def.category} type={def.type} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[9px] font-bold uppercase tracking-[0.07em]" style={{ color: `var(--cat-text-${def.category})` }}>
                        {resourceShortName(def.type)}
                      </span>
                      <span className="block truncate text-[12.5px] font-semibold leading-tight text-foreground" translate="no">
                        {n.id}
                      </span>
                      <span className="block truncate text-[10.5px] text-muted">{n.subtitle(m)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full border bg-surface-1/90 px-2.5 py-1 text-[11px] font-medium text-muted shadow-xs backdrop-blur">
              <MousePointerClick className="h-3 w-3" /> {m.clickResource}
            </span>
          </div>
          <div className="relative">
          <div ref={codeRef} translate="no" className="h-[308px] overflow-hidden bg-surface-1 py-3 font-mono text-[11.5px] leading-[18px]">
            {HERO_CODE.map((line, i) => (
              <div
                key={i}
                className={cn(
                  'flex whitespace-pre pr-4 transition-colors duration-300',
                  i >= from && i <= to ? 'bg-primary/10' : '',
                )}
              >
                <span
                  className={cn(
                    'mr-3 w-8 shrink-0 select-none border-l-[3px] pr-2 text-right text-faint/70',
                    i >= from && i <= to ? 'border-primary text-muted' : 'border-transparent',
                  )}
                >
                  {i + 1}
                </span>
                <span className="text-muted">{hlLine(line, i)}</span>
              </div>
            ))}
          </div>
            {/* outside the scroller so it stays pinned to the bottom edge */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--surface-1)]" />
          </div>
        </div>
      </div>
      <span className="absolute -top-3.5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border bg-surface-1 px-3 py-1 text-[12px] font-semibold text-primary shadow-md">
        <Sparkles className="h-3.5 w-3.5" /> {m.liveSync}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- content */

/** the tiles; their words live in landingMessages.features */
/** a feature card's text; the keyboard card names this device's shortcut and the other platform's */
function featureBody(m: Text, key: keyof Text['features']): string {
  const { body } = m.features[key];
  if (typeof body === 'string') return body;
  return body(shortcut('mod', 'K'), m.keysOn[PLATFORM === 'mac' ? 'pc' : 'mac'](otherShortcut('mod', 'K')));
}

const FEATURES: Array<{ key: keyof Text['features']; icon: LucideIcon; category: Category }> = [
  { key: 'sync', icon: RefreshCw, category: 'network' },
  { key: 'clouds', icon: Boxes, category: 'compute' },
  { key: 'keyboard', icon: Keyboard, category: 'integration' },
  { key: 'layout', icon: WandSparkles, category: 'containers' },
  { key: 'import', icon: FileUp, category: 'storage' },
  { key: 'export', icon: FileDown, category: 'edge' },
  { key: 'private', icon: ShieldCheck, category: 'identity' },
  { key: 'diagnostics', icon: Sparkles, category: 'database' },
];

function FeatureTile({ icon: Icon, category }: { icon: LucideIcon; category: Category }) {
  const c = CATEGORY_COLORS[category];
  return (
    <span
      className="flex h-10 w-10 items-center justify-center rounded-[11px] text-white"
      style={{
        background: `linear-gradient(145deg, ${c.from}, ${c.to})`,
        boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.28), 0 6px 16px -6px color-mix(in srgb, ${c.solid} 60%, transparent)`,
      }}
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/* --------------------------------------------------------- learning map */

const LEARN_POINTS: Array<{ icon: LucideIcon; category: Category }> = [
  { icon: Route, category: 'network' },
  { icon: Trophy, category: 'compute' },
  { icon: SquareTerminal, category: 'containers' },
  { icon: Footprints, category: 'edge' },
];

/** the preview trail's stations: code, state, height on the wave */
const PREVIEW_STATIONS: Array<[string, 'done' | 'progress', number]> = [
  ['0.1', 'done', 1],
  ['0.2', 'done', 2],
  ['0.3', 'done', 1],
  ['0.4', 'progress', 0],
];

/** what the simulated terminal prints (Terraform's own words, never translated) */
const PREVIEW_TERMINAL: Array<[string, string]> = [
  ['$ terraform plan', 'text-foreground'],
  ['  + aws_vpc.main', 'text-success'],
  ['  + aws_subnet.public', 'text-success'],
  ['Plan: 2 to add, 0 to change, 0 to destroy.', 'text-muted'],
  ['$ terraform apply', 'text-foreground'],
  ['Apply complete! Resources: 2 added.', 'text-success'],
];

/** a level of the map and the simulated terminal, drawn here (the real map loads on /learn) */
function LearnPreview() {
  const m = useMessages(landingMessages);
  const cols = PREVIEW_STATIONS.length + 1;
  const at = (i: number, wave: number): [number, number] => [((i + 0.5) / cols) * 100, 34 + wave * 18];
  const points = [...PREVIEW_STATIONS.map(([, , wave], i) => at(i, wave)), at(cols - 1, 1)];
  return (
    <div role="img" aria-label={m.mapLabel} className="relative mx-auto w-full max-w-lg pb-36">
      <div aria-hidden="true" className="bp-island bp-lv-0 relative rounded-[20px] border p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="h-2.5 w-24 rounded-full bg-[color-mix(in_srgb,var(--lv)_35%,transparent)]" />
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full w-3/4 rounded-full bg-[var(--lv)]" />
          </span>
        </div>
        <div className="relative mt-3 h-[104px]">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 104" preserveAspectRatio="none">
            {points.slice(0, -1).map(([x, y], i) => {
              const [x2, y2] = points[i + 1];
              const mid = (x + x2) / 2;
              const d = `M${x} ${y} C${mid} ${y} ${mid} ${y2} ${x2} ${y2}`;
              return PREVIEW_STATIONS[i][1] === 'done' ? (
                <path key={i} d={d} fill="none" stroke="var(--lv)" strokeWidth={3.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              ) : (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke="var(--border-strong)"
                  strokeWidth={3}
                  strokeDasharray="0.5 9"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
          {PREVIEW_STATIONS.map(([code, state], i) => (
            <span
              key={code}
              className={cn(
                'absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full',
                state === 'done'
                  ? 'bp-medal'
                  : 'border-2 border-[color:var(--lv)] bg-surface-1 font-mono text-[11.5px] font-bold text-[color:var(--lv-text)]',
              )}
              style={{ left: `${points[i][0]}%`, top: points[i][1] }}
            >
              {state === 'done' ? <Check className="h-5 w-5" strokeWidth={2.6} /> : code}
              {state === 'progress' ? <span className="bp-pulse-ring absolute inset-0 rounded-full border-2 border-[color:var(--lv)]" /> : null}
            </span>
          ))}
          <span
            className="bp-medal-locked absolute flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
            style={{ left: `${points[cols - 1][0]}%`, top: points[cols - 1][1] }}
          >
            <Award className="h-5 w-5" />
          </span>
        </div>
      </div>
      <div aria-hidden="true" translate="no" className="absolute bottom-0 right-0 w-[86%] overflow-hidden rounded-[14px] border bg-surface-1 shadow-xl">
        <div className="flex items-center gap-1.5 border-b bg-surface-2/70 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
          <span className="h-2 w-2 rounded-full bg-[#febc2e]" />
          <span className="h-2 w-2 rounded-full bg-[#28c840]" />
          <span className="ml-2 font-mono text-[10.5px] text-faint">terraform</span>
        </div>
        <pre className="overflow-hidden px-3.5 py-3 font-mono text-[11px] leading-[1.65]">
          {PREVIEW_TERMINAL.map(([line, color]) => (
            <span key={line} className={cn('block whitespace-pre', color)}>
              {line}
            </span>
          ))}
        </pre>
      </div>
      <span
        aria-hidden="true"
        translate="no"
        className="absolute -left-1 top-[9%] flex -rotate-6 items-center gap-1 rounded-full bg-gradient-to-r from-[#f59e0b] to-[#ea580c] px-3 py-1 text-[13px] font-bold text-white shadow-lg sm:-left-4 sm:top-[44%]"
      >
        <Zap className="h-3.5 w-3.5" fill="currentColor" /> +40 XP
      </span>
      <span
        aria-hidden="true"
        className="absolute -top-4 right-3 flex rotate-3 items-center gap-2 rounded-full border bg-surface-1 py-1 pl-1 pr-3 text-[12px] font-semibold shadow-lg"
      >
        <span className="bp-medal bp-gold flex h-6 w-6 items-center justify-center rounded-full">
          <Award className="h-3.5 w-3.5" />
        </span>
        {m.badgeUnlocked}
      </span>
    </div>
  );
}

function LearnSection() {
  const m = useMessages(landingMessages);
  return (
    <section id="learn" className="bp-offscreen mx-auto max-w-6xl scroll-mt-16 px-6 pb-24">
      <div className="bp-learn-hero grid items-center gap-14 rounded-[28px] border bg-surface-1/60 px-6 py-12 md:px-12 md:py-16 lg:grid-cols-2">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary">{m.learnEyebrow}</p>
          <h2 className="mt-3 text-balance text-[32px] font-bold leading-tight tracking-[-0.03em] md:text-[38px]">{m.learnTitle}</h2>
          <p className="mt-4 max-w-xl text-pretty text-[15px] leading-relaxed text-muted">{m.learnBody}</p>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2">
            {m.learnPoints.map((point, i) => (
              <li key={point.title} className="flex gap-3">
                <span className="shrink-0">
                  <FeatureTile icon={LEARN_POINTS[i].icon} category={LEARN_POINTS[i].category} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold">{point.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{point.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/learn"
            className={buttonClass('primary', 'lg', 'mt-9 h-auto min-h-11 px-6 py-2.5 text-[14.5px] shadow-md')}
            {...warmOn('learn')}
          >
            <GraduationCap className="h-4 w-4" /> {m.openMap} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <LearnPreview />
      </div>
    </section>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const m = useMessages(landingMessages);
  useDocumentTitle(null);
  // the two doors: their pages load while the visitor reads
  useEffect(() => prefetchWhenIdle('dashboard', 'learn'), []);
  const resourceCount = useMemo(() => allDefs().length, []);
  const showcase = useMemo(
    () =>
      ['aws-serverless-api', 'aws-container-stack', 'azure-web-app', 'gcp-static-site', 'aws-web-app', 'multi-cloud-dr']
        .map((slug) => getTemplate(slug))
        .filter((t) => t !== undefined)
        .map((t) => ({ template: t, files: t.build('preview') })),
    [],
  );

  // only ever the seeded demo (tagged `demo`), never one of the user's own projects
  const openDemo = () => {
    try {
      navigate(`/editor/${openDemoProject().id}`);
    } catch {
      /* storage full — the storage notice says so */
    }
  };

  const startTemplate = (slug: string) => {
    const t = getTemplate(slug);
    if (!t) return;
    try {
      // named in the UI language; its HCL (from the slug) stays code
      const name = templateName(t);
      const project = createProject({
        name: uniqueProjectName(name),
        files: t.build(slugify(name)),
        templateSlug: t.slug,
        description: templateDescription(t),
      });
      navigate(`/editor/${project.id}`);
    } catch {
      /* storage full — the storage notice says so */
    }
  };

  // the one page that scrolls as a document (global.css keeps the app shell from it)
  useEffect(() => {
    document.documentElement.setAttribute('data-page-scrolls', '');
    return () => document.documentElement.removeAttribute('data-page-scrolls');
  }, []);

  return (
    <div className="min-h-full overflow-x-hidden bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/75 backdrop-blur-md">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6" aria-label={m.mainNav}>
          <Link to="/" className="shrink-0 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary">
            <Logo />
          </Link>
          <div className="hidden items-center gap-7 text-[13px] font-medium text-muted md:flex">
            <a href="#features" className="hover:text-foreground">
              {m.navFeatures}
            </a>
            <a href="#how" className="hover:text-foreground">
              {m.navHow}
            </a>
            <a href="#templates" className="hover:text-foreground">
              {m.navTemplates}
            </a>
            <Link to="/learn" className="hover:text-foreground" {...warmOn('learn')}>
              {m.navLearn}
            </Link>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-foreground">
              <Github className="h-3.5 w-3.5" /> GitHub
            </a>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <Button className="whitespace-nowrap max-sm:px-3" onClick={() => navigate('/dashboard')} {...warmOn('dashboard')}>
              {m.openApp}
            </Button>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative">
          <div className="bp-hero-bg" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-16 text-center md:pt-20">
            <a
              href="#learn"
              className="bp-fade-in inline-flex items-center gap-2 rounded-full border bg-surface-1/80 py-1 pl-1.5 pr-3 text-[12px] font-medium text-muted shadow-xs backdrop-blur transition-colors hover:text-foreground"
            >
              <span className="flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                <Sparkles className="h-3 w-3" /> {m.badgeNew}
              </span>
              {m.badgeText}
              <ArrowRight className="h-3 w-3" />
            </a>
            <h1 className="bp-rise mx-auto mt-6 max-w-4xl text-balance text-[44px] font-bold leading-[1.04] tracking-[-0.035em] md:text-[64px]">
              {m.heroTitle} <span className="bp-gradient-text lg:whitespace-nowrap">{m.heroAccent}</span>
            </h1>
            <p className="bp-rise mx-auto mt-6 max-w-2xl text-pretty text-[17px] leading-relaxed text-muted [animation-delay:80ms]">
              {m.heroBody}
            </p>
            <nav aria-label={m.doors} className="bp-rise mx-auto mt-9 grid max-w-2xl gap-3 text-left sm:grid-cols-2 [animation-delay:160ms]">
              <Link
                to="/dashboard"
                {...warmOn('dashboard')}
                className="group flex items-start gap-3.5 rounded-[16px] border border-transparent bg-primary p-4 text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-white/15" aria-hidden="true">
                  <PenTool className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[15.5px] font-semibold">
                    {m.doorBuild}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug">{m.doorBuildBody}</span>
                </span>
              </Link>
              <Link
                to="/learn"
                {...warmOn('learn')}
                className="group flex items-start gap-3.5 rounded-[16px] border bg-surface-1 p-4 shadow-md transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-[#6366f1] to-[#0891b2] text-white shadow-sm"
                  aria-hidden="true"
                >
                  <GraduationCap className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[15.5px] font-semibold text-foreground">
                    {m.doorLearn}
                    <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{m.doorLearnBody}</span>
                </span>
              </Link>
            </nav>
            <button
              type="button"
              onClick={openDemo}
              className="mt-4 inline-flex items-center gap-1.5 rounded-sm text-[13px] font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" /> {m.orDemo}
            </button>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12.5px] text-faint">
              <span className="flex items-center gap-1.5">
                <ProviderDot provider="aws" size={8} /> AWS
              </span>
              <span className="flex items-center gap-1.5">
                <ProviderDot provider="azure" size={8} /> Azure
              </span>
              <span className="flex items-center gap-1.5">
                <ProviderDot provider="gcp" size={8} /> Google Cloud
              </span>
              <span aria-hidden="true" className="max-sm:hidden">
                ·
              </span>
              <span className="max-sm:basis-full">{m.trust}</span>
            </div>

            <HeroDemo />
          </div>
        </section>

        <section className="border-y bg-surface-1/70">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-10 text-center md:grid-cols-4">
            {[
              [`${resourceCount}`, m.statServices],
              [`${TEMPLATES.length}`, m.statTemplates],
              ['3', m.statClouds],
              ['0', m.statServers],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="sr-only">{label}</dt>
                <dd className="text-[34px] font-bold tracking-[-0.03em] text-foreground">{value}</dd>
                <dd className="mt-0.5 text-[13px] text-muted">{label}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="features" className="bp-offscreen mx-auto max-w-6xl scroll-mt-16 px-6 py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary">{m.featuresEyebrow}</p>
            <h2 className="mt-3 text-balance text-[36px] font-bold leading-tight tracking-[-0.03em]">
              {m.featuresTitleBefore}
              <span className="font-mono text-[0.9em]" translate="no">
                terraform apply
              </span>
            </h2>
          </div>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.key}
                className="group rounded-[16px] border bg-surface-1 p-5 shadow-xs transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
              >
                <FeatureTile icon={f.icon} category={f.category} />
                <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{m.features[f.key].title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{featureBody(m, f.key)}</p>
              </div>
            ))}
          </div>
        </section>

        <LearnSection />

        <section id="how" className="bp-offscreen scroll-mt-16 border-y bg-surface-1/70">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary">{m.howEyebrow}</p>
              <h2 className="mt-3 text-[36px] font-bold tracking-[-0.03em]">{m.howTitle}</h2>
            </div>
            <ol className="mt-14 grid gap-6 md:grid-cols-3">
              {m.steps.map((s, i) => (
                <li key={i} className="relative rounded-[16px] border bg-background p-6">
                  <span className="bp-gradient-text font-mono text-[28px] font-bold">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="mt-3 text-[16px] font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
                  {i < m.steps.length - 1 ? (
                    <ArrowRight className="absolute -right-5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-faint md:block" />
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="templates" className="bp-offscreen mx-auto max-w-6xl scroll-mt-16 px-6 py-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary">{m.templatesEyebrow}</p>
              <h2 className="mt-3 text-[36px] font-bold tracking-[-0.03em]">{m.templatesTitle}</h2>
            </div>
            <Button variant="outline" onClick={() => navigate('/dashboard?new=1')}>
              {m.browseAll(TEMPLATES.length)} <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {showcase.map(({ template: t, files }) => (
              <button
                key={t.slug}
                type="button"
                onClick={() => startTemplate(t.slug)}
                className="group overflow-hidden rounded-[16px] border bg-surface-1 text-left shadow-xs transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="bp-dots border-b bg-canvas px-5 py-4">
                  <ProjectThumbnail files={files} className="h-36 w-full text-foreground transition-transform duration-300 group-hover:scale-[1.03]" />
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-2">
                    <h3 className="flex-1 truncate text-[15px] font-semibold">{templateName(t)}</h3>
                    {t.providers.map((p) => (
                      <ProviderChip key={p} provider={p} />
                    ))}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">{templateDescription(t)}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary">
                    {m.useTemplate} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="bp-offscreen px-6 pb-24">
          <div className="bp-cta relative mx-auto max-w-6xl overflow-hidden rounded-[24px] px-8 py-16 text-center text-white">
            <h2 className="relative text-balance text-[34px] font-bold tracking-[-0.03em] md:text-[42px]">
              {m.ctaTitle}
            </h2>
            <p className="relative mx-auto mt-4 max-w-xl text-[15.5px] text-white/80">{m.ctaBody}</p>
            <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-white px-6 text-[14.5px] font-semibold text-slate-900 shadow-lg transition-transform hover:-translate-y-0.5"
              >
                {m.startBuilding} <ArrowRight className="h-4 w-4" />
              </button>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-md border border-white/30 px-5 text-[14.5px] font-semibold text-white transition-colors hover:bg-white/10"
              >
                <Github className="h-4 w-4" /> {m.starOnGithub}
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-[12.5px] text-muted md:flex-row">
          <Logo size={18} />
          <span>{m.footer}</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-foreground">
            <Github className="h-4 w-4" /> {m.starOnGithub}
          </a>
        </div>
      </footer>
    </div>
  );
}
