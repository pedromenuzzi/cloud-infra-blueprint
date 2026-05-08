import { Badge, Button, LogoLockup } from '@blueprint/ui';
import { ArrowRight, PlayCircle, UploadCloud } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ComingSoonModal } from '@/components/ComingSoonModal';
import { ProductMockup } from '@/components/ProductMockup';
import { ThemeToggle } from '@/theme';

/**
 * Marketing landing — mirrors image 05 of the spec:
 *
 * - top nav with logo, primary nav links and Start free CTA;
 * - centered hero with announcement pill, display headline, subhead,
 *   primary + ghost CTAs, microcopy;
 * - big product mockup framed in browser chrome with subtle glow;
 * - trust bar with placeholder logos.
 */
export function LandingRoute() {
  const [demoOpen, setDemoOpen] = useState(false);
  return (
    <div className="relative isolate flex min-h-full flex-col overflow-x-clip bg-background text-foreground">
      {/* Soft background gradient (image 05 has a subtle blue wash). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(80%_60%_at_50%_0%,hsl(var(--primary)/0.18),transparent_70%)]"
      />

      <SiteHeader />

      <main className="flex-1">
        <section className="container relative pb-12 pt-16 text-center md:pb-20 md:pt-24">
          <Link
            to="/dashboard"
            className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          >
            <Badge variant="default" size="sm" className="bg-primary text-primary-foreground">
              New
            </Badge>
            Multi-cloud support
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>

          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-bold tracking-tight md:text-6xl">
            Design cloud infrastructure visually.
            <span className="block text-primary">Ship Terraform instantly.</span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted-foreground md:text-lg">
            The blueprint editor that keeps your architecture diagram and your Terraform code in
            perfect sync. AWS, Azure, and GCP.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/dashboard">
              <Button size="lg">
                Start building free <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/import">
              <Button size="lg" variant="secondary">
                <UploadCloud className="h-4 w-4" /> Import existing Terraform
              </Button>
            </Link>
            <Button size="lg" variant="ghost" onClick={() => setDemoOpen(true)}>
              <PlayCircle className="h-4 w-4" /> Watch demo
            </Button>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            No credit card. Free for 3 projects. Already have <code>.tf</code> files?{' '}
            <Link to="/import" className="text-primary underline underline-offset-2">
              Drop them here
            </Link>{' '}
            to visualize.
          </p>
        </section>

        <section className="container relative pb-20">
          <div
            className="absolute inset-x-8 top-12 -z-10 h-[60%] rounded-[32px] bg-primary/15 blur-3xl"
            aria-hidden
          />
          <ProductMockup />
        </section>

        <TrustBar />
      </main>

      <SiteFooter />

      <ComingSoonModal
        open={demoOpen}
        onClose={() => setDemoOpen(false)}
        feature="Watch demo"
        description="A short product walkthrough is being recorded. In the meantime, hit Start building free to jump straight into the editor."
        phase="Phase 6 — Polish + beta"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Subcomponents                                                              */
/* -------------------------------------------------------------------------- */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="focus-ring rounded-md">
          <LogoLockup />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {[
            ['Product', '#'],
            ['Templates', '#'],
            ['Pricing', '#'],
            ['Docs', '#'],
            ['Blog', '#'],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/dashboard"
            className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
          >
            Sign in
          </Link>
          <Link to="/dashboard">
            <Button size="sm">Start free</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

function TrustBar() {
  return (
    <section className="border-t border-border/60 bg-surface-1 py-10">
      <div className="container">
        <p className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Trusted by teams at
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 opacity-70">
          {['Fictional', 'Firorcar', 'Firoweft', 'Northwave', 'Pinecast'].map((name) => (
            <span
              key={name}
              className="text-base font-semibold tracking-tight text-muted-foreground"
              style={{ fontVariationSettings: '"wght" 600' }}
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-background py-10">
      <div className="container flex flex-col items-center justify-between gap-3 text-sm text-muted-foreground md:flex-row">
        <div className="flex items-center gap-2">
          <LogoLockup size="sm" />
          <span className="text-xs">© {new Date().getFullYear()} Cloud Blueprint · Apache 2.0</span>
        </div>
        <nav className="flex items-center gap-5">
          <a
            href="https://github.com/cloud-blueprint/cloud-blueprint"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            GitHub
          </a>
          <a href="#" className="hover:text-foreground">
            Privacy
          </a>
          <a href="#" className="hover:text-foreground">
            Terms
          </a>
        </nav>
      </div>
    </footer>
  );
}
