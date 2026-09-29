import { Command } from 'cmdk';
import { useMemo } from 'react';
import { useLayer } from '@/components/ui';
import { useLocale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
import type { Provider } from '@/ir/types';
import { categoryLabel, resourceDescription, resourceName, resourceShortName } from '@/resources/i18n';
import { PROVIDER_LABELS, ProviderChip, ResourceIcon } from '@/resources/icons';
import { allDefs } from '@/resources/registry';
import { CATEGORY_ORDER, type ResourceDef } from '@/resources/types';
import { paletteMessages } from './Palette.messages';

/** AA text on the chip's tint (ProviderChip's inline brand color is too light as text) */
const CHIP_TEXT: Record<Provider, string> = {
  aws: 'text-aws!',
  azure: 'text-azure!',
  gcp: 'text-gcp!',
  other: 'text-muted!',
};

/**
 * cmdk filter: every query word must appear (as a substring) in the item's
 * value or keywords. The default fuzzy scorer matches scattered letters —
 * "lambda" would surface "App Service Plan" — which feels random here.
 */
export function wordFilter(value: string, search: string, keywords: string[] = []): number {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const primary = (keywords[0] ?? value).toLowerCase();
  const haystack = `${value} ${keywords.join(' ')}`.toLowerCase();
  if (!words.every((w) => haystack.includes(w))) return 0;
  // rank: name starts with the query > name contains it > matched elsewhere
  const q = words.join(' ');
  if (primary.startsWith(q)) return 1;
  if (primary.includes(q)) return 0.8;
  return words.every((w) => primary.includes(w)) ? 0.6 : 0.3;
}

/**
 * Catalog entries as cmdk groups (one per category). Providers already used
 * by the project come first inside each group.
 */
export function ResourceGroups({
  onPick,
  preferred = [],
  headingPrefix = '',
}: {
  onPick(def: ResourceDef): void;
  preferred?: Provider[];
  headingPrefix?: string;
}) {
  const locale = useLocale((s) => s.locale);
  const groups = useMemo(() => {
    const rank = (d: ResourceDef) => {
      const i = preferred.indexOf(d.provider);
      return i === -1 ? preferred.length : i;
    };
    const defs = [...allDefs()].sort((a, b) => rank(a) - rank(b));
    return CATEGORY_ORDER.map((category) => ({
      category,
      defs: defs.filter((d) => d.category === category),
    })).filter((g) => g.defs.length > 0);
  }, [preferred]);

  return (
    <>
      {groups.map((g) => (
        <Command.Group key={g.category} heading={`${headingPrefix}${categoryLabel(g.category, locale)}`}>
          {g.defs.map((def) => (
            <Command.Item
              key={def.type}
              value={`add ${def.type}`}
              // the name on screen first (it ranks the matches), then both languages: "sub-rede" finds a subnet in English too
              keywords={[
                resourceName(def.type, locale),
                ...(['en', 'pt-BR'] as const).flatMap((l) => [
                  resourceName(def.type, l),
                  resourceShortName(def.type, l),
                  categoryLabel(def.category, l),
                  resourceDescription(def.type, l) ?? '',
                ]),
                PROVIDER_LABELS[def.provider],
              ]}
              onSelect={() => onPick(def)}
              className="bp-cmd-item"
            >
              <ResourceIcon category={def.category} type={def.type} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">
                  {resourceName(def.type, locale)}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-faint">{def.type}</span>
              </span>
              <ProviderChip provider={def.provider} className={CHIP_TEXT[def.provider]} />
            </Command.Item>
          ))}
        </Command.Group>
      ))}
    </>
  );
}

/** Standalone searchable picker (quick-add popover on the canvas). */
export function ResourcePicker({
  onPick,
  onClose,
  preferred,
}: {
  onPick(def: ResourceDef): void;
  onClose(): void;
  preferred?: Provider[];
}) {
  const m = useMessages(paletteMessages);
  // a layer, so Esc closes this popover first and page shortcuts stand down
  useLayer(true, onClose);
  return (
    <Command
      label={m.pickerLabel}
      filter={wordFilter}
      className="bp-cmd flex max-h-[380px] flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <Command.Input autoFocus placeholder={m.pickerPlaceholder} className="bp-cmd-input" />
      <Command.List className="bp-cmd-list">
        <Command.Empty className="px-3 py-6 text-center text-[12.5px] text-faint">{m.noMatch}</Command.Empty>
        <ResourceGroups onPick={onPick} preferred={preferred} />
      </Command.List>
    </Command>
  );
}
