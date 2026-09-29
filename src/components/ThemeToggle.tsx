import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ContextMenu } from '@/components/ContextMenu';
import { shellMessages } from '@/components/messages';
import { Button } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { isDark, useTheme } from '@/theme/useTheme';

/**
 * Theme picker: the icon shows the theme in effect (sun / moon); clicking
 * opens Light / Dark / System. (A 3-state cycling button looked broken —
 * "system → light" often changed nothing on screen.)
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dark, setDark] = useState(() => isDark(theme));
  const m = useMessages(shellMessages);
  const LABEL = { light: m.light, dark: m.dark, system: m.system };

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
        aria-label={m.themeIs(LABEL[theme])}
        aria-haspopup="menu"
        title={m.themeIs(LABEL[theme])}
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
          label={m.theme}
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
