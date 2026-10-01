/**
 * A data source in the resource palette's "Data sources" section: click to
 * add it (in the data column, left of the diagram), drag to drop it where
 * it should go.
 */
import { Plus } from 'lucide-react';
import { paletteDragStarted } from '@/features/editor/canvasDrag';
import { useLocale, type Locale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
import { addDataSource, DATA_MIME } from './addData';
import type { DataSourcePreset } from './catalog';
import { DataSourceIcon } from './DataSourceIcon';
import { dataSourceMessages } from './dataSources.messages';
import { dataSourceName, presetDescription, presetName } from './i18n';

/** the presets matching a palette search, in either language (`zonas` and `zones` alike) */
export function filterPresets(presets: DataSourcePreset[], query: string): DataSourcePreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return presets;
  const text = (p: DataSourcePreset, l: Locale) => `${presetName(p, l)} ${dataSourceName(p.type, l)} ${presetDescription(p, l) ?? ''}`;
  return presets.filter((p) => `${text(p, 'en')} ${text(p, 'pt-BR')} ${p.type} data`.toLowerCase().includes(q));
}

export function DataPaletteItem({ preset, active, roveKey }: { preset: DataSourcePreset; active: boolean; roveKey: string }) {
  const m = useMessages(dataSourceMessages);
  const locale = useLocale((s) => s.locale);
  const name = presetName(preset, locale);
  return (
    <button
      type="button"
      draggable
      tabIndex={active ? 0 : -1}
      data-rove={roveKey}
      aria-label={m.addItem(name, preset.type)}
      title={m.itemTitle(name, presetDescription(preset, locale) ?? '')}
      onDragStart={(e) => {
        e.dataTransfer.setData(DATA_MIME, preset.key);
        e.dataTransfer.effectAllowed = 'copy';
        paletteDragStarted();
      }}
      onClick={() => addDataSource(preset.key)}
      className="group flex w-full cursor-grab items-center gap-2.5 rounded-[8px] border border-transparent px-2 py-1.5 text-left transition-colors outline-none hover:border-border hover:bg-surface-2 focus-visible:border-primary focus-visible:bg-surface-2 active:cursor-grabbing"
    >
      <DataSourceIcon size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium leading-tight">{name}</span>
        <span className="block truncate font-mono text-[10px] leading-tight text-faint">data.{preset.type}</span>
      </span>
      <Plus className="h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}
