import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui';
import { useTheme, type Theme } from '@/theme/useTheme';

const NEXT: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
const LABEL: Record<Theme, string> = {
  light: 'Theme: light',
  dark: 'Theme: dark',
  system: 'Theme: system',
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${LABEL[theme]} — click to change`}
      title={LABEL[theme]}
      onClick={() => setTheme(NEXT[theme])}
    >
      <Icon className="h-[16px] w-[16px]" />
    </Button>
  );
}
