/**
 * The data source catalog as cmdk groups (one per provider, the project's
 * own providers first): ⌘K "Add data source…" and its search results.
 */
import { Command } from 'cmdk';
import { useMemo } from 'react';
import { useLocale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
import type { Provider } from '@/ir/types';
import { PROVIDER_LABELS } from '@/resources/icons';
import { presetsFor, type DataSourcePreset } from './catalog';
import { DataSourceIcon } from './DataSourceIcon';
import { dataSourceMessages } from './dataSources.messages';
import { dataSourceName, presetDescription, presetName } from './i18n';

const PROVIDERS: Array<Exclude<Provider, 'other'>> = ['aws', 'azure', 'gcp'];

export function DataSourceGroups({
  onPick,
  preferred = [],
  headingPrefix = '',
}: {
  onPick(preset: DataSourcePreset): void;
  preferred?: Provider[];
  headingPrefix?: string;
}) {
  const m = useMessages(dataSourceMessages);
  const locale = useLocale((s) => s.locale);
  const providers = useMemo(() => {
    const rank = (p: Provider) => {
      const i = preferred.indexOf(p);
      return i === -1 ? preferred.length : i;
    };
    return [...PROVIDERS].sort((a, b) => rank(a) - rank(b));
  }, [preferred]);
  return (
    <>
      {providers.map((provider) => (
        <Command.Group key={provider} heading={`${headingPrefix}${m.section} · ${PROVIDER_LABELS[provider]}`}>
          {presetsFor(provider).map((p) => (
            <Command.Item
              key={p.key}
              value={`data ${p.key}`}
              // the name on screen first (it ranks the matches), then both languages
              keywords={[
                presetName(p, locale),
                ...(['en', 'pt-BR'] as const).flatMap((l) => [presetName(p, l), dataSourceName(p.type, l), presetDescription(p, l) ?? '']),
                p.type,
                'data',
                PROVIDER_LABELS[provider],
              ]}
              onSelect={() => onPick(p)}
              className="bp-cmd-item"
            >
              <DataSourceIcon size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">{presetName(p, locale)}</span>
                <span className="block truncate font-mono text-[10.5px] text-faint">data.{p.type}</span>
              </span>
            </Command.Item>
          ))}
        </Command.Group>
      ))}
    </>
  );
}
