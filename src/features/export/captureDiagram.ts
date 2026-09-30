/**
 * Read the whole diagram off the live canvas for the PDF, as geometry rather
 * than pixels: node rectangles (absolute, children included), their labels,
 * the icon glyphs and the edge paths React Flow drew. The PDF draws it as
 * vectors (diagramVector.ts) in the light theme, whatever the app theme is.
 *
 * Rasterizing the DOM (html-to-image) blocked the tab for seconds even on a
 * small diagram and for minutes on a large one; reading geometry takes
 * milliseconds and never touches the canvas styles.
 */
import { getBezierPath, Position, type Edge, type InternalNode, type Node, type Rect } from '@xyflow/react';
import type { ContainerNodeData, NodeSecurity, ResourceNodeData, SecFlowData } from '@/features/editor/nodes';
import type { Provider } from '@/ir/types';
import { parseSvgPath, shapePathData, type PathSeg } from '@/lib/pdf/svgPath';
import type { Category } from '@/resources/types';
import { portText } from '@/security/model';
import { LIGHT_PALETTE, type DiagramEdge, type DiagramGlyph, type DiagramNode, type DiagramPalette, type DiagramVector } from './diagramVector';

/** the parts of the React Flow instance the capture reads */
export interface FlowGeometrySource {
  getNodes(): Node[];
  getEdges(): Edge[];
  getInternalNode(id: string): InternalNode | undefined;
}

export interface CaptureOptions {
  signal?: AbortSignal;
}

const TONE = { danger: '#ef4444', public: '#0ea5e9', internal: '#10b981' } as const;

function abortError(): Error {
  return new DOMException('The export was cancelled', 'AbortError');
}

