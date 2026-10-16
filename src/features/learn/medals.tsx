/**
 * The learning side's medals, shared by the map and the celebrations: a
 * badge's round medal (a level's in that level's hue, the others gold),
 * a rank's hexagon, and a burst of confetti. The hues are CSS classes
 * (`bp-lv-*`, `bp-rank-*` in global.css and ./learn.css) so each theme gets its own text color.
 * A medal's size is the `--m` custom property: a `size` prop, or without one
 * whatever `--m` its parent sets (`[--m:40px] md:[--m:60px]` for a size per
 * breakpoint).
 */
import {
  Award,
  BookOpen,
  CalendarCheck,
  Cloud,
  Crown,
  DraftingCompass,
  EyeOff,
  Flame,
  Hammer,
  ListChecks,
  Layers,
  Lock,
  Power,
  Rocket,
  Sprout,
  Star,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Badge } from '@/learn/gamification';
import type { Level } from '@/learn/types';
import { cn } from '@/lib/utils';
import './learn.css';

/** hues for the AWS levels, one each (they repeat past the last) */
const LEVEL_HUES = 9;

/** a level's hue class: the AWS levels in order, Azure in its own blue */
export const levelHue = (level: Pick<Level, 'id' | 'index'>): string =>
  level.id.startsWith('azure') ? 'bp-lv-azure' : `bp-lv-${level.index % LEVEL_HUES}`;

/** badge icons by the name `Badge.icon` gives (lucide names) */
const BADGE_ICONS: Record<string, LucideIcon> = { Award, CalendarCheck, EyeOff, Flame, ListChecks, Power, Rocket, Trash2 };

/** the hue of a badge: a level's own, gold for the rest */
export function badgeHue(badge: Badge, levels: Level[]): string {
  const level = levels.find((l) => badge.id === `level-${l.id}`);
  return level ? levelHue(level) : 'bp-gold';
}

const sized = (size?: number) => (size === undefined ? undefined : ({ '--m': `${size}px` } as CSSProperties));

export function BadgeMedal({
  badge,
  hue,
  earned,
  size,
  className,
}: {
  badge: Badge;
  hue: string;
  earned: boolean;
  size?: number;
  className?: string;
}) {
  const Icon = BADGE_ICONS[badge.icon] ?? Award;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex h-[var(--m,44px)] w-[var(--m,44px)] shrink-0 items-center justify-center rounded-full',
        hue,
        earned ? 'bp-medal' : 'bp-medal-locked',
        className,
      )}
      style={sized(size)}
    >
      <Icon className="h-[44%] w-[44%]" strokeWidth={2.1} />
      {earned ? null : (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-surface-1 text-faint shadow-xs">
          <Lock className="h-2.5 w-2.5" />
        </span>
      )}
    </span>
  );
}

/** one icon per rank, Newcomer to Terraform Master */
const RANK_ICONS: LucideIcon[] = [Sprout, BookOpen, Wrench, Hammer, DraftingCompass, Cloud, Layers, Star, Crown];

export function RankMedal({ index, size = 56, className }: { index: number; size?: number; className?: string }) {
  const tier = Math.min(Math.max(index, 0), RANK_ICONS.length - 1);
  const Icon = RANK_ICONS[tier];
  return (
    <span
      aria-hidden="true"
      className={cn(
        `bp-hex bp-rank-${tier} inline-flex h-[calc(var(--m)*1.1)] w-[var(--m)] shrink-0 items-center justify-center`,
        className,
      )}
      style={sized(size)}
    >
      <Icon className="h-[40%] w-[40%]" strokeWidth={2.1} />
    </span>
  );
}

const CONFETTI_COLORS = ['#2563eb', '#7c3aed', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#f97316'];

/**
 * A burst of confetti from the middle of its (positioned) parent. Pure CSS
 * and decorative: callers skip it when reduced motion is asked for.
 */
export function Confetti({ pieces = 36, spread = 1 }: { pieces?: number; spread?: number }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0">
      {Array.from({ length: pieces }, (_, i) => {
        // the golden angle spreads the pieces evenly without randomness
        const angle = (i * 137.5 * Math.PI) / 180;
        const distance = (70 + ((i * 37) % 90)) * spread;
        const style = {
          '--dx': `${Math.cos(angle) * distance}px`,
          '--dy': `${Math.sin(angle) * distance * 0.8 - 40 * spread}px`,
          '--r': `${((i * 97) % 540) - 270}deg`,
          animationDelay: `${(i % 6) * 25}ms`,
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          width: i % 3 === 0 ? 6 : 8,
          height: i % 3 === 0 ? 6 : 4,
          borderRadius: i % 3 === 0 ? 9999 : 1,
        } as CSSProperties;
        return <i key={i} className="bp-confetti absolute" style={style} />;
      })}
    </span>
  );
}
