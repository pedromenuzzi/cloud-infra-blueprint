/** Validation warnings about module calls (./moduleChecks.ts), in the UI language in effect when they run. */
import { defineMessages } from '@/i18n/messages';

export const moduleCheckMessages = defineMessages(
  {
    missingSource: (id: string) => `${id}: "source" is missing (Terraform can't find the module without it)`,
    missingInput: (id: string, input: string, dir: string) =>
      `${id}: required input "${input}" is missing (${dir} gives it no default)`,
    unknownInput: (id: string, input: string, dir: string) => `${id}: "${input}" isn't an input of ${dir} (no variable "${input}")`,
    unknownModule: (id: string, field: string, address: string) => `${id}: "${field}" references unknown module ${address}`,
    unknownOutput: (id: string, field: string, address: string, output: string) =>
      `${id}: "${field}" reads output "${output}", which ${address} doesn't have`,
  },
  {
    missingSource: (id) => `${id}: "source" está faltando (sem ele o Terraform não encontra o módulo)`,
    missingInput: (id, input, dir) => `${id}: a entrada obrigatória "${input}" está faltando (${dir} não tem valor padrão para ela)`,
    unknownInput: (id, input, dir) => `${id}: "${input}" não é uma entrada de ${dir} (não há variable "${input}")`,
    unknownModule: (id, field, address) => `${id}: "${field}" referencia o módulo desconhecido ${address}`,
    unknownOutput: (id, field, address, output) => `${id}: "${field}" lê o output "${output}", que ${address} não tem`,
  },
);
