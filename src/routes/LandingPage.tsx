import { ArrowRight, Check, Cloud, FileDown, Github, Play, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hlLine } from '@/components/HclSnippet';
import { ProjectThumbnail } from '@/components/ProjectThumbnail';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, Logo } from '@/components/ui';
import { createProject, listProjects } from '@/lib/storage';
import { getTemplate } from '@/templates';

const REPO_URL = 'https://github.com';

function HeroMockup() {
  const demo = useMemo(() => getTemplate('aws-web-app')!.build('production-web'), []);
  const codeLines = useMemo(
    () =>
      demo['main.tf']
        .split('\n')
        .filter((l) => !l.includes('@blueprint:pos'))
        .slice(0, 22),
    [demo],
  );

  return (
    <div className="relative mx-auto mt-14 w-full max-w-4xl">
      <div className="overflow-hidden rounded-lg border shadow-lg">
        {/* browser chrome */}
        <div className="flex items-center gap-2 border-b bg-surface-2 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
          <div className="mx-auto flex h-6 w-72 items-center justify-center rounded-[6px] bg-surface-1 text-[11px] text-faint">
            app.cloudblueprint.dev
          </div>
        </div>
        {/* split editor */}
        <div className="grid grid-cols-2">
          <div className="relative border-r bg-canvas p-4">
            <ProjectThumbnail files={demo} className="h-64 w-full text-foreground" />
            <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border bg-surface-1 px-2 py-0.5 text-[11px] font-medium text-success">
              <Check className="h-3 w-3" /> Saved
            </span>
          </div>
          <div className="relative overflow-hidden bg-surface-1 p-4">
            <pre className="h-64 overflow-hidden font-mono text-[10.5px] leading-[1.6] text-muted">
              {codeLines.map((l, i) => (
                <div key={i} className="whitespace-pre">
                  {hlLine(l, i)}
                </div>
              ))}
            </pre>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--surface-1)]" />
          </div>
        </div>
      </div>
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-1 px-3 py-1 text-[12px] font-semibold text-primary shadow-md">
        ✨ Live sync
      </span>
    </div>
  );
}

const FEATURES = [
  {
    icon: RefreshCw,
    title: 'Truly bidirectional',
    body: 'Drag a resource and watch the HCL write itself. Paste Terraform and watch the diagram rebuild. One canonical model, zero drift — comments and formatting survive round-trips.',
  },
  {
    icon: Cloud,
    title: 'Multi-cloud from day one',
    body: 'AWS, Azure and GCP resources in one palette, with containment (VPCs, subnets, resource groups) and cross-cloud guardrails built in.',
  },
  {
    icon: FileDown,
    title: 'No lock-in, no server',
    body: 'Everything runs in your browser and saves locally. Export a real Terraform zip, or share your whole project as a link — no account required.',
  },
];

export default function LandingPage() {
  const navigate = useNavigate();

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

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <nav
          className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6"
          aria-label="Main"
        >
          <Link to="/" className="focus-visible:outline-2 focus-visible:outline-primary">
            <Logo />
          </Link>
          <div className="hidden items-center gap-6 text-[13px] font-medium text-muted md:flex">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <Link to="/dashboard" className="hover:text-foreground">
              Templates
            </Link>
            <Link to="/tutorials" className="hover:text-foreground">
              Tutorials
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground"
            >
              GitHub
            </a>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button onClick={() => navigate('/dashboard')}>Open the app</Button>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-20 text-center">
          <h1 className="mx-auto max-w-3xl text-balance text-[44px] font-bold leading-[1.08] tracking-[-0.02em] md:text-[56px]">
            Design cloud infrastructure visually.
            <br />
            Ship Terraform instantly.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-[16px] leading-relaxed text-muted">
            The blueprint editor that keeps your architecture diagram and your Terraform code in
            perfect sync. AWS, Azure, and GCP — free, open source, and it all runs in your
            browser.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button size="lg" onClick={() => navigate('/dashboard')}>
              Start building free <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={openDemo}>
              <Play className="h-4 w-4" /> Open live demo
            </Button>
          </div>
          <p className="mt-4 text-[12.5px] text-faint">
            No account. No server. Your projects stay in your browser.
          </p>

          <HeroMockup />
        </section>

        <section id="features" className="border-t bg-surface-1/60">
          <div className="mx-auto grid max-w-6xl gap-5 px-6 py-16 md:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-md border bg-surface-1 p-6 shadow-xs">
                <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary-soft text-primary">
                  <f.icon className="h-4.5 w-4.5" />
                </span>
                <h2 className="mt-4 text-[15px] font-semibold">{f.title}</h2>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-[12.5px] text-muted md:flex-row">
          <span className="flex items-center gap-2">
            <Logo size={18} />
          </span>
          <span>Free & open source · MIT license · Built with React Flow, Monaco and a lot of HCL</span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground"
          >
            <Github className="h-4 w-4" /> Star on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
