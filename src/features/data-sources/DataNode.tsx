/**
 * A data source on the canvas: a card the size of a resource's, drawn
 * lighter with a dashed outline (it is read, never created), a lookup glyph,
 * a `data` chip, its name and type, and how many blocks read it. Edges come
 * from src/ir/dataSources.ts: readers point at it, and it points at what its
 * arguments reference.
 */
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';
import type { CSSProperties } from 'react';
import { canvasMessages } from '@/features/editor/CanvasPane.messages';
import { RepeatBadge } from '@/features/editor/RepeatBadge';
import { repeatLabel, type RepeatLabel } from '@/features/editor/repeatLabel';
import type { Locale } from '@/i18n/locale';
import { messagesFor, useMessages } from '@/i18n/messages';
import { dataReferrers } from '@/ir/dataSources';
import { NODE_H, NODE_W } from '@/ir/layout';
import { repeatOf } from '@/ir/repeat';
import type { IR, Provider } from '@/ir/types';
import { cn } from '@/lib/utils';
import { DataSourceIcon } from './DataSourceIcon';
import { DATA_TILE } from './tile';
import { dataSourceMessages } from './dataSources.messages';
import { dataSourceShortName } from './i18n';

export interface DataNodeData extends Record<string, unknown> {
  title: string;
  /** the data source type, as written (`aws_ami`) */
  type: string;
  provider: Provider;
  /** who reads it (ids), for the badge and its tooltip */
  readers: string[];
  warn: boolean;
  /** the security lens is on: a lookup has nothing to analyse, it fades */
  lens: boolean;
  repeat?: RepeatLabel;
  /** what the PDF export reads off a node (captureDiagram): the kind line, the second line, the glyph key, the tile */
  typeLabel: string;
  subtitle: string;
  resourceType: 'data';
  lookup: true;
}

export type DataFlowNode = Node<DataNodeData, 'data'>;

const VARS = { '--cat': DATA_TILE.solid, '--cat-light': DATA_TILE.from, '--cat-text': 'var(--data-text)' } as CSSProperties;

export function DataNodeView({ data, selected }: NodeProps<DataFlowNode>) {
  const m = useMessages(dataSourceMessages);
  const read = data.readers.length;
  return (
    <div
      style={VARS}
      title={m.lookupTitle}
      className={cn(
        'bp-node bp-data group relative flex h-[76px] w-[208px] items-center gap-2.5 rounded-[12px] pl-2.5 pr-2.5',
        selected && 'bp-node-selected',
        data.lens && 'bp-dim',
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <DataSourceIcon size={40} />
      <div className="min-w-0 flex-1">
        {/* a long type name takes a second line instead of being cut, like a resource's (nodes.tsx) */}
        <div className="max-h-[26px] min-h-4 overflow-hidden">
          <code className="float-right -mb-0.5 ml-1 rounded-[4px] bg-(--data-chip) px-1 font-mono text-[9.5px] font-bold leading-[14px] text-(--data-text) ring-1 ring-(--data-ring)">
            data
          </code>
          <span
            data-type-label=""
            className="block break-words pt-0.5 text-[9.5px] font-bold uppercase leading-[12px] tracking-[0.07em] text-(--data-text)"
          >
            {data.typeLabel}
          </span>
        </div>
        <div className="mt-px truncate text-[13px] font-semibold leading-tight text-foreground">{data.title}</div>
        <div className="truncate font-mono text-[10.5px] leading-snug text-muted" translate="no">
          {data.subtitle}
        </div>
      </div>
      <span
        title={read > 0 ? m.readByTitle(data.readers) : m.notReadTitle}
        className={cn(
          'absolute -bottom-2 right-2.5 rounded-full border bg-node px-1.5 py-px text-[9.5px] font-semibold shadow-xs',
          read > 0 ? 'text-muted' : 'text-faint',
        )}
      >
        {read > 0 ? m.readBy(read) : m.notRead}
      </span>
      {data.repeat ? <RepeatBadge repeat={data.repeat} /> : null}
      {data.warn ? (
        <span
          title={m.hasWarnings}
          className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-warning text-white shadow-sm ring-2 ring-node"
        >
          <AlertTriangle className="h-2.5 w-2.5" />
        </span>
      ) : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

/** React Flow nodes for the data blocks of `ir` (top level, like module calls). */
export function dataFlowNodes(ir: IR, warned: Set<string | undefined>, lens: boolean, locale?: Locale): DataFlowNode[] {
  const m = messagesFor(dataSourceMessages, locale);
  const cm = messagesFor(canvasMessages, locale);
  return ir.data.map((d) => {
    const readers = dataReferrers(ir, d.id);
    const typeLabel = dataSourceShortName(d.type, locale);
    const rep = repeatOf(d, ir);
    const repeat = rep ? repeatLabel(rep, locale) : undefined;
    return {
      id: d.id,
      type: 'data',
      position: { x: d.position?.x ?? 0, y: d.position?.y ?? 0 },
      width: NODE_W,
      height: NODE_H,
      domAttributes: { 'aria-roledescription': cm.nodeRole },
      ariaLabel: m.nodeLabel(d.name, typeLabel, readers.length, warned.has(d.id)) + (repeat ? `, ${repeat.aria}` : ''),
      data: {
        title: d.name,
        type: d.type,
        provider: d.provider,
        readers,
        warn: warned.has(d.id),
        lens,
        repeat,
        typeLabel,
        subtitle: d.type,
        resourceType: 'data',
        lookup: true,
      },
    };
  });
}
