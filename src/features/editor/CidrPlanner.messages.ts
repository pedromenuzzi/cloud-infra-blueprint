/**
 * The inspector's address plan card (./CidrPlanner.tsx) and the planner's
 * errors (./cidrPlan.ts). Numbers arrive formatted for the language.
 * Sentences around a code element come as `{ before, after }`.
 */
import { defineMessages } from '@/i18n/messages';
import type { CloudProvider } from '@/resources/cidr';

const CLOUD = { aws: 'AWS', azure: 'Azure', gcp: 'GCP' } as const;
/** "a AWS", "o Azure", "o GCP" */
const ARTICLE = { aws: 'a', azure: 'o', gcp: 'o' } as const;
const withArticle = (p: CloudProvider, capital = false) => {
  const a = ARTICLE[p];
  return `${capital ? a.toUpperCase() : a} ${CLOUD[p]}`;
};

export const cidrPlannerMessages = defineMessages(
  {
    title: 'Address plan',
    gcpNetwork: 'GCP networks have no range of their own: each subnetwork brings one, and they must not overlap.',
    /** after `<field> "<text>"` */
    invalidRange: " isn't a valid CIDR range. Fix it to plan subnets.",
    /** `what`: VPC / VNet */
    noRange: (what: string) => `This ${what} has no IPv4 range set, so there's nothing to divide yet.`,
    /** around the expression */
    expressionRange: (what: string) => ({
      before: `The ${what} range is an expression (`,
      after: '). Planning needs a literal CIDR, or a variable with a default.',
    }),
    addresses: (n: string) => `${n} addresses`,
    fromDefault: (via: string) => `from the default of ${via}`,
    andIpv6: 'and IPv6 ',
    barLabel: (cidr: string, allocated: string, total: string, used: string) =>
      `${cidr}: ${allocated} of ${total} addresses allocated to subnets (${used})`,
    allocated: ' allocated · ',
    free: ' free',
    noSubnets: (gcp: boolean) => `No ${gcp ? 'subnetworks' : 'subnets'} yet.`,
    subnetCount: (n: number, gcp: boolean) => `${n} ${gcp ? 'subnetwork' : 'subnet'}${n === 1 ? '' : 's'}`,
    subnetList: (gcp: boolean): string => (gcp ? 'subnetworks' : 'subnets'),
    select: (id: string) => `Select ${id}`,
    unknownRanges: (n: number) =>
      `${n === 1 ? "One subnet's range is" : `${n} subnets' ranges are`} an expression. New ranges can't account for ${n === 1 ? 'it' : 'them'}.`,
    added: (id: string, cidr: string, zone?: string) => `Added ${id} · ${cidr}${zone ? ` in ${zone}` : ''}`,
    addedAcross: (n: number, zones: string) => `Added ${n} subnets across ${zones}`,
    setRegion: "Set the AWS provider's region to split across its availability zones.",
    noRoomSplit: (count: number, prefix: number) => `No room for ${count} × /${prefix}. Pick a smaller size.`,
    splitPlan: (count: number, prefix: number, zones: string) => `${count} × /${prefix} in ${zones}`,
    subnetSize: 'Subnet size',
    /** the size picker's accessible name */
    subnetSizeLabel: 'Subnet size',
    noRoom: ' (no room)',
    addSubnet: 'Add subnet',
    usablePerSubnet: (usable: string, provider: CloudProvider, reserved: number) =>
      `${usable} usable per subnet: ${CLOUD[provider]} keeps ${reserved} addresses in each.`,
    full: (id: string) => `${id} is full: there's no free block left for a new subnet.`,
    splitLabel: (count: number) => `Split into ${count} subnets across availability zones`,
    splitAcross: 'Split across',
    zonesLabel: 'Availability zones to split across',
    zones: (n: number) => `${n} AZs`,
    statAddresses: 'addresses',
    statUsable: 'usable',
    /** share of the parent network */
    statOf: (network: string) => `of ${network}`,
    statPrefix: 'prefix',
    usable: 'Usable ',
    keepsEvery: (provider: CloudProvider, reserved: number) => `${CLOUD[provider]} keeps ${reserved} addresses in every subnet.`,
    tooSmall: (provider: CloudProvider, reserved: number) =>
      `Too small: ${CLOUD[provider]} keeps ${reserved} addresses in every subnet.`,
    subnetExpression: {
      before: 'The range is an expression (',
      after: "). Numbers appear once it's a literal CIDR, or a variable with a default.",
    },
    notIpv4: (text: string) => `"${text}" isn't a valid IPv4 range.`,
    noIpv4: 'No IPv4 range set yet.',
    secondary: 'Secondary',
    outside: (network: string) => `Outside ${network}'s range.`,
    inside: (cidr: string, network: string, range: string) => `${cidr} inside ${network} (${range})`,
    inNetwork: (network: string, ranges: string) => `in ${network}${ranges ? ` (${ranges})` : ''}`,
    /** a subnet row whose range isn't set */
    noRangeRow: 'no range',

    /* errors from ./cidrPlan.ts */
    notLiteral: "This network's range isn't a literal CIDR the planner can divide",
    noRoomFor: (count: number, prefix: number, network: string) =>
      `There's no room left for ${count === 1 ? `a /${prefix}` : `${count} /${prefix} subnets`} in ${network}`,
    unknownNetwork: (id: string) => `${id} isn't a network the planner knows`,
    awsOnly: 'Splitting across availability zones is for AWS VPCs',
    needsRegion: "Set the AWS provider's region to spread subnets across its zones",
  },
  {
    title: 'Plano de endereços',
    gcpNetwork: 'Redes do GCP não têm intervalo próprio: cada sub-rede traz o seu, e eles não podem se sobrepor.',
    invalidRange: ' não é um intervalo CIDR válido. Corrija-o para planejar sub-redes.',
    noRange: (what) => `Esta ${what} não tem intervalo IPv4 definido, então ainda não há o que dividir.`,
    expressionRange: (what) => ({
      before: `O intervalo da ${what} é uma expressão (`,
      after: '). O planejamento precisa de um CIDR literal ou de uma variável com valor padrão.',
    }),
    addresses: (n) => `${n} endereços`,
    fromDefault: (via) => `do valor padrão de ${via}`,
    andIpv6: 'e IPv6 ',
    barLabel: (cidr, allocated, total, used) => `${cidr}: ${allocated} de ${total} endereços alocados a sub-redes (${used})`,
    allocated: ' alocados · ',
    free: ' livres',
    noSubnets: () => 'Nenhuma sub-rede ainda.',
    subnetCount: (n) => `${n} ${n === 1 ? 'sub-rede' : 'sub-redes'}`,
    subnetList: () => 'sub-redes',
    select: (id) => `Selecionar ${id}`,
    unknownRanges: (n) =>
      n === 1
        ? 'O intervalo de uma sub-rede é uma expressão. Os novos intervalos não conseguem levá-lo em conta.'
        : `Os intervalos de ${n} sub-redes são expressões. Os novos intervalos não conseguem levá-los em conta.`,
    added: (id, cidr, zone) => `${id} · ${cidr} adicionada${zone ? ` em ${zone}` : ''}`,
    addedAcross: (n, zones) => `${n} sub-redes adicionadas em ${zones}`,
    setRegion: 'Defina a região do provider AWS para dividir entre as zonas de disponibilidade dela.',
    noRoomSplit: (count, prefix) => `Não há espaço para ${count} × /${prefix}. Escolha um tamanho menor.`,
    splitPlan: (count, prefix, zones) => `${count} × /${prefix} em ${zones}`,
    subnetSize: 'Tamanho',
    subnetSizeLabel: 'Tamanho da sub-rede',
    noRoom: ' (sem espaço)',
    addSubnet: 'Nova sub-rede',
    usablePerSubnet: (usable, provider, reserved) =>
      `${usable} utilizáveis por sub-rede: ${withArticle(provider)} reserva ${reserved} endereços em cada uma.`,
    full: (id) => `${id} está cheia: não sobrou bloco livre para uma nova sub-rede.`,
    splitLabel: (count) => `Dividir em ${count} sub-redes entre zonas de disponibilidade`,
    splitAcross: 'Dividir entre',
    zonesLabel: 'Zonas de disponibilidade para dividir',
    zones: (n) => `${n} AZs`,
    statAddresses: 'endereços',
    statUsable: 'utilizáveis',
    statOf: (network) => `da ${network}`,
    statPrefix: 'prefixo',
    usable: 'Utilizáveis: ',
    keepsEvery: (provider, reserved) => `${withArticle(provider, true)} reserva ${reserved} endereços em toda sub-rede.`,
    tooSmall: (provider, reserved) => `Pequena demais: ${withArticle(provider)} reserva ${reserved} endereços em toda sub-rede.`,
    subnetExpression: {
      before: 'O intervalo é uma expressão (',
      after: '). Os números aparecem quando ele for um CIDR literal ou uma variável com valor padrão.',
    },
    notIpv4: (text) => `"${text}" não é um intervalo IPv4 válido.`,
    noIpv4: 'Nenhum intervalo IPv4 definido ainda.',
    secondary: 'Secundário',
    outside: (network) => `Fora do intervalo de ${network}.`,
    inside: (cidr, network, range) => `${cidr} dentro de ${network} (${range})`,
    inNetwork: (network, ranges) => `em ${network}${ranges ? ` (${ranges})` : ''}`,
    noRangeRow: 'sem intervalo',

    notLiteral: 'O intervalo desta rede não é um CIDR literal que o planejador consiga dividir',
    noRoomFor: (count, prefix, network) =>
      `Não há mais espaço para ${count === 1 ? `uma /${prefix}` : `${count} sub-redes /${prefix}`} em ${network}`,
    unknownNetwork: (id) => `${id} não é uma rede que o planejador conheça`,
    awsOnly: 'Dividir entre zonas de disponibilidade só vale para VPCs da AWS',
    needsRegion: 'Defina a região do provider AWS para espalhar as sub-redes entre as zonas dela',
  },
);
