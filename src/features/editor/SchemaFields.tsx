/**
 * Inspector "All arguments": every argument and nested block of the real
 * provider schema that the curated catalog fields don't already show —
 * searchable, required first, set ones grouped, the rest behind a toggle.
 * Simple types get the inspector's own editors (same ops, same undo);
 * complex values and nested blocks preview here and edit in code.
 */
import { AlertTriangle, ChevronDown, Code2, Lock, Plus, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { emitExpression, emitNestedBlock } from '@/hcl/emitter';
import { useLocale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
import type { Expression, ResourceNode } from '@/ir/types';
import { cn } from '@/lib/utils';
import { getDef } from '@/resources/registry';
import type { FieldDef } from '@/resources/types';
import { entryDetail } from '@/schema/completion';
import type { ProviderSchema } from '@/schema/lookup';
import { schemaMessages } from '@/schema/messages';
import { loadSchema, requestSchemasFor, schemaProviderOf, useResourceSchema } from '@/schema/store';
import type { SchemaBlock } from '@/schema/types';
import { pinMismatch, schemaIssues } from '@/schema/validate';
import { useLayout } from './layoutStore';
import { schemaFieldsMessages } from './SchemaFields.messages';
import { buildArgGroups, matchesQuery, type ArgRow } from './schemaFieldsModel';
import { installSchemaBridge } from './schemaBridge';
import { useEditor } from './store';

installSchemaBridge();

/** optional arguments are listed inline up to this many; past it they fold behind a toggle */
const FOLD_AFTER = 6;
const PROVIDER_LABEL = { aws: 'AWS', azurerm: 'AzureRM', google: 'Google' } as const;

function editInCode(nodeId: string) {
  useEditor.getState().revealInCode(nodeId);
  if (!useLayout.getState().isOpen('code')) useLayout.getState().toggle('code');
}

const sectionTitle = 'text-[10.5px] font-bold uppercase tracking-wider text-faint';

export function SchemaFields({
  node,
  curated,
  renderControl,
  fallback,
}: {
  node: ResourceNode;
  /** argument names the catalog fields above already show */
  curated: Set<string>;
  /** the inspector's editor for a field */
  renderControl(field: FieldDef): ReactNode;
  /** shown while there's no schema for this type (loading, failed, other providers) */
  fallback: ReactNode;
}) {
  const m = useMessages(schemaFieldsMessages);
  const { block, schema, status } = useResourceSchema(node.type);
  const provider = schemaProviderOf(node.type);
  // "opened": selecting a resource asks for its provider's schema even before validation does
  useEffect(() => requestSchemasFor([node.type]), [node.type]);

  if (block && schema) {
    return <AllArguments key={node.id} node={node} block={block} schema={schema} curated={curated} renderControl={renderControl} />;
  }
  return (
    <>
      {provider && status === 'loading' ? (
        <p className="flex items-center gap-2 border-t pt-3 text-[11px] text-faint" role="status">
          <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-border border-t-primary" aria-hidden="true" />
          {m.loading(PROVIDER_LABEL[provider])}
        </p>
      ) : null}
      {provider && status === 'error' ? (
        <p className="flex flex-wrap items-center gap-2 border-t pt-3 text-[11px] text-faint" role="status">
          {m.failed(PROVIDER_LABEL[provider])}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void loadSchema(provider, { retry: true })}>
            {m.retry}
          </button>
        </p>
      ) : null}
      {fallback}
    </>
  );
}

function AllArguments({
  node,
  block,
  schema,
  curated,
  renderControl,
}: {
  node: ResourceNode;
  block: SchemaBlock;
  schema: ProviderSchema;
  curated: Set<string>;
  renderControl(field: FieldDef): ReactNode;
}) {
  const m = useMessages(schemaFieldsMessages);
  // the findings are text: build them again in the other language
  const locale = useLocale((s) => s.locale);
  const ir = useEditor((s) => s.ir);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const optionalId = useId();

  const pin = pinMismatch(ir, node.type);
  const groups = useMemo(() => {
    const issues = pin ? [] : schemaIssues(node, getDef(node.type));
    return buildArgGroups(node, block, curated, issues);
  }, [node, block, curated, pin, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = groups.required.length + groups.set.length + groups.optional.length;
  if (total === 0) return null;
  const searching = query.trim() !== '';
  const pick = (rows: ArgRow[]) => (searching ? rows.filter((r) => matchesQuery(r, query)) : rows);
  const required = pick(groups.required);
  const set = pick(groups.set);
  const optional = pick(groups.optional);
  const folds = groups.optional.length > FOLD_AFTER;
  const showOptional = searching || expanded || !folds;
  const matches = required.length + set.length + optional.length;

  const rows = (list: ArgRow[]) => (
    <div className="space-y-3">
      {list.map((row) => (
        <ArgRowView key={row.name} node={node} row={row} renderControl={renderControl} />
      ))}
    </div>
  );

  return (
    <section className="border-t pt-3" aria-labelledby={headingId} data-testid="schema-fields">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 id={headingId} className={sectionTitle}>
          {m.heading} <span className="font-medium normal-case tracking-normal">({total})</span>
        </h4>
        <span className="truncate font-mono text-[10px] text-faint" title={m.source(PROVIDER_LABEL[schema.provider], schema.version)}>
          {schema.provider} {schema.version}
        </span>
      </div>
      {pin ? (
        <p className="mb-2 text-[11px] leading-snug text-faint">
          {m.pinned(schema.version).before}
          <span className="font-mono">{schema.provider} {pin}</span>
          {m.pinned(schema.version).after}
        </p>
      ) : null}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden="true" />
        <Input
          className="h-8 pl-8 pr-7"
          placeholder={m.search(total)}
          aria-label={m.searchLabel}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
        {query ? (
          <button
            type="button"
            aria-label={m.clearSearch}
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[4px] p-0.5 text-faint hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {searching ? (
        <p className="sr-only" aria-live="polite">
          {m.matches(matches)}
        </p>
      ) : null}

      <div className="space-y-4">
        {required.length > 0 ? (
          <div>
            <h5 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">{m.required}</h5>
            {rows(required)}
          </div>
        ) : null}
        {set.length > 0 ? (
          <div>
            <h5 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">{m.setInCode(set.length)}</h5>
            {rows(set)}
          </div>
        ) : null}
        {groups.optional.length > 0 ? (
          <div>
            {folds && !searching ? (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={optionalId}
                onClick={() => setExpanded(!expanded)}
                className="flex w-full items-center justify-between gap-2 rounded-sm border bg-surface-2 px-2.5 py-1.5 text-left text-[12px] font-medium text-foreground transition-colors hover:border-border-strong"
              >
                {expanded ? m.hideOptional(groups.optional.length) : m.showOptional(groups.optional.length)}
                <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
              </button>
            ) : (
              <h5 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">{m.optional}</h5>
            )}
            <div id={optionalId} hidden={!showOptional} className={cn(folds && !searching && 'mt-3')}>
              {showOptional ? rows(optional) : null}
            </div>
          </div>
        ) : null}
        {searching && matches === 0 ? (
          <p className="text-[11.5px] text-faint">{m.noMatch(query.trim())}</p>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- rows */

function RowLabel({ row, missing }: { row: ArgRow; missing: boolean }) {
  const m = useMessages(schemaFieldsMessages);
  const sm = useMessages(schemaMessages);
  const attr = row.entry?.kind === 'attribute' ? row.entry : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 truncate font-mono" title={row.name}>
        {row.name}
      </span>
      {row.blockCount > 1 ? <span className="shrink-0 font-mono text-[10px] text-faint">×{row.blockCount}</span> : null}
      {row.required ? (
        <span className={cn('shrink-0 text-[9px] font-bold uppercase', missing ? 'text-warning' : 'text-faint')}>{m.badgeRequired}</span>
      ) : null}
      {row.deprecated ? <span className="shrink-0 text-[9px] font-bold uppercase text-warning">{m.badgeDeprecated}</span> : null}
      {row.kind === 'meta' ? <span className="shrink-0 text-[9px] font-bold uppercase text-faint">{m.badgeMeta}</span> : null}
      {row.kind === 'unknown' ? <span className="shrink-0 text-[9px] font-bold uppercase text-warning">{m.badgeUnknown}</span> : null}
      {attr?.sensitive ? <Lock className="h-3 w-3 shrink-0 text-faint" aria-label={m.sensitive} /> : null}
      {row.entry ? (
        <span
          className="ml-auto shrink-0 truncate pl-0.5 font-mono text-[10px] font-normal text-faint"
          style={{ maxWidth: '45%' }}
          title={entryDetail(row.entry)}
        >
          {row.entry.kind === 'attribute' ? row.entry.type : row.entry.nesting === 'single' || row.entry.maxItems === 1 ? sm.block : sm.blockNesting(row.entry.nesting, 0)}
        </span>
      ) : null}
    </span>
  );
}

function RowHint({ row }: { row: ArgRow }) {
  const m = useMessages(schemaFieldsMessages);
  const entry = row.entry;
  const issues = row.issues.filter((i) => !(i.kind === 'deprecated' && i.path.length === 0));
  if (!entry?.description && !row.deprecated && issues.length === 0) return null;
  return (
    <span className="mt-1 block space-y-0.5 text-[11px] leading-snug text-faint">
      {entry?.description ? <span className="block">{entry.description}</span> : null}
      {row.deprecated ? (
        <span className="block text-warning">{m.deprecated(entry?.deprecation)}</span>
      ) : null}
      {issues.map((issue, i) => (
        <span key={i} className="flex items-start gap-1 text-warning">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{issue.message}</span>
        </span>
      ))}
    </span>
  );
}

/** a few lines of what the code says, for values the inspector can't edit (Terraform text, not translated) */
function previewText(node: ResourceNode, row: ArgRow): string {
  const parts: string[] = [];
  for (const key of row.keys) {
    const expr: Expression = node.args[key];
    if (expr.kind === 'raw') parts.push(expr.hcl);
    else if (expr.kind === 'block') parts.push(emitNestedBlock(row.name, expr.body, '').join('\n'));
    else if (expr.kind === 'blocks') parts.push(...expr.items.map((b) => emitNestedBlock(row.name, b, '').join('\n')));
    else parts.push(`${row.name} = ${emitExpression(expr, '')}`);
  }
  return parts.join('\n');
}

const PREVIEW_LINES = 5;

function ArgRowView({ node, row, renderControl }: { node: ResourceNode; row: ArgRow; renderControl(field: FieldDef): ReactNode }) {
  const m = useMessages(schemaFieldsMessages);
  const applyOps = useEditor((s) => s.applyCanvasOps);
  const isSet = row.keys.length > 0;
  const missing = row.required && !isSet;
  const label = <RowLabel row={row} missing={missing} />;

  if (row.kind === 'simple' && row.field && !row.opaque) {
    return (
      <Field label={label} hint={<RowHint row={row} />}>
        {renderControl(row.field)}
      </Field>
    );
  }

  const block = row.entry?.kind === 'block' ? row.entry : undefined;
  const canAdd = block && !isSet && block.nesting !== 'map';
  const unknown = row.kind === 'unknown' ? row.issues.find((i) => i.kind === 'unknown' && i.suggestion) : undefined;
  const plainKey = row.keys.length === 1 && row.keys[0] === row.name ? row.keys[0] : undefined;
  const lines = isSet ? previewText(node, row).split('\n') : [];

  return (
    <div data-testid={`schema-arg-${row.name}`}>
      <div className="mb-1 text-xs font-medium text-muted">{label}</div>
      {lines.length > 0 ? (
        <pre className="mb-1.5 overflow-hidden whitespace-pre-wrap break-words rounded-sm border bg-surface-2 px-2 py-1.5 font-mono text-[11px] leading-[1.65] text-muted" title={lines.length > PREVIEW_LINES ? lines.join('\n') : undefined}>
          {lines.slice(0, PREVIEW_LINES).join('\n')}
          {lines.length > PREVIEW_LINES ? m.moreLines(lines.length - PREVIEW_LINES) : ''}
        </pre>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {canAdd ? (
          <Button
            variant="outline"
            size="sm"
            aria-label={m.addBlockLabel(row.name)}
            onClick={() => applyOps([{ kind: 'set_arg', nodeId: node.id, field: row.name, value: { kind: 'block', body: {} } }])}
          >
            <Plus className="h-3.5 w-3.5" /> {m.addBlock}
          </Button>
        ) : null}
        {unknown?.suggestion && plainKey ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              applyOps([
                { kind: 'unset_arg', nodeId: node.id, field: plainKey },
                { kind: 'set_arg', nodeId: node.id, field: unknown.suggestion!, value: node.args[plainKey] },
              ])
            }
          >
            {m.renameTo}
            <span className="font-mono">{unknown.suggestion}</span>
          </Button>
        ) : null}
        {!canAdd ? (
          <Button variant="outline" size="sm" aria-label={m.editInCodeLabel(row.name)} onClick={() => editInCode(node.id)}>
            <Code2 className="h-3.5 w-3.5" /> {isSet ? m.editInCode : m.setInCodeButton}
          </Button>
        ) : null}
      </div>
      <RowHint row={row} />
    </div>
  );
}
