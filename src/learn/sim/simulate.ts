/**
 * A Terraform CLI that runs in the browser: `init`, `validate`, `plan`,
 * `apply` and `destroy` over a lesson's files and the simulated state of
 * its last apply. Nothing reaches a cloud: ids, ARNs and IPs are made up
 * (deterministically, ./catalog.ts), and what an apply would compute is
 * `(known after apply)` until it "runs".
 *
 * The plan is a real diff of the configuration against the state: create,
 * update in place, replace (when an argument that forces it changes, or
 * depends on a replaced resource's new id), destroy; `count` and `for_each`
 * expanded to instance addresses; `moved` blocks followed (`# a has moved
 * to b`); data sources read during the plan, or during the apply when their
 * arguments wait on it (`<=`); local modules planned resource by resource
 * (`module.net.aws_vpc.this`), Registry ones left out with a note.
 *
 * And what production work leans on: a backend (`init` configures it, and
 * migrates the state into it; a remote one locks the state around each run),
 * variables from `terraform.tfvars`, `*.auto.tfvars`, `-var-file` and `-var`
 * (in Terraform's order of precedence), workspaces (`terraform.workspace`,
 * a state each), `import` and `removed` blocks, the `lifecycle` arguments,
 * sensitive values kept out of the output, and plans saved with `-out`.
 * Pure: the same files and state always print the same thing.
 */
import { movedBlocks } from '@/hcl/moved';
import { lineColOf, parseFile, parseProject } from '@/hcl/parser';
import { collectRefs, refTargetAddress, scanTraversals } from '@/ir/expr';
import { moduleTarget, type LocalModule } from '@/ir/localModules';
import { moduleInputs } from '@/ir/modules';
import { exprText, instanceAddress, localValue, repeatOf } from '@/ir/repeat';
import type { Expression, IR, ModuleNode, RawBlock, ResourceNode, Trivia } from '@/ir/types';
import { validateProject } from '@/ir/validate';
import { getDef } from '@/resources/registry';
import { constraintAllows } from '@/schema/versions';
import type { Files, PlanSummary, SimCommand, SimState } from '../types';
import { computedOf, createSeconds, dataAttrs, forcesNew, knowsData, makeAttr, makeId, plannedAttr, readData, sensitiveAttrs, versioned, type Fake } from './catalog';
import { dynamicLabel, evaluate, evaluateRecord, hasUnknown, instanceEnv, isObject, Opaque, UNKNOWN, type Scope, type Val } from './eval';
import {
  changeLines,
  decode,
  line,
  outputChangeLines,
  outputValueLines,
  problemLines,
  serialize,
  type ChangeAction,
  type Line,
  type OutputChange,
  type Problem,
  type ResourceChange,
} from './render';

export type { Line, Tone } from './render';

/** `-var 'name=value'` or `-var-file=prod.tfvars` */
export type VarArg = { kind: 'var'; text: string } | { kind: 'file'; name: string };

/** a plan `plan -out` saved: what `apply tfplan` carries out and `show tfplan` prints */
export interface SavedPlan {
  name: string;
  /** the code and the state it was made from: when either changed, it's stale */
  stamp: string;
  vars: VarArg[];
  /** the plan as `terraform show` prints it */
  lines: Line[];
}

export interface SimContext {
  /** `terraform init` ran for these providers and modules (see `initFingerprint`) */
  initialized: boolean;
  /** `-auto-approve`: apply and destroy don't stop to ask */
  autoApprove?: boolean;
  /** the `initFingerprint` of the last `init`: says what changed since (a module: "Module not installed", the backend) */
  installed?: string;
  /** `-var` and `-var-file`, in the order given */
  vars?: VarArg[];
  /** `plan -out=tfplan` */
  out?: string;
  /** `apply tfplan`: the plan saved under that name (`plan` undefined: there's no such file) */
  saved?: { name: string; plan?: SavedPlan };
  /** `plan -generate-config-out=generated.tf` */
  generateConfig?: string;
  /** `init -migrate-state` / `init -reconfigure`, for a backend that changed */
  backendFlag?: 'migrate-state' | 'reconfigure';
}

export interface SimResult {
  ok: boolean;
  lines: Line[];
  /** what apply and destroy leave behind (destroy: null); undefined when the state didn't change */
  state?: SimState | null;
  /** the resource changes plan, apply and destroy worked out */
  plan?: PlanSummary;
  /** apply / destroy without `-auto-approve`, init migrating the state: the index of the `Enter a value: yes` line (Terraform asks there) */
  confirmAt?: number;
  /** what follows the question when the answer is no, when that isn't a cancel (init: start with an empty state) */
  declined?: { lines: Line[]; state: SimState | null };
  /** `plan -out`: the plan to keep under its name */
  saved?: SavedPlan;
  /** `plan -generate-config-out`: the file to write into the project */
  generated?: { file: string; text: string };
}

const REGION = 'us-east-1';
const META = new Set(['count', 'for_each', 'depends_on', 'provider', 'lifecycle', 'provisioner', 'connection']);
const MODULE_META = new Set(['source', 'version', 'count', 'for_each', 'depends_on', 'providers']);
const RESOURCE_ROOT = /^(aws|azurerm|azuread|google|random|null|tls|local|time|archive|http|kubernetes|helm)_/;

/* ------------------------------------------------------------------ providers */

/** provider releases the simulated registry offers, newest first */
const RELEASES: Record<string, string[]> = {
  'hashicorp/aws': ['6.66.0', '5.100.0', '4.67.0', '3.76.1'],
  'hashicorp/azurerm': ['5.7.0', '4.40.0', '3.117.1'],
  'hashicorp/azuread': ['3.5.0', '2.53.1'],
  'hashicorp/google': ['8.4.0', '7.12.0', '6.50.0', '5.45.2'],
  'hashicorp/random': ['3.7.2', '2.3.1'],
  'hashicorp/null': ['3.2.4'],
  'hashicorp/tls': ['4.1.0', '3.4.0'],
  'hashicorp/local': ['2.5.3'],
  'hashicorp/time': ['0.13.1'],
  'hashicorp/archive': ['2.7.1'],
  'hashicorp/http': ['3.5.0'],
  'hashicorp/kubernetes': ['2.38.0'],
  'hashicorp/helm': ['3.0.2'],
};

export interface ProviderReq {
  /** the name the configuration uses (`aws`) */
  local: string;
  /** `hashicorp/aws` */
  source: string;
  constraint?: string;
}

const tfFiles = (files: Files): Files => Object.fromEntries(Object.entries(files).filter(([f]) => f.endsWith('.tf')));

/** the providers a configuration needs: `required_providers`, provider blocks, and the prefixes of its types */
export function requiredProviders(files: Files): ProviderReq[] {
  const { ir } = parseProject(tfFiles(files));
  const out = new Map<string, ProviderReq>();
  for (const extra of ir.extras) {
    const at = extra.text.search(/\brequired_providers\s*\{/);
    if (at === -1) continue;
    const body = /\{([\s\S]*)/.exec(extra.text.slice(at))?.[1] ?? '';
    for (const m of body.matchAll(/(?:^|\s)([A-Za-z][\w-]*)\s*=\s*(\{[^{}]*\}|"[^"]*")/g)) {
      const [, local, value] = m;
      const source = (/\bsource\s*=\s*"([^"]+)"/.exec(value)?.[1] ?? `hashicorp/${local}`).replace(/^registry\.terraform\.io\//, '');
      const constraint = value.startsWith('"') ? value.slice(1, -1) : /\bversion\s*=\s*"([^"]+)"/.exec(value)?.[1];
      out.set(local, { local, source: source.includes('/') ? source : `hashicorp/${source}`, constraint });
    }
  }
  const implied = (local: string) => {
    if (!out.has(local)) out.set(local, { local, source: `hashicorp/${local}` });
  };
  for (const p of ir.providers) implied(p.name);
  const types = (x: IR) => [...x.resources, ...x.data].map((r) => r.type.split('_')[0]);
  for (const t of types(ir)) implied(t);
  for (const m of ir.modules) {
    const target = moduleTarget(files, m);
    if (target.kind === 'local' && target.module) for (const t of types(target.module.ir)) implied(t);
  }
  return [...out.values()].sort((a, b) => a.source.localeCompare(b.source));
}

/** what `init` installs: when it changes (a provider added, a version constraint, a module, the backend), Terraform asks for `init` again */
export function initFingerprint(files: Files): string {
  const { ir } = parseProject(tfFiles(files));
  const backend = backendOf(files);
  return JSON.stringify([
    requiredProviders(files).map((p) => [p.source, p.constraint ?? '']),
    ir.modules.map((m) => [m.name, exprString(m.args.source)]),
    backend ? [backend.type, backend.config] : null,
  ]);
}

const exprString = (e: Expression | undefined) => (e?.kind === 'literal' ? String(e.value) : '');

interface Backend {
  type: string;
  /** its arguments, whitespace folded: a change means init again */
  config: string;
  /** it locks the state (S3 with `use_lockfile` or a DynamoDB table; the others always do) */
  locks: boolean;
}

