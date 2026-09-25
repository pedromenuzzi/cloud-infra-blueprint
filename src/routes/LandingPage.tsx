import {
  ArrowRight,
  Boxes,
  Command,
  FileDown,
  FileUp,
  Github,
  Lock,
  MousePointerClick,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hlLine } from '@/components/HclSnippet';
import { ProjectThumbnail } from '@/components/ProjectThumbnail';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, Kbd, Logo } from '@/components/ui';
import { createProject, listProjects } from '@/lib/storage';
import { cn, slugify } from '@/lib/utils';
import { CATEGORY_COLORS, ProviderChip, ProviderDot, ResourceIcon } from '@/resources/icons';
import { allDefs, getDef } from '@/resources/registry';
import type { Category } from '@/resources/types';
import { getTemplate, TEMPLATES } from '@/templates';

const REPO_URL = 'https://github.com/pedromenuzzi/cloud-infra-blueprint';

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
const HERO_NODES = [
  { id: 'api', type: 'aws_apigatewayv2_api', subtitle: 'HTTP API', x: 20, y: 30 },
  { id: 'handler', type: 'aws_lambda_function', subtitle: 'nodejs22.x', x: 222, y: 30 },
  { id: 'orders', type: 'aws_dynamodb_table', subtitle: 'on-demand', x: 424, y: 30 },
  { id: 'lambda', type: 'aws_iam_role', subtitle: 'IAM role', x: 222, y: 180 },
  { id: 'events', type: 'aws_sqs_queue', subtitle: 'queue', x: 424, y: 180 },
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
  const [active, setActive] = useState(1);
  const { ref, scale } = useFitScale(CANVAS_W);
  const codeRef = useRef<HTMLDivElement>(null);

  // walk through the resources to show the diagram ↔ code sync
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setActive((i) => (i + 1) % HERO_NODES.length), 2600);
    return () => clearInterval(t);
  }, []);

  const activeId = HERO_NODES[active].id;
  const [from, to] = blockRange(activeId);

  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    el.scrollTo({ top: Math.max(0, from * 18 - 36), behavior: 'smooth' });
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
            <Kbd>⌘ K</Kbd>
          </span>
        </div>
        <div className="grid md:grid-cols-[1.35fr_1fr]">
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
                      {hot ? (
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
                      <span className="block truncate text-[9px] font-bold uppercase tracking-[0.07em]" style={{ color: c.solid }}>
                        {def.shortName}
                      </span>
                      <span className="block truncate text-[12.5px] font-semibold leading-tight text-foreground">{n.id}</span>
                      <span className="block truncate text-[10.5px] text-muted">{n.subtitle}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full border bg-surface-1/90 px-2.5 py-1 text-[11px] font-medium text-muted shadow-xs backdrop-blur">
              <MousePointerClick className="h-3 w-3" /> Click a resource
            </span>
          </div>
          <div className="relative">
          <div ref={codeRef} className="h-[308px] overflow-hidden bg-surface-1 py-3 font-mono text-[11.5px] leading-[18px]">
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
      <span className="absolute -top-3.5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-surface-1 px-3 py-1 text-[12px] font-semibold text-primary shadow-md">
        <Sparkles className="h-3.5 w-3.5" /> Live two-way sync
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- content */

const FEATURES: Array<{ icon: LucideIcon; category: Category; title: string; body: string }> = [
  {
    icon: RefreshCw,
    category: 'network',
    title: 'Truly bidirectional',
    body: 'Drag a resource and the HCL writes itself. Type Terraform and the diagram rebuilds. Comments and formatting survive every round-trip.',
  },
  {
    icon: Boxes,
    category: 'compute',
    title: '80+ services, three clouds',
    body: 'AWS, Azure and GCP in one palette — from VPCs and Lambdas to AKS, Pub/Sub and Key Vault — with real nesting and connection rules.',
  },
  {
    icon: Command,
    category: 'integration',
    title: 'Keyboard-first',
    body: 'Press ⌘K to add resources, jump anywhere or run any action. Double-click the canvas to drop a service right where you want it.',
  },
  {
    icon: WandSparkles,
    category: 'containers',
    title: 'One-click tidy layout',
    body: 'A layered auto-layout that understands containers — messy imports become a clean, readable architecture in a second.',
  },
  {
    icon: FileUp,
    category: 'storage',
    title: 'Bring your own Terraform',
    body: 'Drop existing .tf files, a folder or a .zip. The diagram draws itself from the references already in your code.',
  },
  {
    icon: FileDown,
    category: 'edge',
    title: 'Export everything',
    body: 'Download a ready-to-apply Terraform zip, a crisp PNG/SVG of the diagram, or share the whole project as a link.',
  },
  {
    icon: ShieldCheck,
    category: 'identity',
    title: 'Private by design',
    body: 'No account, no server, no tracking. Projects live in your browser; share links keep the data in the URL fragment.',
  },
  {
    icon: Sparkles,
    category: 'database',
    title: 'Diagnostics as you type',
    body: 'Unclosed blocks, missing required arguments and dangling references are flagged instantly — on the canvas and in the code.',
  },
];

const STEPS = [
  { n: '01', title: 'Start anywhere', body: 'Pick a template, import your .tf files, or open a blank canvas.' },
  { n: '02', title: 'Design both ways', body: 'Drag, connect and nest on the canvas — or just write HCL. Both stay in sync.' },
  { n: '03', title: 'Ship it', body: 'Export the Terraform and run terraform apply. Diagram included.' },
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

export default function LandingPage() {
  const navigate = useNavigate();
  const resourceCount = useMemo(() => allDefs().length, []);
  const showcase = useMemo(
    () =>
      ['aws-serverless-api', 'aws-container-stack', 'azure-web-app', 'gcp-static-site', 'aws-web-app', 'multi-cloud-dr']
        .map((slug) => getTemplate(slug))
        .filter((t) => t !== undefined)
        .map((t) => ({ template: t, files: t.build('preview') })),
    [],
  );

  const openDemo = () => {
    const existing = listProjects().find((p) => p.templateSlug === 'aws-web-app');
    if (existing) {
      navigate(`/editor/${existing.id}`);
      return;
    }
    const template = getTemplate('aws-web-app')!;
    const project = createProject({
      name: 'production-web',
      description: 'Demo project — a classic VPC + EC2 + RDS web stack.',
      files: template.build('production-web'),
      templateSlug: template.slug,
    });
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

  return (
    <div className="min-h-full overflow-x-hidden bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/75 backdrop-blur-md">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6" aria-label="Main">
          <Link to="/" className="focus-visible:outline-2 focus-visible:outline-primary">
            <Logo />
          </Link>
          <div className="hidden items-center gap-7 text-[13px] font-medium text-muted md:flex">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href="#templates" className="hover:text-foreground">
              Templates
            </a>
            <Link to="/tutorials" className="hover:text-foreground">
              Tutorials
            </Link>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-foreground">
              <Github className="h-3.5 w-3.5" /> GitHub
            </a>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button onClick={() => navigate('/dashboard')}>Open the app</Button>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative">
          <div className="bp-hero-bg" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-16 text-center md:pt-20">
            <a
              href="#features"
              className="bp-fade-in inline-flex items-center gap-2 rounded-full border bg-surface-1/80 py-1 pl-1.5 pr-3 text-[12px] font-medium text-muted shadow-xs backdrop-blur transition-colors hover:text-foreground"
            >
              <span className="flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                <Sparkles className="h-3 w-3" /> New
              </span>
              {resourceCount} services · command palette · auto-layout
              <ArrowRight className="h-3 w-3" />
            </a>
            <h1 className="bp-rise mx-auto mt-6 max-w-4xl text-balance text-[44px] font-bold leading-[1.04] tracking-[-0.035em] md:text-[64px]">
              Design cloud infrastructure visually.{' '}
              <span className="bp-gradient-text">Ship Terraform instantly.</span>
            </h1>
            <p className="bp-rise mx-auto mt-6 max-w-2xl text-pretty text-[17px] leading-relaxed text-muted [animation-delay:80ms]">
              The blueprint editor that keeps your architecture diagram and your Terraform code in
              perfect sync — for AWS, Azure and GCP. Free, open source, and it runs entirely in
              your browser.
            </p>
            <div className="bp-rise mt-9 flex flex-wrap items-center justify-center gap-3 [animation-delay:160ms]">
              <Button size="lg" className="h-11 px-6 text-[14.5px] shadow-md" onClick={() => navigate('/dashboard')}>
                Start building — it’s free <ArrowRight className="h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" className="h-11 px-5 text-[14.5px]" onClick={openDemo}>
                <Play className="h-4 w-4" /> Open live demo
              </Button>
            </div>
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
              <span>·</span>
              <span>No account · No server · MIT licensed</span>
            </div>

            <HeroDemo />
          </div>
        </section>

        <section className="border-y bg-surface-1/70">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-10 text-center md:grid-cols-4">
            {[
              [`${resourceCount}`, 'cloud services'],
              [`${TEMPLATES.length}`, 'production templates'],
              ['3', 'clouds, one canvas'],
              ['0', 'servers or accounts'],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="sr-only">{label}</dt>
                <dd className="text-[34px] font-bold tracking-[-0.03em] text-foreground">{value}</dd>
                <dd className="mt-0.5 text-[13px] text-muted">{label}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="features" className="mx-auto max-w-6xl scroll-mt-16 px-6 py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary">Features</p>
            <h2 className="mt-3 text-balance text-[36px] font-bold leading-tight tracking-[-0.03em]">
              Everything you need to go from whiteboard to <span className="font-mono text-[0.9em]">terraform apply</span>
            </h2>
          </div>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-[16px] border bg-surface-1 p-5 shadow-xs transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
              >
                <FeatureTile icon={f.icon} category={f.category} />
                <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{f.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="scroll-mt-16 border-y bg-surface-1/70">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary">How it works</p>
              <h2 className="mt-3 text-[36px] font-bold tracking-[-0.03em]">Three steps. No yak shaving.</h2>
            </div>
            <ol className="mt-14 grid gap-6 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.n} className="relative rounded-[16px] border bg-background p-6">
                  <span className="bp-gradient-text font-mono text-[28px] font-bold">{s.n}</span>
                  <h3 className="mt-3 text-[16px] font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
                  {i < STEPS.length - 1 ? (
                    <ArrowRight className="absolute -right-5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-faint md:block" />
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="templates" className="mx-auto max-w-6xl scroll-mt-16 px-6 py-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary">Templates</p>
              <h2 className="mt-3 text-[36px] font-bold tracking-[-0.03em]">Start from a proven pattern</h2>
            </div>
            <Button variant="outline" onClick={() => navigate('/dashboard?new=1')}>
              Browse all {TEMPLATES.length} <ArrowRight className="h-4 w-4" />
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
                    <h3 className="flex-1 truncate text-[15px] font-semibold">{t.name}</h3>
                    {t.providers.map((p) => (
                      <ProviderChip key={p} provider={p} />
                    ))}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">{t.description}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary">
                    Use template <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="px-6 pb-24">
          <div className="bp-cta relative mx-auto max-w-6xl overflow-hidden rounded-[24px] px-8 py-16 text-center text-white">
            <h2 className="relative text-balance text-[34px] font-bold tracking-[-0.03em] md:text-[42px]">
              Your next architecture is one drag away.
            </h2>
            <p className="relative mx-auto mt-4 max-w-xl text-[15.5px] text-white/80">
              Open the editor, pick a template and export real Terraform in minutes. No sign-up.
            </p>
            <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-white px-6 text-[14.5px] font-semibold text-slate-900 shadow-lg transition-transform hover:-translate-y-0.5"
              >
                Start building <ArrowRight className="h-4 w-4" />
              </button>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-md border border-white/30 px-5 text-[14.5px] font-semibold text-white transition-colors hover:bg-white/10"
              >
                <Github className="h-4 w-4" /> Star on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-[12.5px] text-muted md:flex-row">
          <Logo size={18} />
          <span>Free & open source · MIT license · Built with React Flow, Monaco and a lot of HCL</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-foreground">
            <Github className="h-4 w-4" /> Star on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
