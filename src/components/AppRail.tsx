import { Github, GraduationCap, Home, LayoutTemplate } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, LogoMark } from '@/components/ui';
import { cn } from '@/lib/utils';

export function AppRail({
  active,
  onTemplates,
}: {
  active: 'projects' | 'tutorials';
  onTemplates?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <aside
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-surface-1 py-3"
      aria-label="Primary"
    >
      <Link to="/" className="mb-2 p-1" aria-label="Cloud Blueprint home">
        <LogoMark size={26} />
      </Link>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Projects"
        title="Projects"
        className={cn(active === 'projects' && 'bg-primary-soft text-primary')}
        onClick={() => navigate('/dashboard')}
      >
        <Home className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Tutorials"
        title="Tutorials"
        className={cn(active === 'tutorials' && 'bg-primary-soft text-primary')}
        onClick={() => navigate('/tutorials')}
      >
        <GraduationCap className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Templates"
        title="Templates"
        onClick={() => (onTemplates ? onTemplates() : navigate('/dashboard'))}
      >
        <LayoutTemplate className="h-4 w-4" />
      </Button>
      <div className="flex-1" />
      <a
        href="https://github.com"
        target="_blank"
        rel="noreferrer"
        className="flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-foreground"
        aria-label="GitHub repository"
      >
        <Github className="h-4 w-4" />
      </a>
      <ThemeToggle />
    </aside>
  );
}
