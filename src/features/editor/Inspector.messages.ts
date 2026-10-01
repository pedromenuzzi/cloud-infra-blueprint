/**
 * The inspector: its header and tabs, the field editors, the security card
 * and rules summary, connections, and the project overview the stats pill
 * opens. What the audit says (reasons, findings, fixes, peers) comes worded
 * from src/security in the same language.
 */
import { defineMessages } from '@/i18n/messages';

type Tab = 'rules' | 'properties' | 'connections';
type Direction = 'inbound' | 'outbound';

const s = (n: number) => (n === 1 ? '' : 's');

export const inspectorMessages = defineMessages(
  {
    label: 'Inspector',
    close: 'Close inspector',
    closeTitle: 'Close (Esc)',
    terraformDocs: 'Terraform docs',
    tab: { rules: 'rules', properties: 'properties', connections: 'connections' } satisfies Record<Tab, string>,
    readOnlyView: 'Read-only view: make a copy to edit.',
    readOnlyUntilParses: 'Read-only until the code parses: fix the errors in the code pane.',
    settingsReadOnly: 'Resource settings (read-only)',
    deleteResource: 'Delete resource',

    /* fields */
    required: 'required',
    none: 'None',
    unset: 'Not set',
    complexExpression: 'complex expression: edit in code',
    engineCleared: 'Cleared engine_version. Set one that exists for the new engine',
    outOfRange: (field: string, min: string, max: string) => `${field} must be ${min}–${max}`,
    removeItem: 'Remove item',
    addReference: '+ add reference…',
    noCandidates: 'No matching resources on the canvas yet.',
    addValuePlaceholder: 'add value…',
    addValue: 'Add value',
    removeTag: (key: string) => `Remove tag ${key}`,
    keyPlaceholder: 'key',
    valuePlaceholder: 'value',
    tagKey: 'Tag key',
    tagValue: 'Tag value',
    addTag: 'Add tag',
    terraformName: 'Terraform name',
    /** `code` in backticks */
    referencedAs: (id: string) => `Referenced as \`${id}\``,
    alreadyExists: (address: string) => `${address} already exists`,
    otherArguments: 'Other arguments',

    /* security card */
    internetFacing: (ports: string) => `Internet-facing on ${ports}`,
    unverifiable: "Exposure can't be verified",
    restricted: 'Private: reachable only as allowed below',
    isolated: 'No inbound traffic allowed',
    from: (name: string) => `from ${name}`,
    protectedBy: 'Protected by',
    editRules: 'Edit rules',

    /* rules tab */
    direction: { inbound: 'inbound', outbound: 'outbound' } satisfies Record<Direction, string>,
    hiddenRules: (reasons: string) => `Rules built with ${reasons} can't be shown: check them in code.`,
    nothingIn: 'Nothing can connect in.',
    nothingOut: 'No outbound traffic.',
    deny: 'deny',
    peersFrom: 'from ',
    peersTo: 'to ',
    /** a rule with no source / destination of its own: "from nowhere" */
    noSources: 'nowhere',
    noDestinations: 'nowhere',
    appliesTo: 'Applies to',
    notAttached: 'Not attached to anything yet. Connect it to an instance, load balancer or database on the canvas.',

    /* connections tab */
    referencedVia: (field: string) => `referenced via ${field}`,
    removeConnection: 'Remove connection',
    editConnectionInCode: 'Edit this connection in code',
    outgoing: (n: number) => `Outgoing (${n})`,
    incoming: (n: number) => `Incoming (${n})`,
    noOutgoing: "Drag from this node's right handle to another resource to connect.",
    noIncoming: 'Nothing references this resource yet.',

    /* project overview */
    projectName: 'Project name',
    counts: { resources: 'resources', links: 'links', variables: 'variables', outputs: 'outputs' },
    files: 'Files',
    lines: (n: number) => `${n} lines`,
    warnings: (n: number) => `Warnings (${n})`,
  },
  {
    label: 'Inspetor',
    close: 'Fechar o inspetor',
    closeTitle: 'Fechar (Esc)',
    terraformDocs: 'Documentação do Terraform',
    tab: { rules: 'regras', properties: 'propriedades', connections: 'conexões' },
    readOnlyView: 'Visualização somente leitura: faça uma cópia para editar.',
    readOnlyUntilParses: 'Somente leitura até o código ser lido sem erros: corrija-os no painel de código.',
    settingsReadOnly: 'Configurações do recurso (somente leitura)',
    deleteResource: 'Excluir recurso',

    required: 'obrigatório',
    none: 'Nenhum',
    unset: 'Não definido',
    complexExpression: 'expressão complexa: edite no código',
    engineCleared: 'engine_version foi limpo. Defina uma versão que exista para o novo engine',
    outOfRange: (field: string, min: string, max: string) => `${field} precisa estar entre ${min} e ${max}`,
    removeItem: 'Remover item',
    addReference: '+ adicionar referência…',
    noCandidates: 'Nenhum recurso compatível no canvas ainda.',
    addValuePlaceholder: 'adicionar valor…',
    addValue: 'Adicionar valor',
    removeTag: (key: string) => `Remover a tag ${key}`,
    keyPlaceholder: 'chave',
    valuePlaceholder: 'valor',
    tagKey: 'Chave da tag',
    tagValue: 'Valor da tag',
    addTag: 'Adicionar tag',
    terraformName: 'Nome no Terraform',
    referencedAs: (id: string) => `Referenciado como \`${id}\``,
    alreadyExists: (address: string) => `${address} já existe`,
    otherArguments: 'Outros argumentos',

    internetFacing: (ports: string) => `Exposto à internet em ${ports}`,
    unverifiable: 'Não é possível verificar a exposição',
    restricted: 'Privado: acessível só como permitido abaixo',
    isolated: 'Nenhum tráfego de entrada permitido',
    from: (name: string) => `de ${name}`,
    protectedBy: 'Protegido por',
    editRules: 'Editar regras',

    direction: { inbound: 'entrada', outbound: 'saída' },
    hiddenRules: (reasons: string) =>
      `Regras criadas com ${reasons} não podem ser mostradas aqui: confira-as no código.`,
    nothingIn: 'Nada consegue se conectar.',
    nothingOut: 'Nenhum tráfego de saída.',
    deny: 'negar',
    peersFrom: 'Origem: ',
    peersTo: 'Destino: ',
    noSources: 'nenhuma',
    noDestinations: 'nenhum',
    appliesTo: 'Aplica-se a',
    notAttached:
      'Ainda não está ligado a nada. Conecte-o a uma instância, a um balanceador de carga ou a um banco de dados no canvas.',

    referencedVia: (field: string) => `referenciado por ${field}`,
    removeConnection: 'Remover conexão',
    editConnectionInCode: 'Edite esta conexão no código',
    outgoing: (n: number) => `Saída (${n})`,
    incoming: (n: number) => `Entrada (${n})`,
    noOutgoing: 'Arraste da alça à direita deste nó até outro recurso para conectar.',
    noIncoming: 'Nada faz referência a este recurso ainda.',

    projectName: 'Nome do projeto',
    counts: { resources: 'recursos', links: 'conexões', variables: 'variáveis', outputs: 'outputs' },
    files: 'Arquivos',
    lines: (n: number) => `${n} linha${s(n)}`,
    warnings: (n: number) => `Avisos (${n})`,
  },
);
