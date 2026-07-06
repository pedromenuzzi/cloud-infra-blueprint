import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';
import { PROVIDER_COLORS, ResourceIcon } from '@/resources/icons';
import type { Category } from '@/resources/types';
import type { Provider } from '@/ir/types';
import { cn } from '@/lib/utils';
import { useEditor } from './store';

export interface ResourceNodeData extends Record<string, unknown> {
  title: string;
  subtitle: string;
  typeLabel: string;
  provider: Provider;
  category: Category;
  warn: boolean;
}

export interface ContainerNodeData extends Record<string, unknown> {
  title: string;
  subtitle?: string;
  provider: Provider;
  category: Category;
  warn: boolean;
}

export type ResourceFlowNode = Node<ResourceNodeData, 'resource'>;
export type ContainerFlowNode = Node<ContainerNodeData, 'container'>;
export type FlowNode = ResourceFlowNode | ContainerFlowNode;

export function ResourceNodeView({ data, selected }: NodeProps<ResourceFlowNode>) {
  const color = PROVIDER_COLORS[data.provider];
  return (
    <div
      className={cn(
        'relative flex h-[76px] w-[208px] items-center gap-2.5 rounded-[10px] border bg-node px-3 shadow-sm transition-shadow',
        selected
          ? 'border-primary shadow-md ring-2 ring-primary/25'
          : 'border-node-border hover:shadow-md',
      )}
    >
      <span
        className="absolute -top-2 left-2.5 rounded-[4px] border px-1 text-[8.5px] font-bold uppercase tracking-wide"
        style={{
          color,
          borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
          background: 'var(--node-bg)',
        }}
      >
        {data.typeLabel}
      </span>
      <Handle type="target" position={Position.Left} />
      <ResourceIcon category={data.category} provider={data.provider} size={34} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold leading-tight text-foreground">
          {data.title}
        </div>
        <div className="truncate text-[11px] leading-tight text-muted">{data.subtitle}</div>
      </div>
      {data.warn ? (
        <span title="Missing required arguments" className="absolute -right-1.5 -top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-warning text-white shadow-sm">
          <AlertTriangle className="h-2.5 w-2.5" />
        </span>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ContainerNodeView({ id, data, selected }: NodeProps<ContainerFlowNode>) {
  const color = PROVIDER_COLORS[data.provider];
  const applyCanvasOps = useEditor((s) => s.applyCanvasOps);
  return (
    <div
      className="h-full w-full rounded-[14px] border-2 border-dashed transition-colors"
      style={{
        borderColor: `color-mix(in srgb, ${color} ${selected ? '85' : '50'}%, transparent)`,
        background: `color-mix(in srgb, ${color} 4%, transparent)`,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={140}
        lineClassName="!border-primary/60"
        handleClassName="!h-2.5 !w-2.5 !rounded-[3px] !border-primary !bg-surface-1"
        onResizeEnd={(_e, params) => {
          // params.x/y are relative to the parent — the same space the IR stores
          applyCanvasOps([
            {
              kind: 'move_node',
              nodeId: id,
              position: {
                x: params.x,
                y: params.y,
                w: Math.round(params.width),
                h: Math.round(params.height),
              },
            },
          ]);
        }}
      />
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <ResourceIcon category={data.category} provider={data.provider} size={22} />
        <span className="truncate text-[12px] font-semibold text-foreground">{data.title}</span>
        {data.subtitle ? (
          <span className="truncate text-[11px] text-muted">· {data.subtitle}</span>
        ) : null}
        {data.warn ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" /> : null}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
