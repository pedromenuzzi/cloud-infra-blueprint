/**
 * UI text of the resource catalog that isn't per-resource data: category
 * labels, the canvas node subtitles the defs compute, and the field-bounds
 * warning. Per-resource names, descriptions and field help are in
 * ./catalog.messages.ts.
 */
import { defineMessages } from '@/i18n/messages';
import type { Category } from './types';

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const resourceMessages = defineMessages(
  {
    categories: {
      compute: 'Compute',
      storage: 'Storage',
      network: 'Network',
      database: 'Database',
      containers: 'Containers',
      integration: 'Messaging & APIs',
      identity: 'Security & Identity',
      edge: 'Edge & DNS',
    } satisfies Record<Category, string>,

    /** a number literal outside a field's min / max (fieldRules.ts) */
    outOfBounds: (id: string, field: string, value: number, range: string) => `${id}: "${field}" is ${value} but must be ${range}`,
    between: (min: number, max: number) => `between ${min} and ${max}`,
    atLeast: (min: number) => `at least ${min}`,
    atMost: (max: number) => `at most ${max}`,

    /* canvas node subtitles */
    noInlineRules: 'no inline rules',
    inboundOutbound: (inbound: number, outbound: number) => `${inbound} inbound · ${outbound} outbound`,
    iamRole: 'IAM role',
    loadBalancer: 'load balancer',
    containerRegistry: 'container registry',
    cpuUnits: (cpu: string) => `${cpu} CPU units`,
    internetAccess: 'internet access',
    staticIp: 'static IP',
    inlinePolicy: 'inline policy',
    fifoQueue: 'FIFO queue',
    queue: 'queue',
    topic: 'topic',
    provisioned: 'provisioned',
    onDemand: 'on-demand',
    encryptionKey: 'encryption key',
    secret: 'secret',
    workerNodes: 'worker nodes',
    /** `tcp :443 in` */
    ingressRule: (protocol: string, port?: string | number | boolean | null) =>
      `${protocol}${port !== undefined ? ` :${port}` : ''} in`,
    /** `all out` / `tcp out` */
    egressRule: (protocol: string | undefined) => `${protocol ?? 'all'} out`,
    /** always "rules": `1 rules` reads as a count */
    ruleCount: (n: number) => `${n} rules`,
    ruleCountPlural: (n: number) => `${n} rule${s(n, '', 's')}`,
    routeCount: (n: number) => `${n} route${s(n, '', 's')}`,
    localOnly: 'local only',
    subnetRoutes: 'subnet ↔ routes',
    neverPublic: 'never public',
    subnetCount: (n: number) => `${n} subnet${s(n, '', 's')}`,
    networkInterface: 'network interface',
    staticWebsite: 'static website',
    cdnEndpoint: 'CDN endpoint',
    /** Azure public IP: `Static IP` (the value of allocation_method) */
    publicIp: (allocation: string) => `${allocation} IP`,
    webApp: 'web app',
    functions: 'functions',
    secrets: 'secrets',
    subnetNsg: 'subnet ↔ NSG',
    vpcNetwork: 'VPC network',
    /** GCP firewall direction */
    inbound: 'in',
    outbound: 'out',
    cdnBackend: 'CDN backend',
    httpRouting: 'HTTP routing',
    lbFrontend: 'LB frontend',
    router: 'router',
    egressNat: 'egress NAT',
    registry: 'registry',
    subscription: 'subscription',
    serviceAccount: 'service account',
  },
  {
    categories: {
      compute: 'Computação',
      storage: 'Armazenamento',
      network: 'Rede',
      database: 'Banco de dados',
      containers: 'Contêineres',
      integration: 'Mensageria e APIs',
      identity: 'Segurança e identidade',
      edge: 'Borda e DNS',
    },

    outOfBounds: (id, field, value, range) => `${id}: "${field}" é ${value}, mas precisa ser ${range}`,
    between: (min, max) => `entre ${min} e ${max}`,
    atLeast: (min) => `pelo menos ${min}`,
    atMost: (max) => `no máximo ${max}`,

    noInlineRules: 'sem regras inline',
    inboundOutbound: (inbound, outbound) => `${inbound} de entrada · ${outbound} de saída`,
    iamRole: 'perfil do IAM',
    loadBalancer: 'balanceador de carga',
    containerRegistry: 'registro de contêineres',
    cpuUnits: (cpu) => `${cpu} unidades de CPU`,
    internetAccess: 'acesso à internet',
    staticIp: 'IP estático',
    inlinePolicy: 'política inline',
    fifoQueue: 'fila FIFO',
    queue: 'fila',
    topic: 'tópico',
    provisioned: 'provisionado',
    onDemand: 'sob demanda',
    encryptionKey: 'chave de criptografia',
    secret: 'segredo',
    workerNodes: 'nós de trabalho',
    ingressRule: (protocol, port) => `entrada ${protocol}${port !== undefined ? ` :${port}` : ''}`,
    egressRule: (protocol) => (protocol === undefined ? 'toda a saída' : `saída ${protocol}`),
    ruleCount: (n) => `${n} ${s(n, 'regra', 'regras')}`,
    ruleCountPlural: (n) => `${n} ${s(n, 'regra', 'regras')}`,
    routeCount: (n) => `${n} ${s(n, 'rota', 'rotas')}`,
    localOnly: 'só local',
    subnetRoutes: 'sub-rede ↔ rotas',
    neverPublic: 'nunca público',
    subnetCount: (n) => `${n} ${s(n, 'sub-rede', 'sub-redes')}`,
    networkInterface: 'interface de rede',
    staticWebsite: 'site estático',
    cdnEndpoint: 'endpoint da CDN',
    publicIp: (allocation) =>
      allocation === 'Static' ? 'IP estático' : allocation === 'Dynamic' ? 'IP dinâmico' : `IP ${allocation}`,
    webApp: 'aplicativo web',
    functions: 'funções',
    secrets: 'segredos',
    subnetNsg: 'sub-rede ↔ NSG',
    vpcNetwork: 'rede VPC',
    inbound: 'entrada',
    outbound: 'saída',
    cdnBackend: 'back-end da CDN',
    httpRouting: 'roteamento HTTP',
    lbFrontend: 'front-end do LB',
    router: 'roteador',
    egressNat: 'NAT de saída',
    registry: 'registro',
    subscription: 'assinatura',
    serviceAccount: 'conta de serviço',
  },
);
