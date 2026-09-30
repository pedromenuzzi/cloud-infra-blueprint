/**
 * `module` calls: reading a ModuleNode apart (source, version, inputs,
 * meta-arguments), what its `source` points at (a Registry module, a git
 * repository, a folder of this project), references to it
 * (`module.vpc.private_subnets[0]`) and the canvas edges they make.
 *
 * Pure: no parser here (src/ir/localModules.ts reads child module folders).
 *
 * Child modules live in the project as files with a folder in their path
 * (`modules/network/main.tf`); the root module is the files without one.
 */
import { collectRefs, literalString, refTargetAddress } from './expr';
import type { Expression, IR, IREdge, ModuleNode, ResourceNode } from './types';

export const MODULE_PREFIX = 'module.';

/** Canvas / op ids of module calls are their addresses: `module.vpc`. */
export const isModuleId = (id: string): boolean => id.startsWith(MODULE_PREFIX);

export const moduleAddress = (name: string): string => `${MODULE_PREFIX}${name}`;

/** Arguments of a module call that aren't inputs of the module. */
export const MODULE_META_ARGS = ['source', 'version', 'count', 'for_each', 'depends_on', 'providers'] as const;
const META = new Set<string>(MODULE_META_ARGS);

/** Keys the parser gives verbatim sub-blocks (`dynamic "x" #0`) — never inputs. */
const RAW_ENTRY_KEY = /[\s"]/;

/* ------------------------------------------------------------- files */

/** A file of the root module: no folder in its project path. */
export const isRootModuleFile = (path: string): boolean => !path.includes('/');

/** The files of the root module only (what the IR is parsed from). */
export function rootModuleFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) if (isRootModuleFile(path)) out[path] = text;
  return out;
}

/** Folder of a project path (`modules/net/main.tf` → `modules/net`, `main.tf` → ''). */
export function dirOfPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** The files directly in project folder `dir` (not its sub-folders). */
export function filesInDir(files: Record<string, string>, dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) if (dirOfPath(path) === dir) out[path] = text;
  return out;
}

/** Project folders holding child-module files, sorted. */
export function moduleDirs(files: Record<string, string>): string[] {
  return [...new Set(Object.keys(files).map(dirOfPath).filter((d) => d !== ''))].sort();
}

/**
 * The project folder a local `source` (`./modules/net`, `../../modules/vpc`)
 * points at, seen from folder `from`. `..` never climbs above the project:
 * the import stores a module found outside the root module's folder at the
 * path this gives (src/lib/importTf.ts), so both sides always agree. '' means
 * the root module itself (never a valid module).
 */
