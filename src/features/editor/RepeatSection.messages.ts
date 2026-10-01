/**
 * Repetition (`count` / `for_each`) as the editor shows it: the canvas badge
 * and its tooltip, the inspector's Repeat section, and the "keep the state"
 * choice (a `moved {}` block) shared with the rename field.
 */
import { defineMessages } from '@/i18n/messages';

const s = (n: number) => (n === 1 ? '' : 's');

export const repeatMessages = defineMessages(
  {
    /* canvas badge */
    badgeInstances: (n: number) => `${n} instance${s(n)}`,
    badgeOptional: '0 or 1 instance — created only when the condition holds',
    badgeUnknownCount: 'How many instances is decided at plan time',
    badgeUnknownEach: 'One instance per key — the keys are decided at plan time',
    badgeKeys: (keys: string) => `Keys: ${keys}`,
    /** appended to a node's accessible name */
    ariaInstances: (n: number) => `${n} instance${s(n)}`,
    ariaOptional: 'optional',
    ariaRepeated: 'repeated',

    /* inspector section */
    title: 'Repeat',
    mode: 'Instances',
    single: 'One',
    howMany: 'How many',
    howManyHint: 'A number, or an expression such as length(var.azs)',
    keys: 'Keys',
    keysHint: 'One instance per key.',
    keyPlaceholder: 'key…',
    addKey: 'Add key',
    removeKey: (key: string) => `Remove key ${key}`,
    useExpression: 'Use an expression',
    useKeys: 'Use a list of keys',
    expression: 'Expression',
    expressionHint: 'A map or a set of strings: var.azs, local.sites, toset(var.names)…',
    existingKey: 'The existing instance becomes',
    existingKeyHint: 'The key the resource you already have takes.',
    keepInstance: 'Keep instance',
    apply: 'Apply',
    cancel: 'Cancel',
    invalidCount: 'Count must be a whole number or an expression',
    invalidExpression: 'That expression doesn\'t parse',
    noKeys: 'Add at least one key',
    referencesFollow: 'References follow:',

    /* keeping the state */
    keepState: 'Keep the state (write a moved block)',
    keepStateHint: 'Renames and count / for_each changes then tell Terraform to move what it created instead of recreating it.',
    moves: (n: number) => `Writes ${n === 1 ? 'a moved block' : `${n} moved blocks`}:`,
    stateNotKept: 'No moved block: Terraform will destroy and recreate it (see "Keep the state" above).',
    noMove: 'Nothing to move: Terraform will create and destroy instances.',
  },
  {
    badgeInstances: (n: number) => `${n} instância${s(n)}`,
    badgeOptional: '0 ou 1 instância — criada só quando a condição vale',
    badgeUnknownCount: 'O número de instâncias só é decidido no plan',
    badgeUnknownEach: 'Uma instância por chave — as chaves só são decididas no plan',
    badgeKeys: (keys: string) => `Chaves: ${keys}`,
    ariaInstances: (n: number) => `${n} instância${s(n)}`,
    ariaOptional: 'opcional',
    ariaRepeated: 'repetido',

    title: 'Repetição',
    mode: 'Instâncias',
    single: 'Uma',
    howMany: 'Quantas',
    howManyHint: 'Um número, ou uma expressão como length(var.azs)',
    keys: 'Chaves',
    keysHint: 'Uma instância por chave.',
    keyPlaceholder: 'chave…',
    addKey: 'Adicionar chave',
    removeKey: (key: string) => `Remover a chave ${key}`,
    useExpression: 'Usar uma expressão',
    useKeys: 'Usar uma lista de chaves',
    expression: 'Expressão',
    expressionHint: 'Um map ou um conjunto de strings: var.azs, local.sites, toset(var.names)…',
    existingKey: 'A instância existente vira',
    existingKeyHint: 'A chave que o recurso que você já tem recebe.',
    keepInstance: 'Manter a instância',
    apply: 'Aplicar',
    cancel: 'Cancelar',
    invalidCount: 'count precisa ser um número inteiro ou uma expressão',
    invalidExpression: 'Essa expressão não é válida',
    noKeys: 'Adicione pelo menos uma chave',
    referencesFollow: 'As referências acompanham:',

    keepState: 'Manter o estado (escrever um bloco moved)',
    keepStateHint: 'Renomear e mudar count / for_each passam a dizer ao Terraform para mover o que já criou em vez de recriar.',
    moves: (n: number) => `Escreve ${n === 1 ? 'um bloco moved' : `${n} blocos moved`}:`,
    stateNotKept: 'Sem bloco moved: o Terraform vai destruir e recriar o recurso (veja "Manter o estado" acima).',
    noMove: 'Nada a mover: o Terraform vai criar e destruir instâncias.',
  },
);
