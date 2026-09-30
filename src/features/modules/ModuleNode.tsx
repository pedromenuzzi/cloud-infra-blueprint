/**
 * A module call on the canvas: a card the size of a resource's, drawn as a
 * small stack (it holds other blocks), with the module's name, where it
 * comes from (`terraform-aws-modules/vpc` + `v5.0.0`, `./modules/network`)
 * and how many inputs it's given. A module of this project opens on a
 * double-click (./ModuleView.tsx).
 */
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle, ShieldQuestion } from 'lucide-react';
import { messagesFor, useMessages } from '@/i18n/messages';
import type { Locale } from '@/i18n/locale';
import { NODE_H, NODE_W } from '@/ir/layout';
import { moduleTarget } from '@/ir/localModules';
import { moduleInputs, moduleVersion, versionLabel, type ModuleSourceKind } from '@/ir/modules';
import type { IR, ModuleNode } from '@/ir/types';
import { cn } from '@/lib/utils';
import { canvasMessages } from '@/features/editor/CanvasPane.messages';
import { ModuleIcon } from './ModuleIcon';
import { modulesMessages } from './modules.messages';
import { openModuleView } from './moduleViewStore';

export interface ModuleNodeData extends Record<string, unknown> {
  title: string;
  /** short source, or "no source" */
  source: string;
  kind: ModuleSourceKind | null;
  version?: string;
  inputs: number;
  warn: boolean;
  /** project folder of a local module the project holds (it can be opened) */
  dir?: string;
  /** the security lens is on: modules aren't analysed */
  lens: boolean;
  /** drawn inside an opened module: opening it goes one level deeper */
  nested?: boolean;
  /** what the PDF export reads off a node (captureDiagram): the kind line, the second line, the glyph key */
  typeLabel: string;
  subtitle: string;
  resourceType: 'module';
}

export type ModuleFlowNode = Node<ModuleNodeData, 'module'>;

export function ModuleNodeView({ data, selected }: NodeProps<ModuleFlowNode>) {
  const m = useMessages(modulesMessages);
  const tail = data.source.lastIndexOf('/');
  return (
    <div
      className={cn(
        'bp-node bp-module group relative flex h-[76px] w-[208px] items-center gap-2.5 rounded-[12px] border bg-node pl-2.5 pr-2.5',
        selected ? 'bp-node-selected border-transparent' : 'border-node-border',
      )}
      title={data.dir ? m.openHint : undefined}
      onDoubleClick={(e) => {
        if (!data.dir) return;
        e.stopPropagation();
        openModuleView(data.dir, data.title, { nested: data.nested });
      }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <ModuleIcon size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[9.5px] font-bold uppercase tracking-[0.07em] text-(--module-text)">{m.typeLabel}</span>
          {data.version ? (
            <span className="shrink-0 truncate rounded-[4px] bg-surface-2 px-1 font-mono text-[9.5px] font-semibold text-muted ring-1 ring-border">
              {data.version}
            </span>
          ) : data.kind ? (
            <span className="shrink-0 rounded-[4px] px-1 text-[9px] font-bold uppercase tracking-wide text-faint ring-1 ring-border">
              {m.kind[data.kind]}
            </span>
          ) : null}
        </div>
        <div className="mt-px truncate text-[13px] font-semibold leading-tight text-foreground">{data.title}</div>
        {/* the end says the most (`…/vpc`, `…/network`): the front gives way first */}
        <div className="flex min-w-0 text-[11px] leading-snug text-muted" title={data.source} translate="no">
          {tail > 0 ? (
            <>
              <span className="truncate">{data.source.slice(0, tail)}</span>
              <span className="shrink-0">{data.source.slice(tail)}</span>
            </>
          ) : (
            <span className="truncate">{data.source}</span>
          )}
        </div>
      </div>
      {data.inputs > 0 ? (
        <span className="absolute -bottom-2 right-2.5 rounded-full border bg-node px-1.5 py-px text-[9.5px] font-semibold text-muted shadow-xs">
          {m.inputs(data.inputs)}
        </span>
      ) : null}
      {data.lens ? (
        <span className="bp-sec-chip absolute -bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full border bg-node px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-muted shadow-xs">
          <ShieldQuestion className="h-2.5 w-2.5" />
          {m.notAnalysed}
        </span>
      ) : null}
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

/** What a module call's node shows. */
export function moduleNodeData(
  m: ModuleNode,
  files: Record<string, string>,
  warn: boolean,
  lens: boolean,
  locale?: Locale,
): ModuleNodeData {
  const t = messagesFor(modulesMessages, locale);
  const target = moduleTarget(files, m);
  const info = target.kind === 'none' ? null : target.info;
  const version = versionLabel(moduleVersion(m)) ?? (info?.ref ? info.ref : undefined);
  const source = info?.short ?? t.noSource;
  return {
    title: m.name,
    source,
    typeLabel: t.typeLabel,
    subtitle: version ? `${source} · ${version}` : source,
    resourceType: 'module',
    kind: info?.kind ?? null,
    version,
    inputs: moduleInputs(m).length,
    warn,
    dir: target.kind === 'local' && target.module ? target.dir : undefined,
    lens,
  };
}

/** React Flow nodes for the module calls of `ir` (top level, like resources). */
export function moduleFlowNodes(
  ir: IR,
  files: Record<string, string>,
  warned: Set<string | undefined>,
  lens: boolean,
  locale?: Locale,
  nested = false,
): ModuleFlowNode[] {
  const t = messagesFor(modulesMessages, locale);
  const cm = messagesFor(canvasMessages, locale);
  return ir.modules.map((m) => {
    const data = { ...moduleNodeData(m, files, warned.has(m.id), lens, locale), nested };
    return {
      id: m.id,
      type: 'module',
      position: { x: m.position?.x ?? 0, y: m.position?.y ?? 0 },
      width: NODE_W,
      height: NODE_H,
      domAttributes: { 'aria-roledescription': cm.nodeRole },
      ariaLabel: t.nodeLabel(m.name, data.source, data.warn),
      data,
    };
  });
}
