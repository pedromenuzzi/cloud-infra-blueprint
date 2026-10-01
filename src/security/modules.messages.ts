/** What the audit of local modules adds to a finding (./modules.ts). */
import { defineMessages } from '@/i18n/messages';

export const moduleAuditMessages = defineMessages(
  {
    fromInput: (name: string, value: string) =>
      `var.${name} comes from an input: the module call gives ${value}, not a literal, so what Terraform plans may differ.`,
  },
  {
    fromInput: (name, value) =>
      `var.${name} vem de uma entrada: a chamada de módulo passa ${value}, não um literal, então o que o Terraform planejar pode ser diferente.`,
  },
);
