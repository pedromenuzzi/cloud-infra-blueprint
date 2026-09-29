/**
 * The words of rule editing (edit.ts): one-click fix labels, why a rule
 * can't be added here, and the preset names shown in menus. A preset's
 * English name is also the description written into the code (AWS only
 * accepts ASCII there), so only the menus use these.
 */
import { defineMessages } from '@/i18n/messages';

export type PresetId = 'https' | 'http' | 'ssh' | 'rdp' | 'postgres' | 'mysql' | 'mssql' | 'redis' | 'mongodb' | 'app' | 'all-tcp' | 'icmp' | 'all';

export const editMessages = defineMessages(
  {
    restrictToVnet: 'Restrict to the virtual network',
    restrictTo: (ranges: string) => `Restrict to ${ranges}`,
    removeAccess: (v6: boolean) => `Remove ${v6 ? '::/0' : 'internet'} access`,
    removeRule: 'Remove the rule',
    writtenAs: (field: string, objects: boolean) =>
      `${field} is written as ${objects ? 'a list of objects' : 'an expression'} — add rules in code`,
    presets: {
      https: 'HTTPS',
      http: 'HTTP',
      ssh: 'SSH',
      rdp: 'RDP',
      postgres: 'PostgreSQL',
      mysql: 'MySQL / Aurora',
      mssql: 'SQL Server',
      redis: 'Redis',
      mongodb: 'MongoDB',
      app: 'App (8080)',
      'all-tcp': 'All TCP',
      icmp: 'ICMP (ping)',
      all: 'All traffic',
    } satisfies Record<PresetId, string>,
  },
  {
    restrictToVnet: 'Restringir à rede virtual',
    restrictTo: (ranges: string) => `Restringir a ${ranges}`,
    removeAccess: (v6: boolean) => (v6 ? 'Remover o acesso de ::/0' : 'Remover o acesso pela internet'),
    removeRule: 'Remover a regra',
    writtenAs: (field: string, objects: boolean) =>
      `${field} está escrito como ${objects ? 'uma lista de objetos' : 'uma expressão'} — adicione regras no código`,
    presets: {
      https: 'HTTPS',
      http: 'HTTP',
      ssh: 'SSH',
      rdp: 'RDP',
      postgres: 'PostgreSQL',
      mysql: 'MySQL / Aurora',
      mssql: 'SQL Server',
      redis: 'Redis',
      mongodb: 'MongoDB',
      app: 'App (8080)',
      'all-tcp': 'Todas as portas TCP',
      icmp: 'ICMP (ping)',
      all: 'Todo o tráfego',
    },
  },
);
