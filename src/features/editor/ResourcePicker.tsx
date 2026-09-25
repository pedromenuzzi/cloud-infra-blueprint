import { Command } from 'cmdk';
import { useMemo } from 'react';
import type { Provider } from '@/ir/types';
import { PROVIDER_LABELS, ProviderChip, ResourceIcon } from '@/resources/icons';
import { allDefs } from '@/resources/registry';
import { CATEGORY_LABELS, CATEGORY_ORDER, type ResourceDef } from '@/resources/types';

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
        <Command.Group key={g.category} heading={`${headingPrefix}${CATEGORY_LABELS[g.category]}`}>
          {g.defs.map((def) => (
            <Command.Item
              key={def.type}
              value={`add ${def.type}`}
              keywords={[
                def.displayName,
                def.shortName,
                PROVIDER_LABELS[def.provider],
                CATEGORY_LABELS[def.category],
                def.description ?? '',
              ]}
              onSelect={() => onPick(def)}
              className="bp-cmd-item"
            >
              <ResourceIcon category={def.category} type={def.type} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">
                  {def.displayName}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-faint">{def.type}</span>
              </span>
              <ProviderChip provider={def.provider} />
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
  return (
    <Command
      label="Add a resource"
      filter={wordFilter}
      className="bp-cmd flex max-h-[380px] flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <Command.Input autoFocus placeholder="Add a resource…" className="bp-cmd-input" />
      <Command.List className="bp-cmd-list">
        <Command.Empty className="px-3 py-6 text-center text-[12.5px] text-faint">
          No resources match.
        </Command.Empty>
        <ResourceGroups onPick={onPick} preferred={preferred} />
      </Command.List>
    </Command>
  );
}
