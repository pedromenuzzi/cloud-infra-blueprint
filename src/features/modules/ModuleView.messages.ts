/** An opened child module over the canvas (./ModuleView.tsx). */
import { defineMessages } from '@/i18n/messages';

const s = (n: number) => (n === 1 ? '' : 's');

export const moduleViewMessages = defineMessages(
  {
    label: (name: string) => `Module ${name} (read-only)`,
    path: 'Module path',
    root: 'root',
    back: 'Back',
    backTo: (where: string) => `Back to ${where} (Esc)`,
    readOnly: 'Read-only',
    readOnlyHint: 'Edit the module’s files in the code pane.',
    counts: (resources: number, modules: number) =>
      `${resources} resource${s(resources)}${modules > 0 ? `, ${modules} module call${s(modules)}` : ''}`,
    openCode: 'Open its code',
    empty: 'No resources of its own.',
    gone: 'This module’s files aren’t in the project any more.',
    broken: 'The module’s code has errors — fix them in the code pane.',
    interface: 'Inputs and outputs',
    inputs: (n: number) => `Inputs (${n})`,
    outputs: (n: number) => `Outputs (${n})`,
    required: 'required',
    optional: 'optional',
    none: 'none',
    canvas: 'Module canvas',
  },
  {
    label: (name) => `Módulo ${name} (somente leitura)`,
    path: 'Caminho do módulo',
    root: 'raiz',
    back: 'Voltar',
    backTo: (where) => `Voltar para ${where} (Esc)`,
    readOnly: 'Somente leitura',
    readOnlyHint: 'Edite os arquivos do módulo no painel de código.',
    counts: (resources, modules) =>
      `${resources} recurso${s(resources)}${modules > 0 ? `, ${modules} chamada${s(modules)} de módulo` : ''}`,
    openCode: 'Abrir o código',
    empty: 'Nenhum recurso próprio.',
    gone: 'Os arquivos deste módulo não estão mais no projeto.',
    broken: 'O código do módulo tem erros — corrija-os no painel de código.',
    interface: 'Entradas e saídas',
    inputs: (n) => `Entradas (${n})`,
    outputs: (n) => `Outputs (${n})`,
    required: 'obrigatória',
    optional: 'opcional',
    none: 'nenhum',
    canvas: 'Canvas do módulo',
  },
);
