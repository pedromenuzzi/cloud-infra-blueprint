import { Github, GraduationCap, Home, LayoutTemplate } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { shellMessages } from '@/components/messages';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, buttonClass, LogoMark } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { REPO_URL } from '@/lib/links';
import { prefetchWhenIdle, warmOn } from '@/lib/routeChunks';
import { cn } from '@/lib/utils';

const RAIL_ACTIVE = 'bg-primary-soft text-primary';

export function AppRail({
  active,
  onTemplates,
}: {
  active: 'projects' | 'learn';
  onTemplates?: () => void;
}) {
  const navigate = useNavigate();
  const m = useMessages(shellMessages);
  // where these pages lead next: a project opens the editor, a station of the map a lesson
  useEffect(() => prefetchWhenIdle(active === 'projects' ? 'editor' : 'lesson'), [active]);
  return (
    <nav
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-surface-1 py-3"
      aria-label={m.primaryNav}
    >
      <Link to="/" className="mb-2 p-1" aria-label={m.home}>
        <LogoMark size={26} />
      </Link>
      <Link
        to="/dashboard"
        aria-label={m.projects}
        title={m.projects}
        aria-current={active === 'projects' ? 'page' : undefined}
        className={buttonClass('ghost', 'icon', cn(active === 'projects' && RAIL_ACTIVE))}
        {...warmOn('dashboard')}
      >
        <Home className="h-4 w-4" />
      </Link>
      <Link
        to="/learn"
        aria-label={m.learn}
        title={m.learn}
        aria-current={active === 'learn' ? 'page' : undefined}
        className={buttonClass('ghost', 'icon', cn(active === 'learn' && RAIL_ACTIVE))}
        {...warmOn('learn')}
      >
        <GraduationCap className="h-4 w-4" />
      </Link>
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
        className={buttonClass('ghost', 'icon')}
        aria-label={m.githubRepo}
        title={m.githubRepo}
      >
        <Github className="h-4 w-4" />
      </a>
      <LanguageSwitcher compact />
      <ThemeToggle />
    </nav>
  );
}
