# IR — Especificação

> A IR (Intermediate Representation) é a única fonte de verdade do projeto. Tanto o canvas quanto o editor Monaco são projeções dela.

## Tipos canônicos

```ts
type Provider = 'aws' | 'azure' | 'gcp' | 'kubernetes' | 'random' | 'tls';

type Expression =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'list'; items: Expression[] }
  | { kind: 'object'; fields: Record<string, Expression> }
  | { kind: 'ref'; path: string } // ex: aws_vpc.main.id
  | { kind: 'raw'; hcl: string }; // escape hatch

interface Trivia {
  leadingComments: string[];
  trailingComments: string[];
  rawTextRange?: { start: number; end: number };
  sourceFile?: string; // 'main.tf', 'modules/network.tf'
}

interface ResourceNode {
  id: string;
  provider: Provider;
  type: string; // 'aws_instance'
  name: string; // 'web'
  args: Record<string, Expression>;
  position: { x: number; y: number };
  parentId?: string; // VPC -> Subnet -> EC2
  trivia: Trivia;
}

interface IREdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: 'network' | 'iam' | 'reference' | 'data';
  label?: string;
}

interface IR {
  version: 1;
  providers: Partial<Record<Provider, ProviderConfig>>;
  variables: Record<string, VariableDecl>;
  outputs: Record<string, OutputDecl>;
  modules: ModuleNode[];
  resources: ResourceNode[];
  edges: IREdge[];
}
```

## Operações (`Op`)

Mutações são sempre representadas como `Op`s discriminados — útil para:

- aplicar em ordem determinística,
- gerar patches mínimos no HCL (`emitPatch(op)`),
- enviar via WebSocket sem ambiguidade.

```ts
type Op =
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
```

`applyOp(ir, op)` é puro (retorna nova IR). `applyOps(ir, [op1, op2])` é dobra.

## Algoritmo HCL → IR

1. Carregar `@cdktf/hcl2json` em WebWorker (não bloqueia UI).
2. Para cada `.tf`, chamar `hcl2json` → AST JSON.
3. Walker percorre `resource`, `module`, `variable`, `output`, `provider`.
4. Cada bloco vira um nó na IR; campos viram `Expression`.
5. Comentários e quebras de linha ficam em `trivia.rawTextRange`.
6. Posições x,y não existem no HCL: geradas por dagre na primeira leitura, depois persistem como comentário especial `# @blueprint:pos=120,340`.

## Algoritmo IR → HCL (patch mínimo)

1. Usuário altera um campo no canvas → `Op` (e.g. `set_arg(nodeId, 'instance_type', t3.small)`).
2. Emitter localiza o range textual original do recurso via `trivia.rawTextRange`.
3. Reescreve apenas as linhas daquele recurso, preservando o resto do arquivo.
4. Yjs aplica como `insert/delete` textual (resolvendo conflitos com edições simultâneas).

```ts
const range = ir.findById(op.nodeId).trivia.rawTextRange!;
const before = fileText.slice(0, range.start);
const after = fileText.slice(range.end);
const newBlock = emitResource(updatedNode);
yText.delete(range.start, range.end - range.start);
yText.insert(range.start, newBlock);
```

## Resolução de conflitos

| Cenário                                    | Estratégia                                    |
| ------------------------------------------ | --------------------------------------------- |
| 2 users editam string em campos diferentes | CRDT merge automático                         |
| 2 users editam string no MESMO campo       | last-write-wins (Yjs)                         |
| 1 user no canvas + 1 no Monaco             | Monaco "vence" — canvas re-renderiza do parse |
| Drag de nó (`position`)                    | Yjs `Y.Map` separado, sem conflito com texto  |
| Delete de nó referenciado                  | Edge é removida; refs viram `raw` HCL         |

## Validações semânticas (F3)

Acima do parser, uma camada própria valida usando o grafo:

- Refs a recursos inexistentes → diagnostic no Monaco + badge no canvas.
- Cycles em network/reference edges → mesma marcação.
- Conexões inválidas multi-cloud (e.g. `aws_instance` apontando para `azurerm_subnet`) → bloqueia drop.
- Schemas Zod aplicados nos args (campos required, enums).

## Linha vermelha de qualidade

Round-trip é o invariante. Em CI:

- Property-based: gerar 1000 IRs aleatórias, emitir, parsear, comparar campo-a-campo.
- Snapshot tests: 100+ exemplos de Terraform real (HashiCorp examples + projetos open source).
- Bench: P95 de parse < 80ms para arquivos de até 500 linhas.
