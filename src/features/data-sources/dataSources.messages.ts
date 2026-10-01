/**
 * Data sources (`data` blocks) on screen: the canvas node and its menu, the
 * inspector, the palette section, ⌘K, deleting one that is read, the hint
 * on a resource argument that a data source can fill, and the PDF list.
 * "Data source" is "fonte de dados" (src/i18n/GLOSSARY.md); `data` stays code.
 */
import { formatList } from '@/i18n/format';
import { defineMessages } from '@/i18n/messages';

const s = (n: number) => (n === 1 ? '' : 's');
/** `a, b and 3 more` */
const few = (ids: string[], more: (n: number) => string, locale: 'en' | 'pt-BR') =>
  ids.length <= 4 ? formatList(ids, 'conjunction', locale) : `${ids.slice(0, 3).join(', ')} ${more(ids.length - 3)}`;

export const dataSourceMessages = defineMessages(
  {
    /* the node */
    nodeLabel: (name: string, type: string, readers: number, warn: boolean) =>
      `Data source ${name}, ${type}, ${readers === 0 ? 'not read' : `read by ${readers}`}${warn ? ', has warnings' : ''}`,
    readBy: (n: number) => `read by ${n}`,
    notRead: 'not read',
    readByTitle: (ids: string[]) => `Read by ${formatList(ids, 'conjunction', 'en')}`,
    notReadTitle: 'Nothing reads it yet',
    hasWarnings: 'Has warnings: see the inspector',
    lookupTitle: 'A data source: Terraform reads it, never creates it',
    actions: 'Data source actions',

    /* inspector */
    label: 'Data source inspector',
    title: 'Data source',
    readOnlyArgs: 'Data source settings (read-only)',
    referencedAs: (id: string) => `Read as \`${id}.<attribute>\``,
    alreadyExists: (id: string) => `${id} already exists`,
    lookupNote: 'A data source reads something that already exists. Terraform never creates, changes or destroys it, and it costs nothing.',
    arguments: (n: number) => `Arguments (${n})`,
    noArguments: 'No arguments: it reads what the provider is configured with.',
    editInCode: 'Edit in code',
    complexValue: 'An expression: edit it in the code',
    removeArgument: (name: string) => `Remove ${name}`,
    required: 'required',
    missingRequired: (n: number) => `Required, not set (${n})`,
    add: 'Add',
    addThis: (name: string) => `Add ${name}`,
    optionalArguments: (n: number) => `Other arguments (${n})`,
    addArgument: 'Add an argument',
    argumentName: 'Argument name',
    argumentValue: 'Argument value',
    keyPlaceholder: 'name',
    valuePlaceholder: 'value, or var.x',
    badKey: 'Use letters, digits, _ and -, starting with a letter',
    argumentExists: (name: string) => `${name} is already set`,
    meta: 'Meta-arguments',
    readers: 'Read by',
    wholeObject: 'the whole object',
    notReadYet: (example: string) => `Nothing reads it yet. Reference it from a resource, for example \`${example}\`.`,
    readByList: (ids: string[]) => `by ${formatList(ids, 'conjunction', 'en')}`,
    attributes: (n: number) => `Attributes it exposes (${n})`,
    attributesHint: 'Copy a reference to read one of them',
    attributesLoading: 'Loading what the provider documents…',
    attributesUnknown: 'The provider schema shipped here doesn’t describe this type.',
    copyReference: (ref: string) => `Copy ${ref}`,
    copied: (ref: string) => `Copied ${ref}`,
    useIn: 'Connect to',
    useInHint: 'Arguments of this project’s resources that usually read it',
    connect: 'Connect',
    connected: 'Connected',
    connectTitle: (target: string, value: string) => `Set ${target} = ${value}`,
    deleteDataSource: 'Delete data source',
    docs: 'Terraform docs',

    /* a resource argument a data source can fill */
    useData: (ref: string) => `Use ${ref}`,
    useDataTitle: (ref: string) => `Read the value from the data source: ${ref}`,

    /* delete */
    deleteTitle: (id: string) => `Delete ${id}?`,
    deleteManyTitle: (n: number) => `Delete ${n} data sources?`,
    deleteBody: (ids: string[]) =>
      `Still read by ${few(ids, (n) => `and ${n} more`, 'en')}. Those references are kept as they are. They'll show as warnings until you point them elsewhere.`,
    deleteConfirm: 'Delete',

    /* palette and ⌘K */
    section: 'Data sources',
    sectionHint: 'Read what already exists',
    addItem: (name: string, type: string) => `Add data source ${name} (${type})`,
    itemTitle: (name: string, description: string) => `${name}: ${description}`,
    command: 'Add data source…',
    commandHint: 'AMIs, zones, account, existing networks',
    commandKeywords: ['data', 'data source', 'lookup', 'existing', 'fonte de dados', 'ami', 'zones'],
    back: 'Data sources',
    search: 'Search data sources…',
    added: (id: string) => `Added ${id}`,

    /* the stats pill */
    stats: (base: string, n: number) => `${base}, ${n} data source${s(n)}`,

    /* PDF */
    pdfTitle: 'Data sources',
    pdfIntro: (n: number) =>
      `${n} data source${s(n)}: lookups Terraform reads when it plans. They create nothing and cost nothing.`,
    pdfType: 'Type',
    pdfName: 'Name',
    pdfReadBy: 'Read by',
    pdfNothing: 'nothing reads it',
  },
  {
    nodeLabel: (name, type, readers, warn) =>
      `Fonte de dados ${name}, ${type}, ${readers === 0 ? 'não lida' : `lida por ${readers}`}${warn ? ', tem avisos' : ''}`,
    readBy: (n) => `lida por ${n}`,
    notRead: 'não lida',
    readByTitle: (ids) => `Lida por ${formatList(ids, 'conjunction', 'pt-BR')}`,
    notReadTitle: 'Nada a lê ainda',
    hasWarnings: 'Tem avisos: veja o inspetor',
    lookupTitle: 'Uma fonte de dados: o Terraform a lê, nunca a cria',
    actions: 'Ações da fonte de dados',

    label: 'Inspetor da fonte de dados',
    title: 'Fonte de dados',
    readOnlyArgs: 'Configurações da fonte de dados (somente leitura)',
    referencedAs: (id) => `Lida como \`${id}.<atributo>\``,
    alreadyExists: (id) => `${id} já existe`,
    lookupNote: 'Uma fonte de dados lê algo que já existe. O Terraform nunca a cria, altera ou destrói, e ela não custa nada.',
    arguments: (n) => `Argumentos (${n})`,
    noArguments: 'Sem argumentos: ela lê o que o provider tem configurado.',
    editInCode: 'Editar no código',
    complexValue: 'Uma expressão: edite no código',
    removeArgument: (name) => `Remover ${name}`,
    required: 'obrigatório',
    missingRequired: (n) => `Obrigatórios que faltam (${n})`,
    add: 'Adicionar',
    addThis: (name) => `Adicionar ${name}`,
    optionalArguments: (n) => `Outros argumentos (${n})`,
    addArgument: 'Adicionar um argumento',
    argumentName: 'Nome do argumento',
    argumentValue: 'Valor do argumento',
    keyPlaceholder: 'nome',
    valuePlaceholder: 'valor, ou var.x',
    badKey: 'Use letras, dígitos, _ e -, começando por uma letra',
    argumentExists: (name) => `${name} já está definido`,
    meta: 'Meta-argumentos',
    readers: 'Lida por',
    wholeObject: 'o objeto inteiro',
    notReadYet: (example) => `Nada a lê ainda. Referencie a partir de um recurso, por exemplo \`${example}\`.`,
    readByList: (ids) => `por ${formatList(ids, 'conjunction', 'pt-BR')}`,
    attributes: (n) => `Atributos que expõe (${n})`,
    attributesHint: 'Copie uma referência para ler um deles',
    attributesLoading: 'Carregando o que o provider documenta…',
    attributesUnknown: 'O schema do provider incluído aqui não descreve este tipo.',
    copyReference: (ref) => `Copiar ${ref}`,
    copied: (ref) => `${ref} copiado`,
    useIn: 'Conectar a',
    useInHint: 'Argumentos de recursos deste projeto que costumam lê-la',
    connect: 'Conectar',
    connected: 'Conectado',
    connectTitle: (target, value) => `Definir ${target} = ${value}`,
    deleteDataSource: 'Excluir fonte de dados',
    docs: 'Documentação',

    useData: (ref) => `Usar ${ref}`,
    useDataTitle: (ref) => `Ler o valor da fonte de dados: ${ref}`,

    deleteTitle: (id) => `Excluir ${id}?`,
    deleteManyTitle: (n) => `Excluir ${n} fontes de dados?`,
    deleteBody: (ids) =>
      `Ainda é lida por ${few(ids, (n) => `e mais ${n}`, 'pt-BR')}. Essas referências ficam como estão. Elas aparecem como avisos até você apontá-las para outro lugar.`,
    deleteConfirm: 'Excluir',

    section: 'Fontes de dados',
    sectionHint: 'Ler o que já existe',
    addItem: (name, type) => `Adicionar fonte de dados ${name} (${type})`,
    itemTitle: (name, description) => `${name}: ${description}`,
    command: 'Adicionar fonte de dados…',
    commandHint: 'AMIs, zonas, conta, redes existentes',
    commandKeywords: ['data', 'fonte de dados', 'consulta', 'existente', 'data source', 'ami', 'zonas'],
    back: 'Fontes de dados',
    search: 'Buscar fontes de dados…',
    added: (id) => `${id} adicionada`,

    stats: (base, n) => `${base}, ${n} fonte${s(n)} de dados`,

    pdfTitle: 'Fontes de dados',
    pdfIntro: (n) =>
      `${n} fonte${s(n)} de dados: consultas que o Terraform lê ao planejar. Elas não criam nada e não custam nada.`,
    pdfType: 'Tipo',
    pdfName: 'Nome',
    pdfReadBy: 'Lida por',
    pdfNothing: 'nada a lê',
  },
);
