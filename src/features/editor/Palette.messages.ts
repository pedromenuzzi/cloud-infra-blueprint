/** The resource palette and the searchable resource picker (canvas quick add, ⌘K "Add resource"). */
import { defineMessages } from '@/i18n/messages';

export const paletteMessages = defineMessages(
  {
    title: 'Resource palette',
    search: 'Search resources',
    searchPlaceholder: 'Search resources…',
    cloudProvider: 'Cloud provider',
    providerCount: (n: number, provider: string) => `${n} ${provider} resources`,
    list: (provider: string) => `${provider} resources: arrow keys to move, Enter to add`,
    add: (name: string, type: string) => `Add ${name} (${type})`,
    itemTitle: (name: string, description: string) => `${name}: drag to the canvas or click to add\n${description}`,
    noMatch: 'No resources match.',
    /** the footer, split around the ⌘K key */
    footer: [
      'Drag onto the canvas or click to add. Drop inside a VPC / subnet / group to nest. Double-click the canvas or press ',
      ' to search.',
    ] as [string, string],
    /* the picker */
    pickerLabel: 'Add a resource',
    pickerPlaceholder: 'Add a resource…',
    results: 'Suggestions',
  },
  {
    title: 'Paleta de recursos',
    search: 'Buscar recursos',
    searchPlaceholder: 'Buscar recursos…',
    cloudProvider: 'Provedor de nuvem',
    providerCount: (n: number, provider: string) => `${n} recursos ${provider}`,
    list: (provider: string) => `Recursos ${provider}: setas para navegar, Enter para adicionar`,
    add: (name: string, type: string) => `Adicionar ${name} (${type})`,
    itemTitle: (name: string, description: string) =>
      `${name}: arraste para o canvas ou clique para adicionar\n${description}`,
    noMatch: 'Nenhum recurso encontrado.',
    footer: [
      'Arraste para o canvas ou clique para adicionar. Solte dentro de uma VPC, sub-rede ou grupo para aninhar. Clique duas vezes no canvas ou pressione ',
      ' para buscar.',
    ],
    pickerLabel: 'Adicionar um recurso',
    pickerPlaceholder: 'Adicionar um recurso…',
    results: 'Sugestões',
  },
);
