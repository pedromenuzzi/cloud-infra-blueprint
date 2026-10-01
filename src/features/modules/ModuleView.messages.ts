/** The opened module's bar on the canvas (./ModuleView.tsx). */
import { defineMessages } from '@/i18n/messages';

export const moduleViewMessages = defineMessages(
  {
    label: (name: string) => `Module ${name}`,
    path: 'Module path',
    root: 'root',
    back: 'Back',
    backTo: (where: string) => `Back to ${where} (Esc)`,
    readOnly: 'Read-only',
    readOnlyHint: 'A view link: make a copy to edit the module.',
    openCode: 'Code',
    interface: 'Inputs and outputs',
    interfaceCounts: (inputs: number, outputs: number) =>
      `${inputs} input${inputs === 1 ? '' : 's'}, ${outputs} output${outputs === 1 ? '' : 's'}`,
    inputs: (n: number) => `Inputs (${n})`,
    outputs: (n: number) => `Outputs (${n})`,
    required: 'required',
    optional: 'optional',
    noInputs: 'none',
    noOutputs: 'none',
  },
  {
    label: (name) => `Módulo ${name}`,
    path: 'Caminho do módulo',
    root: 'raiz',
    back: 'Voltar',
    backTo: (where) => `Voltar para ${where} (Esc)`,
    readOnly: 'Somente leitura',
    readOnlyHint: 'Um link de visualização: faça uma cópia para editar o módulo.',
    openCode: 'Código',
    interface: 'Entradas e outputs',
    interfaceCounts: (inputs, outputs) => `${inputs} entrada${inputs === 1 ? '' : 's'}, ${outputs} output${outputs === 1 ? '' : 's'}`,
    inputs: (n) => `Entradas (${n})`,
    outputs: (n) => `Outputs (${n})`,
    required: 'obrigatória',
    optional: 'opcional',
    noInputs: 'nenhuma',
    noOutputs: 'nenhum',
  },
);
