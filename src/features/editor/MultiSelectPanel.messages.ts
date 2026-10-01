/** The multi-selection inspector (./MultiSelectPanel.tsx). */
import { defineMessages } from '@/i18n/messages';

const resources = (n: number) => `${n} resource${n === 1 ? '' : 's'}`;
const recursos = (n: number) => `${n} recurso${n === 1 ? '' : 's'}`;

export const multiSelectMessages = defineMessages(
  {
    panel: (n: number) => `${n} resources selected`,
    heading: (n: number) => `${resources(n)} selected`,
    clear: 'Clear selection',
    clearTitle: 'Clear selection (Esc)',
    readOnly: 'Read-only until the code parses: fix the errors in the code pane.',
    arrange: 'Arrange',
    alignToolbar: 'Align and distribute',
    /** `blocker`: why aligning can't run, from ./align.messages.ts */
    lineUpHint: (blocker: string) => `${blocker} to line them up.`,
    shared: 'Shared settings',
    mixed: 'mixed',
    mixedPick: 'Mixed: pick one for all',
    mixedType: 'Mixed: type to set for all',
    none: 'None',
    tagAll: 'Tag all',
    tagKey: 'key',
    tagValue: 'value',
    tagKeyLabel: 'Tag key for all',
    tagValueLabel: 'Tag value for all',
    addTag: 'Add tag to all',
    tagged: (n: number, key: string, value: string, skipped: number) =>
      `Tagged ${resources(n)} ${key}=${value}${skipped ? `, ${skipped} skipped (tags is an expression)` : ''}`,
    connectAllTo: 'Connect all to',
    connectTarget: 'Resource to connect all to',
    pickResource: 'Pick a resource…',
    connectAll: 'Connect all',
    connected: (n: number, to: string, already: number) =>
      `Connected ${resources(n)} to ${to}${already ? ` (${already} already were)` : ''}`,
    allConnected: (to: string) => `All of them are already connected to ${to}`,
    selected: 'Selected',
    selectOnly: 'Select only this one',
    deleted: (n: number, undo: string) => `Deleted ${resources(n)}. ${undo} to undo`,
    delete: (n: number) => `Delete ${resources(n)}`,
  },
  {
    panel: (n) => `${n} recursos selecionados`,
    heading: (n) => `${recursos(n)} selecionado${n === 1 ? '' : 's'}`,
    clear: 'Limpar seleção',
    clearTitle: 'Limpar seleção (Esc)',
    readOnly: 'Somente leitura enquanto o código tiver erros: corrija-os no painel de código.',
    arrange: 'Alinhar e distribuir',
    alignToolbar: 'Alinhar e distribuir',
    lineUpHint: (blocker) => `${blocker} para alinhá-los.`,
    shared: 'Configurações em comum',
    mixed: 'misto',
    mixedPick: 'Misto: escolha um para todos',
    mixedType: 'Misto: digite para definir em todos',
    none: 'Nenhum',
    tagAll: 'Aplicar tag a todos',
    tagKey: 'chave',
    tagValue: 'valor',
    tagKeyLabel: 'Chave da tag para todos',
    tagValueLabel: 'Valor da tag para todos',
    addTag: 'Adicionar a tag a todos',
    tagged: (n, key, value, skipped) =>
      `Tag ${key}=${value} aplicada a ${recursos(n)}${
        skipped ? `, ${skipped} ignorado${skipped === 1 ? '' : 's'} (tags é uma expressão)` : ''
      }`,
    connectAllTo: 'Conectar todos a',
    connectTarget: 'Recurso ao qual conectar todos',
    pickResource: 'Escolha um recurso…',
    connectAll: 'Conectar todos',
    connected: (n, to, already) =>
      `${recursos(n)} conectado${n === 1 ? '' : 's'} a ${to}${
        already ? ` (${already} já ${already === 1 ? 'estava' : 'estavam'})` : ''
      }`,
    allConnected: (to) => `Todos já estão conectados a ${to}`,
    selected: 'Selecionados',
    selectOnly: 'Selecionar só este',
    deleted: (n, undo) => `${recursos(n)} excluído${n === 1 ? '' : 's'}. ${undo} para desfazer`,
    delete: (n) => `Excluir ${recursos(n)}`,
  },
);
