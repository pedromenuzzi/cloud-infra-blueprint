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
    openHint: 'Double-click to open',
    hasWarnings: 'Has warnings — see the inspector',

    /* its menu */
    open: 'Open module',
    registryPage: 'Registry page',
    actions: 'Module actions',

    /* delete */
    deleteTitle: (id: string) => `Delete ${id}?`,
    deleteManyTitle: (n: number) => `Delete ${n} modules?`,
    deleteBody: (ids: string[]) =>
      `Still read by ${few(ids, (n) => `and ${n} more`, 'en')}. Those references are kept as they are — they'll show as warnings until you point them elsewhere.`,
    deleteConfirm: 'Delete',

    /* what the audit and the estimate leave out */
    notAudited: (n: number, local: number) =>
      `${n === 1 ? 'A module call isn’t' : `${n} module calls aren’t`} part of this audit: ` +
      (local === n ? 'module resources aren’t audited yet.' : local === 0 ? 'their contents come from outside the project.' : `${n - local} come from outside the project, ${local} ${local === 1 ? 'is' : 'are'} not audited yet.`),
    notEstimated: (n: number, local: number) =>
      `Not included: ${n} module call${s(n)} — ` +
      (local === n ? 'module resources aren’t estimated yet.' : local === 0 ? 'their contents come from outside the project.' : `${n - local} from outside the project, ${local} not estimated yet.`),

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
    openHint: 'Clique duas vezes para abrir',
    hasWarnings: 'Tem avisos — veja o inspetor',

    open: 'Abrir módulo',
    registryPage: 'Página no Registry',
    actions: 'Ações do módulo',

    deleteTitle: (id) => `Excluir ${id}?`,
    deleteManyTitle: (n) => `Excluir ${n} módulos?`,
    deleteBody: (ids) =>
      `Ainda é lido por ${few(ids, (n) => `e mais ${n}`, 'pt-BR')}. Essas referências ficam como estão — aparecem como avisos até você apontá-las para outro lugar.`,
    deleteConfirm: 'Excluir',

    notAudited: (n, local) =>
      `${n === 1 ? 'Uma chamada de módulo não entra' : `${n} chamadas de módulo não entram`} nesta auditoria: ` +
      (local === n
        ? 'os recursos de módulos ainda não são auditados.'
        : local === 0
          ? 'o conteúdo delas vem de fora do projeto.'
          : `${n - local} ${n - local === 1 ? 'vem' : 'vêm'} de fora do projeto, ${local} ainda não ${local === 1 ? 'é auditada' : 'são auditadas'}.`),
    notEstimated: (n, local) =>
      `Fora da conta: ${n} chamada${s(n)} de módulo — ` +
      (local === n
        ? 'os recursos de módulos ainda não são estimados.'
        : local === 0
          ? 'o conteúdo delas vem de fora do projeto.'
          : `${n - local} de fora do projeto, ${local} ainda sem estimativa.`),

    stats: (resources, modules, connections) =>
      `${resources} recurso${s(resources)}, ${connections} ${connections === 1 ? 'conexão' : 'conexões'}, ${modules} módulo${s(modules)}`,
  },
);
