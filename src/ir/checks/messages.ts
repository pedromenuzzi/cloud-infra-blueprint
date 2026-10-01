/**
 * Warnings of the in-browser checks, both languages side by side. Each one
 * follows the resource address (`aws_subnet.a: …`, added by ./index.ts), and
 * most are phrased to follow the quoted value: `name "My_Bucket" has
 * uppercase letters…` / `name "My_Bucket" tem letras maiúsculas…`.
 */
import { defineMessages } from '@/i18n/messages';
import type { CloudProvider, IpFamily } from '@/resources/cidr';

const FAMILY = { ipv4: 'IPv4', ipv6: 'IPv6' } as const;
const chars = (n: number) => `${n} caractere${n === 1 ? '' : 's'}`;

export const checkMessages = defineMessages(
  {
    /* ------------------------------------------------------------- shared */
    /** where a value came from: ` (from var.cidr)` */
    from: (via: string) => ` (from ${via})`,

    /* --------------------------------------------------------------- CIDR */
    /** AWS: a VPC or subnet range outside /16–/28 */
    awsSize: (field: string, text: string, tooLarge: boolean, role: 'network' | 'subnet') =>
      `${field} ${text} is too ${tooLarge ? 'large' : 'small'} for a ${role === 'subnet' ? 'subnet' : 'VPC'} (AWS allows /16 to /28)`,
    azureSubnetTooSmall: (field: string, text: string) => `${field} ${text} is too small (Azure subnets must be /29 or larger)`,
    azureIpv6Size: (field: string, text: string) => `${field} ${text} can't be used (Azure IPv6 subnets must be exactly /64)`,
    gcpSubnetTooSmall: (field: string, text: string) => `${field} ${text} is too small (GCP subnet ranges must be /29 or larger)`,
    /** `quoted`: `cidr_block "10.0.1/24" (from var.x)` */
    invalidCidr: (quoted: string, example: string) => `${quoted} isn't a valid CIDR range (expected something like ${example})`,
    wrongFamily: (quoted: string, family: IpFamily, fix: string) => `${quoted} is an ${FAMILY[family]} range, ${fix}`,
    putItIn: (field: string) => `so put it in ${field}`,
    takesFamily: (field: string, family: IpFamily) => `but ${field} takes ${FAMILY[family]} ranges`,
    hostBits: (quoted: string, cidr: string) => `${quoted} has host bits set: the range it describes is ${cidr}, so write that instead`,
    noFamilyRange: (field: string, text: string, family: IpFamily, network: string) =>
      `${field} ${text} is ${FAMILY[family]}, but ${network} has no ${FAMILY[family]} range`,
    outsideNetwork: (field: string, text: string, partly: boolean, network: string, ranges: string[]) =>
      `${field} ${text} is ${partly ? 'not fully inside' : 'outside'} ${network}'s ${
        ranges.length === 1 ? `range (${ranges[0]})` : `ranges (${ranges.join(', ')})`
      }`,
    /** two ranges of one subnet */
    overlapsOwn: (field: string, text: string, first: string) => `${field} ${text} overlaps ${first}`,
    overlapsSibling: (field: string, text: string, other: string, otherText: string, provider: CloudProvider) =>
      `${field} ${text} overlaps ${other} (${otherText}), but ${
        provider === 'gcp' ? 'subnetworks of one network' : `subnets in one ${provider === 'azure' ? 'VNet' : 'VPC'}`
      } need ranges of their own`,
    peeringOverlap: (provider: CloudProvider, a: string, aRange: string, b: string, bRange: string) =>
      `${a} (${aRange}) and ${b} (${bRange}) overlap. ${
        provider === 'aws'
          ? "AWS can't peer VPCs whose ranges overlap"
          : provider === 'azure'
            ? "Azure can't peer virtual networks whose address spaces overlap"
            : "GCP can't peer networks whose subnet ranges overlap"
      }`,
    /** two networks of one project that aren't peered */
    networksOverlap: (range: string, other: string, otherRange: string, provider: CloudProvider) =>
      `${range} overlaps ${other} (${otherRange}). That's fine while the two ${provider === 'azure' ? 'VNet' : provider === 'gcp' ? 'network' : 'VPC'}s stay apart, but they could never be peered`,

    /* -------------------------------------------------------------- names */
    /** `problem` follows `name "…"` */
    nameProblem: (arg: string, value: string, problem: string) => `${arg} "${value}" ${problem}`,
    tooLong: (length: number, resource: string, max: number) => `is ${length} characters, but ${resource} names can be at most ${max}`,
    tooShort: (length: number, resource: string, min: number) =>
      `is ${length} character${length === 1 ? '' : 's'}, but ${resource} names need at least ${min}`,
    notValid: (resource: string, allowed: string) => `isn't a valid ${resource} name: ${allowed}`,
    allowed: {
      rfc1035: 'use lowercase letters, digits and hyphens, starting with a letter and not ending with a hyphen',
      azureNetwork:
        'use letters, digits, underscores, dots and hyphens, starting with a letter or digit and ending with a letter, digit or underscore',
      alnumHyphen: 'use letters, digits and hyphens, starting and ending with a letter or digit',
      lowerHyphen: 'use lowercase letters, digits and hyphens, not starting or ending with a hyphen',
      wordHyphen: 'use letters, digits, hyphens and underscores',
      iam: 'use letters, digits and + = , . @ _ -',
      lowerIdentifier: 'use lowercase letters, digits and hyphens, starting with a letter',
      fifo: 'use letters, digits, hyphens and underscores (FIFO names end in .fifo)',
      dynamodb: 'use letters, digits, underscores, hyphens and dots',
      dbSubnetGroup: 'use lowercase letters, digits, spaces, dots, underscores and hyphens',
      ecr: 'use lowercase letters and digits, separated by single dots, hyphens, underscores or slashes',
      eks: 'use letters, digits, hyphens and underscores, starting with a letter or digit',
      secretsManager: 'use letters, digits and / _ + = . @ -',
      resourceGroup: 'use letters, digits, underscores, hyphens, dots and parentheses, not ending with a dot',
      storageAccount: 'use lowercase letters and digits only',
      lettersDigits: 'use letters and digits only',
      aks: 'use letters, digits, underscores and hyphens, starting and ending with a letter or digit',
      keyVault: 'use letters, digits and hyphens, starting with a letter and ending with a letter or digit',
      servicePlan: 'use letters, digits and hyphens',
      gcs: 'use lowercase letters, digits, hyphens, underscores and dots, starting and ending with a letter or digit',
      pubsub: 'start with a letter, then use letters, digits and - _ . ~ + %',
      bigquery: 'use letters, digits and underscores',
    },
    doubleHyphen: "can't contain two hyphens in a row",
    endsWithHyphen: "can't end with a hyphen",
    lbInternalPrefix: 'can\'t start with "internal-" (AWS reserves it)',
    sgPrefix: 'can\'t start with "sg-" (AWS reserves it for group IDs)',
    defaultDbSubnetGroup: 'is reserved: AWS already has a "default" DB subnet group',
    googPrefix: 'can\'t start with "goog"',
    s3: {
      length: (n: number) => `is ${n} characters, but S3 bucket names must be 3 to 63`,
      uppercase: 'has uppercase letters, but S3 bucket names must be lowercase',
      underscore: "has an underscore, but S3 bucket names can't contain underscores (use hyphens)",
      characters: 'has characters S3 refuses: use lowercase letters, digits, dots and hyphens',
      edges: 'must start and end with a letter or digit',
      doubleDot: "can't contain two dots in a row",
      ipLike: "looks like an IP address, which S3 doesn't allow",
      prefix: 'starts with a prefix S3 reserves (xn--, sthree-)',
      suffix: 'ends with a suffix S3 reserves (-s3alias, --ol-s3)',
    },
    gcs: {
      tooShort: (n: number) => `is ${n} characters, but Cloud Storage bucket names need at least 3`,
      tooLongNoDots: (n: number) => `is ${n} characters, but Cloud Storage bucket names can be at most 63 (222 with dots)`,
      tooLong: 'is too long: at most 222 characters, and 63 between dots',
      ipLike: "looks like an IP address, which Cloud Storage doesn't allow",
      google: 'can\'t start with "goog" or contain "google"',
    },

    /* ------------------------------------------------------------ regions */
    /** `alias`: a `provider = aws.west` reference; else the default configuration */
    provider: (alias: string | undefined, fallback: string) => `the ${alias ?? fallback} provider`,
    awsZoneRegion: (zone: string, zoneVia: string, zoneRegion: string, provider: string, region: string, regionVia: string) =>
      `availability_zone "${zone}"${zoneVia} is in ${zoneRegion}, but ${provider} deploys to ${region}${regionVia}`,
    gcpZoneIsRegion: (location: string, via: string) =>
      `zone "${location}"${via} is a region, but instances need a zone such as ${location}-a`,
    gcpRegionMismatch: (
      field: string,
      location: string,
      via: string,
      region: string,
      subnetwork: string,
      subnetRegion: string,
      subnetVia: string,
      kind: 'instance' | 'cluster',
    ) =>
      `${field} "${location}"${via} is in ${region}, ` +
      `but ${subnetwork} is in ${subnetRegion}${subnetVia}. ${kind === 'instance' ? 'An instance' : 'A cluster'} must be in its subnetwork's region`,

    /* ------------------------------------------------------------- wiring */
    alreadyUsed: (arg: string, name: string, first: string, scope: string, why: string) =>
      `${arg} "${name}" is already used by ${first}${scope ? ` ${scope}` : ''} (${why})`,
    sameVpc: 'in the same VPC',
    sameVnet: 'in the same VNet',
    unique: {
      s3Bucket: 'S3 bucket names are global across all AWS accounts',
      securityGroup: 'AWS needs security group names to be unique per VPC',
      iamRole: 'IAM role names are unique per account',
      loadBalancer: 'load balancer names are unique per region',
      targetGroup: 'target group names are unique per region',
      lambda: 'function names are unique per region',
      dynamodb: 'table names are unique per region',
      storageAccount: 'storage account names are global across Azure',
      azureSubnet: 'subnet names are unique per VNet',
      gcsBucket: 'Cloud Storage bucket names are global',
      gcpNetwork: 'network names are unique per project',
      gcpFirewall: 'firewall rule names are unique per project',
    },
    instanceCrossVpc: (group: string, groupVpc: string, subnet: string, vpc: string) =>
      `${group} belongs to ${groupVpc}, but ${subnet} is in ${vpc}. An instance can only use security groups of its own VPC`,
    routeTableCrossVpc: (table: string, tableVpc: string, subnet: string, vpc: string) =>
      `${table} belongs to ${tableVpc}, but ${subnet} is in ${vpc}. A subnet can only use a route table of its own VPC`,
    lbCrossVpc: (vpcs: string[]) => `subnets come from ${vpcs.join(' and ')}, but a load balancer's subnets must all be in one VPC`,
  },
  {
    from: (via) => ` (de ${via})`,

    awsSize: (field, text, tooLarge, role) =>
      `${field} ${text} é ${tooLarge ? 'grande' : 'pequeno'} demais para uma ${role === 'subnet' ? 'sub-rede' : 'VPC'} (a AWS aceita de /16 a /28)`,
    azureSubnetTooSmall: (field, text) => `${field} ${text} é pequeno demais (sub-redes do Azure precisam ser /29 ou maiores)`,
    azureIpv6Size: (field, text) => `${field} ${text} não pode ser usado (sub-redes IPv6 do Azure precisam ser exatamente /64)`,
    gcpSubnetTooSmall: (field, text) =>
      `${field} ${text} é pequeno demais (intervalos de sub-rede do GCP precisam ser /29 ou maiores)`,
    invalidCidr: (quoted, example) => `${quoted} não é um intervalo CIDR válido (esperado algo como ${example})`,
    wrongFamily: (quoted, family, fix) => `${quoted} é um intervalo ${FAMILY[family]}, ${fix}`,
    putItIn: (field) => `então coloque-o em ${field}`,
    takesFamily: (field, family) => `mas ${field} aceita intervalos ${FAMILY[family]}`,
    hostBits: (quoted, cidr) => `${quoted} tem bits de host definidos: o intervalo descrito é ${cidr}, então use esse valor`,
    noFamilyRange: (field, text, family, network) =>
      `${field} ${text} é ${FAMILY[family]}, mas ${network} não tem intervalo ${FAMILY[family]}`,
    outsideNetwork: (field, text, partly, network, ranges) =>
      `${field} ${text} está ${partly ? 'parcialmente fora' : 'fora'} ${
        ranges.length === 1 ? `do intervalo de ${network} (${ranges[0]})` : `dos intervalos de ${network} (${ranges.join(', ')})`
      }`,
    overlapsOwn: (field, text, first) => `${field} ${text} se sobrepõe a ${first}`,
    overlapsSibling: (field, text, other, otherText, provider) =>
      `${field} ${text} se sobrepõe a ${other} (${otherText}), mas sub-redes de uma mesma ${
        provider === 'gcp' ? 'rede' : provider === 'azure' ? 'VNet' : 'VPC'
      } precisam de intervalos próprios`,
    peeringOverlap: (provider, a, aRange, b, bRange) =>
      `${a} (${aRange}) e ${b} (${bRange}) se sobrepõem. ${
        provider === 'aws'
          ? 'A AWS não faz peering entre VPCs com intervalos sobrepostos'
          : provider === 'azure'
            ? 'O Azure não faz peering entre redes virtuais com espaços de endereço sobrepostos'
            : 'O GCP não faz peering entre redes com intervalos de sub-rede sobrepostos'
      }`,
    networksOverlap: (range, other, otherRange, provider) =>
      `${range} se sobrepõe a ${other} (${otherRange}). Tudo bem enquanto as duas ${
        provider === 'azure' ? 'VNets' : provider === 'gcp' ? 'redes' : 'VPCs'
      } ficarem separadas, mas nunca será possível fazer peering entre elas`,

    nameProblem: (arg, value, problem) => `${arg} "${value}" ${problem}`,
    tooLong: (length, resource, max) => `tem ${chars(length)}, mas nomes de ${resource} podem ter no máximo ${max}`,
    tooShort: (length, resource, min) => `tem ${chars(length)}, mas nomes de ${resource} precisam de pelo menos ${min}`,
    notValid: (resource, allowed) => `não é um nome válido de ${resource}: ${allowed}`,
    allowed: {
      rfc1035: 'use letras minúsculas, dígitos e hifens, começando com uma letra e sem terminar em hífen',
      azureNetwork:
        'use letras, dígitos, sublinhados, pontos e hifens, começando com letra ou dígito e terminando com letra, dígito ou sublinhado',
      alnumHyphen: 'use letras, dígitos e hifens, começando e terminando com letra ou dígito',
      lowerHyphen: 'use letras minúsculas, dígitos e hifens, sem começar nem terminar com hífen',
      wordHyphen: 'use letras, dígitos, hifens e sublinhados',
      iam: 'use letras, dígitos e + = , . @ _ -',
      lowerIdentifier: 'use letras minúsculas, dígitos e hifens, começando com uma letra',
      fifo: 'use letras, dígitos, hifens e sublinhados (nomes FIFO terminam em .fifo)',
      dynamodb: 'use letras, dígitos, sublinhados, hifens e pontos',
      dbSubnetGroup: 'use letras minúsculas, dígitos, espaços, pontos, sublinhados e hifens',
      ecr: 'use letras minúsculas e dígitos, separados por um único ponto, hífen, sublinhado ou barra',
      eks: 'use letras, dígitos, hifens e sublinhados, começando com letra ou dígito',
      secretsManager: 'use letras, dígitos e / _ + = . @ -',
      resourceGroup: 'use letras, dígitos, sublinhados, hifens, pontos e parênteses, sem terminar com ponto',
      storageAccount: 'use apenas letras minúsculas e dígitos',
      lettersDigits: 'use apenas letras e dígitos',
      aks: 'use letras, dígitos, sublinhados e hifens, começando e terminando com letra ou dígito',
      keyVault: 'use letras, dígitos e hifens, começando com letra e terminando com letra ou dígito',
      servicePlan: 'use letras, dígitos e hifens',
      gcs: 'use letras minúsculas, dígitos, hifens, sublinhados e pontos, começando e terminando com letra ou dígito',
      pubsub: 'comece com uma letra e depois use letras, dígitos e - _ . ~ + %',
      bigquery: 'use letras, dígitos e sublinhados',
    },
    doubleHyphen: 'não pode ter dois hifens seguidos',
    endsWithHyphen: 'não pode terminar com hífen',
    lbInternalPrefix: 'não pode começar com "internal-" (a AWS reserva esse prefixo)',
    sgPrefix: 'não pode começar com "sg-" (a AWS reserva esse prefixo para IDs de grupo)',
    defaultDbSubnetGroup: 'é reservado: a AWS já tem um grupo de sub-redes do banco "default"',
    googPrefix: 'não pode começar com "goog"',
    s3: {
      length: (n) => `tem ${chars(n)}, mas nomes de bucket S3 precisam ter de 3 a 63`,
      uppercase: 'tem letras maiúsculas, mas nomes de bucket S3 precisam ser minúsculos',
      underscore: 'tem sublinhado, mas nomes de bucket S3 não aceitam sublinhados (use hifens)',
      characters: 'tem caracteres que o S3 recusa: use letras minúsculas, dígitos, pontos e hifens',
      edges: 'precisa começar e terminar com letra ou dígito',
      doubleDot: 'não pode ter dois pontos seguidos',
      ipLike: 'parece um endereço IP, o que o S3 não permite',
      prefix: 'começa com um prefixo reservado pelo S3 (xn--, sthree-)',
      suffix: 'termina com um sufixo reservado pelo S3 (-s3alias, --ol-s3)',
    },
    gcs: {
      tooShort: (n) => `tem ${chars(n)}, mas nomes de bucket do Cloud Storage precisam de pelo menos 3`,
      tooLongNoDots: (n) => `tem ${chars(n)}, mas nomes de bucket do Cloud Storage podem ter no máximo 63 (222 com pontos)`,
      tooLong: 'é longo demais: no máximo 222 caracteres, e 63 entre pontos',
      ipLike: 'parece um endereço IP, o que o Cloud Storage não permite',
      google: 'não pode começar com "goog" nem conter "google"',
    },

    provider: (alias, fallback) => `o provider ${alias ?? fallback}`,
    awsZoneRegion: (zone, zoneVia, zoneRegion, provider, region, regionVia) =>
      `availability_zone "${zone}"${zoneVia} fica em ${zoneRegion}, mas ${provider} implanta em ${region}${regionVia}`,
    gcpZoneIsRegion: (location, via) => `zone "${location}"${via} é uma região, mas instâncias precisam de uma zona, como ${location}-a`,
    gcpRegionMismatch: (field, location, via, region, subnetwork, subnetRegion, subnetVia, kind) =>
      `${field} "${location}"${via} fica em ${region}, ` +
      `mas ${subnetwork} fica em ${subnetRegion}${subnetVia}. ${kind === 'instance' ? 'Uma instância' : 'Um cluster'} precisa estar na região da sua sub-rede`,

    alreadyUsed: (arg, name, first, scope, why) => `${arg} "${name}" já é usado por ${first}${scope ? ` ${scope}` : ''} (${why})`,
    sameVpc: 'na mesma VPC',
    sameVnet: 'na mesma VNet',
    unique: {
      s3Bucket: 'nomes de bucket S3 são globais, entre todas as contas da AWS',
      securityGroup: 'a AWS exige nomes de grupo de segurança únicos por VPC',
      iamRole: 'nomes de perfil do IAM são únicos por conta',
      loadBalancer: 'nomes de balanceador de carga são únicos por região',
      targetGroup: 'nomes de grupo de destino são únicos por região',
      lambda: 'nomes de função são únicos por região',
      dynamodb: 'nomes de tabela são únicos por região',
      storageAccount: 'nomes de conta de armazenamento são globais em todo o Azure',
      azureSubnet: 'nomes de sub-rede são únicos por VNet',
      gcsBucket: 'nomes de bucket do Cloud Storage são globais',
      gcpNetwork: 'nomes de rede são únicos por projeto',
      gcpFirewall: 'nomes de regra de firewall são únicos por projeto',
    },
    instanceCrossVpc: (group, groupVpc, subnet, vpc) =>
      `${group} pertence a ${groupVpc}, mas ${subnet} está em ${vpc}. Uma instância só pode usar grupos de segurança da própria VPC`,
    routeTableCrossVpc: (table, tableVpc, subnet, vpc) =>
      `${table} pertence a ${tableVpc}, mas ${subnet} está em ${vpc}. Uma sub-rede só pode usar uma tabela de rotas da própria VPC`,
    lbCrossVpc: (vpcs) =>
      `as sub-redes vêm de ${vpcs.join(' e ')}, mas as sub-redes de um balanceador de carga precisam estar todas na mesma VPC`,
  },
);

export type CheckText = (typeof checkMessages)['en'];
