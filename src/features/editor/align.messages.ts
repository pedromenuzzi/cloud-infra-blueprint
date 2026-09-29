/** Align / distribute labels and why an action can't run (./alignActions.ts, ./align.ts). */
import { defineMessages } from '@/i18n/messages';

export const alignMessages = defineMessages(
  {
    left: 'Align left',
    center: 'Align centers',
    right: 'Align right',
    top: 'Align top',
    middle: 'Align middles',
    bottom: 'Align bottom',
    horizontal: 'Distribute horizontally',
    vertical: 'Distribute vertically',
    atLeast: (n: number) => `Select at least ${n} resources`,
    sameContainer: 'Select resources in the same container',
  },
  {
    left: 'Alinhar à esquerda',
    center: 'Centralizar na horizontal',
    right: 'Alinhar à direita',
    top: 'Alinhar ao topo',
    middle: 'Centralizar na vertical',
    bottom: 'Alinhar à base',
    horizontal: 'Distribuir na horizontal',
    vertical: 'Distribuir na vertical',
    atLeast: (n) => `Selecione pelo menos ${n} recursos`,
    sameContainer: 'Selecione recursos do mesmo contêiner',
  },
);

export type AlignText = (typeof alignMessages)['en'];