function hex(value: string, fallback: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (m) return `#${[m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
  return fallback;
}

/** the light-theme tokens, read through `.bp-force-light` so a dark app still yields the light palette */
function readPalette(flow: Element | null): DiagramPalette {
  if (!flow) return LIGHT_PALETTE;
  const probe = document.createElement('div');
  probe.className = 'bp-force-light';
  probe.style.display = 'none';
  flow.appendChild(probe);
  try {
    const css = getComputedStyle(probe);
    const token = (name: string, fallback: string) => hex(css.getPropertyValue(name), fallback);
    return {
      canvas: token('--canvas-bg', LIGHT_PALETTE.canvas),
      node: token('--node-bg', LIGHT_PALETTE.node),
      nodeBorder: token('--node-border', LIGHT_PALETTE.nodeBorder),
      text: token('--foreground', LIGHT_PALETTE.text),
      muted: token('--muted-foreground', LIGHT_PALETTE.muted),
      border: token('--border', LIGHT_PALETTE.border),
      edgeRef: token('--edge-ref', LIGHT_PALETTE.edgeRef),
      edgeSecurity: token('--edge-security', LIGHT_PALETTE.edgeSecurity),
    };
  } finally {
    probe.remove();
  }
}

/** the service glyph inside a node's icon tile, as paths in its 24 × 24 box */
function readGlyph(nodeEl: Element): DiagramGlyph | undefined {
  const svg = nodeEl.querySelector('span[style*="gradient"] svg');
  if (!svg) return undefined;
  const strokeWidth = parseFloat(svg.getAttribute('stroke-width') ?? '2') || 2;
  const parts: DiagramGlyph['parts'] = [];
  const walk = (el: Element, inherited: { fill: boolean; stroke: boolean }) => {
    for (const child of Array.from(el.children)) {
      const fillAttr = child.getAttribute('fill');
      const strokeAttr = child.getAttribute('stroke');
      const style = {
        fill: fillAttr === null ? inherited.fill : fillAttr !== 'none' && fillAttr !== 'transparent',
        stroke: strokeAttr === null ? inherited.stroke : strokeAttr !== 'none',
      };
      const tag = child.tagName.toLowerCase();
      if (tag === 'g') {
        walk(child, style);
        continue;
      }
      const d = shapePathData(tag, (name) => child.getAttribute(name));
      if (!d) continue;
      const path = parseSvgPath(d);
      if (path.length) parts.push({ path, ...style });
    }
  };
  walk(svg, {
    fill: !['none', null].includes(svg.getAttribute('fill')),
    stroke: svg.getAttribute('stroke') !== 'none',
  });
  return parts.length ? { strokeWidth, parts } : undefined;
}

function sizeOf(internal: InternalNode, node: Node) {
  return {
    w: internal.measured?.width ?? node.width ?? 0,
    h: internal.measured?.height ?? node.height ?? 0,
  };
}

/** an edge's path when the DOM has none (not rendered yet): a bézier between facing sides */
function fallbackPath(a: DiagramNode, b: DiagramNode): PathSeg[] {
  const left = a.x + a.w / 2 <= b.x + b.w / 2;
  const [path] = getBezierPath({
    sourceX: left ? a.x + a.w : a.x,
    sourceY: a.y + a.h / 2,
    sourcePosition: left ? Position.Right : Position.Left,
    targetX: left ? b.x : b.x + b.w,
    targetY: b.y + b.h / 2,
    targetPosition: left ? Position.Left : Position.Right,
  });
  return parseSvgPath(path);
}

/**
 * The diagram inside `bounds` (canvas coordinates, every node included) as
 * vector geometry. Selection and hover state are not part of it.
 */
export async function captureDiagram(
  rf: FlowGeometrySource,
  bounds: Rect,
  lens: boolean,
  { signal }: CaptureOptions = {},
): Promise<DiagramVector> {
  if (signal?.aborted) throw abortError();
  const flow = document.querySelector('.react-flow');
  const palette = readPalette(flow);
  const glyphs: Record<string, DiagramGlyph> = {};
  const nodes: DiagramNode[] = [];
  const byId = new Map<string, DiagramNode>();
  // one DOM pass each, not a query per node / edge
  const byDataId = (selector: string) => {
    const out = new Map<string, Element>();
    for (const el of Array.from(flow?.querySelectorAll(selector) ?? [])) {
      const id = el.getAttribute('data-id');
      if (id !== null) out.set(id, el);
    }
    return out;
  };
  const nodeEls = byDataId('.react-flow__node');

  for (const node of rf.getNodes()) {
    if (node.hidden) continue;
    const internal = rf.getInternalNode(node.id);
    if (!internal) continue;
    const { x, y } = internal.internals.positionAbsolute;
    const { w, h } = sizeOf(internal, node);
    const kind = node.type === 'container' ? 'container' : node.type === 'internet' ? 'internet' : 'resource';
    const data = node.data as Partial<ResourceNodeData & ContainerNodeData>;
    const glyphKey = kind === 'internet' ? '__internet__' : (data.resourceType ?? data.category ?? '');
    if (glyphKey && !(glyphKey in glyphs)) {
      const el = nodeEls.get(node.id);
      const glyph = el ? readGlyph(el) : undefined;
      if (glyph) glyphs[glyphKey] = glyph;
    }
    const entry: DiagramNode = {
      id: node.id,
      kind,
      x,
      y,
      w,
      h,
      title: kind === 'internet' ? 'Internet' : (data.title ?? node.id),
      subtitle: data.subtitle,
      typeLabel: data.typeLabel,
      category: (data.category ?? (kind === 'container' ? 'network' : 'compute')) as Category,
      provider: (data.provider ?? 'other') as Provider,
      glyph: glyphKey || undefined,
      warn: data.warn,
      security: data.security as NodeSecurity | undefined,
      repeat: data.repeat?.text,
    };
    nodes.push(entry);
    byId.set(node.id, entry);
  }
  // parents first (the canvas paints children above their containers)
  const all = new Map(rf.getNodes().map((m) => [m.id, m] as const));
  const depthOf = (id: string) => {
    let d = 0;
    let parent = all.get(id)?.parentId;
    while (parent && d < 16) {
      d++;
      parent = all.get(parent)?.parentId;
    }
    return d;
  };
  const depths = new Map(nodes.map((n) => [n.id, depthOf(n.id)] as const));
  nodes.sort((a, b) => depths.get(a.id)! - depths.get(b.id)!);

  // hand the main thread back once between the two passes
  await new Promise((r) => setTimeout(r, 0));
  if (signal?.aborted) throw abortError();

  const edges: DiagramEdge[] = [];
  const edgeEls = byDataId('.react-flow__edge');
  for (const edge of rf.getEdges()) {
    if (edge.hidden) continue;
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (!a || !b) continue;
    const d = edgeEls.get(edge.id)?.querySelector('path.react-flow__edge-path')?.getAttribute('d');
    const path = d ? parseSvgPath(d) : fallbackPath(a, b);
    if (path.length < 2) continue;
    if (edge.type === 'secflow') {
      const data = edge.data as Partial<SecFlowData> | undefined;
      edges.push({
        id: edge.id,
        kind: 'traffic',
        path,
        color: TONE[data?.tone ?? 'internal'],
        // the canvas label (nodes.tsx SecFlowEdge), in the document's language — the one in effect now
        label: (data?.ports ?? []).map((p) => (p === 'all' ? portText(p) : `:${portText(p)}`)).join(' '),
      });
    } else {
      const data = edge.data as { kind?: string; dimmed?: boolean } | undefined;
      edges.push({ id: edge.id, kind: data?.kind === 'security' ? 'security' : 'ref', path, dimmed: data?.dimmed });
    }
  }
  if (signal?.aborted) throw abortError();

  return {
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    nodes,
    edges,
    glyphs,
    palette,
    lens,
  };
}
