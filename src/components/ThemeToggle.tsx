import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ContextMenu } from '@/components/ContextMenu';
import { Button } from '@/components/ui';
import { isDark, useTheme, type Theme } from '@/theme/useTheme';

const LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };

/**
 * Theme picker: the icon shows the theme in effect (sun / moon); clicking
 * opens Light / Dark / System. (A 3-state cycling button looked broken —
 * "system → light" often changed nothing on screen.)
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dark, setDark] = useState(() => isDark(theme));

  // follow OS changes while on "system"
  useEffect(() => {
    setDark(isDark(theme));
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(isDark(useTheme.getState().theme));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const Icon = dark ? Moon : Sun;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Theme: ${LABEL[theme]}`}
        aria-haspopup="menu"
        title={`Theme: ${LABEL[theme]}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: Math.max(8, r.right - 180), y: r.bottom + 6 });
        }}
      >
        <Icon className="h-[16px] w-[16px]" />
      </Button>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Theme"
          onClose={() => setMenu(null)}
          entries={(['light', 'dark', 'system'] as const).map((t) => ({
            id: t,
            label: LABEL[t],
            icon: t === 'light' ? Sun : t === 'dark' ? Moon : Monitor,
            checked: theme === t,
            onSelect: () => setTheme(t),
          }))}
        />
      ) : null}
    </>
  );
}
