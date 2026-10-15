/**
 * The lesson panel's Docs tab: what the selected block is (picked on the
 * canvas, or under the cursor in the code), its arguments from the provider
 * schema the inspector reads, and its Terraform Registry page. The types the
 * lesson teaches can be read before anything is on the canvas.
 */
import { BookOpen, Database, ExternalLink, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui';
import { useEditor } from '@/features/editor/store';
import { dataSourceName } from '@/features/data-sources/i18n';
import { useMessages } from '@/i18n/messages';
import type { Lesson } from '@/learn/types';
import { cn } from '@/lib/utils';
import { resourceDescription, resourceName } from '@/resources/i18n';
import { ResourceIcon } from '@/resources/icons';
import { docsUrl, getDef } from '@/resources/registry';
import { isRequired, settableEntries } from '@/schema/lookup';
import { requestDataSchemasFor, requestSchemasFor, schemaProviderOf, useDataSourceSchema, useResourceSchema } from '@/schema/store';
import type { SchemaEntry } from '@/schema/types';
import { playerMessages } from './player.messages';

const eyebrow = 'text-[10.5px] font-bold uppercase tracking-wider text-faint';

export function DocsPanel({ lesson }: { lesson: Lesson }) {
  const m = useMessages(playerMessages);
  const selection = useEditor((s) => s.selection);
  const ir = useEditor((s) => s.ir);
  const [picked, setPicked] = useState<string | null>(null);
  // a block picked on the canvas or in the code takes over from a type picked here
  useEffect(() => {
    if (selection) setPicked(null);
  }, [selection]);

  const resource = selection ? ir.resources.find((r) => r.id === selection) : undefined;
  const data = selection && !resource ? ir.data.find((d) => d.id === selection) : undefined;
  const shown = picked ? { type: picked, data: false } : resource ? { type: resource.type, data: false } : data ? { type: data.type, data: true } : null;
  const teaches = lesson.teaches ?? [];

  return (
    <div className="space-y-4 px-5 py-4">
      {teaches.length > 0 ? (
        <div>
          <p className={eyebrow}>{m.docsTeaches}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {teaches.map((type) => {
              const def = getDef(type);
              const active = shown?.type === type && !shown.data;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPicked(type)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-[12px] font-medium transition-colors',
                    active ? 'border-primary/50 bg-primary-soft text-primary' : 'text-muted hover:border-border-strong hover:text-foreground',
                  )}
                >
                  {def ? <ResourceIcon category={def.category} type={type} size={18} /> : null}
                  {resourceName(type)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {shown ? (
        <TypeDocs key={`${shown.data}:${shown.type}`} type={shown.type} data={shown.data} />
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-[12px] border border-dashed px-5 py-8 text-center">
          <BookOpen className="h-5 w-5 text-faint" />
          <p className="text-[12.5px] leading-relaxed text-muted">{m.docsEmpty}</p>
        </div>
      )}
    </div>
  );
}

/** the Registry page of a data source sits beside its resource's */
const registryUrl = (type: string, data: boolean) => {
  const url = docsUrl(type);
  return data ? url?.replace('/docs/resources/', '/docs/data-sources/') : url;
};

function TypeDocs({ type, data }: { type: string; data: boolean }) {
  const m = useMessages(playerMessages);
  const resourceSchema = useResourceSchema(data ? '' : type);
  const dataSchema = useDataSourceSchema(data ? type : '');
  const { block, status } = data ? dataSchema : resourceSchema;
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (data) requestDataSchemasFor([type]);
    else requestSchemasFor([type]);
  }, [type, data]);

  const def = getDef(type);
  const name = data ? dataSourceName(type) : resourceName(type);
  const description = data ? undefined : resourceDescription(type);
  const url = registryUrl(type, data);
  const entries = useMemo(() => {
    if (!block) return [];
    const q = query.trim().toLowerCase();
    return settableEntries(block)
      .filter((e) => !q || e.name.includes(q.replace(/\s+/g, '_')) || e.description?.toLowerCase().includes(q))
      // what's deprecated last, still in reach for code that uses it
      .sort((a, b) => Number(a.deprecated) - Number(b.deprecated));
  }, [block, query]);
  const required = entries.filter(isRequired);
  const optional = entries.filter((e) => !isRequired(e));

  return (
    <article className="space-y-4" aria-labelledby={`docs-${type}`}>
      <header className="flex items-start gap-3">
        {def && !data ? (
          <ResourceIcon category={def.category} type={type} size={36} />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-faint">
            <Database className="h-4.5 w-4.5" />
          </span>
        )}
        <div className="min-w-0">
          <h2 id={`docs-${type}`} className="text-[15px] font-semibold leading-tight">
            {name}
          </h2>
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-faint">
            {data ? `data "${type}"` : type}
          </p>
          {description ? <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{description}</p> : null}
          {data ? <p className="mt-1.5 text-[12.5px] text-muted">{m.docsDataSource}</p> : null}
        </div>
      </header>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary hover:text-primary-hover hover:underline"
        >
          {m.docsRegistry} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}

      <section className="space-y-3">
        <h3 className={eyebrow}>{m.docsArguments}</h3>
        {!block ? (
          <p className="text-[12.5px] text-faint" aria-live="polite">
            {schemaProviderOf(type) && (status === 'loading' || status === undefined) ? m.docsLoading : m.docsUnknown}
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                className="h-8 pl-8"
                placeholder={m.docsFilter}
                aria-label={m.docsFilter}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {entries.length === 0 ? <p className="text-[12.5px] text-faint">{m.docsNoMatch}</p> : null}
            <ArgList title={m.docsRequired} entries={required} />
            <ArgList title={m.docsOptional} entries={optional} />
          </>
        )}
      </section>
    </article>
  );
}

function ArgList({ title, entries }: { title: string; entries: SchemaEntry[] }) {
  const m = useMessages(playerMessages);
  if (entries.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-[11.5px] font-semibold text-muted">
        {title} <span className="font-normal text-faint">{entries.length}</span>
      </h4>
      <dl className="divide-y rounded-[10px] border">
        {entries.map((e) => (
          <div key={e.name} className="px-3 py-2">
            <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <code className={cn('font-mono text-[12px] font-semibold', e.deprecated ? 'text-muted line-through' : 'text-foreground')}>
                {e.name}
              </code>
              {e.kind === 'block' ? (
                <span className="font-mono text-[10.5px] text-faint">{m.docsBlock}</span>
              ) : (
                <code className="font-mono text-[10.5px] text-faint">{e.type}</code>
              )}
              {e.deprecated ? (
                <span className="rounded-full bg-warning/15 px-1.5 text-[10px] font-semibold text-warning">{m.docsDeprecated}</span>
              ) : null}
            </dt>
            {/* the provider's own words, in English whatever the UI language */}
            {e.description ? (
              <dd lang="en" className="mt-0.5 text-[12px] leading-relaxed text-muted">
                {e.description}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </div>
  );
}
