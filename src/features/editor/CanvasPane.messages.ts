/**
 * The canvas: node labels and lens chips (nodes.tsx), the toolbar
 * (CanvasToolbar.tsx), context menus, toasts, the stats pill, first-run tips
 * and the empty state (CanvasPane.tsx). The lens chips say what the PDF
 * says (features/export/archDoc.messages.ts).
 */
import { defineMessages } from '@/i18n/messages';

const s = (n: number) => (n === 1 ? '' : 's');

/** React Flow's arrow-key move announcement */
const DIRECTION_PT: Record<string, string> = { up: 'cima', down: 'baixo', left: 'a esquerda', right: 'a direita' };

export const canvasMessages = defineMessages(
  {
    /* nodes */
    nodeLabel: (type: string, name: string, parent: string | null, warn: boolean) =>
      `${type} ${name}${parent ? `, in ${parent}` : ''}${warn ? ', missing required settings' : ''}`,
    missingRequired: 'Missing required arguments',
    naclOnSubnet: 'Network ACL on this subnet',
    /** security lens: a subnet's badge (shown in capitals) */
    subnet: { public: 'public', private: 'private' },
    chipPublic: (ports: string) => `Public ${ports}`,
    chipUnverified: 'Unverified',
    chipPrivate: 'Private',
    chipNoInbound: 'No inbound',
    chipReview: 'Review',
    chipAtRisk: 'At risk',
    /** a firewall's chip: its rule counts */
    lensRules: (inbound: number, outbound: number) => `${inbound} in · ${outbound} out`,
    internetReaches: (target: string, ports: string) => `Anyone on the internet can reach ${target} on ${ports}`,
    allowedOn: (from: string, to: string, ports: string) => `${from} → ${to} allowed on ${ports}`,
    /** what assistive tech hears on the canvas (React Flow's own words, in English its defaults) */
    nodeRole: 'node',
    edgeRole: 'edge',
    edgeLabel: (source: string, target: string) => `Edge from ${source} to ${target}`,
    flowAria: {
      'node.a11yDescription.default': 'Press enter or space to select a node. Press delete to remove it and escape to cancel.',
      'node.a11yDescription.keyboardDisabled':
        'Press enter or space to select a node. You can then use the arrow keys to move the node around. Press delete to remove it and escape to cancel.',
      'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }: { direction: string; x: number; y: number }) =>
        `Moved selected node ${direction}. New position, x: ${x}, y: ${y}`,
      'edge.a11yDescription.default':
        'Press enter or space to select an edge. You can then press delete to remove it or escape to cancel.',
      'controls.ariaLabel': 'Control Panel',
      'controls.zoomIn.ariaLabel': 'Zoom In',
      'controls.zoomOut.ariaLabel': 'Zoom Out',
      'controls.fitView.ariaLabel': 'Fit View',
      'controls.interactive.ariaLabel': 'Toggle Interactivity',
      'minimap.ariaLabel': 'Mini Map',
      'handle.ariaLabel': 'Handle',
    },

    /* connecting */
    crossCloud: 'Cross-cloud connections are not allowed',
    expressionArg: 'That argument is an expression — connect them in code',
    alreadyConnected: 'These resources are already connected',
    roleNeedsProfile: 'An EC2 instance uses a role through an aws_iam_instance_profile — add one in code',
    noAttribute: 'These resources have no direct attribute to connect',
    complexConnections: 'Some connections are complex expressions — edit them in code',

    /* toasts */
    deletedMany: (n: number, mod: string) => `Deleted ${n} resources — ${mod} Z to undo`,
    duplicated: (id: string) => `Duplicated as ${id}`,
    exported: (format: string) => `Diagram exported as ${format}`,
    nothingToExport: 'Nothing to export yet — add a resource first',
    exportFailed: (message: string) => `Export failed: ${message}`,
    copied: (text: string) => `Copied ${text}`,

    /* context menus */
    deleteMany: (n: number) => `Delete ${n} resources`,
    showInCode: 'Show in code',
    rename: 'Rename…',
    duplicate: 'Duplicate',
    copyAddress: 'Copy address',
    terraformDocs: 'Terraform docs',
    delete: 'Delete',
    exportPdf: 'Export PDF document…',
    exportPng: 'Export as PNG',
    exportSvg: 'Export as SVG',
    addHere: 'Add resource here…',
    doubleClick: 'Dbl-click',
    fitView: 'Fit view',
    selectionActions: 'Selection actions',
    resourceActions: 'Resource actions',
    export: 'Export',
    canvasActions: 'Canvas actions',

    /* the stats pill */
    stats: (resources: number, connections: number) =>
      `${resources} resource${s(resources)}, ${connections} connection${s(connections)}`,
    overviewToggle: (stats: string) => `${stats} — project overview`,
    showWarnings: 'Show warnings',
    projectOverview: 'Project overview',
    codeErrored: 'Code has errors — fix them to edit the canvas again',
    quickAdd: 'Quick add resource',

    /* first-run tips */
    tipsLabel: 'Editor tips',
    proTips: 'Pro tips',
    dismissTips: 'Dismiss tips',
    tipKeys: { doubleClick: 'Double-click', rightClick: 'Right-click' },
    tips: {
      doubleClick: 'add a resource right there',
      palette: 'search, add, jump, export…',
      rightClick: 'rename, duplicate, delete',
      shortcuts: 'all keyboard shortcuts',
    },

    /* an empty project */
    emptyTitle: 'Start your blueprint',
    emptyBody:
      'Drag a resource from the palette, double-click anywhere on the canvas, or type Terraform in the code editor.',
    addResource: 'Add resource',
    useTemplate: 'Use a template',

    /* the toolbar */
    controls: 'Canvas controls',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    resetZoom: 'Reset zoom',
    resetZoomTip: 'Reset to 100%',
    fitViewTip: 'Fit view  ⇧1',
    lens: 'Security lens',
    hideLens: 'Hide security lens',
    showMinimap: 'Show minimap',
    hideMinimap: 'Hide minimap',
    exportImage: 'Export image',
  },
  {
    nodeLabel: (type: string, name: string, parent: string | null, warn: boolean) =>
      `${type} ${name}${parent ? `, em ${parent}` : ''}${warn ? ', faltam configurações obrigatórias' : ''}`,
    missingRequired: 'Faltam argumentos obrigatórios',
    naclOnSubnet: 'ACL de rede nesta sub-rede',
    subnet: { public: 'pública', private: 'privada' },
    chipPublic: (ports: string) => `Público ${ports}`,
    chipUnverified: 'Não verificado',
    chipPrivate: 'Privado',
    chipNoInbound: 'Sem entrada',
    chipReview: 'Revisar',
    chipAtRisk: 'Em risco',
    lensRules: (inbound: number, outbound: number) => `${inbound} de entrada · ${outbound} de saída`,
    internetReaches: (target: string, ports: string) => `Qualquer pessoa na internet alcança ${target} em ${ports}`,
    allowedOn: (from: string, to: string, ports: string) => `${from} → ${to} permitido em ${ports}`,
    nodeRole: 'nó',
    edgeRole: 'conexão',
    edgeLabel: (source: string, target: string) => `Conexão de ${source} para ${target}`,
    flowAria: {
      'node.a11yDescription.default':
        'Pressione Enter ou Espaço para selecionar um nó. Pressione Delete para excluí-lo e Esc para cancelar.',
      'node.a11yDescription.keyboardDisabled':
        'Pressione Enter ou Espaço para selecionar um nó. Depois, use as setas para movê-lo. Pressione Delete para excluí-lo e Esc para cancelar.',
      'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }: { direction: string; x: number; y: number }) =>
        `Nó selecionado movido para ${DIRECTION_PT[direction] ?? direction}. Nova posição: x ${x}, y ${y}`,
      'edge.a11yDescription.default':
        'Pressione Enter ou Espaço para selecionar uma conexão. Depois, pressione Delete para removê-la ou Esc para cancelar.',
      'controls.ariaLabel': 'Painel de controle',
      'controls.zoomIn.ariaLabel': 'Aproximar',
      'controls.zoomOut.ariaLabel': 'Afastar',
      'controls.fitView.ariaLabel': 'Ajustar à tela',
      'controls.interactive.ariaLabel': 'Ativar ou desativar a interatividade',
      'minimap.ariaLabel': 'Minimapa',
      'handle.ariaLabel': 'Alça de conexão',
    },

    crossCloud: 'Não é possível conectar recursos de nuvens diferentes',
    expressionArg: 'Esse argumento é uma expressão — conecte-os no código',
    alreadyConnected: 'Esses recursos já estão conectados',
    roleNeedsProfile:
      'Uma instância EC2 usa um perfil do IAM por meio de um aws_iam_instance_profile — adicione um no código',
    noAttribute: 'Esses recursos não têm um atributo para conectá-los diretamente',
    complexConnections: 'Algumas conexões são expressões complexas — edite-as no código',

    deletedMany: (n: number, mod: string) => `${n} recursos excluídos — ${mod} Z para desfazer`,
    duplicated: (id: string) => `Duplicado como ${id}`,
    exported: (format: string) => `Diagrama exportado em ${format}`,
    nothingToExport: 'Nada para exportar ainda — adicione um recurso primeiro',
    exportFailed: (message: string) => `Falha ao exportar: ${message}`,
    copied: (text: string) => `${text} copiado`,

    deleteMany: (n: number) => `Excluir ${n} recursos`,
    showInCode: 'Mostrar no código',
    rename: 'Renomear…',
    duplicate: 'Duplicar',
    copyAddress: 'Copiar endereço',
    terraformDocs: 'Documentação do Terraform',
    delete: 'Excluir',
    exportPdf: 'Exportar documento PDF…',
    exportPng: 'Exportar em PNG',
    exportSvg: 'Exportar em SVG',
    addHere: 'Adicionar recurso aqui…',
    doubleClick: 'Clique duplo',
    fitView: 'Ajustar à tela',
    selectionActions: 'Ações da seleção',
    resourceActions: 'Ações do recurso',
    export: 'Exportar',
    canvasActions: 'Ações do canvas',

    stats: (resources: number, connections: number) =>
      `${resources} recurso${s(resources)}, ${connections} ${connections === 1 ? 'conexão' : 'conexões'}`,
    overviewToggle: (stats: string) => `${stats} — visão geral do projeto`,
    showWarnings: 'Mostrar avisos',
    projectOverview: 'Visão geral do projeto',
    codeErrored: 'O código tem erros — corrija-os para editar o canvas de novo',
    quickAdd: 'Adicionar recurso rapidamente',

    tipsLabel: 'Dicas do editor',
    proTips: 'Dicas rápidas',
    dismissTips: 'Dispensar dicas',
    tipKeys: { doubleClick: 'Clique duplo', rightClick: 'Botão direito' },
    tips: {
      doubleClick: 'adiciona um recurso ali mesmo',
      palette: 'busca, adiciona, navega, exporta…',
      rightClick: 'renomeia, duplica, exclui',
      shortcuts: 'todos os atalhos de teclado',
    },

    emptyTitle: 'Comece seu blueprint',
    emptyBody:
      'Arraste um recurso da paleta, clique duas vezes em qualquer lugar do canvas ou digite Terraform no editor de código.',
    addResource: 'Adicionar recurso',
    useTemplate: 'Usar um template',

    controls: 'Controles do canvas',
    zoomOut: 'Afastar',
    zoomIn: 'Aproximar',
    resetZoom: 'Redefinir zoom',
    resetZoomTip: 'Voltar a 100%',
    fitViewTip: 'Ajustar à tela  ⇧1',
    lens: 'Lente de segurança',
    hideLens: 'Ocultar lente de segurança',
    showMinimap: 'Mostrar minimapa',
    hideMinimap: 'Ocultar minimapa',
    exportImage: 'Exportar imagem',
  },
);
