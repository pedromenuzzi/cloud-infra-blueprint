/**
 * Words of the security model (model.ts): rule services, peers, port labels
 * and why some rules can't be read. Port labels ("all", "all TCP"…) stay
 * English in the data — they are keys — and are turned into words here.
 */
import { defineMessages } from '@/i18n/messages';

/** "a, b and c"; past three: "a, b, c and 2 more" */
function joinWith(names: string[], and: string, more: (n: number) => string): string {
  const shown = names.length > 3 ? [...names.slice(0, 3), more(names.length - 3)] : names;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} ${and} ${shown[shown.length - 1]}`;
}

export const modelMessages = defineMessages(
  {
    join: (names: string[]) => joinWith(names, 'and', (n) => `${n} more`),
    protocolExpr: (expr: string) => `Protocol ${expr}`,
    allTraffic: 'All traffic',
    allOf: (proto: string) => `All ${proto}`,
    /** well-known services whose name is a description, not a product */
    httpAlt: 'HTTP alt',
    httpsAlt: 'HTTPS alt',
    app: 'App',
    internetDefault: 'Internet (default 0.0.0.0/0)',
    anySource: 'Any source (*)',
    itself: 'itself',
    /** a port label in a sentence or a chip: "all" → "all", "other ports" → "other ports" */
    ports: {
      all: 'all',
      allTcp: 'all TCP',
      allUdp: 'all UDP',
      otherProtocols: 'other protocols',
      otherPorts: 'other ports',
    },
    dynamicBlocks: (field: string) => `dynamic "${field}" blocks`,
  },
  {
    join: (names: string[]) => joinWith(names, 'e', (n) => `mais ${n}`),
    protocolExpr: (expr: string) => `Protocolo ${expr}`,
    allTraffic: 'Todo o tráfego',
    allOf: (proto: string) => `Todas as portas ${proto}`,
    httpAlt: 'HTTP alternativo',
    httpsAlt: 'HTTPS alternativo',
    app: 'App',
    internetDefault: 'Internet (padrão 0.0.0.0/0)',
    anySource: 'Qualquer origem (*)',
    itself: 'o próprio grupo',
    ports: {
      all: 'todas',
      allTcp: 'TCP (todas)',
      allUdp: 'UDP (todas)',
      otherProtocols: 'outros protocolos',
      otherPorts: 'outras portas',
    },
    dynamicBlocks: (field: string) => `blocos dynamic "${field}"`,
  },
);
