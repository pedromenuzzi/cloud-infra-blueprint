/** Warnings about references and repetition (see instances.ts). */
import { defineMessages } from '@/i18n/messages';

export const instanceCheckMessages = defineMessages(
  {
    missingKey: (field: string, path: string, address: string, kind: string, one: string, all: string) =>
      `${field} reads ${path}, but ${address} has ${kind} set — use one instance (${one}) or all of them (${all})`,
    unexpectedKey: (field: string, path: string, address: string, fixed: string) =>
      `${field} reads ${path}, but ${address} has no count or for_each — drop the instance key (${fixed})`,
  },
  {
    missingKey: (field: string, path: string, address: string, kind: string, one: string, all: string) =>
      `${field} lê ${path}, mas ${address} tem ${kind} — use uma instância (${one}) ou todas (${all})`,
    unexpectedKey: (field: string, path: string, address: string, fixed: string) =>
      `${field} lê ${path}, mas ${address} não tem count nem for_each — tire a chave da instância (${fixed})`,
  },
);
