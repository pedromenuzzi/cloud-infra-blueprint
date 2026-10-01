/** The security panel's findings inside local modules (./ModuleFindings.tsx). */
import { defineMessages } from '@/i18n/messages';

export const moduleFindingsMessages = defineMessages(
  {
    title: 'Inside local modules',
    count: (n: number) => `${n} finding${n === 1 ? '' : 's'}`,
    open: (label: string) => `Open the module at ${label}`,
    fixInside: 'Open the module to fix it in its code, or change what the call gives it.',
  },
  {
    title: 'Dentro de módulos locais',
    count: (n) => `${n} ${n === 1 ? 'achado' : 'achados'}`,
    open: (label) => `Abrir o módulo em ${label}`,
    fixInside: 'Abra o módulo para corrigir no código dele, ou mude o que a chamada passa para ele.',
  },
);
