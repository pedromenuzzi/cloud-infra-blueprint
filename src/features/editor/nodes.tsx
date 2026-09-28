import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  NodeResizer,
  Position,
  useInternalNode,
  type Edge,
  type InternalNode,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { AlertTriangle, Globe, Lock, Shield, ShieldEllipsis, ShieldOff, ShieldQuestion } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Provider } from '@/ir/types';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS, ProviderChip, ResourceIcon } from '@/resources/icons';
import type { Category } from '@/resources/types';
import { useEditor } from './store';

/** security-lens decorations (undefined when the lens is off) */
export interface NodeSecurity {
  exposure?: { level: 'internet' | 'unknown' | 'restricted' | 'isolated'; ports: string[] };
  /** SG / NACL / NSG / firewall rule summary */
  rules?: string;
  /** worst finding touching this node */
  risk?: 'critical' | 'high' | 'medium' | 'low';
  subnet?: 'public' | 'private';
  nacls?: number;
  /** nothing security-relevant here — fade it */
  dim?: boolean;
}

const RISK_COLOR = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#64748b' } as const;

function SecurityChip({ security }: { security: NodeSecurity }) {
  const risky = security.risk === 'critical' || security.risk === 'high';
  let tone = '#10b981';
  let icon = <Lock className="h-2.5 w-2.5" />;
  let label: string | undefined;
  if (security.rules !== undefined) {
    tone = security.risk ? RISK_COLOR[security.risk] : '#64748b';
    icon = <Shield className="h-2.5 w-2.5" />;
    label = security.rules;
  } else if (security.exposure?.level === 'internet') {
    tone = risky ? RISK_COLOR[security.risk!] : '#0ea5e9';
    icon = <Globe className="h-2.5 w-2.5" />;
    label = `Public :${security.exposure.ports.slice(0, 3).join(', :')}${security.exposure.ports.length > 3 ? '…' : ''}`;
  } else if (security.exposure?.level === 'unknown') {
    tone = '#f59e0b';
    icon = <ShieldQuestion className="h-2.5 w-2.5" />;
    label = 'Unverified';
  } else if (security.exposure?.level === 'restricted') {
    label = 'Private';
  } else if (security.exposure?.level === 'isolated') {
    tone = '#64748b';
    icon = <ShieldOff className="h-2.5 w-2.5" />;
    label = 'No inbound';
  } else if (security.risk) {
    tone = RISK_COLOR[security.risk];
    icon = <AlertTriangle className="h-2.5 w-2.5" />;
    label = security.risk === 'low' ? 'Review' : 'At risk';
  }
  if (!label) return null;
  return (
    <span
      className="bp-sec-chip absolute -bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full border bg-node px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide shadow-xs"
      style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 45%, transparent)` }}
    >
      {icon}
      {label}
    </span>
  );
}

export interface ResourceNodeData extends Record<string, unknown> {
  security?: NodeSecurity;
  title: string;
  subtitle: string;
  typeLabel: string;
  resourceType: string;
  provider: Provider;
  category: Category;
  warn: boolean;
}

export interface ContainerNodeData extends Record<string, unknown> {
  security?: NodeSecurity;
  title: string;
  subtitle?: string;
  typeLabel: string;
  resourceType: string;
  provider: Provider;
  category: Category;
  warn: boolean;
}

export type ResourceFlowNode = Node<ResourceNodeData, 'resource'>;
export type ContainerFlowNode = Node<ContainerNodeData, 'container'>;
export type InternetFlowNode = Node<Record<string, unknown>, 'internet'>;
export type FlowNode = ResourceFlowNode | ContainerFlowNode | InternetFlowNode;

/** The public internet, drawn by the security lens as the origin of inbound traffic. */
export function InternetNodeView() {
  return (
    <div className="bp-internet relative flex h-[76px] w-[184px] items-center gap-3 rounded-[40px] border-2 border-dashed bg-node px-3.5 shadow-md">
      <span className="flex h-11 w-11 items-center justify-center rounded-full text-white shadow-md" style={{ background: 'linear-gradient(145deg, #38bdf8, #2563eb)' }}>
        <Globe className="h-6 w-6" />
      </span>
      <div>
        <div className="text-[13.5px] font-semibold leading-tight text-foreground">Internet</div>
        <div className="font-mono text-[11px] text-muted">0.0.0.0/0</div>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

/** CSS custom properties carrying the category color (light + dark variants). */
function catVars(category: Category): CSSProperties {
  const c = CATEGORY_COLORS[category];
  return { '--cat': c.solid, '--cat-light': c.from } as CSSProperties;
}

function WarnBadge() {
  return (
    <span
      title="Missing required arguments"
      className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-warning text-white shadow-sm ring-2 ring-node"
    >
      <AlertTriangle className="h-2.5 w-2.5" />
    </span>
  );
}

export function ResourceNodeView({ data, selected }: NodeProps<ResourceFlowNode>) {
  return (
    <div
      style={catVars(data.category)}
      className={cn(
        'bp-node group relative flex h-[76px] w-[208px] items-center gap-2.5 rounded-[12px] border bg-node pl-2.5 pr-2.5 shadow-sm',
        selected ? 'bp-node-selected border-transparent' : 'border-node-border',
        data.security?.dim && 'bp-dim',
        !selected && (data.security?.risk === 'critical' || data.security?.risk === 'high') && 'bp-risk',
      )}
    >
      <Handle type="target" position={Position.Left} />
      <ResourceIcon category={data.category} type={data.resourceType} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[9.5px] font-bold uppercase tracking-[0.07em] text-(--cat) dark:text-(--cat-light)">
            {data.typeLabel}
          </span>
          {data.provider !== 'other' ? <ProviderChip provider={data.provider} /> : null}
        </div>
        <div className="mt-px truncate text-[13px] font-semibold leading-tight text-foreground">
          {data.title}
        </div>
        <div className="truncate text-[11px] leading-snug text-muted">{data.subtitle}</div>
      </div>
      {data.warn ? <WarnBadge /> : null}
      {data.security ? <SecurityChip security={data.security} /> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ContainerNodeView({ id, data, selected }: NodeProps<ContainerFlowNode>) {
  const applyCanvasOps = useEditor((s) => s.applyCanvasOps);
  return (
    <div
      style={catVars(data.category)}
      className={cn('bp-container h-full w-full rounded-[16px]', selected && 'bp-container-selected', data.security?.dim && 'bp-dim')}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={140}
        lineClassName="!border-(--cat)/60"
        handleClassName="!h-2.5 !w-2.5 !rounded-[3px] !border-(--cat) !bg-surface-1"
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
        <ResourceIcon category={data.category} type={data.resourceType} size={24} />
        <span className="truncate text-[12.5px] font-semibold text-foreground">{data.title}</span>
        <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.07em] text-(--cat) dark:text-(--cat-light)">
          {data.typeLabel}
        </span>
        {data.subtitle ? (
          <span className="truncate rounded-[5px] bg-surface-1/70 px-1.5 py-px font-mono text-[10.5px] text-muted ring-1 ring-border">
            {data.subtitle}
          </span>
        ) : null}
        {data.security?.subnet ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide"
            style={{
              color: data.security.subnet === 'public' ? '#0284c7' : '#059669',
              background: data.security.subnet === 'public' ? 'color-mix(in srgb, #0ea5e9 14%, transparent)' : 'color-mix(in srgb, #10b981 14%, transparent)',
            }}
          >
            {data.security.subnet === 'public' ? <Globe className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
            {data.security.subnet}
          </span>
        ) : null}
        {data.security?.nacls ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger/10 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-danger" title="Network ACL on this subnet">
            <ShieldEllipsis className="h-2.5 w-2.5" /> NACL
          </span>
        ) : null}
        <span className="flex-1" />
        {data.warn ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" /> : null}
        {data.provider !== 'other' ? <ProviderChip provider={data.provider} /> : null}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export interface FlowEdgeData extends Record<string, unknown> {
  field: string;
  kind: string;
  /** an endpoint is selected — draw attention and animate the flow */
  active: boolean;
  /** security lens is on — references step back */
  dimmed?: boolean;
}

export type FlowEdgeType = Edge<FlowEdgeData, 'flow'>;

/** Middle of the side of `node` that faces `other` — edges attach to the nearest side. */
function facingSide(node: InternalNode, other: InternalNode): { x: number; y: number; position: Position } {
  const a = node.internals.positionAbsolute;
  const b = other.internals.positionAbsolute;
  const aw = node.measured.width ?? node.width ?? 0;
  const ah = node.measured.height ?? node.height ?? 0;
  const bw = other.measured.width ?? other.width ?? 0;
  const bh = other.measured.height ?? other.height ?? 0;
  const dx = b.x + bw / 2 - (a.x + aw / 2);
  const dy = b.y + bh / 2 - (a.y + ah / 2);
  // compare against the node's aspect so wide nodes prefer left/right
  if (Math.abs(dx) / Math.max(aw, 1) >= Math.abs(dy) / Math.max(ah, 1)) {
    return dx >= 0
      ? { x: a.x + aw, y: a.y + ah / 2, position: Position.Right }
      : { x: a.x, y: a.y + ah / 2, position: Position.Left };
  }
  return dy >= 0
    ? { x: a.x + aw / 2, y: a.y + ah, position: Position.Bottom }
    : { x: a.x + aw / 2, y: a.y, position: Position.Top };
}

export function FlowEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<FlowEdgeType>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  let geometry = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  if (sourceNode && targetNode) {
    const s = facingSide(sourceNode, targetNode);
    const t = facingSide(targetNode, sourceNode);
    geometry = {
      sourceX: s.x,
      sourceY: s.y,
      sourcePosition: s.position,
      targetX: t.x,
      targetY: t.y,
      targetPosition: t.position,
    };
  }
  const [path, labelX, labelY] = getBezierPath(geometry);
  const security = data?.kind === 'security';
  const active = selected || data?.active;
  const color = security ? 'var(--edge-security)' : 'var(--edge-ref)';
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={12}
        style={{
          stroke: color,
          strokeWidth: active ? 2.25 : 1.5,
          strokeDasharray: security ? '6 5' : undefined,
          opacity: data?.dimmed ? 0.14 : active ? 1 : 0.62,
          transition: 'opacity 150ms, stroke-width 150ms',
        }}
      />
      {active ? (
        <circle r={3.5} fill={color} className="bp-edge-dot">
          <animateMotion dur="1.8s" repeatCount="indefinite" path={path} />
        </circle>
      ) : null}
      {active && data?.field ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-full border bg-surface-1 px-2 py-0.5 font-mono text-[10px] font-medium text-muted shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.field}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export interface SecFlowData extends Record<string, unknown> {
  ports: string[];
  tone: 'danger' | 'public' | 'internal';
  explain: string;
}

export type SecFlowEdgeType = Edge<SecFlowData, 'secflow'>;

const TONE = { danger: '#ef4444', public: '#0ea5e9', internal: '#10b981' } as const;

/** Allowed traffic (security lens): internet → resource, or resource → resource via SG references. */
export function SecFlowEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<SecFlowEdgeType>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  let geometry = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  if (sourceNode && targetNode) {
    const s = facingSide(sourceNode, targetNode);
    const t = facingSide(targetNode, sourceNode);
    geometry = { sourceX: s.x, sourceY: s.y, sourcePosition: s.position, targetX: t.x, targetY: t.y, targetPosition: t.position };
  }
  const [path, labelX, labelY] = getBezierPath(geometry);
  const color = TONE[data?.tone ?? 'internal'];
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={14}
        className="bp-secflow"
        style={{ stroke: color, strokeWidth: 2.25 }}
      />
      <EdgeLabelRenderer>
        <div
          title={data?.explain}
          className="nodrag nopan pointer-events-auto absolute rounded-full border bg-surface-1 px-2 py-0.5 font-mono text-[10.5px] font-bold shadow-sm"
          style={{
            color,
            borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {(data?.ports ?? []).map((p) => (p === 'all' ? 'all' : `:${p}`)).join(' ')}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
