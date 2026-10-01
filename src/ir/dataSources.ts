/**
 * `data` blocks: lookups Terraform reads at plan time and never creates
 * (`data "aws_ami" "ubuntu"`, `data "aws_caller_identity" "current"`).
 *
 * Pure helpers over the IR: what a `data.x.y…` reference points at, who
 * reads a data source (and which of its attributes), and the canvas edges
 * data sources take part in. Edges follow the canvas convention: the block
 * holding the reference points at the block it reads, so a resource that
 * reads `data.aws_ami.ubuntu.id` points at the data source, and a data
 * source filtered by `aws_vpc.main.id` points at the VPC.
 */
import { collectRefs, refTargetAddress, scanTraversals } from './expr';
import { moduleAddress, moduleRef } from './modules';
import type { DataNode, Expression, IR, IREdge } from './types';

export const DATA_PREFIX = 'data.';

/** Canvas / op ids of data blocks are their addresses: `data.aws_ami.ubuntu`. */
export const isDataId = (id: string): boolean => id.startsWith(DATA_PREFIX);

const IDENT = '[A-Za-z_][A-Za-z0-9_-]*';
/** `data.<type>.<name>`, instance keys (`[0]`, `["a"]`), then the attribute read */
const DATA_REF_RE = new RegExp(`^data\\.(${IDENT})\\.(${IDENT})((?:\\[[^\\]]*\\])*)(?:\\.(${IDENT}))?`);

export interface DataRef {
  type: string;
  name: string;
  /** `data.aws_ami.ubuntu` */
  address: string;
  /** the attribute read (`id`, `names`, `json`), when the reference goes that far */
  attribute?: string;
}

/** `data.aws_availability_zones.available.names[0]` → type, name, address, attribute `names`; null for other refs. */
export function dataRef(path: string): DataRef | null {
  const m = DATA_REF_RE.exec(path);
  if (!m) return null;
  const ref: DataRef = { type: m[1], name: m[2], address: `${DATA_PREFIX}${m[1]}.${m[2]}` };
  if (m[4] !== undefined) ref.attribute = m[4];
  return ref;
}

/** The data block with this id. */
export function findData(ir: IR, id: string): DataNode | undefined {
  return ir.data.find((d) => d.id === id);
}

function refsOf(args: Record<string, Expression>): Array<{ field: string; path: string }> {
  const refs: Array<{ field: string; path: string }> = [];
  for (const [field, expr] of Object.entries(args)) collectRefs(expr, field, refs);
  return refs;
}

/**
 * Canvas edges data sources take part in: resources, module calls and other
 * data sources that read one point at it; a data source whose arguments
 * reference resources, module calls or data sources points at them.
 */
export function dataEdges(ir: IR): IREdge[] {
  if (ir.data.length === 0) return [];
  const data = new Set(ir.data.map((d) => d.id));
  const resources = new Set(ir.resources.map((r) => r.id));
  const modules = new Set(ir.modules.map((m) => m.id));
  const edges: IREdge[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string, field: string) => {
    const rootField = field.split('.')[0];
    const id = `${source}->${target}:${rootField}`;
    if (source === target || seen.has(id)) return;
    seen.add(id);
    edges.push({ id, source, target, field: rootField, kind: 'reference' });
  };
  for (const node of [...ir.resources, ...ir.modules, ...ir.data]) {
    const fromData = isDataId(node.id);
    for (const r of refsOf(node.args)) {
      const d = dataRef(r.path);
      if (d) {
        if (data.has(d.address)) add(node.id, d.address, r.field);
        continue;
      }
      // a data source's own arguments: what it is filtered by
      if (!fromData) continue;
      const mod = moduleRef(r.path);
      if (mod) {
        const target = moduleAddress(mod.name);
        if (modules.has(target)) add(node.id, target, r.field);
        continue;
      }
      const address = refTargetAddress(r.path);
      if (address && resources.has(address)) add(node.id, address, r.field);
    }
  }
  return edges;
}

/**
 * Who reads `dataId`, attribute by attribute: attribute name ('' for the
 * whole object) → the blocks that read it (resources, module calls, data
 * sources, outputs, variables, providers, locals and other verbatim blocks).
 */
export function dataReaders(ir: IR, dataId: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const note = (attribute: string | undefined, by: string) => {
    const key = attribute ?? '';
    const list = out.get(key) ?? [];
    if (!list.includes(by)) list.push(by);
    out.set(key, list);
  };
  const blocks: Array<{ id: string; args: Record<string, Expression> }> = [
    ...ir.resources,
    ...ir.modules,
    ...ir.data,
    ...ir.outputs,
    ...ir.variables,
    ...ir.providers,
  ];
  for (const b of blocks) {
    if (b.id === dataId) continue;
    for (const r of refsOf(b.args)) {
      const ref = dataRef(r.path);
      if (ref?.address === dataId) note(ref.attribute, b.id);
    }
  }
  for (const x of ir.extras) {
    if (/^\s*(?:moved|removed|import)\b/.test(x.text)) continue;
    // the code parts of its text (strings and comments skipped, interpolations read)
    for (const t of scanTraversals(x.text)) {
      const ref = dataRef(t.path);
      if (ref?.address === dataId) note(ref.attribute, x.id);
    }
  }
  return out;
}

/** Every block that reads `dataId` at all (what deleting it would leave dangling). */
export function dataReferrers(ir: IR, dataId: string): string[] {
  return [...new Set([...dataReaders(ir, dataId).values()].flat())];
}
