import { LogoMark, cn } from '@blueprint/ui';
import { FolderKanban, GitBranch, Home, Settings, Users, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

interface RailItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const ITEMS: RailItem[] = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/dashboard', label: 'Projects', icon: FolderKanban },
  { to: '/teams', label: 'Teams', icon: Users },
  { to: '/branches', label: 'Branches', icon: GitBranch },
];

interface AppRailProps {
  /** Visually mark which item is current. Defaults to inferring from URL. */
  activeLabel?: string;
}

/**
 * Vertical 64px navigation rail used by the dashboard and editor (image 01/03).
 * Stays dark-only — even in light mode — to match the spec's reference shots.
 */
export function AppRail({ activeLabel }: AppRailProps) {
  const location = useLocation();

  return (
    <aside
      className="flex h-full w-16 shrink-0 flex-col items-center justify-between border-r border-border/40 bg-[#0B1220] py-4 text-white/70"
      aria-label="Primary navigation"
    >
      <div className="flex flex-col items-center gap-6">
        <Link
          to="/"
          className="focus-ring rounded-md p-1 text-white"
          aria-label="Cloud Blueprint home"
        >
          <LogoMark size={28} />
        </Link>
        <nav className="flex flex-col items-center gap-1" aria-label="App navigation">
          {ITEMS.map((item) => {
            const isActive =
              activeLabel != null
                ? activeLabel === item.label
                : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                to={item.to}
                title={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex h-10 w-10 items-center justify-center rounded-md transition-colors',
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-white/60 hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className="h-5 w-5" />
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      <Link
        to="/settings"
        className="flex h-10 w-10 items-center justify-center rounded-md text-white/60 hover:bg-white/5 hover:text-white"
        title="Settings"
      >
        <Settings className="h-5 w-5" />
      </Link>
    </aside>
  );
}
