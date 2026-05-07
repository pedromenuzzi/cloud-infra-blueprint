import { Button, LogoLockup } from '@blueprint/ui';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundRoute() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <Link to="/" className="focus-ring rounded-md" aria-label="Cloud Blueprint home">
        <LogoLockup size="lg" />
      </Link>
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        404 · Resource not found
      </p>
      <h1 className="text-balance text-4xl font-bold tracking-tight md:text-5xl">
        That blueprint doesn’t exist yet.
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        We couldn’t find the page you’re looking for. Go back to the dashboard or start a new
        project from a template.
      </p>
      <div className="flex items-center gap-2">
        <Link to="/">
          <Button variant="ghost">
            <ArrowLeft className="h-4 w-4" /> Home
          </Button>
        </Link>
        <Link to="/dashboard">
          <Button>Open dashboard</Button>
        </Link>
      </div>
    </main>
  );
}
