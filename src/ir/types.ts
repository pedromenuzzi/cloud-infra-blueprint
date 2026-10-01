/**
 * Canonical Intermediate Representation (IR).
 *
 * The IR is the single source of truth of a project. Both the canvas and the
 * Monaco editor are projections of it: canvas edits mutate the IR through Ops
 * and produce minimal HCL text patches; code edits are parsed back into the IR.
 */

export type Provider = 'aws' | 'azure' | 'gcp' | 'other';

export type Expression =
  /** `text` keeps a number's source spelling (`1.50`, `1e3`, big ints) so it re-emits verbatim */
  | { kind: 'literal'; value: string | number | boolean | null; text?: string }
  | { kind: 'list'; items: Expression[] }
  /** `key = { ... }` attribute syntax */
  | { kind: 'object'; fields: Record<string, Expression> }
  /** `key { ... }` nested block syntax */
  | { kind: 'block'; body: Record<string, Expression> }
  /** repeated nested blocks with the same name (e.g. two `ingress { }`) */
  | { kind: 'blocks'; items: Array<Record<string, Expression>> }
  /** bare traversal, e.g. `aws_vpc.main.id`, `var.region` */
  | { kind: 'ref'; path: string }
  /** escape hatch: anything the parser does not model (functions, heredocs,
   *  conditionals, interpolated strings). Emitted verbatim — guarantees
   *  round-trip. */
  | { kind: 'raw'; hcl: string };

export interface TextRange {
  /** offset of the first character of the block (including attached leading comments) */
  start: number;
  /** offset just past the newline that follows the closing `}` */
  end: number;
}

/** Where one body entry (`key = value`, `key { }`, a verbatim sub-block) sits in its file. */
export interface EntrySpan {
  key: string;
  kind: 'attr' | 'block' | 'raw';
  /** first byte of the entry: its own-line comments, else its key line (a line start unless `inline`) */
  start: number;
  keyStart: number;
  keyEnd: number;
  /** attributes: the `=` and the value's text */
  eq?: number;
  valueStart?: number;
  valueEnd?: number;
  /** past the value / closing brace / same-line comment */
  contentEnd: number;
  /** past the newline that ends the entry (equals `contentEnd` when the line goes on) */
  end: number;
  /** shares its line with other tokens (single-line body, missing newline) */
  inline: boolean;
  /** nested blocks: spans of their own body */
  body?: BodySpans;
  /** 1-based position of the key, for diagnostics */
  line: number;
  col: number;
}

export interface BodySpans {
  /** offset of `{` */
  open: number;
  /** offset of the matching `}` */
  close: number;
  entries: EntrySpan[];
}

/** Source spans of a top-level block — what lets the patcher touch single lines. */
export interface BlockSpans {
  /** first byte of the block keyword */
  header: number;
  /** 1-based position of the keyword, for diagnostics */
  line: number;
  col: number;
  /** label tokens (quotes included when `quoted`) */
  labels: Array<TextRange & { quoted: boolean }>;
  /** the managed `# @blueprint:pos` comment (its text, not its line) */
  pos?: TextRange;
  /** end of the block text (just past `}`) */
  textEnd: number;
  body: BodySpans;
}

export interface Trivia {
  /** user comment lines attached directly above the block (verbatim, incl. `#`) */
  leadingComments: string[];
  /** full-line comments attached above individual arguments */
  argComments?: Record<string, string[]>;
  /** same-line comments after an argument value */
  argTrailing?: Record<string, string>;
  /** where the block lives in its source file — the key to minimal patching */
  rawTextRange?: TextRange;
  sourceFile?: string;
  /** exact text of `rawTextRange` at parse time: lets the patcher detect stale ranges */
  sourceText?: string;
  /** offsets of the block's pieces at parse time (valid while `sourceText` still matches) */
  spans?: BlockSpans;
  /** parse errors inside the block (re-used when a patch leaves the block's text alone) */
  diagnostics?: Diagnostic[];
}

export interface CanvasPosition {
  x: number;
  y: number;
  /** containers (VPC, subnet, resource group) persist their size too */
  w?: number;
  h?: number;
}

export interface ResourceNode {
  /** stable address, `${type}.${name}` — unique per Terraform rules */
  id: string;
  provider: Provider;
  type: string;
  name: string;
  args: Record<string, Expression>;
  /** canvas position; persisted in HCL via `# @blueprint:pos=x,y[,w,h]` */
  position?: CanvasPosition;
  /** derived containment (VPC → subnet → instance); computed by graph.ts */
  parentId?: string;
  trivia: Trivia;
}

