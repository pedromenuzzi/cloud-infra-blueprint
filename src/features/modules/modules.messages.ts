/**
 * Module calls on the canvas: the node, its menu, deleting one. The
 * inspector, the "Add module" dialog and the opened-module view have their
 * own message modules next to them.
 */
import { formatList } from '@/i18n/format';
import { defineMessages } from '@/i18n/messages';
import type { ModuleSourceKind } from '@/ir/modules';

const s = (n: number) => (n === 1 ? '' : 's');
/** `a, b and 3 more` */
const few = (ids: string[], more: (n: number) => string, locale: 'en' | 'pt-BR') =>
  ids.length <= 4 ? formatList(ids, 'conjunction', locale) : `${ids.slice(0, 3).join(', ')} ${more(ids.length - 3)}`;

export const modulesMessages = defineMessages(
  {
    /* the node */
    typeLabel: 'Module',
    kind: { local: 'Local', registry: 'Registry', git: 'Git', other: 'Remote' } satisfies Record<ModuleSourceKind, string>,
    inputs: (n: number) => `${n} input${s(n)}`,
    noSource: 'no source',
    nodeLabel: (name: string, source: string, warn: boolean) => `Module ${name}, ${source}${warn ? ', has warnings' : ''}`,
    notAnalysed: 'Not analysed',
    analysedInside: (findings: number, cost: string | null) =>
      `${findings === 0 ? 'No findings' : `${findings} finding${s(findings)}`}${cost ? `, ~${cost}/mo` : ''} inside`,
    openHint: 'Double-click to open',
    hasWarnings: 'Has warnings: see the inspector',

    /* its menu */
    open: 'Open module',
    registryPage: 'Registry page',
    actions: 'Module actions',

    /* delete */
    deleteTitle: (id: string) => `Delete ${id}?`,
    deleteManyTitle: (n: number) => `Delete ${n} modules?`,
    deleteBody: (ids: string[]) =>
      `Still read by ${few(ids, (n) => `and ${n} more`, 'en')}. Those references are kept as they are. They'll show as warnings until you point them elsewhere.`,
    deleteConfirm: 'Delete',

    /* what the audit and the estimate leave out */
    notAudited: (n: number) =>
      `${n === 1 ? 'A module call isn’t' : `${n} module calls aren’t`} part of this audit: their contents aren’t in the project (Registry, git, or a folder that’s missing or doesn’t parse).`,
    notEstimated: (n: number) =>
      `${n} module call${s(n)} not included: ${n === 1 ? 'its contents aren’t' : 'their contents aren’t'} in the project (Registry, git, or a folder that’s missing or doesn’t parse).`,

    /* the stats pill */
    stats: (resources: number, modules: number, connections: number) =>
      `${resources} resource${s(resources)}, ${connections} connection${s(connections)}, ${modules} module${s(modules)}`,
  },
  {
    typeLabel: 'Módulo',
    kind: { local: 'Local', registry: 'Registry', git: 'Git', other: 'Remoto' },
    inputs: (n) => `${n} entrada${s(n)}`,
    noSource: 'sem source',
    nodeLabel: (name, source, warn) => `Módulo ${name}, ${source}${warn ? ', tem avisos' : ''}`,
    notAnalysed: 'Não analisado',
    analysedInside: (findings, cost) =>
      `${findings === 0 ? 'Nenhum achado' : `${findings} ${findings === 1 ? 'achado' : 'achados'}`}${cost ? `, ~${cost}/mês` : ''} dentro dele`,
    openHint: 'Clique duas vezes para abrir',
    hasWarnings: 'Tem avisos: veja o inspetor',

    open: 'Abrir módulo',
    registryPage: 'Página no Registry',
    actions: 'Ações do módulo',

    deleteTitle: (id) => `Excluir ${id}?`,
    deleteManyTitle: (n) => `Excluir ${n} módulos?`,
    deleteBody: (ids) =>
      `Ainda é lido por ${few(ids, (n) => `e mais ${n}`, 'pt-BR')}. Essas referências ficam como estão. Elas aparecem como avisos até você apontá-las para outro lugar.`,
    deleteConfirm: 'Excluir',

    notAudited: (n) =>
      `${n === 1 ? 'Uma chamada de módulo não entra' : `${n} chamadas de módulo não entram`} nesta auditoria: o conteúdo ${n === 1 ? 'dela' : 'delas'} não está no projeto (Registry, git, ou uma pasta que falta ou não é lida).`,
    notEstimated: (n) =>
      `${n} chamada${s(n)} de módulo fora da conta: o conteúdo ${n === 1 ? 'dela' : 'delas'} não está no projeto (Registry, git, ou uma pasta que falta ou não é lida).`,

    stats: (resources, modules, connections) =>
      `${resources} recurso${s(resources)}, ${connections} ${connections === 1 ? 'conexão' : 'conexões'}, ${modules} módulo${s(modules)}`,
  },
);