export function resolveModuleDir(from: string, source: string): string {
  const parts = from ? from.split('/') : [];
  for (const seg of source.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/* ------------------------------------------------------------ sources */

export type ModuleSourceKind = 'local' | 'registry' | 'git' | 'other';

export interface ModuleSourceInfo {
  kind: ModuleSourceKind;
  /** as written */
  source: string;
  /** what the canvas shows: `terraform-aws-modules/vpc`, `./modules/network`, `org/repo//vpc` */
  short: string;
  /** registry modules */
  registry?: { host?: string; namespace: string; name: string; provider: string; subdir?: string };
  /** git sources: the `?ref=` pin */
  ref?: string;
}

const LOCAL_RE = /^\.{1,2}[/\\]/;
const SEGMENT = '[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?';
const REGISTRY_RE = new RegExp(
  `^(?:([A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+(?::\\d+)?)/)?(${SEGMENT})/(${SEGMENT})/([a-z0-9]{1,64})(?://(.+))?$`,
);
/** hosts Terraform reads as git shorthands, not registries */
const VCS_HOSTS = /^(?:github\.com|bitbucket\.org|gitlab\.com)\//i;
const PUBLIC_REGISTRY = 'registry.terraform.io';

export function parseModuleSource(source: string): ModuleSourceInfo {
  const s = source.trim();
  if (LOCAL_RE.test(s)) return { kind: 'local', source, short: s };
  if (!VCS_HOSTS.test(s) && !s.includes('::') && !/^[a-z]+:\/\//i.test(s) && !s.startsWith('git@')) {
    const m = REGISTRY_RE.exec(s);
    if (m) {
      const [, host, namespace, name, provider, subdir] = m;
      const tail = subdir ? `//${subdir.split('/').filter(Boolean).pop()}` : '';
      return {
        kind: 'registry',
        source,
        short: `${namespace}/${name}${tail}`,
        registry: { host, namespace, name, provider, subdir },
      };
    }
  }
  const isGit = /^git::|^git@|\.git(?:$|[/?])|^(?:github\.com|bitbucket\.org|gitlab\.com)\//i.test(s);
  // `git::https://github.com/org/repo.git//modules/x?ref=v1.2.0` → `org/repo//x`, ref v1.2.0
  const refMatch = /[?&]ref=([^&]+)/.exec(s);
  let body = s.replace(/^[a-z0-9]+::/i, '').replace(/\?.*$/, '');
  body = body.replace(/^[a-z+]+:\/\//i, '').replace(/^git@([^:]+):/, '$1/');
  const [repoPart, sub] = body.split('//');
  const repo = repoPart.replace(/\.git$/, '').split('/').filter(Boolean);
  // drop the host: `github.com/org/repo` → `org/repo`
  const path = repo.length > 2 && /\./.test(repo[0]) ? repo.slice(1) : repo;
  const short = `${path.slice(-2).join('/')}${sub ? `//${sub.split('/').filter(Boolean).pop()}` : ''}` || s;
  return {
    kind: isGit ? 'git' : 'other',
    source,
    short,
    ...(refMatch ? { ref: decodeURIComponent(refMatch[1]) } : {}),
  };
}

/** An exact version (`5.0.0`, `= 5.0.0`, `v5.0.0`) out of a `version` constraint, else null. */
export function exactVersion(version: string | undefined): string | null {
  const m = /^\s*=?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/.exec(version ?? '');
  return m ? m[1] : null;
}

/** How a version reads on the canvas: `v5.0.0` for an exact one, the constraint (`~> 5.0`) otherwise. */
export function versionLabel(version: string | undefined): string | undefined {
  if (!version?.trim()) return undefined;
  const exact = exactVersion(version);
  return exact ? `v${exact}` : version.trim();
}

/**
 * The public Registry's page of a module:
 * `https://registry.terraform.io/modules/<ns>/<name>/<provider>/<version>` —
 * `latest` unless the call pins an exact version. Null for other sources and
 * private registries.
 */
export function registryUrl(info: ModuleSourceInfo, version?: string): string | null {
  const r = info.registry;
  if (info.kind !== 'registry' || !r || (r.host && r.host.toLowerCase() !== PUBLIC_REGISTRY)) return null;
  const v = exactVersion(version) ?? 'latest';
  return `https://${PUBLIC_REGISTRY}/modules/${r.namespace}/${r.name}/${r.provider}/${v}`;
}

/* ------------------------------------------------------ module blocks */

export const moduleSource = (m: ModuleNode): string | undefined => literalString(m.args.source);
export const moduleVersion = (m: ModuleNode): string | undefined => literalString(m.args.version);

export function moduleSourceInfo(m: ModuleNode): ModuleSourceInfo | null {
  const source = moduleSource(m);
  return source === undefined ? null : parseModuleSource(source);
}

/** The inputs passed to the module (every argument but the meta-arguments), in code order. */
export function moduleInputs(m: ModuleNode): Array<[string, Expression]> {
  return Object.entries(m.args).filter(([k]) => !META.has(k) && !RAW_ENTRY_KEY.test(k));
}

/** The meta-arguments present (`count`, `for_each`, `depends_on`, `providers`), kept as written. */
export function moduleMetaArgs(m: ModuleNode): Array<[string, Expression]> {
  return Object.entries(m.args).filter(([k]) => META.has(k) && k !== 'source' && k !== 'version');
}

/* --------------------------------------------------------------- refs */

const MODULE_REF_RE = /^module\.([A-Za-z_][A-Za-z0-9_-]*)((?:\[[^\]]*\])*)(?:\.([A-Za-z_][A-Za-z0-9_-]*))?/;

/** `module.vpc.private_subnets[0]` → `{ name: 'vpc', output: 'private_subnets' }`; null for other refs. */
export function moduleRef(path: string): { name: string; output?: string } | null {
  const m = MODULE_REF_RE.exec(path);
  if (!m) return null;
  return m[3] !== undefined ? { name: m[1], output: m[3] } : { name: m[1] };
}

/** Every canvas node: resources and module calls. */
export type CanvasBlock = ResourceNode | ModuleNode;

/** The resource or module call with this id. */
export function findNode(ir: IR, id: string): CanvasBlock | undefined {
  if (isModuleId(id)) return ir.modules.find((m) => m.id === id);
  return ir.resources.find((r) => r.id === id);
}

export const hasNode = (ir: IR, id: string): boolean => findNode(ir, id) !== undefined;

/** ids of every canvas node */
export function nodeIds(ir: IR): Set<string> {
  return new Set([...ir.resources.map((r) => r.id), ...ir.modules.map((m) => m.id)]);
}

function refsOf(args: Record<string, Expression>): Array<{ field: string; path: string }> {
  const refs: Array<{ field: string; path: string }> = [];
  for (const [field, expr] of Object.entries(args)) collectRefs(expr, field, refs);
  return refs;
}

/**
 * Canvas edges a module call takes part in: resources and modules that use
 * a module's outputs (`subnet_id = module.vpc.private_subnets[0]`) point at
 * it; a module whose inputs reference resources (`subnet_ids =
 * aws_subnet.private[*].id`) points at them. Resource → resource edges are
 * graph.ts's.
 */
export function moduleEdges(ir: IR): IREdge[] {
  if (ir.modules.length === 0) return [];
  const modules = new Set(ir.modules.map((m) => m.id));
  const resources = new Set(ir.resources.map((r) => r.id));
  const edges: IREdge[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string, field: string) => {
    const rootField = field.split('.')[0];
    const id = `${source}->${target}:${rootField}`;
    if (source === target || seen.has(id)) return;
    seen.add(id);
    edges.push({ id, source, target, field: rootField, kind: 'reference' });
  };
  for (const node of [...ir.resources, ...ir.modules]) {
    const fromModule = isModuleId(node.id);
    for (const r of refsOf(node.args)) {
      const mod = moduleRef(r.path);
      if (mod) {
        const target = moduleAddress(mod.name);
        if (modules.has(target)) add(node.id, target, r.field);
        continue;
      }
      if (!fromModule) continue;
      const address = refTargetAddress(r.path);
      if (address && resources.has(address)) add(node.id, address, r.field);
    }
  }
  return edges;
}

/**
 * Who reads which output of `moduleId`: output name → the blocks that
 * reference it (resources, modules, outputs, locals…).
 */
export function referencedOutputs(ir: IR, moduleId: string): Map<string, string[]> {
  const name = moduleId.slice(MODULE_PREFIX.length);
  const out = new Map<string, string[]>();
  const note = (output: string | undefined, by: string) => {
    const key = output ?? '';
    const list = out.get(key) ?? [];
    if (!list.includes(by)) list.push(by);
    out.set(key, list);
  };
  const blocks: Array<{ id: string; args: Record<string, Expression> }> = [
    ...ir.resources,
    ...ir.modules,
    ...ir.outputs,
    ...ir.variables,
    ...ir.providers,
  ];
  for (const b of blocks) {
    if (b.id === moduleId) continue;
    for (const r of refsOf(b.args)) {
      const ref = moduleRef(r.path);
      if (ref?.name === name) note(ref.output, b.id);
    }
  }
  for (const x of ir.extras) {
    for (const m of x.text.matchAll(/\bmodule\.([A-Za-z_][A-Za-z0-9_-]*)(?:\[[^\]]*\])*(?:\.([A-Za-z_][A-Za-z0-9_-]*))?/g)) {
      if (m[1] === name && !/^\s*moved\b/.test(x.text)) note(m[2], x.id);
    }
  }
  return out;
}

/** Every block that references `moduleId` at all (what deleting the module would leave dangling). */
export function moduleReferrers(ir: IR, moduleId: string): string[] {
  return [...new Set([...referencedOutputs(ir, moduleId).values()].flat())];
}

/* ------------------------------------------------------------- layout */

/**
 * The IR with its module calls as plain, parentless resources of type
 * `module` — so the resource layout code (auto-layout, Auto-arrange) places
 * them too. Positions are shared objects: moves come back as
 * `move_node` ops on the module ids.
 */
export function withModuleNodes(ir: IR): IR {
  if (ir.modules.length === 0) return ir;
  return {
    ...ir,
    resources: [
      ...ir.resources,
      ...ir.modules.map(
        (m): ResourceNode => ({
          id: m.id,
          provider: 'other',
          type: 'module',
          name: m.name,
          args: m.args,
          position: m.position,
          trivia: m.trivia,
        }),
      ),
    ],
  };
}
