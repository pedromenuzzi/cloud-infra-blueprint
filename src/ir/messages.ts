/** Validation warnings from ./validate.ts (the checks in ./checks have their own). */
import { defineMessages } from '@/i18n/messages';

export const validateMessages = defineMessages(
  {
    requiredMissing: (id: string, field: string) => `${id}: required argument "${field}" is missing`,
    unknownReference: (id: string, field: string, address: string) => `${id}: "${field}" references unknown resource ${address}`,
    crossCloud: (id: string, address: string, from: string, to: string) =>
      `${id}: cross-cloud reference to ${address} (${from} → ${to})`,
  },
  {
    requiredMissing: (id, field) => `${id}: o argumento obrigatório "${field}" está faltando`,
    unknownReference: (id, field, address) => `${id}: "${field}" referencia o recurso desconhecido ${address}`,
    crossCloud: (id, address, from, to) => `${id}: referência entre nuvens para ${address} (${from} → ${to})`,
  },
);
