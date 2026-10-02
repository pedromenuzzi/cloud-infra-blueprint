/** The inspector of a module call (./ModuleInspector.tsx). */
import { defineMessages } from '@/i18n/messages';

const s = (n: number) => (n === 1 ? '' : 's');

export const moduleInspectorMessages = defineMessages(
  {
    label: 'Module inspector',
    title: 'Module',
    referencedAs: (id: string) => `Outputs are read as \`${id}.<output>\``,
    alreadyExists: (id: string) => `${id} already exists`,

    source: 'Source',
    sourceHint: {
      local: 'A folder of this project.',
      registry: 'A module from the Terraform Registry.',
      git: 'A git repository.',
      other: 'A remote archive or storage bucket.',
    },
    sourceExpression: 'The source is an expression: edit it in code.',
    registryPage: 'Registry page',
    version: 'Version',
    versionPlaceholder: 'e.g. ~> 5.0',
    versionHint: 'A version or a constraint (~> 5.0). Registry modules only.',
    pinnedBy: (ref: string) => `Pinned by ?ref=${ref} in the source.`,

    folder: 'Folder',
    folderFiles: (dir: string, n: number) => `${dir} · ${n} file${s(n)}`,
    folderMissing: (dir: string) => `${dir} isn't in this project. Import the module's folder with it to see its inputs and resources.`,
    brokenModule: "The module's code doesn't parse. Fix it in the code pane to check its inputs.",
    openModule: 'Open module',

    meta: 'Meta-arguments',

    inputs: (n: number) => `Inputs (${n})`,
    noInputs: 'No inputs passed yet.',
    required: 'required',
    notAnInput: 'not an input of this module',
    removeInput: (key: string) => `Remove input ${key}`,
    editInCode: 'Edit in code',
    complexValue: 'Expression: edit in code',
    missingRequired: (n: number) => `Required, not passed (${n})`,
    optionalInputs: (n: number) => `Optional inputs it accepts (${n})`,
    defaultValue: (value: string) => `default ${value}`,
    add: 'Add',
    addThis: (key: string) => `Add input ${key}`,
    addInput: 'Add an input',
    keyPlaceholder: 'name',
    valuePlaceholder: 'value, e.g. "10.0.0.0/16", 3, true, var.x',
    inputName: 'Input name',
    inputValue: 'Input value',
    badKey: 'An input name is letters, digits and underscores, starting with a letter.',
    inputExists: (key: string) => `${key} is already set. Change it above.`,

    outputsUsed: 'Outputs read elsewhere',
    noOutputsUsed: 'No block reads its outputs yet.',
    wholeModule: '(the whole module)',
    readBy: (ids: string) => `read by ${ids}`,
    declaredOutputs: (n: number) => `Outputs it declares (${n})`,

    resourcesInside: (n: number) => `Resources inside (${n})`,
    noResources: 'No resources of its own.',
    nestedModules: (n: number) => `Module calls inside (${n})`,

    opaqueRemote:
      'Contents not analysed: the module comes from outside the project, so the security audit and the cost estimate can’t look inside it.',
    opaqueLocal: 'Its resources are part of the security audit and the cost estimate, read with the inputs this call gives. Open the module to edit them.',
    insideTitle: 'Inside this call',
    reviewFindings: 'Review',
    reviewFindingsTitle: 'Show the findings in the security panel',
    instancesUnknown: 'instances decided at plan time',

    settingsReadOnly: 'Module settings (read-only)',
    deleteModule: 'Delete module',
  },
  {
    label: 'Inspetor do módulo',
    title: 'Módulo',
    referencedAs: (id) => `Os outputs são lidos como \`${id}.<output>\``,
    alreadyExists: (id) => `${id} já existe`,

    source: 'Origem',
    sourceHint: {
      local: 'Uma pasta deste projeto.',
      registry: 'Um módulo do Terraform Registry.',
      git: 'Um repositório git.',
      other: 'Um arquivo ou bucket remoto.',
    },
    sourceExpression: 'A origem é uma expressão: edite no código.',
    registryPage: 'Página no Registry',
    version: 'Versão',
    versionPlaceholder: 'ex.: ~> 5.0',
    versionHint: 'Uma versão ou uma restrição (~> 5.0). Só para módulos do Registry.',
    pinnedBy: (ref) => `Fixada por ?ref=${ref} na origem.`,

    folder: 'Pasta',
    folderFiles: (dir, n) => `${dir} · ${n} arquivo${s(n)}`,
    folderMissing: (dir) => `${dir} não está neste projeto. Importe a pasta do módulo junto para ver as entradas e os recursos dele.`,
    brokenModule: 'O código do módulo não pode ser lido. Corrija-o no painel de código para conferir as entradas.',
    openModule: 'Abrir módulo',

    meta: 'Meta-argumentos',

    inputs: (n) => `Entradas (${n})`,
    noInputs: 'Nenhuma entrada passada ainda.',
    required: 'obrigatória',
    notAnInput: 'não é uma entrada deste módulo',
    removeInput: (key) => `Remover a entrada ${key}`,
    editInCode: 'Editar no código',
    complexValue: 'Expressão: edite no código',
    missingRequired: (n) => `Obrigatórias, não passadas (${n})`,
    optionalInputs: (n) => `Entradas opcionais que ele aceita (${n})`,
    defaultValue: (value) => `padrão ${value}`,
    add: 'Adicionar',
    addThis: (key) => `Adicionar a entrada ${key}`,
    addInput: 'Adicionar uma entrada',
    keyPlaceholder: 'nome',
    valuePlaceholder: 'valor, ex.: "10.0.0.0/16", 3, true, var.x',
    inputName: 'Nome da entrada',
    inputValue: 'Valor da entrada',
    badKey: 'O nome de uma entrada tem letras, dígitos e sublinhados, começando por uma letra.',
    inputExists: (key) => `${key} já está definida. Altere-a acima.`,

    outputsUsed: 'Outputs lidos em outros blocos',
    noOutputsUsed: 'Nenhum bloco lê os outputs dele ainda.',
    wholeModule: '(o módulo inteiro)',
    readBy: (ids) => `lido por ${ids}`,
    declaredOutputs: (n) => `Outputs que ele declara (${n})`,

    resourcesInside: (n) => `Recursos dentro dele (${n})`,
    noResources: 'Nenhum recurso próprio.',
    nestedModules: (n) => `Chamadas de módulo dentro dele (${n})`,

    opaqueRemote:
      'Conteúdo não analisado: o módulo vem de fora do projeto, então a auditoria de segurança e a estimativa de custo não enxergam o que há dentro dele.',
    opaqueLocal: 'Os recursos dele entram na auditoria de segurança e na estimativa de custo, lidos com as entradas que esta chamada passa. Abra o módulo para editá-los.',
    insideTitle: 'Dentro desta chamada',
    reviewFindings: 'Revisar',
    reviewFindingsTitle: 'Mostrar os achados no painel de segurança',
    instancesUnknown: 'instâncias decididas no plan',

    settingsReadOnly: 'Configurações do módulo (somente leitura)',
    deleteModule: 'Excluir módulo',
  },
);
