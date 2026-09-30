import { Github, GraduationCap, Home, LayoutTemplate } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { shellMessages } from '@/components/messages';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, LogoMark } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { REPO_URL } from '@/lib/links';
import { cn } from '@/lib/utils';

export function AppRail({
  active,
  onTemplates,
}: {
  active: 'projects' | 'tutorials';
  onTemplates?: () => void;
}) {
  const navigate = useNavigate();
  const m = useMessages(shellMessages);
  return (
    <aside
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-surface-1 py-3"
      aria-label={m.primaryNav}
    >
      <Link to="/" className="mb-2 p-1" aria-label={m.home}>
        <LogoMark size={26} />
      </Link>
      <Button
        variant="ghost"
        size="icon"
        aria-label={m.projects}
        title={m.projects}
        className={cn(active === 'projects' && 'bg-primary-soft text-primary')}
        onClick={() => navigate('/dashboard')}
      >
        <Home className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={m.tutorials}
        title={m.tutorials}
        className={cn(active === 'tutorials' && 'bg-primary-soft text-primary')}
        onClick={() => navigate('/tutorials')}
      >
        <GraduationCap className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={m.templates}
        title={m.templates}
        onClick={() => (onTemplates ? onTemplates() : navigate('/dashboard?new=1'))}
      >
        <LayoutTemplate className="h-4 w-4" />
      </Button>
      <div className="flex-1" />
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        className="flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-foreground"
        aria-label={m.githubRepo}
      >
        <Github className="h-4 w-4" />
      </a>
      <LanguageSwitcher compact />
      <ThemeToggle />
    </aside>
  );
}
