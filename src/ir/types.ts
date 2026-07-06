/**
 * Canonical Intermediate Representation (IR).
 *
 * The IR is the single source of truth of a project. Both the canvas and the
 * Monaco editor are projections of it: canvas edits mutate the IR through Ops
 * and produce minimal HCL text patches; code edits are parsed back into the IR.
 */

export type Provider = 'aws' | 'azure' | 'gcp' | 'other';

export type Expression =
  | { kind: 'literal'; value: string | number | boolean | null }
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

/** Any block we intentionally keep verbatim: terraform {}, locals {}, data, module… */
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