export interface VariableDecl {
  id: string; // `var.${name}`
  name: string;
  args: Record<string, Expression>;
  trivia: Trivia;
}

export interface OutputDecl {
  id: string; // `output.${name}`
  name: string;
  args: Record<string, Expression>;
  trivia: Trivia;
}

export interface ProviderBlock {
  id: string;
  /** terraform provider source name: aws | azurerm | google | ... */
  name: string;
  args: Record<string, Expression>;
  trivia: Trivia;
}

/**
 * A `module "name" { source = … }` call — a node of its own on the canvas.
 * Every argument is kept as written in `args`: `source`, `version`, the
 * module's inputs and the meta-arguments (`count`, `for_each`, `depends_on`,
 * `providers`); src/ir/modules.ts reads them apart.
 */
export interface ModuleNode {
  /** `module.${name}` — the address references to its outputs start with */
  id: string;
  name: string;
  args: Record<string, Expression>;
  /** canvas position; persisted in HCL via `# @blueprint:pos=x,y` like a resource's */
  position?: CanvasPosition;
  trivia: Trivia;
}

/**
 * A `data "type" "name" { … }` block: a lookup Terraform reads, never
 * creates. A node of its own on the canvas, kept as written like a
 * resource (arguments, position comment, trivia); src/ir/dataSources.ts
 * reads its references (`data.aws_ami.ubuntu.id`) and edges.
 */
export interface DataNode {
  /** `data.${type}.${name}`: the address its attributes are read through */
  id: string;
  provider: Provider;
  type: string;
  name: string;
  args: Record<string, Expression>;
  /** canvas position; persisted in HCL via `# @blueprint:pos=x,y` like a resource's */
  position?: CanvasPosition;
  trivia: Trivia;
}

/** Any block we intentionally keep verbatim: terraform {}, locals {}, moved… */
export interface RawBlock {
  id: string;
  text: string;
  trivia: Trivia;
}

export interface IR {
  version: 1;
  resources: ResourceNode[];
  variables: VariableDecl[];
  outputs: OutputDecl[];
  providers: ProviderBlock[];
  /** `module` calls of the root module (child module files are not parsed into the IR) */
  modules: ModuleNode[];
  /** `data` blocks (lookups) */
  data: DataNode[];
  extras: RawBlock[];
}

export interface IREdge {
  id: string;
  source: string;
  target: string;
  /** the argument that creates the reference, e.g. `subnet_id` */
  field: string;
  kind: 'reference' | 'security' | 'network';
}

export interface Diagnostic {
  file: string;
  message: string;
  severity: 'error' | 'warning';
  /** 1-based positions for Monaco markers */
  start?: { line: number; col: number };
  end?: { line: number; col: number };
  nodeId?: string;
}

export const emptyIR = (): IR => ({
  version: 1,
  resources: [],
  variables: [],
  outputs: [],
  providers: [],
  modules: [],
  data: [],
  extras: [],
});

const PROVIDER_PREFIXES: Array<[string, Provider]> = [
  ['aws_', 'aws'],
  ['azurerm_', 'azure'],
  ['azuread_', 'azure'],
  ['google_', 'gcp'],
];

export function providerOfType(type: string): Provider {
  for (const [prefix, provider] of PROVIDER_PREFIXES) {
    if (type.startsWith(prefix)) return provider;
  }
  return 'other';
}

/** terraform source name for a provider ('aws' → 'aws', 'azure' → 'azurerm', 'gcp' → 'google') */
export function providerSourceName(provider: Provider): string {
  switch (provider) {
    case 'aws':
      return 'aws';
    case 'azure':
      return 'azurerm';
    case 'gcp':
      return 'google';
    default:
      return provider;
  }
}

export function providerOfSourceName(name: string): Provider {
  switch (name) {
    case 'aws':
      return 'aws';
    case 'azurerm':
    case 'azuread':
      return 'azure';
    case 'google':
    case 'google-beta':
      return 'gcp';
    default:
      return 'other';
  }
}

export const resourceAddress = (type: string, name: string) => `${type}.${name}`;

/** `data.aws_ami.ubuntu`: a data block's address (and canvas / op id) */
export const dataAddress = (type: string, name: string) => `data.${type}.${name}`;
