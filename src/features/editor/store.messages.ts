/** What the editor store says on its own: refused edits and the read-only view. */
import { defineMessages } from '@/i18n/messages';

export const storeMessages = defineMessages(
  {
    readOnlyHint: 'This is a read-only view. Make a copy to edit it',
    fixCodeFirst: 'Fix the errors in the code first: the canvas is read-only until it parses',
    cantApply: "That change couldn't be applied without breaking the code. Make it in the code pane",
    /** a project renamed to nothing */
    untitled: 'Untitled',
  },
  {
    readOnlyHint: 'Esta é uma visualização somente leitura. Faça uma cópia para editar',
    fixCodeFirst: 'Corrija primeiro os erros do código: o canvas fica somente leitura até lá',
    cantApply: 'Não foi possível aplicar essa alteração sem quebrar o código. Faça-a no painel de código',
    untitled: 'Sem nome',
  },
);