/** the `backend "s3" { … }` of the `terraform` block (null: the local one) */
export function backendOf(files: Files): Backend | null {
  const { ir } = parseProject(tfFiles(files));
  for (const x of ir.extras) {
    const m = /^\s*terraform\s*\{[\s\S]*?\bbackend\s+"([^"]+)"\s*\{/.exec(x.text);
    if (!m) continue;
    let depth = 1;
    let end = m[0].length;
    for (; end < x.text.length && depth > 0; end++) depth += x.text[end] === '{' ? 1 : x.text[end] === '}' ? -1 : 0;
    const body = x.text.slice(m[0].length, end - 1).replace(/(#|\/\/).*$/gm, '');
    const locks = m[1] === 's3' ? /\buse_lockfile\s*=\s*true\b|\bdynamodb_table\s*=/.test(body) : ['azurerm', 'gcs', 'consul', 'pg', 'kubernetes'].includes(m[1]);
    return { type: m[1], config: body.replace(/\s+/g, ' ').trim(), locks };
  }
  return null;
}

/** the backend an `initFingerprint` recorded: `[type, config]`, null (local), undefined (no init yet) */
function installedBackend(installed: string | undefined): [string, string] | null | undefined {
  if (!installed) return undefined;
  return (JSON.parse(installed) as unknown[])[2] as [string, string] | null | undefined ?? null;
}

/* ------------------------------------------------------------------ diagnostics */

/** where a problem is: the argument's line (else the block header), the block, the source line */
function at(files: Files, node: { trivia: Trivia }, field?: string, offset?: number): Pick<Problem, 'file' | 'line' | 'block' | 'source'> {
  const file = node.trivia.sourceFile ?? 'main.tf';
  const spans = node.trivia.spans;
  const text = files[file] ?? '';
  if (!spans) return { file };
  const entry = field === undefined ? undefined : spans.body.entries.find((e) => e.key === field);
  const lineNo = offset !== undefined ? lineColOf(text, offset).line : (entry?.line ?? spans.line);
  const lines = text.split('\n');
  return {
    file,
    line: lineNo,
    block: lines[spans.line - 1]?.replace(/\s*\{.*$/, '').trim(),
    source: lines[lineNo - 1] ?? '',
  };
}

/**
 * What `terraform validate` finds: parse errors, references to things
 * that aren't declared, required arguments left out (errors); and, with
 * `warnings`, the editor's own validation warnings.
 */
function diagnose(files: Files, ir: IR, parseDiagnostics: ReturnType<typeof parseProject>['diagnostics'], warnings: boolean): Problem[] {
  const out: Problem[] = [];
  for (const d of parseDiagnostics) {
    const source = d.start ? (files[d.file] ?? '').split('\n')[d.start.line - 1] : undefined;
    out.push({ severity: d.severity, summary: d.message, file: d.file, line: d.start?.line, source });
  }
  if (out.some((p) => p.severity === 'error')) return out;
  checkModule(files, ir, 'the root module', out, new Set(), 0);
  if (warnings) {
    const errorLines = new Set(out.map((p) => `${p.file}:${p.line}`));
    for (const d of validateProject(ir, getDef)) {
      if (d.severity !== 'warning' || errorLines.has(`${d.file}:${d.start?.line}`)) continue;
      const source = d.start ? (files[d.file] ?? '').split('\n')[d.start.line - 1] : undefined;
      out.push({ severity: 'warning', summary: d.message, file: d.file, line: d.start?.line, source });
    }
  }
  return out;
}

/**
 * One module's errors (`where`: "the root module", "module.net"), then
 * those of the modules of this project it calls, each folder once: its
 * references, the required arguments of its resources, and each module call
 * held to that module's variables and outputs.
 */
function checkModule(files: Files, ir: IR, where: string, out: Problem[], checked: Set<string>, depth: number) {
  const vars = new Set(ir.variables.map((v) => v.name));
  const data = new Set(ir.data.map((d) => d.id));
  const modules = new Set(ir.modules.map((m) => m.name));
  /** the calls to modules of this project, by name: their inputs and outputs are known */
  const children = new Map<string, LocalModule>();
  for (const m of ir.modules) {
    const target = moduleTarget(files, m);
    if (target.kind !== 'local' || !target.module) continue;
    if (!target.module.broken) children.set(m.name, target.module);
    else if (!checked.has(target.dir)) {
      checked.add(target.dir);
      for (const d of target.module.diagnostics.filter((x) => x.severity === 'error')) {
        out.push({ severity: 'error', summary: d.message, file: d.file, line: d.start?.line, source: d.start ? (files[d.file] ?? '').split('\n')[d.start.line - 1] : undefined });
      }
    }
  }
  const resources = new Set(ir.resources.map((r) => r.id));
  const types = new Set(ir.resources.map((r) => r.type));
  const seen = new Set<string>();
  const blocks = [...ir.resources, ...ir.data, ...ir.modules, ...ir.outputs, ...ir.providers, ...ir.extras.filter((x) => /^\s*locals\s*\{/.test(x.text))];
  for (const b of blocks) {
    const text = b.trivia.sourceText;
    const start = b.trivia.rawTextRange?.start;
    if (text === undefined || start === undefined) continue;
    for (const t of scanTraversals(text)) {
      const [root, second, third] = t.path.split('.').map((s) => s.replace(/\[.*$/, ''));
      let problem: Pick<Problem, 'summary' | 'detail'> | undefined;
      if (root === 'var' && !vars.has(second)) {
        problem = {
          summary: 'Reference to undeclared input variable',
          detail: `An input variable with the name "${second}" has not been declared. This variable can be\ndeclared with a variable "${second}" {} block.`,
        };
      } else if (root === 'local' && !localValue(ir, second)) {
        problem = { summary: 'Reference to undeclared local value', detail: `A local value with the name "${second}" has not been declared.` };
      } else if (root === 'module' && !modules.has(second)) {
        problem = { summary: 'Reference to undeclared module', detail: `No module call named "${second}" is declared in ${where}.` };
      } else if (root === 'module' && third !== undefined && children.has(second) && !children.get(second)!.outputs.some((o) => o.name === third)) {
        problem = { summary: 'Unsupported attribute', detail: `This object does not have an attribute named "${third}".` };
      } else if (root === 'data' && third !== undefined && !data.has(`data.${second}.${third}`)) {
        problem = { summary: 'Reference to undeclared resource', detail: `A data resource "${second}" "${third}" has not been declared in ${where}.` };
      } else if ((RESOURCE_ROOT.test(root) || types.has(root)) && second !== undefined && !resources.has(`${root}.${second}`)) {
        problem = { summary: 'Reference to undeclared resource', detail: `A managed resource "${root}" "${second}" has not been declared in ${where}.` };
      }
      if (!problem) continue;
      const place = at(files, b, undefined, start + t.start);
      const key = `${place.file}:${place.line}:${t.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ severity: 'error', ...problem, ...place });
    }
  }
  for (const r of ir.resources) {
    for (const field of getDef(r.type)?.fields ?? []) {
      if (!field.required || r.args[field.name] !== undefined) continue;
      out.push({
        severity: 'error',
        summary: 'Missing required argument',
        detail: `The argument "${field.name}" is required, but no definition was found.`,
        ...at(files, r),
      });
    }
  }
  for (const m of ir.modules) {
    const child = children.get(m.name);
    if (!child) continue;
    const given = new Set(moduleInputs(m).map(([k]) => k));
    for (const v of child.variables) {
      if (!v.required || given.has(v.name)) continue;
      out.push({ severity: 'error', summary: 'Missing required argument', detail: `The argument "${v.name}" is required, but no definition was found.`, ...at(files, m) });
    }
    for (const k of given) {
      if (child.variables.some((v) => v.name === k)) continue;
      out.push({ severity: 'error', summary: 'Unsupported argument', detail: `An argument named "${k}" is not expected here.`, ...at(files, m, k) });
    }
    // a module that (through others) calls itself stops here, like the plan's walk
    if (checked.has(child.dir) || depth >= 8) continue;
    checked.add(child.dir);
    checkModule(files, child.ir, `${where === 'the root module' ? '' : `${where}.`}module.${m.name}`, out, checked, depth + 1);
  }
}

/* ------------------------------------------------------------------ the walk */

interface Engine {
  files: Files;
  previous: SimState | null;
  /** the apply pass: ids and computed attributes are made */
  apply: boolean;
  /** the serial this apply writes: the seed of the ids it makes */
  gen: number;
  /** the apply pass follows the plan's actions */
  actions?: Map<string, ChangeAction>;
  /** every instance planned, in the order it was reached (dependencies first) */
  changes: ResourceChange[];
  /** each instance's values: its arguments and attributes */
  values: Map<string, Record<string, Val>>;
  reads: Line[];
  notes: Line[];
  problems: Problem[];
  regions: Map<string, string>;
  /** `moved` blocks: an instance's address → the one the state had it under */
  movedFrom: Map<string, string>;
  /** every resource reached (`module.net.aws_subnet.a`) → how it repeats; and every module instance (`module.env["prod"]`) */
  reached: Map<string, 'count' | 'for_each' | 'none' | 'module'>;
  /** `terraform.workspace` */
  workspace: string;
  /** `import` blocks: the address → the id it imports */
  imports: Map<string, string>;
}

interface Mod {
  /** `''`, `module.net.`, `module.net[0].` */
  prefix: string;
  ir: IR;
  /** its folder (`''`: the root module) */
  dir: string;
  vars: Map<string, Val>;
  locals: Map<string, Val>;
  /** `aws_vpc.main`, `data.aws_ami.x`, `module.net` → its value (an instance, or a list / map of them) */
  blocks: Map<string, Val>;
  /** attributes read from each block anywhere in the module: `aws_vpc.main` → {id, arn} */
  reads: Map<string, Set<string>>;
  /** its variables declared `sensitive = true` */
  secret: Set<string>;
}

const sensitiveVars = (ir: IR) => new Set(ir.variables.filter((v) => v.args.sensitive?.kind === 'literal' && v.args.sensitive.value === true).map((v) => v.name));

/**
 * The value holds something sensitive: a sensitive variable, an attribute
 * the provider marks sensitive (a password, a secret's string), through
 * locals too; unless `nonsensitive()` unwraps it.
 *
 * ponytail: tracked by what an expression references, not value by value:
 * a whole attribute is hidden (not one key of its map), and a resource
 * argument set from a secret doesn't make that attribute secret where
 * others read it. Mark values instead if lessons need finer grain.
 */
function isSensitive(e: Expression, mod: Mod, seen = new Set<string>()): boolean {
  if (e.kind === 'raw' && /\bnonsensitive\s*\(/.test(e.hcl)) return false;
  if (e.kind === 'raw' && /(^|[^\w])sensitive\s*\(/.test(e.hcl)) return true;
  const refs: Array<{ field: string; path: string }> = [];
  collectRefs(e, '', refs);
  return refs.some(({ path }) => {
    const [root, a, b, c] = path.split('.').map((s) => s.replace(/\[.*$/, ''));
    if (root === 'var') return mod.secret.has(a);
    if (root === 'local') {
      if (seen.has(a)) return false;
      seen.add(a);
      const value = localValue(mod.ir, a);
      return value !== undefined && isSensitive(value, mod, seen);
    }
    if (root === 'data') return c !== undefined && sensitiveAttrs(a).includes(c);
    return b !== undefined && sensitiveAttrs(root).includes(b);
  });
}

function scopeOf(mod: Mod, eng: Engine): Scope {
  const declared = (key: string, list: Array<{ id: string }>) => mod.blocks.get(key) ?? (list.some((x) => x.id === key) ? UNKNOWN : undefined);
  const scope: Scope = {
    ref(root, name) {
      switch (root) {
        case 'var':
          return mod.vars.get(name);
        case 'local': {
          if (mod.locals.has(name)) return mod.locals.get(name);
          const e = localValue(mod.ir, name);
          if (!e) return undefined;
          mod.locals.set(name, UNKNOWN); // a local that reads itself stays unknown
          const v = evaluate(e, scope);
          mod.locals.set(name, v);
          return v;
        }
        case 'path':
          return name === 'module' ? mod.dir || '.' : name === 'root' || name === 'cwd' ? '.' : undefined;
        case 'terraform':
          return name === 'workspace' ? eng.workspace : undefined;
        case 'data':
          return declared(`data.${name}`, mod.ir.data);
        case 'module':
          return declared(`module.${name}`, mod.ir.modules);
        default:
          return declared(`${root}.${name}`, mod.ir.resources);
      }
    },
    file: (path) => eng.files[mod.dir ? `${mod.dir}/${path}` : path],
  };
  return scope;
}

/** the block a reference points at: `aws_vpc.main`, `data.aws_ami.x`, `module.net` */
function blockKey(path: string): string | null {
  const segs = path.split('.').map((s) => s.replace(/\[.*$/, ''));
  if (segs[0] === 'data') return segs.length >= 3 ? `data.${segs[1]}.${segs[2]}` : null;
  if (segs[0] === 'module') return segs.length >= 2 ? `module.${segs[1]}` : null;
  return refTargetAddress(path);
}

/** the blocks `args` depend on, through `local.x` values too */
function depsOf(args: Record<string, Expression>, ir: IR, seen = new Set<string>()): Set<string> {
  const refs: Array<{ field: string; path: string }> = [];
  for (const e of Object.values(args)) collectRefs(e, '', refs);
  const out = new Set<string>();
  for (const { path } of refs) {
    const key = blockKey(path);
    if (key) out.add(key);
    const local = /^local\.([A-Za-z_][\w-]*)/.exec(path)?.[1];
    if (local && !seen.has(local)) {
      seen.add(local);
      const e = localValue(ir, local);
      if (e) for (const k of depsOf({ v: e }, ir, seen)) out.add(k);
    }
  }
  return out;
}

/** the attributes the module reads from each of its blocks (`aws_vpc.main.arn` → arn) */
function readsOf(ir: IR): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const note = (path: string) => {
    const key = blockKey(path);
    // the path goes on from the block's address: `[0].id`, `.arn`
    const attr = key && path.startsWith(key) ? /^(?:\[[^\]]*\])*\.([A-Za-z_][\w-]*)/.exec(path.slice(key.length))?.[1] : undefined;
    if (!key || !attr) return;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)!.add(attr);
  };
  for (const b of [...ir.resources, ...ir.data, ...ir.modules, ...ir.outputs]) {
    const refs: Array<{ field: string; path: string }> = [];
    for (const e of Object.values(b.args)) collectRefs(e, '', refs);
    refs.forEach((r) => note(r.path));
  }
  for (const x of ir.extras) if (/^\s*locals\s*\{/.test(x.text)) scanTraversals(x.text).forEach((t) => note(t.path));
  return out;
}

interface Lifecycle {
  createFirst: boolean;
  preventDestroy: boolean;
  /** argument names whose changes are ignored (`all`: every one) */
  ignore: Set<string> | 'all';
  /** `replace_triggered_by`: references whose change replaces this one */
  triggers: string[];
}

function lifecycleOf(r: ResourceNode): Lifecycle {
  const body = r.args.lifecycle?.kind === 'block' ? r.args.lifecycle.body : {};
  const flag = (e: Expression | undefined) => e?.kind === 'literal' && e.value === true;
  const ignore = body.ignore_changes;
  const triggers = body.replace_triggered_by;
  return {
    createFirst: flag(body.create_before_destroy),
    preventDestroy: flag(body.prevent_destroy),
    ignore:
      (ignore?.kind === 'raw' && ignore.hcl.trim() === 'all') || (ignore?.kind === 'ref' && ignore.path === 'all')
        ? 'all'
        : // `tags["Owner"]` ignores the whole map (ponytail: one key of it would need a path-aware diff)
          new Set(ignore?.kind === 'list' ? ignore.items.map((i) => (i.kind === 'ref' ? i.path : i.kind === 'literal' ? String(i.value) : '').replace(/[[.].*$/, '')) : []),
    triggers: triggers?.kind === 'list' ? triggers.items.flatMap((i) => (i.kind === 'ref' ? [i.path] : [])) : [],
  };
}

/** a `replace_triggered_by` reference changes in this plan: a whole instance with any change, an attribute whose value changes */
function triggered(eng: Engine, mod: Mod, paths: string[]): boolean {
  return paths.some((path) => {
    const key = blockKey(path);
    if (!key || !path.startsWith(key)) return false;
    const target = mod.prefix + key;
    const attr = /^(?:\[[^\]]*\])*\.([A-Za-z_][\w-]*)/.exec(path.slice(key.length))?.[1];
    return eng.changes.some((c) => {
      if ((c.address !== target && !c.address.startsWith(`${target}[`)) || c.action === 'noop' || c.action === 'read') return false;
      if (attr === undefined || c.action !== 'update') return true;
      const after = c.after?.[attr];
      return after === undefined || hasUnknown(after) || c.before?.[attr] !== serialize(after);
    });
  });
}

/** what an `import` reads: the object as the configuration describes it, with the id given and what the provider computes */
function importedObject(fake: Omit<Fake, 'id'>, id: string, computed: string[]): Record<string, string> {
  const f: Fake = { ...fake, seed: `${fake.seed}@import`, id };
  const out: Record<string, string> = { id };
  for (const k of computed) if (k !== 'id') out[k] = serialize(makeAttr(k, f));
  for (const [k, v] of Object.entries(fake.config)) if (!hasUnknown(v) && !(v instanceof Opaque)) out[k] = serialize(v);
  return out;
}

interface Instance {
  /** the full address (`module.net.aws_subnet.a[0]`) */
  address: string;
  env: Map<string, Val>;
  key?: string | number;
}

/** a block's instances (`count`, `for_each`), or null when how many can't be known now */
function expand(node: { id: string; args: Record<string, Expression>; trivia: Trivia }, mod: Mod, eng: Engine): { instances: Instance[]; kind?: 'count' | 'for_each' } | null {
  const scope = scopeOf(mod, eng);
  const fail = (meta: 'count' | 'for_each', unknown: boolean) => {
    const detail = unknown
      ? meta === 'count'
        ? 'The "count" value depends on resource attributes that cannot be determined until apply,\nso Terraform cannot predict how many instances will be created.'
        : 'The "for_each" map includes keys derived from resource attributes that cannot be\ndetermined until apply, and so Terraform cannot determine the full set of keys that\nwill identify the instances of this resource.'
      : `The given "${meta}" argument value is unsuitable: ${meta === 'count' ? 'a whole number is required' : 'the "for_each" argument must be a map, or set of strings'}.`;
    eng.problems.push({ severity: 'error', summary: `Invalid ${meta} argument`, detail, ...at(eng.files, node, meta) });
    return null;
  };
  if (node.args.count) {
    let n = evaluate(node.args.count, scope);
    if (n instanceof Opaque) n = repeatOf(node, mod.ir)?.size ?? n;
    if (n === UNKNOWN) return fail('count', true);
    const count = typeof n === 'number' ? n : typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : NaN;
    if (!Number.isInteger(count) || count < 0) return fail('count', false);
    return {
      kind: 'count',
      instances: Array.from({ length: count }, (_, i) => ({ address: mod.prefix + instanceAddress(node.id, 'count', i), env: instanceEnv(i), key: i })),
    };
  }
  if (node.args.for_each) {
    const v = evaluate(node.args.for_each, scope);
    if (v === UNKNOWN) return fail('for_each', true);
    let pairs: Array<[string, Val]>;
    if (isObject(v)) pairs = Object.keys(v).map((k) => [k, v[k]]);
    // ponytail: a list is taken as a set of strings; real Terraform wants `toset()` around it
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string' || x === UNKNOWN)) {
      if (v.includes(UNKNOWN)) return fail('for_each', true);
      pairs = [...new Set(v as string[])].map((k) => [k, k]);
    } else return fail('for_each', false);
    pairs.sort(([a], [b]) => a.localeCompare(b));
    return {
      kind: 'for_each',
      instances: pairs.map(([key, value]) => ({ address: mod.prefix + instanceAddress(node.id, 'for_each', key), env: instanceEnv(undefined, { key, value }), key })),
    };
  }
  return { instances: [{ address: mod.prefix + node.id, env: new Map() }] };
}

/** the value a repeated block stands for: a list (`count`) or a map (`for_each`) of its instances */
function gather(kind: 'count' | 'for_each' | undefined, values: Array<[string | number | undefined, Val]>): Val {
  if (kind === 'count') return values.map(([, v]) => v);
  if (kind === 'for_each') return Object.fromEntries(values.map(([k, v]) => [String(k), v]));
  return values[0]?.[1] ?? null;
}

const nonNull = (record: Record<string, Val>) => Object.fromEntries(Object.entries(record).filter(([, v]) => v !== null));

/** which of an instance's arguments are nested blocks: written as blocks, or what a `dynamic` block expanded to */
function blocksOf(args: Record<string, Expression>, config: Record<string, Val>): Set<string> {
  const out = new Set<string>();
  for (const [k, e] of Object.entries(args)) {
    const label = dynamicLabel(k);
    if (e.kind === 'block' || e.kind === 'blocks') out.add(k);
    else if (label !== undefined && Array.isArray(config[label])) out.add(label);
  }
  return out;
}

function findById(eng: Engine, id: string): Record<string, Val> | undefined {
  for (const v of eng.values.values()) if (v.id === id) return v;
  return undefined;
}

function regionOf(eng: Engine, r: ResourceNode, config: Record<string, Val>): string {
  if (typeof config.location === 'string') return config.location;
  const alias = r.args.provider?.kind === 'ref' ? r.args.provider.path.split('.')[1] : undefined;
  return eng.regions.get(alias ?? '') ?? eng.regions.get('') ?? REGION;
}

function visitResource(eng: Engine, mod: Mod, r: ResourceNode) {
  const expanded = expand(r, mod, eng);
  if (!expanded) return void mod.blocks.set(r.id, UNKNOWN);
  eng.reached.set(mod.prefix + r.id, expanded.kind ?? 'none');
  const scope = scopeOf(mod, eng);
  const life = lifecycleOf(r);
  const ignored = (k: string) => life.ignore === 'all' || life.ignore.has(k);
  const args = Object.fromEntries(Object.entries(r.args).filter(([k]) => !META.has(k)));
  const secret = new Set([...Object.keys(args).filter((k) => isSensitive(args[k], mod)), ...sensitiveAttrs(r.type)]);
  const values: Array<[string | number | undefined, Val]> = [];
  for (const inst of expanded.instances) {
    const config = nonNull(evaluateRecord(args, scope, inst.env));
    const blocks = blocksOf(args, config);
    const fake: Omit<Fake, 'id'> = {
      type: r.type,
      name: r.name,
      seed: `${inst.address}@${eng.gen}`,
      config,
      region: regionOf(eng, r, config),
      byId: (id) => findById(eng, id),
    };
    const computed = [...new Set(['id', ...computedOf(r.type), ...(mod.reads.get(r.id) ?? [])])].filter((k) => !(k in config));
    // an `import` block for an address the state doesn't have yet: the plan compares against the object it reads
    const importing = eng.previous?.resources[inst.address] ? undefined : eng.imports.get(inst.address);
    const prev = importing !== undefined ? importedObject(fake, importing, computed) : eng.previous?.resources[inst.address];
    // arguments left out that the provider keeps (they're computed, or the ones that would force a replacement)
    const kept = Object.keys(prev ?? {}).filter((k) => !(k in config) && (computed.includes(k) || forcesNew(r.type, k)));
    let action: ChangeAction;
    let forced = new Set<string>();
    let byTrigger = false;
    if (eng.actions) action = eng.actions.get(inst.address) ?? 'create';
    else if (!prev) action = 'create';
    else {
      const changed = Object.entries(config)
        .filter(([k, v]) => !ignored(k) && (hasUnknown(v) || prev[k] !== serialize(v)))
        .map(([k]) => k);
      for (const k of Object.keys(prev)) if (!(k in config) && !kept.includes(k) && !ignored(k)) changed.push(k);
      forced = new Set(changed.filter((k) => k in config && forcesNew(r.type, k)));
      byTrigger = forced.size === 0 && importing === undefined && triggered(eng, mod, life.triggers);
      action = forced.size > 0 || byTrigger ? 'replace' : changed.length > 0 ? 'update' : 'noop';
      if (action === 'replace' && life.preventDestroy) {
        eng.problems.push({
          severity: 'error',
          summary: 'Instance cannot be destroyed',
          detail: `Resource ${inst.address} has lifecycle.prevent_destroy set, but the plan calls for this\nresource to be destroyed. To avoid this error and continue with the plan, either disable\nlifecycle.prevent_destroy or reduce the scope of the plan using the -target flag.`,
          ...at(eng.files, r),
        });
      }
    }
    const fresh = action === 'create' || action === 'replace';
    const value: Record<string, Val> = {};
    const id = eng.apply && fresh ? makeId(fake) : undefined;
    for (const k of [...computed, ...kept]) {
      if (action === 'update' && prev?.[k] !== undefined && versioned(r.type, k)) value[k] = eng.apply ? Number(prev[k]) + 1 : UNKNOWN;
      else if (!fresh && prev?.[k] !== undefined) value[k] = decode(prev[k]);
      else if (!eng.apply) value[k] = plannedAttr(k, fake) ?? UNKNOWN;
      else value[k] = k === 'id' ? (id ?? makeId(fake)) : makeAttr(k, { ...fake, id: id ?? String(value.id ?? prev?.id ?? '') });
    }
    Object.assign(value, config);
    // ignore_changes: the object keeps what the state has for those arguments
    if (prev && !fresh) for (const k of Object.keys(config)) if (ignored(k) && prev[k] !== undefined) value[k] = decode(prev[k], config[k]);
    eng.values.set(inst.address, value);
    const hidden = [...secret].filter((k) => k in value);
    eng.changes.push({
      address: inst.address,
      type: r.type,
      name: r.name,
      action,
      before: prev,
      after: value,
      blocks,
      forced,
      createFirst: life.createFirst,
      movedFrom: eng.movedFrom.get(inst.address),
      ...(importing !== undefined ? { importing } : {}),
      ...(byTrigger ? { triggered: true } : {}),
      ...(hidden.length > 0 ? { sensitive: new Set(hidden) } : {}),
    });
    values.push([inst.key, value]);
  }
  mod.blocks.set(r.id, gather(expanded.kind, values));
}

function visitData(eng: Engine, mod: Mod, d: IR['data'][number]) {
  const expanded = expand(d, mod, eng);
  if (!expanded) return void mod.blocks.set(d.id, UNKNOWN);
  const scope = scopeOf(mod, eng);
  const args = Object.fromEntries(Object.entries(d.args).filter(([k]) => !META.has(k)));
  const values: Array<[string | number | undefined, Val]> = [];
  const known = knowsData(d.type);
  // `depends_on` something with changes pending: read once those are applied
  const refs: Array<{ field: string; path: string }> = [];
  if (d.args.depends_on) collectRefs(d.args.depends_on, '', refs);
  const waits = refs.some(({ path }) => {
    const key = blockKey(path);
    const target = key === null ? '' : mod.prefix + key;
    return key !== null && eng.changes.some((c) => c.action !== 'noop' && (c.address === target || c.address.startsWith(`${target}[`) || c.address.startsWith(`${target}.`)));
  });
  for (const inst of expanded.instances) {
    const config = nonNull(evaluateRecord(args, scope, inst.env));
    const reads = mod.reads.get(d.id) ?? new Set<string>();
    const because = waits ? 'depends on a resource or a module with changes pending' : 'config refers to values not yet known';
    const read = (after: Record<string, Val>): ResourceChange => ({ address: inst.address, type: d.type, name: d.name, action: 'read', after, blocks: blocksOf(args, config), because });
    let value: Record<string, Val>;
    if (!eng.apply && (hasUnknown(config) || waits || !known)) {
      // it reads something an apply creates, or waits on one (or the simulator can't answer for the type): Terraform reads it during the apply
      value = { ...config, ...Object.fromEntries(['id', ...dataAttrs(d.type), ...reads].filter((k) => !(k in config)).map((k) => [k, UNKNOWN])) };
      if (known) eng.changes.push(read(value));
    } else {
      const region = typeof config.region === 'string' ? config.region : (eng.regions.get('') ?? REGION);
      value = { ...config, ...readData(d.type, { type: d.type, name: d.name, seed: inst.address, config, region, byId: (id) => findById(eng, id) }, reads) };
      if (!eng.apply) {
        eng.reads.push(line(`${inst.address}: Reading...`, undefined, true), line(`${inst.address}: Read complete after 0s [id=${String(value.id)}]`));
      } else if (!known || eng.actions?.get(inst.address) === 'read') eng.changes.push(read(value));
    }
    values.push([inst.key, value]);
  }
  mod.blocks.set(d.id, gather(expanded.kind, values));
}

function visitModule(eng: Engine, mod: Mod, m: ModuleNode) {
  const target = moduleTarget(eng.files, m);
  const source = exprString(m.args.source);
  // a module that (through others) calls itself stops here
  if (mod.prefix.split('module.').length > 8) return void mod.blocks.set(m.id, UNKNOWN);
  if (target.kind !== 'local' || !target.module || target.module.broken) {
    if (!eng.apply) {
      const why = target.kind === 'remote' ? 'its code is downloaded by a real "terraform init"' : `the folder of "${source}" isn't in this project`;
      eng.notes.push(line(`  # ${mod.prefix}${m.id}: not simulated (${why}), so its resources are left out of this plan.`, 'muted'));
    }
    return void mod.blocks.set(m.id, UNKNOWN);
  }
  const child = target.module;
  const expanded = expand(m, mod, eng);
  if (!expanded) return void mod.blocks.set(m.id, UNKNOWN);
  const scope = scopeOf(mod, eng);
  const inputs = Object.fromEntries(Object.entries(m.args).filter(([k]) => !MODULE_META.has(k)));
  const values: Array<[string | number | undefined, Val]> = [];
  for (const inst of expanded.instances) {
    const given = evaluateRecord(inputs, scope, inst.env);
    const vars = new Map<string, Val>();
    const none: Scope = { ref: () => undefined };
    for (const v of child.ir.variables) {
      if (v.name in given) vars.set(v.name, given[v.name]);
      else if (v.args.default) vars.set(v.name, evaluate(v.args.default, none));
      else {
        vars.set(v.name, UNKNOWN);
        if (!eng.apply) {
          eng.problems.push({
            severity: 'error',
            summary: 'Missing required argument',
            detail: `The argument "${v.name}" is required, but no definition was found.`,
            ...at(eng.files, m),
          });
        }
      }
    }
    eng.reached.set(inst.address, 'module');
    const inner: Mod = { prefix: `${inst.address}.`, ir: child.ir, dir: target.dir, vars, locals: new Map(), blocks: new Map(), reads: readsOf(child.ir), secret: sensitiveVars(child.ir) };
    walk(eng, inner);
    const innerScope = scopeOf(inner, eng);
    values.push([inst.key, Object.fromEntries(child.ir.outputs.map((o) => [o.name, o.args.value ? evaluate(o.args.value, innerScope) : null]))]);
  }
  mod.blocks.set(m.id, gather(expanded.kind, values));
}

/** every block of a module, dependencies first */
function walk(eng: Engine, mod: Mod) {
  type Item = { key: string; visit: () => void; deps: Set<string> };
  const items: Item[] = [
    ...mod.ir.resources.map((r) => ({ key: r.id, visit: () => visitResource(eng, mod, r), deps: depsOf(r.args, mod.ir) })),
    ...mod.ir.data.map((d) => ({ key: d.id, visit: () => visitData(eng, mod, d), deps: depsOf(d.args, mod.ir) })),
    ...mod.ir.modules.map((m) => ({ key: m.id, visit: () => visitModule(eng, mod, m), deps: depsOf(m.args, mod.ir) })),
  ];
  const keys = new Set(items.map((i) => i.key));
  const done = new Set<string>();
  let pending = items;
  while (pending.length > 0) {
    const ready = pending.filter((i) => [...i.deps].every((d) => d === i.key || !keys.has(d) || done.has(d)));
    if (ready.length === 0) {
      if (!eng.apply) eng.problems.push({ severity: 'error', summary: `Cycle: ${pending.map((i) => mod.prefix + i.key).join(', ')}` });
      ready.push(...pending);
    }
    for (const item of ready) {
      item.visit();
      done.add(item.key);
    }
    pending = pending.filter((i) => !done.has(i.key));
  }
}

/* ------------------------------------------------------------------ plan */

interface Planned {
  problems: Problem[];
  /** instances in dependency order, deletes included (last) */
  changes: ResourceChange[];
  outputs: OutputChange[];
  /** each root output's value, for the Outputs section */
  outputValues: Map<string, { value: Val; sensitive: boolean }>;
  values: Map<string, Record<string, Val>>;
  reads: Line[];
  notes: Line[];
  /** the state with the `moved` blocks followed: what the plan compares against */
  state: SimState | null;
}

/**
 * The state as the configuration now names it: each `moved` block (in file
 * order, so chains work) re-keys what the state holds at `from` (a whole
 * resource or module carries its instances along), unless `to` is taken.
 * Then Terraform's implied moves: a resource that gained `count` keeps its
 * object as `[0]`, one that lost it takes `[0]` back.
 *
 * ponytail: `moved` blocks of the root module only, and implied moves for
 * the root's resources; read each module's own blocks with its prefix if
 * lessons move things inside a module.
 */
function moveState(ir: IR, previous: SimState | null): { state: SimState | null; movedFrom: Map<string, string> } {
  const movedFrom = new Map<string, string>();
  if (!previous) return { state: previous, movedFrom };
  let resources = previous.resources;
  const move = (from: string, to: string) => {
    const next: SimState['resources'] = {};
    for (const [address, attrs] of Object.entries(resources)) {
      const rest = address.startsWith(from) ? address.slice(from.length) : null;
      const carried = rest !== null && (rest === '' || rest.startsWith('.') || (rest.startsWith('[') && !from.endsWith(']') && !to.endsWith(']')));
      const target = carried ? to + rest : address;
      if (carried && resources[target] === undefined) {
        movedFrom.set(target, movedFrom.get(address) ?? address);
        movedFrom.delete(address);
        next[target] = attrs;
      } else next[address] = attrs;
    }
    resources = next;
  };
  for (const m of movedBlocks(ir)) move(m.from, m.to);
  for (const r of ir.resources) {
    const counted = r.args.count !== undefined;
    if (counted && resources[r.id] && !resources[`${r.id}[0]`]) move(r.id, `${r.id}[0]`);
    if (!counted && !r.args.for_each && resources[`${r.id}[0]`] && !resources[r.id]) move(`${r.id}[0]`, r.id);
  }
  return { state: { ...previous, resources }, movedFrom };
}

/** why the state's `address` is destroyed: Terraform's `# (because …)` line */
function whyGone(eng: Engine, address: string): string {
  const m = /^((?:module\.[\w-]+(?:\[[^\]]*\])?\.)*)([\w-]+\.[\w-]+)(\[[^\]]*\])?$/.exec(address);
  if (!m) return `${address} is not in configuration`;
  const [, path, base, key] = m;
  let prefix = '';
  for (const step of path.match(/module\.[\w-]+(?:\[[^\]]*\])?\./g) ?? []) {
    prefix += step;
    if (!eng.reached.has(prefix.slice(0, -1))) return `${prefix.slice(0, -1)} is not in configuration`;
  }
  const kind = eng.reached.get(prefix + base);
  const from = eng.movedFrom.get(address);
  if (kind === undefined || kind === 'module') return from ? `${from} was moved to ${address}, which is not in configuration` : `${prefix + base} is not in configuration`;
  const numeric = key !== undefined && /^\[\d+\]$/.test(key);
  if (key === undefined) return 'resource uses count or for_each';
  if (kind === 'count') return numeric ? `index ${key} is out of range for count` : 'resource does not use for_each';
  if (kind === 'for_each') return numeric ? 'resource does not use count' : `key ${key} is not in for_each map`;
  return numeric ? 'resource does not use count' : 'resource does not use for_each';
}

/** a `-var` value: a string, unless the variable's type says it's a number, a bool or a structure (then read as HCL) */
function cliValue(text: string, type: Expression | undefined): Val {
  const t = type ? exprText(type).trim() : 'string';
  if (t === 'number' && /^-?\d+(\.\d+)?$/.test(text.trim())) return Number(text);
  if (t === 'bool' && /^(true|false)$/.test(text.trim())) return text.trim() === 'true';
  if (t === 'string' || t === 'number' || t === 'bool' || t === 'any') return text;
  const [block] = parseFile('cli.tfvars', `output "v" {\n  value = ${text}\n}\n`).blocks;
  return block?.kind === 'labeled' && block.args.value ? evaluate(block.args.value, { ref: () => undefined }) : text;
}

/**
 * The root module's input values, in Terraform's order of precedence (each
 * one over the ones before it): `terraform.tfvars`, `*.auto.tfvars` in
 * lexical order, then `-var-file` and `-var` in the order given.
 */
function inputVars(files: Files, ir: IR, args: VarArg[]): { given: Record<string, Val>; problems: Problem[] } {
  const given: Record<string, Val> = {};
  const problems: Problem[] = [];
  const none: Scope = { ref: () => undefined };
  const read = (file: string) => {
    const [block] = parseFile(file, `output "tfvars" {\n${files[file]}\n}\n`).blocks;
    if (block?.kind === 'labeled') Object.assign(given, evaluateRecord(block.args, none));
  };
  const auto = Object.keys(files)
    .filter((f) => !f.includes('/') && f.endsWith('.auto.tfvars'))
    .sort();
  for (const f of [...(files['terraform.tfvars'] !== undefined ? ['terraform.tfvars'] : []), ...auto]) read(f);
  for (const a of args) {
    if (a.kind === 'file') {
      const file = a.name.replace(/^\.\//, '');
      if (files[file] !== undefined) read(file);
      else problems.push({ severity: 'error', summary: 'Failed to read variables file', detail: `Given variables file ${a.name} does not exist.` });
      continue;
    }
    const eq = a.text.indexOf('=');
    const name = eq > 0 ? a.text.slice(0, eq).trim() : '';
    const v = ir.variables.find((x) => x.name === name);
    if (!name) {
      problems.push({
        severity: 'error',
        summary: 'Invalid -var option',
        detail: `The given -var option "${a.text}" is not correctly specified. Must be a variable name\nand value separated by an equals sign, like -var="key=value".`,
      });
    } else if (!v) {
      problems.push({
        severity: 'error',
        summary: 'Value for undeclared variable',
        detail: `A variable named "${name}" was assigned on the command line, but the root module does\nnot declare a variable of that name. To use this value, add a "variable" block to the\nconfiguration.`,
      });
    } else given[name] = cliValue(a.text.slice(eq + 1), v.args.type);
  }
  return { given, problems };
}

/** a variable's `validation` blocks that its value fails: Terraform's error, with the rule's message */
function validationProblems(files: Files, v: IR['variables'][number], value: Val): Problem[] {
  const rule = v.args.validation;
  const rules = rule?.kind === 'block' ? [rule.body] : rule?.kind === 'blocks' ? rule.items : [];
  const scope: Scope = { ref: (root, name) => (root === 'var' && name === v.name ? value : undefined) };
  return rules
    .filter((r) => r.condition && evaluate(r.condition, scope) === false)
    .map((r) => {
      const message = r.error_message ? evaluate(r.error_message, scope) : null;
      return { severity: 'error', summary: 'Invalid value for variable', detail: typeof message === 'string' ? message : undefined, ...at(files, v) };
    });
}

/** the root module's `import` or `removed` blocks, read as an output's body */
function stateBlocks(ir: IR, kind: 'import' | 'removed'): Array<{ args: Record<string, Expression>; x: RawBlock }> {
  const head = new RegExp(`^\\s*${kind}\\s*\\{`);
  return ir.extras.flatMap((x) => {
    if (!head.test(x.text)) return [];
    const [block] = parseFile(x.trivia.sourceFile ?? 'main.tf', x.text.replace(head, 'output "x" {')).blocks;
    return block?.kind === 'labeled' ? [{ args: block.args, x }] : [];
  });
}

/** where a verbatim block (an `import`, a `removed`) starts, for an error box */
const atBlock = (files: Files, x: RawBlock, block: string): Pick<Problem, 'file' | 'line' | 'block' | 'source'> => {
  const file = x.trivia.sourceFile ?? 'main.tf';
  const text = files[file] ?? '';
  const start = x.trivia.rawTextRange?.start;
  const lineNo = start === undefined ? undefined : lineColOf(text, start).line;
  return { file, line: lineNo, block, source: lineNo === undefined ? undefined : text.split('\n')[lineNo - 1] };
};

/** an address in the configuration's terms: `aws_s3_bucket.logs`, without spaces */
const addressOf = (e: Expression | undefined) => (e ? exprText(e).replace(/\s+/g, '') : '');

interface RunOpts {
  vars: VarArg[];
  workspace: string;
}

function run(files: Files, applied: SimState | null, opts: RunOpts, actions?: Map<string, ChangeAction>): Planned {
  const parsed = parseProject(tfFiles(files));
  const { ir } = parsed;
  const problems = diagnose(files, ir, parsed.diagnostics, false).filter((p) => p.severity === 'error');
  const { state: previous, movedFrom } = moveState(ir, applied);
  const eng: Engine = {
    files,
    previous,
    apply: actions !== undefined,
    gen: (previous?.serial ?? 0) + 1,
    actions,
    changes: [],
    values: new Map(),
    reads: [],
    notes: [],
    problems,
    regions: new Map(),
    movedFrom,
    reached: new Map(),
    workspace: opts.workspace,
    imports: new Map(),
  };
  const nothing = (): Planned => ({ problems, changes: [], outputs: [], outputValues: new Map(), values: eng.values, reads: [], notes: [], state: previous });
  if (problems.length > 0) return nothing();

  const input = inputVars(files, ir, opts.vars);
  problems.push(...input.problems);
  if (problems.length > 0) return nothing();
  const vars = new Map<string, Val>();
  const none: Scope = { ref: () => undefined };
  for (const v of ir.variables) {
    if (v.name in input.given) vars.set(v.name, input.given[v.name]);
    else if (v.args.default) vars.set(v.name, evaluate(v.args.default, none));
    else {
      vars.set(v.name, UNKNOWN);
      problems.push({
        severity: 'error',
        summary: 'No value for required variable',
        detail: `The root module input variable "${v.name}" is not set, and has no default value. Use a\n-var or -var-file command line argument to provide a value for this variable.`,
        ...at(files, v),
      });
      continue;
    }
    problems.push(...validationProblems(files, v, vars.get(v.name)!));
  }
  const root: Mod = { prefix: '', ir, dir: '', vars, locals: new Map(), blocks: new Map(), reads: readsOf(ir), secret: sensitiveVars(ir) };
  const scope = scopeOf(root, eng);
  for (const p of ir.providers) {
    const region = p.args.region ? evaluate(p.args.region, scope) : undefined;
    const alias = p.args.alias ? evaluate(p.args.alias, scope) : '';
    if (typeof region === 'string' && typeof alias === 'string') eng.regions.set(alias, region);
  }
  const imports = stateBlocks(ir, 'import');
  for (const { args } of imports) {
    const id = args.id ? evaluate(args.id, scope) : null;
    if (typeof id === 'string') eng.imports.set(addressOf(args.to), id);
  }
  walk(eng, root);

  const planned = new Set(eng.changes.map((c) => c.address));
  // ponytail: an import target that is an instance of a module call, or `for_each` in an import block, isn't followed
  for (const { args, x } of imports) {
    const to = addressOf(args.to);
    if (planned.has(to)) continue;
    problems.push({
      severity: 'error',
      summary: 'Configuration for import target does not exist',
      detail: `The configuration for the given import target ${to} does not exist. All target\ninstances must have an associated configuration to be imported.`,
      ...atBlock(files, x, 'import'),
    });
  }

  // `removed` blocks with `destroy = false`: what the state holds there is forgotten, not destroyed
  const forgotten: string[] = [];
  for (const { args, x } of stateBlocks(ir, 'removed')) {
    const from = addressOf(args.from);
    const life = args.lifecycle?.kind === 'block' ? args.lifecycle.body : {};
    if (eng.reached.has(from)) {
      problems.push({
        severity: 'error',
        summary: 'Removed resource still exists',
        detail: `This statement declares that ${from} was removed, but it is still declared in\nconfiguration.`,
        ...atBlock(files, x, 'removed'),
      });
    } else if (life.destroy?.kind === 'literal' && life.destroy.value === false) forgotten.push(from);
  }
  const forgets = (address: string) => forgotten.some((f) => address === f || address.startsWith(`${f}[`) || address.startsWith(`${f}.`));

  // what the state holds that the configuration doesn't any more
  for (const [address, before] of Object.entries(previous?.resources ?? {})) {
    if (planned.has(address)) continue;
    const [type, name] = address.replace(/\[[^\]]*\]$/, '').split('.').slice(-2);
    const hidden = sensitiveAttrs(type).filter((k) => k in before);
    eng.changes.push({
      address,
      type,
      name,
      blocks: new Set(),
      before,
      ...(forgets(address) ? { action: 'forget' as const } : { action: 'delete' as const, because: whyGone(eng, address) }),
      ...(hidden.length > 0 ? { sensitive: new Set(hidden) } : {}),
    });
  }

  // root outputs
  const outputValues = new Map<string, { value: Val; sensitive: boolean }>();
  const outputs: OutputChange[] = [];
  for (const o of ir.outputs) {
    const value = o.args.value ? evaluate(o.args.value, scope) : null;
    const sensitive = o.args.sensitive?.kind === 'literal' && o.args.sensitive.value === true;
    if (!sensitive && o.args.value && isSensitive(o.args.value, root)) {
      problems.push({
        severity: 'error',
        summary: 'Output refers to sensitive values',
        detail: [
          'To reduce the risk of accidentally exporting sensitive data that was intended to be',
          'only internal, Terraform requires that any root module output containing sensitive',
          'data be explicitly marked as sensitive, to confirm your intent.',
          '',
          'If you do intend to export this data, annotate the output value as sensitive by adding',
          'the following argument:',
          '    sensitive = true',
        ].join('\n'),
        ...at(files, o),
      });
    }
    outputValues.set(o.name, { value, sensitive });
    const before = previous?.outputs[o.name];
    if (before === undefined || hasUnknown(value) || before !== serialize(value)) outputs.push({ name: o.name, before, after: value, sensitive });
  }
  for (const [name, before] of Object.entries(previous?.outputs ?? {})) {
    if (!outputValues.has(name)) outputs.push({ name, before });
  }
  outputs.sort((a, b) => a.name.localeCompare(b.name));
  return { problems, changes: eng.changes, outputs, outputValues, values: eng.values, reads: eng.reads, notes: eng.notes, state: previous };
}

const byAddress = (a: { address: string }, b: { address: string }) => a.address.localeCompare(b.address, 'en', { numeric: true });

/** the changes as the canvas and the lesson read them */
function summary(changes: ResourceChange[]): PlanSummary {
  const real = changes.filter((c) => c.action !== 'noop' && c.action !== 'read' && c.action !== 'forget').sort(byAddress);
  const text = (v: Val | undefined) => (v === undefined || v === null || v === UNKNOWN || v instanceof Opaque ? null : serialize(v));
  return {
    changes: real.map((c) => {
      const before = c.before ?? {};
      const after = c.after ?? {};
      const keys = c.action === 'delete' ? Object.keys(before) : Object.keys(after).filter((k) => c.action === 'create' || before[k] !== text(after[k]));
      const hide = (k: string, v: string | null) => (v !== null && c.sensitive?.has(k) ? '(sensitive value)' : v);
      return {
        address: c.address,
        action: c.action as PlanSummary['changes'][number]['action'],
        attributes: Object.fromEntries(keys.sort().map((k) => [k, [hide(k, before[k] ?? null), c.action === 'delete' ? null : hide(k, text(after[k]))]])),
      };
    }),
    add: real.filter((c) => c.action === 'create' || c.action === 'replace').length,
    change: real.filter((c) => c.action === 'update').length,
    destroy: real.filter((c) => c.action === 'delete' || c.action === 'replace').length,
  };
}

/** imports and forgets: they count apart from add, change and destroy */
const extraCounts = (changes: ResourceChange[]) => ({
  imported: changes.filter((c) => c.importing !== undefined).length,
  forgotten: changes.filter((c) => c.action === 'forget').length,
});

const LEGEND: Record<string, Line> = {
  create: line('  + create', 'add'),
  update: line('  ~ update in-place', 'change'),
  delete: line('  - destroy', 'destroy'),
  replace: line('-/+ destroy and then create replacement', 'replace'),
  createFirst: line('+/- create replacement and then destroy', 'replace'),
  read: line(' <= read (data resources)', 'change'),
  forget: line('  . forget'),
};

/** the plan as Terraform prints it, from the refresh to the summary (and the output changes); `body`: where the refresh ends */
function planLines(p: Planned): { lines: Line[]; empty: boolean; body: number } {
  const out: Line[] = [];
  for (const c of p.changes) {
    if (c.importing !== undefined) out.push(line(`${c.address}: Preparing import... [id=${c.importing}]`, undefined, true));
  }
  for (const [address, attrs] of Object.entries(p.state?.resources ?? {})) {
    out.push(line(`${address}: Refreshing state... [id=${attrs.id ?? ''}]`, undefined, true));
  }
  for (const c of p.changes) if (c.importing !== undefined) out.push(line(`${c.address}: Refreshing state... [id=${c.importing}]`, undefined, true));
  out.push(...p.reads);
  if (out.length > 0) out.push(line());
  const body = out.length;
  // a move with nothing else to do is still shown: `# a has moved to b` (an import too)
  const real = p.changes.filter((c) => c.action !== 'noop' || c.movedFrom !== undefined || c.importing !== undefined).sort(byAddress);
  if (real.length === 0 && p.outputs.length === 0) {
    out.push(
      line('No changes. Your infrastructure matches the configuration.', 'success'),
      line(),
      line('Terraform has compared your real infrastructure against your configuration'),
      line('and found no differences, so no changes are needed.'),
    );
    if (p.notes.length > 0) out.push(line(), ...p.notes);
    return { lines: out, empty: true, body };
  }
  if (real.length > 0) {
    // the symbols' legend, when there are any (a plan of moves and imports alone has none)
    const used = new Set(real.map((c) => (c.action === 'replace' && c.createFirst ? 'createFirst' : c.action)));
    const legend = (['create', 'update', 'delete', 'replace', 'createFirst', 'read', 'forget'] as const).filter((k) => used.has(k)).map((k) => LEGEND[k]);
    if (legend.length > 0) {
      out.push(
        line('Terraform used the selected providers to generate the following execution'),
        line('plan. Resource actions are indicated with the following symbols:'),
        ...legend,
        line(),
      );
    }
    out.push(line('Terraform will perform the following actions:'), line());
    for (const c of real) out.push(...changeLines(c));
    if (p.notes.length > 0) out.push(...p.notes, line());
    const s = summary(p.changes);
    const { imported, forgotten } = extraCounts(p.changes);
    out.push(
      line(
        `Plan: ${imported > 0 ? `${imported} to import, ` : ''}${s.add} to add, ${s.change} to change, ${s.destroy} to destroy${forgotten > 0 ? `, ${forgotten} to forget` : ''}.`,
        'strong',
      ),
    );
    const gone = p.changes.filter((c) => c.action === 'forget').map((c) => c.address);
    if (gone.length > 0) {
      out.push(
        ...problemLines({
          severity: 'warning',
          summary: 'Some objects will no longer be managed by Terraform',
          detail: [
            'If you apply this plan, Terraform will discard its tracking information for the',
            'following objects, but it will not delete them:',
            ...gone.map((a) => ` - ${a}`),
            '',
            'After applying this plan, Terraform will no longer manage these objects. You will',
            'need to import them into Terraform to manage them again.',
          ].join('\n'),
        }),
      );
    }
  } else if (p.notes.length > 0) out.push(...p.notes, line());
  if (p.outputs.length > 0) {
    if (real.length > 0) out.push(line());
    out.push(line('Changes to Outputs:'), ...outputChangeLines(p.outputs));
    if (real.length === 0) {
      out.push(
        line(),
        line('You can apply this plan to save these new output values to the Terraform'),
        line('state, without changing any real infrastructure.'),
      );
    }
  }
  return { lines: out, empty: false, body };
}

const RULE = '─'.repeat(77);

/** Go's duration format, as Terraform prints elapsed times: `9s`, `1m35s` */
const duration = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`);

function confirmLines(destroying: boolean): Line[] {
  return destroying
    ? [
        line(),
        line('Do you really want to destroy all resources?', 'strong'),
        line('  Terraform will destroy all your managed infrastructure, as shown above.'),
        line('  There is no undo. Only \'yes\' will be accepted to confirm.'),
        line(),
        line('  Enter a value: yes', 'strong'),
      ]
    : [
        line(),
        line('Do you want to perform these actions?', 'strong'),
        line('  Terraform will perform the actions described above.'),
        line('  Only \'yes\' will be accepted to approve.'),
        line(),
        line('  Enter a value: yes', 'strong'),
      ];
}

function destroyLines(address: string, id: string, type: string, deposed?: string): Line[] {
  const who = deposed ? `${address} (deposed object ${deposed})` : address;
  return [line(`${who}: Destroying... [id=${id}]`, undefined, true), line(`${who}: Destruction complete after ${duration(Math.max(1, Math.round(createSeconds(type) / 2)))}`)];
}

function createLines(address: string, id: string, type: string): Line[] {
  const seconds = createSeconds(type);
  const out = [line(`${address}: Creating...`, undefined, true)];
  for (let s = 10; s < seconds; s += 10) out.push(line(`${address}: Still creating... [${duration(s)} elapsed]`, undefined, true));
  out.push(line(`${address}: Creation complete after ${duration(seconds)} [id=${id}]`));
  return out;
}

function outputsSection(values: Planned['outputValues']): Line[] {
  if (values.size === 0) return [];
  const out = [line(), line('Outputs:', 'success'), line()];
  for (const name of [...values.keys()].sort()) {
    const { value, sensitive } = values.get(name)!;
    out.push(...outputValueLines(name, value, sensitive));
  }
  return out;
}

/* ------------------------------------------------------------------ commands */

function notInitialized(files: Files, command: SimCommand): SimResult {
  const sources = requiredProviders(files).map((p) => p.source);
  const detail =
    command === 'validate'
      ? `This configuration requires provider registry.terraform.io/${sources[0] ?? 'hashicorp/aws'}, but that provider\nisn't available. You may be able to install it automatically by running:\n  terraform init`
      : [
          'The following dependency selections recorded in the lock file are inconsistent with the',
          'current configuration:',
          ...sources.map((s) => `  - provider registry.terraform.io/${s}: required by this configuration but no version is selected`),
          '',
          'To make the initial dependency selections that will initialize the dependency lock file, run:',
          '  terraform init',
        ].join('\n');
  return {
    ok: false,
    lines: problemLines({ severity: 'error', summary: command === 'validate' ? 'Missing required provider' : 'Inconsistent dependency lock file', detail }),
  };
}

/** the providers are as the last init left them, but module calls aren't installed: Terraform names each one */
function modulesNotInstalled(files: Files, installed: string | undefined): SimResult | null {
  if (!installed) return null;
  const { ir } = parseProject(tfFiles(files));
  const now = JSON.parse(initFingerprint(files)) as [unknown, Array<[string, string]>];
  const before = JSON.parse(installed) as [unknown, Array<[string, string]>];
  if (JSON.stringify(now[0]) !== JSON.stringify(before[0])) return null;
  const had = new Set(before[1].map((x) => JSON.stringify(x)));
  const missing = ir.modules.filter((m) => !had.has(JSON.stringify([m.name, exprString(m.args.source)])));
  if (missing.length === 0) return null;
  // `on main.tf line 14:` with no block after it, as Terraform prints this one
  const problems = missing.map(
    (m): Problem => ({
      severity: 'error',
      summary: 'Module not installed',
      detail: 'This module is not yet installed. Run "terraform init" to install all modules\nrequired by this configuration.',
      ...at(files, m),
      block: undefined,
    }),
  );
  return { ok: false, lines: problems.flatMap(problemLines) };
}

/** the backend isn't the one the last init configured: every command but init stops here */
function backendRequired(files: Files, installed: string | undefined): SimResult | null {
  const before = installedBackend(installed);
  const now = backendOf(files);
  if (before === undefined || JSON.stringify(before) === JSON.stringify(now ? [now.type, now.config] : null)) return null;
  const reason = !before ? `Initial configuration of the requested backend "${now!.type}"` : !now ? `Unsetting the previously set backend "${before[0]}"` : 'Backend configuration block has changed';
  return {
    ok: false,
    lines: problemLines({
      severity: 'error',
      summary: 'Backend initialization required, please run "terraform init"',
      detail: [
        `Reason: ${reason}`,
        '',
        'The "backend" is the interface that Terraform uses to store state,',
        'perform operations, etc. If this message is showing up, it means that the',
        "Terraform configuration you're using is using a custom configuration for",
        'the Terraform backend.',
        '',
        'Changes to backend configurations require reinitialization. This allows',
        'Terraform to set up the new configuration, copy existing state, etc. Please run',
        '"terraform init" with either the "-reconfigure" or "-migrate-state" flags to',
        'use the current configuration.',
        '',
        'If the change reason above is incorrect, please verify your configuration',
        "hasn't changed and try again. At this point, no changes to your existing",
        'configuration or state have been applied.',
      ].join('\n'),
    }),
  };
}

/**
 * What init says about the backend: configured (the first time, or after a
 * change), and, when there's state to carry, the question whether to copy
 * it there (`confirmAt` is the index of its answer). A backend that changed
 * from another remote one wants `-migrate-state` or `-reconfigure`.
 *
 * ponytail: one state per lesson (per workspace), so `-reconfigure` keeps it
 * as it is; a real new backend location would start out empty.
 */
function backendLines(files: Files, ctx: SimContext, previous: SimState | null): { lines: Line[]; confirmAt?: number; failed?: boolean } {
  const before = installedBackend(ctx.installed) ?? null;
  const now = backendOf(files);
  if (JSON.stringify(before) === JSON.stringify(now ? [now.type, now.config] : null)) return { lines: [] };
  const done = now
    ? [line(), line(`Successfully configured the backend "${now.type}"! Terraform will automatically`, 'success'), line('use this backend unless the backend configuration changes.', 'success'), line()]
    : [line(), line(`Successfully unset the backend "${before![0]}". Terraform will now operate locally.`, 'success'), line()];
  const lead = before && !now ? [line(`Terraform has detected you're unconfiguring your previously set "${before[0]}" backend.`)] : [];
  if (before && now && !ctx.backendFlag) {
    return {
      failed: true,
      lines: problemLines({
        severity: 'error',
        summary: 'Backend configuration changed',
        detail: [
          'A change in the backend configuration has been detected, which may require',
          'migrating existing state.',
          '',
          'If you wish to attempt automatic migration of the state, use "terraform init',
          '-migrate-state".',
          'If you wish to store the current configuration with no changes to the state,',
          'use "terraform init -reconfigure".',
        ].join('\n'),
      }),
    };
  }
  const hasState = Object.keys(previous?.resources ?? {}).length > 0;
  if (!hasState || ctx.backendFlag === 'reconfigure') return { lines: [...lead, ...done] };
  const from = before?.[0] ?? 'local';
  const to = now?.type ?? 'local';
  const lines = [
    ...lead,
    line('Do you want to copy existing state to the new backend?', 'strong'),
    line(`  Pre-existing state was found while migrating the previous "${from}" backend to the`),
    line(`  newly configured "${to}" backend. No existing state was found in the newly`),
    line(`  configured "${to}" backend. Do you want to copy this state to the new "${to}"`),
    line('  backend? Enter "yes" to copy and "no" to start with an empty state.'),
    line(),
    line('  Enter a value: yes', 'strong'),
  ];
  return { lines: [...lines, line(), ...done], confirmAt: lines.length - 1 };
}

function init(files: Files, ctx: SimContext, previous: SimState | null): SimResult {
  // the lock file still holds these providers when only the modules or the backend changed
  const initialized = ctx.initialized || (ctx.installed !== undefined && JSON.stringify(JSON.parse(ctx.installed)[0]) === JSON.stringify(JSON.parse(initFingerprint(files))[0]));
  const parsed = parseProject(tfFiles(files));
  const out: Line[] = [line('Initializing the backend...', 'strong')];
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (Object.keys(tfFiles(files)).length === 0 || Object.values(tfFiles(files)).every((t) => t.trim() === '')) {
    return {
      ok: true,
      lines: [
        line('Terraform initialized in an empty directory!', 'success'),
        line(),
        line('The directory has no Terraform configuration files. You may begin working'),
        line('with Terraform immediately by creating Terraform configuration files.'),
      ],
    };
  }
  if (errors.length > 0) {
    out.push(
      line('Terraform encountered problems during initialisation, including problems', 'error'),
      line('with the configuration, described below.', 'error'),
      line(),
      line('The Terraform configuration must be valid before initialization so that'),
      line('Terraform can determine which modules and providers need to be installed.'),
    );
    for (const p of diagnose(files, parsed.ir, errors, false)) out.push(...problemLines(p));
    return { ok: false, lines: out };
  }
  const backend = backendLines(files, ctx, previous);
  const confirmAt = backend.confirmAt === undefined ? undefined : out.length + backend.confirmAt;
  out.push(...backend.lines);
  if (backend.failed) return { ok: false, lines: out };
  if (parsed.ir.modules.length > 0) {
    out.push(line('Initializing modules...', 'strong'));
    for (const m of parsed.ir.modules) {
      const target = moduleTarget(files, m);
      const source = exprString(m.args.source);
      if (target.kind === 'local') out.push(line(`- ${m.name} in ${target.dir}`));
      else {
        const version = exprString(m.args.version);
        out.push(line(`Downloading registry.terraform.io/${source}${version ? ` ${version.replace(/^[~>=<! ]+/, '')}` : ''} for ${m.name}...`, undefined, true), line(`- ${m.name} in .terraform/modules/${m.name}`));
      }
    }
  }
  out.push(line('Initializing provider plugins...', 'strong'));
  for (const p of requiredProviders(files)) {
    const releases = RELEASES[p.source];
    const version = releases?.find((v) => !p.constraint || constraintAllows(p.constraint, v));
    if (!version) {
      out.push(
        ...problemLines({
          severity: 'error',
          summary: 'Failed to query available provider packages',
          detail: releases
            ? `Could not retrieve the list of available versions for provider ${p.source}: no available\nreleases match the given constraints ${p.constraint}`
            : `Could not retrieve the list of available versions for provider ${p.source}: provider\nregistry.terraform.io/${p.source} was not found in any of the search locations`,
        }),
      );
      return { ok: false, lines: out };
    }
    if (initialized) {
      out.push(line(`- Reusing previous version of ${p.source} from the dependency lock file`), line(`- Using previously-installed ${p.source} v${version}`));
    } else {
      out.push(
        line(p.constraint ? `- Finding ${p.source} versions matching "${p.constraint}"...` : `- Finding latest version of ${p.source}...`, undefined, true),
        line(`- Installing ${p.source} v${version}...`, undefined, true),
        line(`- Installed ${p.source} v${version} (signed by HashiCorp)`),
      );
    }
  }
  if (!initialized) {
    out.push(
      line('Terraform has created a lock file .terraform.lock.hcl to record the provider'),
      line('selections it made above. Include this file in your version control repository'),
      line('so that Terraform can guarantee to make the same selections by default when'),
      line('you run "terraform init" in the future.'),
    );
  }
  out.push(
    line(),
    line('Terraform has been successfully initialized!', 'success'),
    line(),
    line('You may now begin working with Terraform. Try running "terraform plan" to see'),
    line('any changes that are required for your infrastructure. All Terraform commands'),
    line('should now work.'),
    line(),
    line('If you ever set or change modules or backend configuration for Terraform,'),
    line('rerun this command to reinitialize your working directory. If you forget, other'),
    line('commands will detect it and remind you to do so if necessary.'),
  );
  // answered no: the new backend starts with an empty state
  return { ok: true, lines: out, ...(confirmAt === undefined ? {} : { confirmAt, declined: { lines: out.slice(confirmAt + 1), state: carry(previous, null) } }) };
}

function validate(files: Files): SimResult {
  const parsed = parseProject(tfFiles(files));
  const problems = diagnose(files, parsed.ir, parsed.diagnostics, true);
  const out = problems.flatMap(problemLines);
  const failed = problems.some((p) => p.severity === 'error');
  if (failed) return { ok: false, lines: out };
  if (problems.length > 0) {
    out.push(line(), line('Success! The configuration is valid, but there were some', 'success'), line('validation warnings as shown above.', 'success'));
  } else out.push(line('Success! The configuration is valid.', 'success'));
  return { ok: true, lines: out };
}

/** what a run reads besides the code and the state: the `-var`s, and the workspace the state belongs to */
const runOpts = (previous: SimState | null, vars: VarArg[] | undefined): RunOpts => ({ vars: vars ?? [], workspace: previous?.workspace ?? 'default' });

/** what a saved plan was made from: applying it once either changed is refused */
const stampOf = (files: Files, previous: SimState | null) => JSON.stringify([files, previous]);

/** the argument an imported object's id names (a bucket's `bucket`), for the configuration `-generate-config-out` writes */
const IDENTITY: Record<string, string> = {
  aws_s3_bucket: 'bucket',
  aws_iam_role: 'name',
  aws_iam_user: 'name',
  aws_iam_group: 'name',
  aws_dynamodb_table: 'name',
  aws_lambda_function: 'function_name',
  aws_db_instance: 'identifier',
  aws_ssm_parameter: 'name',
  aws_cloudwatch_log_group: 'name',
  aws_ecr_repository: 'name',
  aws_key_pair: 'key_name',
};

/**
 * The configuration `-generate-config-out` writes for import targets the
 * code doesn't declare (root module, no instance key: like Terraform).
 *
 * ponytail: the provider would read every attribute of the real object; the
 * simulation knows only the id, so it writes the argument the id names and
 * the required ones (as null, to fill in).
 */
function generatedConfig(files: Files, file: string): { problem: Problem } | { text?: string; targets: Set<string> } {
  const { ir } = parseProject(tfFiles(files));
  const declared = new Set(ir.resources.map((r) => r.id));
  const missing = stateBlocks(ir, 'import')
    .map(({ args }) => ({ to: addressOf(args.to), id: args.id?.kind === 'literal' ? String(args.id.value) : undefined }))
    .filter(({ to }) => /^[\w-]+\.[\w-]+$/.test(to) && !declared.has(to));
  if (missing.length === 0) return { targets: new Set() };
  if (files[file] !== undefined) {
    return {
      problem: {
        severity: 'error',
        summary: 'Target generated file already exists',
        detail: 'Terraform can only write generated config into a new file. Either choose a different\ntarget location or move all existing configuration out of the target file, delete it\nand try again.',
      },
    };
  }
  const blocks = missing.map(({ to, id }) => {
    const [type, name] = to.split('.');
    const identity = IDENTITY[type];
    const required = (getDef(type)?.fields ?? []).filter((f) => f.required && f.name !== identity).map((f) => `  ${f.name} = null`);
    const body = [...(identity && id !== undefined ? [`  ${identity} = ${JSON.stringify(id)}`] : []), ...required];
    return `# __generated__ by Terraform${id === undefined ? '' : ` from ${JSON.stringify(id)}`}\nresource "${type}" "${name}" {\n${body.map((l) => `${l}\n`).join('')}}\n`;
  });
  return {
    text: `# __generated__ by Terraform\n# Please review these resources and move them into your main configuration files.\n\n${blocks.join('\n')}`,
    targets: new Set(missing.map((m) => m.to)),
  };
}

function plan(files: Files, previous: SimState | null, ctx: SimContext): SimResult {
  let code = files;
  let generated: SimResult['generated'];
  let targets = new Set<string>();
  if (ctx.generateConfig) {
    const g = generatedConfig(files, ctx.generateConfig);
    if ('problem' in g) return { ok: false, lines: problemLines(g.problem) };
    if (g.text) {
      generated = { file: ctx.generateConfig, text: g.text };
      code = { ...files, [generated.file]: g.text };
      targets = g.targets;
    }
  }
  const p = run(code, previous, runOpts(previous, ctx.vars));
  if (p.problems.length > 0) return { ok: false, lines: p.problems.flatMap(problemLines) };
  for (const c of p.changes) if (targets.has(c.address)) c.generated = true;
  const { lines, empty, body } = planLines(p);
  const shown = lines.slice(body);
  if (generated) {
    lines.push(
      ...problemLines({
        severity: 'warning',
        summary: 'Config generation is experimental',
        detail: 'Generating configuration during import is currently experimental, and the generated\nconfiguration format may change in future versions.',
      }),
    );
  }
  const tail: Line[][] = [];
  if (generated) {
    tail.push([
      line(`Terraform has generated configuration and written it to ${generated.file}. Please review the`),
      line('configuration and edit it as necessary before adding it to version control.'),
    ]);
  }
  if (ctx.out) {
    tail.push([line(`Saved the plan to: ${ctx.out}`), line(), line('To perform exactly these actions, run the following command to apply:'), line(`    terraform apply "${ctx.out}"`)]);
  } else if (!empty) {
    tail.push([
      line("Note: You didn't use the -out option to save this plan, so Terraform can't", 'muted'),
      line('guarantee to take exactly these actions if you run "terraform apply" now.', 'muted'),
    ]);
  }
  if (tail.length > 0) lines.push(line(), line(RULE, 'muted'), ...tail.flatMap((t) => [line(), ...t]));
  const saved: SavedPlan | undefined = ctx.out ? { name: ctx.out, stamp: stampOf(code, previous), vars: ctx.vars ?? [], lines: shown } : undefined;
  return { ok: true, lines, plan: summary(p.changes), ...(saved ? { saved } : {}), ...(generated ? { generated } : {}) };
}

/** apply: the plan and its question (none with `-auto-approve`), then the run; a saved plan (`apply tfplan`) runs at once, as it was made */
function apply(files: Files, previous: SimState | null, ctx: SimContext): SimResult {
  const saved = ctx.saved;
  if (saved && !saved.plan) {
    return { ok: false, lines: problemLines({ severity: 'error', summary: `Failed to load "${saved.name}" as a plan file`, detail: `Error: stat ${saved.name}: no such file or directory` }) };
  }
  if (saved?.plan && saved.plan.stamp !== stampOf(files, previous)) {
    return {
      ok: false,
      lines: problemLines({
        severity: 'error',
        summary: 'Saved plan is stale',
        detail: 'The given plan file can no longer be applied because the state was changed by\nanother operation after the plan was created.',
      }),
    };
  }
  const opts = runOpts(previous, saved?.plan ? saved.plan.vars : ctx.vars);
  const p = run(files, previous, opts);
  if (p.problems.length > 0) return { ok: false, lines: p.problems.flatMap(problemLines) };
  const planned = planLines(p);
  const empty = planned.empty;
  const lines = saved ? [] : planned.lines;
  let confirmAt: number | undefined;
  if (!empty && !ctx.autoApprove && !saved) {
    lines.push(...confirmLines(false));
    confirmAt = lines.length - 1;
  }
  if (!empty && !saved) lines.push(line());

  // the apply itself: the plan's actions, with ids made as each instance is created
  const actions = new Map(p.changes.map((c) => [c.address, c.action]));
  const done = run(files, previous, opts, actions);
  const old = p.state?.resources ?? {};
  const deletes = p.changes.filter((c) => c.action === 'delete');
  const replaced = p.changes.filter((c) => c.action === 'replace');
  for (const c of [...deletes].reverse()) lines.push(...destroyLines(c.address, old[c.address].id ?? '', c.type));
  for (const c of [...replaced].reverse()) if (!c.createFirst) lines.push(...destroyLines(c.address, old[c.address].id ?? '', c.type));
  for (const c of done.changes) {
    const id = String(c.after?.id ?? '');
    if (c.importing !== undefined) lines.push(line(`${c.address}: Importing... [id=${c.importing}]`, undefined, true), line(`${c.address}: Import complete [id=${c.importing}]`));
    if (c.action === 'create' || c.action === 'replace') lines.push(...createLines(c.address, id, c.type));
    else if (c.action === 'read') lines.push(line(`${c.address}: Reading...`, undefined, true), line(`${c.address}: Read complete after 0s [id=${id}]`));
    else if (c.action === 'update') {
      lines.push(line(`${c.address}: Modifying... [id=${id}]`, undefined, true), line(`${c.address}: Modifications complete after 1s [id=${id}]`));
    }
  }
  for (const c of replaced) if (c.createFirst) lines.push(...destroyLines(c.address, old[c.address].id ?? '', c.type, hashShort(c.address)));

  const s = summary(p.changes);
  const { imported, forgotten } = extraCounts(p.changes);
  lines.push(line());
  lines.push(
    line(
      `Apply complete! Resources: ${imported > 0 ? `${imported} imported, ` : ''}${s.add} added, ${s.change} changed, ${s.destroy} destroyed${forgotten > 0 ? `, ${forgotten} forgotten` : ''}.`,
      'success',
    ),
  );
  lines.push(...outputsSection(done.outputValues));

  const resources: SimState['resources'] = {};
  for (const c of done.changes) {
    if (c.action === 'delete' || c.action === 'read' || c.action === 'forget' || !c.after) continue;
    resources[c.address] = Object.fromEntries(Object.entries(c.after).map(([k, v]) => [k, serialize(v)]));
  }
  const outputs = Object.fromEntries([...done.outputValues].map(([k, { value }]) => [k, serialize(value)]));
  const changed = !empty;
  const state: SimState = { serial: changed ? (previous?.serial ?? 0) + 1 : (previous?.serial ?? 1), resources, outputs };
  return { ok: true, lines, state, plan: s, confirmAt };
}

const hashShort = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0').slice(0, 8);

function destroy(files: Files, previous: SimState | null, autoApprove: boolean): SimResult {
  const parsed = parseProject(tfFiles(files));
  const problems = diagnose(files, parsed.ir, parsed.diagnostics, false).filter((p) => p.severity === 'error');
  if (problems.length > 0) return { ok: false, lines: problems.flatMap(problemLines) };
  const entries = Object.entries(moveState(parsed.ir, previous).state?.resources ?? {});
  if (entries.length === 0) {
    return {
      ok: true,
      state: null,
      plan: { changes: [], add: 0, change: 0, destroy: 0 },
      lines: [
        line('No changes. No objects need to be destroyed.', 'success'),
        line(),
        line('Either you have not created any objects yet or the existing objects were'),
        line('already deleted outside of Terraform.'),
        line(),
        line('Destroy complete! Resources: 0 destroyed.', 'success'),
      ],
    };
  }
  for (const r of parsed.ir.resources) {
    if (!lifecycleOf(r).preventDestroy) continue;
    const held = entries.find(([a]) => a === r.id || a.startsWith(`${r.id}[`));
    if (!held) continue;
    return {
      ok: false,
      lines: problemLines({
        severity: 'error',
        summary: 'Instance cannot be destroyed',
        detail: `Resource ${held[0]} has lifecycle.prevent_destroy set, but the plan calls for this\nresource to be destroyed. To avoid this error and continue with the plan, either disable\nlifecycle.prevent_destroy or reduce the scope of the plan using the -target flag.`,
        ...at(files, r),
      }),
    };
  }
  const changes: ResourceChange[] = entries.map(([address, before]) => {
    const [type, name] = address.replace(/\[[^\]]*\]$/, '').split('.').slice(-2);
    return { address, type, name, action: 'delete', before, blocks: new Set() };
  });
  const out: Line[] = entries.map(([address, a]) => line(`${address}: Refreshing state... [id=${a.id ?? ''}]`, undefined, true));
  out.push(
    line(),
    line('Terraform used the selected providers to generate the following execution'),
    line('plan. Resource actions are indicated with the following symbols:'),
    LEGEND.delete,
    line(),
    line('Terraform will perform the following actions:'),
    line(),
  );
  for (const c of [...changes].sort(byAddress)) out.push(...changeLines(c));
  out.push(line(`Plan: 0 to add, 0 to change, ${changes.length} to destroy.`, 'strong'));
  const outputs = Object.entries(previous?.outputs ?? {}).map(([name, before]) => ({ name, before }));
  if (outputs.length > 0) out.push(line(), line('Changes to Outputs:'), ...outputChangeLines(outputs.sort((a, b) => a.name.localeCompare(b.name))));
  let confirmAt: number | undefined;
  if (!autoApprove) {
    out.push(...confirmLines(true));
    confirmAt = out.length - 1;
  }
  out.push(line());
  for (const [address, a] of [...entries].reverse()) out.push(...destroyLines(address, a.id ?? '', changes.find((c) => c.address === address)!.type));
  out.push(line(), line(`Destroy complete! Resources: ${changes.length} destroyed.`, 'success'));
  return { ok: true, lines: out, state: null, plan: summary(changes), confirmAt };
}

/** a workspace's new state keeps the workspace it belongs to and the other workspaces' states */
function carry(previous: SimState | null, next: SimState | null): SimState | null {
  const meta = { ...(previous?.workspace ? { workspace: previous.workspace } : {}), ...(previous?.workspaces ? { workspaces: previous.workspaces } : {}) };
  if (Object.keys(meta).length === 0) return next;
  return { ...(next ?? { serial: (previous?.serial ?? 0) + 1, resources: {}, outputs: {} }), ...meta };
}

/** a backend that locks: the run holds the state lock (Terraform says so when it takes a moment, as a remote one does) */
function locked(files: Files, r: SimResult): SimResult {
  if (!backendOf(files)?.locks) return r;
  const lines = [line('Acquiring state lock. This may take a few moments...'), ...r.lines];
  const end = lines.findIndex((l) => /^(Apply|Destroy) complete!/.test(l.text));
  lines.splice(end > 0 ? end - 1 : lines.length, 0, line('Releasing state lock. This may take a few moments...'));
  return { ...r, lines, ...(r.confirmAt === undefined ? {} : { confirmAt: r.confirmAt + 1 }) };
}

/**
 * Run a Terraform command over `files`, from the state `previous` left
 * (null: nothing applied yet). Before `init`, every other command fails as
 * the real CLI does (unless the configuration needs no provider at all).
 */
export function simulate(command: SimCommand, files: Files, previous: SimState | null, ctx: SimContext = { initialized: true }): SimResult {
  if (command === 'init') return init(files, ctx, previous);
  if (!ctx.initialized && requiredProviders(files).length > 0) {
    return backendRequired(files, ctx.installed) ?? modulesNotInstalled(files, ctx.installed) ?? notInitialized(files, command);
  }
  if (command === 'validate') return validate(files);
  const result = command === 'plan' ? plan(files, previous, ctx) : command === 'apply' ? apply(files, previous, ctx) : destroy(files, previous, ctx.autoApprove === true);
  return locked(files, result.state === undefined ? result : { ...result, state: carry(previous, result.state) });
}

/** the root module's instance addresses the configuration declares (to tell which deletes have no node left) */
export function declaredBlocks(files: Files): Set<string> {
  const { ir } = parseProject(tfFiles(files));
  return new Set([...ir.resources.map((r) => r.id), ...ir.modules.map((m) => m.id)]);
}
