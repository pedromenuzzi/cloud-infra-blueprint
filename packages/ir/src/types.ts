/**
 * Cloud Infra Blueprint - canonical IR types.
 *
 * IR is the SINGLE source of truth shared by the canvas and the HCL editor.
 * Every visual node and every block of HCL code projects from / to this graph.
 *
 * Spec reference: section 4 of the AI-Ready Master Specification v1.0.
 */

export type Provider = 'aws' | 'azure' | 'gcp' | 'kubernetes' | 'random' | 'tls';

/**
 * Expression - a polymorphic value that may live inside a resource argument.
 *
 * `raw` is the escape hatch: when an expression is too complex to round-trip
 * losslessly through the typed forms (heredocs, deeply nested ternaries with
 * function calls, etc.), the parser stores the original text. The emitter
 * outputs it verbatim.
 */
export type Expression =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'list'; items: Expression[] }
  | { kind: 'object'; fields: Record<string, Expression> }
  | { kind: 'ref'; path: string }
  | { kind: 'raw'; hcl: string };

/**
 * Trivia - metadata that does not affect semantics but MUST be preserved
 * across round-trips so user-authored formatting survives canvas edits.
 */
export interface Trivia {
  leadingComments: string[];
  trailingComments: string[];
  /**
   * Byte/char range in the source file where this node was originally written.
   * Used by the emitter to apply minimal patches (rewrite only the bytes of
   * the changed block, leaving the rest of the file untouched).
   */
  rawTextRange?: { start: number; end: number };
  /**
   * Source file the node belongs to (e.g. 'main.tf', 'modules/network.tf').
   */
  sourceFile?: string;
}

export interface CanvasPosition {
  x: number;
  y: number;
}

export type EdgeKind = 'network' | 'iam' | 'reference' | 'data';

export interface ResourceNode {
  /** Internal UUID, stable across renames. */
  id: string;
  provider: Provider;
  /** Terraform type, e.g. `aws_instance`. */
  type: string;
  /** Terraform name, e.g. `web`. Unique within the same `type`. */
  name: string;
  args: Record<string, Expression>;
  position: CanvasPosition;
  /** Optional parent for grouping (VPC -> Subnet -> EC2). */
  parentId?: string;
  trivia: Trivia;
}

export interface ModuleNode {
  id: string;
  /** Local module name, e.g. `network`. */
  name: string;
  source: string;
  version?: string;
  inputs: Record<string, Expression>;
  position: CanvasPosition;
  trivia: Trivia;
}

export interface IREdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: EdgeKind;
  label?: string;
}

export interface ProviderConfig {
  region?: string;
  alias?: string;
  /** Free-form additional config, emitted verbatim. */
  extras?: Record<string, Expression>;
}

export interface VariableDecl {
  /**
   * Terraform variable type expression. Stored as an Expression so we can
   * faithfully round-trip both the legacy quoted form `type = "string"`
   * (Expression `literal "string"`) and the modern unquoted type-expression
   * form `type = list(string)` (Expression `raw "${list(string)}"`).
   */
  type?: Expression;
  default?: Expression;
  description?: string;
  sensitive?: boolean;
}

export interface OutputDecl {
  value: Expression;
  description?: string;
  sensitive?: boolean;
}

export interface IR {
  version: 1;
  providers: Partial<Record<Provider, ProviderConfig>>;
  variables: Record<string, VariableDecl>;
  outputs: Record<string, OutputDecl>;
  modules: ModuleNode[];
  resources: ResourceNode[];
  edges: IREdge[];
}

/* ---------------------------------------------------------------------------
 * Patch operations.
 *
 * The canvas / inspector / HCL diff produce a sequence of `Op`s that mutate
 * the IR atomically. The HCL emitter knows how to derive a minimal text patch
 * from each Op, which Yjs then applies to the shared `Y.Text`.
 * ------------------------------------------------------------------------- */

export type Op =
  | { kind: 'add_resource'; node: ResourceNode }
  | { kind: 'remove_resource'; nodeId: string }
  | { kind: 'set_arg'; nodeId: string; field: string; value: Expression }
  | { kind: 'unset_arg'; nodeId: string; field: string }
  | { kind: 'rename_resource'; nodeId: string; newName: string }
  | { kind: 'move_node'; nodeId: string; position: CanvasPosition }
  | { kind: 'reparent_node'; nodeId: string; parentId: string | undefined }
  | { kind: 'add_edge'; edge: IREdge }
  | { kind: 'remove_edge'; edgeId: string }
  | { kind: 'set_provider'; provider: Provider; config: ProviderConfig }
  | { kind: 'set_variable'; name: string; decl: VariableDecl }
  | { kind: 'set_output'; name: string; decl: OutputDecl };

/** Bulk patch applied transactionally (used by templates). */
export interface IRPatch {
  addResources?: ResourceNode[];
  addModules?: ModuleNode[];
  addEdges?: IREdge[];
  removeResources?: string[];
  removeEdges?: string[];
  setVariables?: Record<string, VariableDecl>;
  setOutputs?: Record<string, OutputDecl>;
  setProviders?: Partial<Record<Provider, ProviderConfig>>;
}
