/**
 * A finding about a repeated resource (`count` / `for_each`) is about each
 * of its instances — said once, in the finding's own words.
 */
import { defineMessages } from '@/i18n/messages';

export const instanceMessages = defineMessages(
  {
    /** "web (each of its 3 instances)" */
    eachOf: (name: string, n: number | undefined) => `${name} (each of its ${n === undefined ? '' : `${n} `}instances)`,
    /** the inspector's exposure card */
    appliesToEach: (n: number | undefined) => `Applies to each of its ${n === undefined ? '' : `${n} `}instances.`,
  },
  {
    eachOf: (name: string, n: number | undefined) => `${name} (cada uma das ${n === undefined ? '' : `${n} `}instâncias)`,
    appliesToEach: (n: number | undefined) => `Vale para cada uma das ${n === undefined ? '' : `${n} `}instâncias.`,
  },
);
