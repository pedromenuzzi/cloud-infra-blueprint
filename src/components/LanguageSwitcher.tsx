import { useState } from 'react';
import { ContextMenu } from '@/components/ContextMenu';
import { BrazilFlag, UsFlag } from '@/components/flags';
import { Button } from '@/components/ui';
import { LOCALES, useLocale, type Locale } from '@/i18n/locale';
import { defineMessages, useMessages } from '@/i18n/messages';

const FLAGS: Record<Locale, typeof BrazilFlag> = { en: UsFlag, 'pt-BR': BrazilFlag };

const messages = defineMessages(
  { language: 'Language', current: (name: string) => `Language: ${name}` },
  { language: 'Idioma', current: (name: string) => `Idioma: ${name}` },
);

/**
 * Language picker, beside the theme picker: the button shows the current
 * flag and language code; the menu names each language in itself.
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  const m = useMessages(messages);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const current = LOCALES.find((l) => l.id === locale) ?? LOCALES[0];
  const Flag = FLAGS[current.id];

  return (
    <>
      <Button
        variant="ghost"
        size={compact ? 'icon' : 'sm'}
        aria-label={m.current(current.label)}
        aria-haspopup="menu"
        title={m.current(current.label)}
        className={compact ? undefined : 'gap-1.5 px-2 text-[11.5px] font-semibold text-muted'}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          // open toward the page: rails sit at the left edge, top bars at the right
          const x = r.left < 200 ? r.right + 6 : Math.max(8, r.right - 200);
          const y = r.left < 200 ? Math.max(8, r.bottom - 84) : r.bottom + 6;
          setMenu({ x, y });
        }}
      >
        <Flag className="text-[16px]" />
        {compact ? null : <span>{current.short}</span>}
      </Button>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={m.language}
          onClose={() => setMenu(null)}
          entries={LOCALES.map((l) => ({
            id: l.id,
            label: l.label,
            icon: FLAGS[l.id],
            checked: l.id === locale,
            onSelect: () => setLocale(l.id),
          }))}
        />
      ) : null}
    </>
  );
}
