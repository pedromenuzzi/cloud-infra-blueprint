/**
 * The words of the pricing rules (aws.ts, azure.ts, gcp.ts): line labels,
 * assumptions and notes. Rates arrive already written as money in the
 * language (RuleContext.rate); instance types, SKUs, argument names and
 * product names are passed in as they are.
 */
import { defineMessages } from '@/i18n/messages';
import { numPt as n } from '../messages';

const count = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
const countPt = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`;

/** "(2 in each of 3 zones)" */
const zonesEn = (perZone: number, zones: number) => (zones > 1 ? ` (${perZone} in each of ${zones} zones)` : '');
const zonesPt = (perZone: number, zones: number) => (zones > 1 ? ` (${perZone} em cada uma das ${zones} zonas)` : '');

export const serviceMessages = defineMessages(
  {
    gb: (gb: number, type: string) => `${gb} GB ${type}`,
    nodesGb: (nodes: number, gb: number, type: string) => `${nodes} × ${gb} GB ${type}`,
    priceChanges: (what: 'spot-instances' | 'fargate-spot' | 'spot-capacity' | 'spot-vms' | 'preemptible') =>
      `${
        {
          'spot-instances': 'Spot instances',
          'fargate-spot': 'Fargate Spot',
          'spot-capacity': 'Spot capacity',
          'spot-vms': 'Spot VMs',
          preemptible: 'Spot / preemptible VMs',
        }[what]
      }: the price changes with demand`,
    notIncludedType: (what: string, type: string) => `${what} ${type} isn't in the price table, so it isn't included`,

    aws: {
      fromLaunchTemplate: 'The instance type comes from its launch template',
      tenancy: (tenancy: string) => `${tenancy} tenancy isn't in the price table`,
      linuxShared: 'Linux, shared tenancy (a Windows or licensed AMI costs more)',
      rootVolumeType: 'Root volume type',
      rootVolumeDefault: (gb: number, type: string) => `Root volume: ${gb} GB ${type}, a typical AMI default (set root_block_device to change it)`,
      extraVolume: 'An extra EBS volume without a literal size or a listed type is not included',
      eipPriced: 'Its public IP is an Elastic IP, priced on the aws_eip',
      publicIpv4: 'Public IPv4',
      associatePublicIp: 'associate_public_ip_address gives it a public IPv4',
      subnetPublicIp: (subnet: string) => `Subnet ${subnet} gives it a public IPv4 (map_public_ip_on_launch)`,
      aurora: 'Aurora is billed per cluster instance and I/O (not in the price table)',
      auroraStandard: (storage: string, io: string) =>
        `Billed by use: ${storage} per GB-month of storage and ${io} per million I/O requests (Aurora Standard).`,
      auroraIoOptimized: (storage: string) => `Billed by use: ${storage} per GB-month of storage, I/O included (Aurora I/O-Optimized).`,
      auroraInstances: 'Its instances (aws_rds_cluster_instance) are billed per hour on their own',
      auroraServerless: 'Serverless capacity (ACUs) is billed per hour of use on top',
      deployment: (engine: string, multi: boolean) => `${engine}, ${multi ? 'Multi-AZ (a standby in a second zone)' : 'Single-AZ'}`,
      noStorage: "No literal allocated_storage, so storage isn't included",
      storageType: 'Storage type',
      storageDefault: (type: string) => `storage_type not set: ${type}, the AWS default`,
      iops: 'Provisioned IOPS are billed on top',
      backups: 'Backups beyond the free allowance and snapshots are extra',
      replicationGroup: 'Its nodes are billed through the replication group',
      cacheNodes: (nodes: number, engine: string) => `${count(nodes, 'node', 'nodes')}, ${engine}`,
      clusterEc2: "Runs on the cluster's EC2 instances: those are billed, not the service",
      noTaskDefinition: "The task definition isn't in this project, so its CPU and memory are unknown",
      taskNoCpu: (task: string) => `Task definition ${task} has no literal cpu and memory`,
      tasks: (tasks: number, vcpu: number, gb: number) => `${count(tasks, 'task', 'tasks')} (${vcpu} vCPU, ${gb} GB)`,
      fargateRate: (arm: boolean, vcpu: number, vcpuRate: string, gb: number, gbRate: string) =>
        `Fargate ${arm ? 'ARM' : 'Linux/x86'}: ${vcpu} vCPU × ${vcpuRate} + ${gb} GB × ${gbRate} per task-hour`,
      noDesiredCount: 'desired_count not set: Terraform starts 0 tasks',
      tasksAllMonth: (tasks: number) => `${count(tasks, 'task', 'tasks')} running all month (autoscaling changes this)`,
      desiredSize: "scaling_config.desired_size isn't a literal number",
      nodeGroupNodes: (nodes: number, defaultType: boolean) =>
        `${count(nodes, 'node', 'nodes')} (desired_size; autoscaling changes this)${defaultType ? ', t3.medium (the default instance type)' : ''}`,
      nodeGroupDisk: (gb: number) => `${gb} GB gp2 root disk per node (the EKS default)`,
      albLcu: (rate: string) => `Plus ${rate} per LCU-hour, by usage (connections, traffic, rule evaluations)`,
      nlbLcu: (rate: string) => `Plus ${rate} per NLCU-hour, by usage`,
      natGateway: 'NAT gateway',
      perGbProcessed: (rate: string) => `Plus ${rate} per GB processed`,
      eipBilled: 'Public IPv4 addresses are billed whether attached or not',
      hostedZone: 'Hosted zone',
      queries: (rate: string) => `Plus ${rate} per million standard queries`,
      kmsKey: 'Customer managed key',
      kmsRequests: (rate: string) => `Plus ${rate} per 10,000 requests`,
      secret: 'Secret',
      secretCalls: (rate: string) => `Plus ${rate} per 10,000 API calls`,
      eksControlPlane: 'EKS control plane',
      eksSupport: 'Standard Kubernetes version support (extended support costs more)',
      eksNodes: 'Worker nodes are priced on their node groups',
      ebsSize: "size isn't a literal number (a volume from a snapshot takes the snapshot's size)",
      ebsType: 'type not set: gp3',
      s3: (rate: string) => `Billed by use: ${rate} per GB-month in S3 Standard, plus requests and data transfer out.`,
      lambda: (requests: string, gbSecond: string) =>
        `Billed per request (${requests} per million) and compute time (${gbSecond} per GB-second). Free tier: 1 million requests and 400,000 GB-seconds a month.`,
      cloudfront: (gb: string, https: string) =>
        `Pay-as-you-go: from ${gb} per GB served and ${https} per 10,000 HTTPS requests. Flat-rate plans, including a free one, are an alternative.`,
      dynamoProvisioned: "Provisioned capacity (the Terraform default billing_mode) isn't in the price table",
      dynamoOnDemand: (write: string, read: string, gb: string) =>
        `On-demand: ${write} per million writes, ${read} per million reads and ${gb} per GB-month stored.`,
      sqs: (rate: string) => `${rate} per million requests. Free tier: the first 1 million requests each month.`,
      sns: (rate: string) => `${rate} per million publishes, plus deliveries (priced per protocol).`,
      websocket: 'WebSocket APIs are billed per message and per connection-minute.',
      httpApi: (rate: string) => `${rate} per million HTTP API requests.`,
      ecr: (rate: string) => `${rate} per GB-month of stored images, plus data transfer out.`,
      logs: 'Billed per GB ingested and stored.',
      free: {
        igw: 'Data transfer through it is billed separately',
        viaLoadBalancer: 'Billed through its load balancer',
        cluster: 'What runs in it is billed',
        taskDefinition: 'Billed through the ECS service that runs it',
        record: 'Included in the hosted zone; queries are billed there',
        viaApi: 'Billed through the API',
        subscription: 'Deliveries are billed on the topic',
        launchTemplate: 'The instances launched from it are billed',
      },
    },

    azure: {
      functions: (executions: string, gbSecond: string) =>
        `Consumption plan: ${executions} per million executions and ${gbSecond} per GB-second. Free grant: 1 million executions and 400,000 GB-s a month.`,
      linuxPayg: 'Linux, pay as you go',
      osDisk: (gb: number, tier: string) => `${gb} GB OS disk (${tier})`,
      osDiskDefault: 'OS disk: the image size, 30 GB assumed',
      hddTransactions: 'Standard HDD disks also bill per transaction',
      osDiskMissing: (type: string | undefined) => `OS disk ${type ?? '(no storage_account_type)'} isn't in the price table, so it isn't included`,
      flexConsumption: 'Flex Consumption: billed per execution and GB-second, with a smaller free grant.',
      freeTier: (sku: string) => `${sku} is the free App Service tier`,
      workers: (workers: number) => `${count(workers, 'instance', 'instances')} (worker_count; autoscale changes this)`,
      elasticPool: 'Billed through its elastic pool',
      noSku: "sku_name isn't set: Azure picks a vCore tier, which isn't in the price table",
      serverless: 'Serverless: billed per vCore-second used, plus storage.',
      dtu: 'DTU model; the storage included in the tier (more storage and long-term backups are extra)',
      storage: (copies: number, gb: number) => `${copies === 2 ? `2 × ${gb}` : gb} GB storage`,
      ha: (mode: string | undefined) => (mode ? `High availability (${mode}): the standby is billed like the primary` : 'No high availability'),
      storageDefault: 'storage_mb not set: 32 GB',
      retiredIp: (sku: string) => `${sku} public IPs were retired on Sep 30, 2025 and aren't in the price table`,
      standardIpv4: 'Standard public IPv4',
      registry: (sku: string) => `${sku} registry`,
      registryExtra: 'Plus storage beyond the included amount and data transfer',
      busBasic: 'Basic: billed per million messaging operations.',
      busBase: 'Standard base charge',
      busOperations: 'Plus messaging operations, by usage',
      busUnit: 'Premium messaging unit',
      busUnits: (units: number) => `${count(units, 'messaging unit', 'messaging units')} (capacity)`,
      aksTier: (tier: 'Standard' | 'Premium') => `AKS ${tier} tier`,
      aksFree: 'Free tier control plane (no uptime SLA)',
      aksNodes: (nodes: number) => `${count(nodes, 'node', 'nodes')} in the default pool (autoscaling changes this)`,
      ephemeral: 'Ephemeral OS disks: no disk charge',
      aksDisk: (nodes: number, gb: number, tier: string) => `${nodes} × ${gb} GB OS disk (${tier})`,
      aksDiskNote: (gb: number, premium: boolean) =>
        `${gb} GB managed OS disk per node (the AKS default), priced as ${premium ? 'Premium SSD' : 'Standard SSD'}`,
      blob: (rate: string, other: string | undefined) =>
        `Billed by use: ${rate} per GB-month for Hot LRS blobs, plus operations and data transfer.${other ? ` ${other} costs more.` : ''}`,
      keyVault: (rate: string) => `${rate} per 10,000 operations.`,
      cdn: 'Billed per GB delivered and per request.',
      free: {
        vnet: 'Peering and data transfer are billed separately',
        sqlServer: 'The server is free, but each database is billed',
        webApp: 'Billed through its App Service plan',
        functionApp: 'Billed through its App Service plan (Y1: per execution)',
        queue: 'Billed through its namespace',
        staticWebsite: 'Served from the storage account, billed by usage there',
        cdnEndpoint: 'Billed through its CDN profile, by usage',
      },
    },

    gcp: {
      bootDiskDefault: (gb: number) => `Boot disk: the image size, ${gb} GB assumed`,
      externalIpv4: 'External IPv4',
      sustainedUse: 'Sustained-use discounts (automatic for N1 / N2 / N2D) are not applied, so the bill can be lower',
      e2MicroFree: 'The free tier covers one e2-micro a month in us-west1, us-central1 or us-east1 (not subtracted)',
      sqlServer: 'SQL Server licenses are not in the price table',
      enterprisePlus: "Enterprise Plus edition isn't in the price table",
      sqlStorage: (copies: number, gb: number, disk: string) => `${copies === 2 ? `2 × ${gb}` : gb} GB ${disk}`,
      sqlHa: (ha: boolean): string => (ha ? 'High availability (REGIONAL): compute and storage are billed twice' : 'Single zone (no high availability)'),
      sqlCustom: (vcpu: string, vcpuRate: string, gb: number, gbRate: string) => `${vcpu} vCPU × ${vcpuRate} + ${gb} GB × ${gbRate} per hour`,
      diskDefault: 'disk_size not set: 10 GB',
      gkeFee: 'GKE cluster fee',
      gkeFree: 'The free tier covers the fee of one zonal or Autopilot cluster a month (not subtracted)',
      autopilot: 'Autopilot: pods are billed by the CPU and memory they request, by usage',
      poolNodes: 'Nodes are priced on their node pools',
      defaultPool: (nodes: number, perZone: number, zones: number) =>
        `Default node pool: ${count(nodes, 'node', 'nodes')}${zonesEn(perZone, zones)}, each with a 100 GB pd-balanced boot disk unless node_config says otherwise`,
      pool: (nodes: number, perZone: number, zones: number, autoscaling: boolean) =>
        `${count(nodes, 'node', 'nodes')}${zonesEn(perZone, zones)}${autoscaling ? ', autoscaling changes this' : ''}`,
      memorystore: (gb: number, ha: boolean) => `${gb} GB ${ha ? 'Standard (HA)' : 'Basic'}`,
      perGbHour: (rate: string) => `${rate} per GB-hour for this capacity tier`,
      forwardingRule: 'Forwarding rule',
      lbData: 'Plus data processed by the load balancer, by usage',
      managedZone: 'Managed zone',
      queries: 'Plus queries, by usage',
      nat: (vmHour: string, maxHour: string, gb: string) =>
        `${vmHour} per VM-hour using it (at most ${maxHour} an hour per gateway) plus ${gb} per GB processed.`,
      cloudRun: (vcpu: string, gib: string, requests: string) =>
        `Billed per vCPU-second (${vcpu}) and GiB-second (${gib}) while serving, plus ${requests} per million requests. Free tier: 2 million requests, 180,000 vCPU-seconds and 360,000 GiB-seconds a month.`,
      minInstances: (min: number) => `min_instance_count = ${min}: those instances are billed while idle too`,
      functions: 'Billed per invocation and compute time (Cloud Run functions). Free tier: 2 million invocations a month.',
      storage: (rate: string) => `${rate} per GB-month (Standard), plus operations and data transfer. Free tier: 5 GB-months in US regions.`,
      bigquery: (rate: string) => `${rate} per TiB scanned on demand, plus storage. Free tier: 1 TiB of queries and 10 GiB of storage a month.`,
      pubsub: (rate: string) => `${rate} per TiB of messages. Free tier: 10 GiB a month.`,
      subscription: 'Delivered messages count toward Pub/Sub throughput, billed by usage.',
      artifacts: (rate: string) => `${rate} per GB-month stored; the first 0.5 GB is free.`,
      secrets: (rate: string) =>
        `${rate} per active secret version a month, plus access operations. Free tier: 6 versions and 10,000 accesses a month.`,
      cdn: 'Cloud CDN: billed per GB served and per cache fill.',
      viaLb: 'Served through the load balancer, billed on its forwarding rule',
      free: {
        lbPart: 'Part of the load balancer, billed on its forwarding rule',
        record: 'Included in the managed zone; queries are billed there',
      },
    },
  },
  {
    gb: (gb: number, type: string) => `${n(gb)} GB ${type}`,
    nodesGb: (nodes: number, gb: number, type: string) => `${n(nodes)} × ${n(gb)} GB ${type}`,
    priceChanges: (what: 'spot-instances' | 'fargate-spot' | 'spot-capacity' | 'spot-vms' | 'preemptible') =>
      `${
        {
          'spot-instances': 'Instâncias spot',
          'fargate-spot': 'Fargate Spot',
          'spot-capacity': 'Capacidade spot',
          'spot-vms': 'VMs spot',
          preemptible: 'VMs spot / preemptivas',
        }[what]
      }: o preço muda conforme a demanda`,
    notIncludedType: (what: string, type: string) => `${what} ${type} não está na tabela de preços, então não está incluído`,

    aws: {
      fromLaunchTemplate: 'O tipo de instância vem do launch template',
      tenancy: (tenancy: string) => `A locação ${tenancy} não está na tabela de preços`,
      linuxShared: 'Linux, locação compartilhada (uma AMI Windows ou licenciada custa mais)',
      rootVolumeType: 'O tipo de volume raiz',
      rootVolumeDefault: (gb: number, type: string) =>
        `Volume raiz: ${n(gb)} GB ${type}, um padrão comum de AMI (defina root_block_device para mudar)`,
      extraVolume: 'Um volume EBS extra sem tamanho literal ou com tipo fora da tabela não está incluído',
      eipPriced: 'O IP público é um Elastic IP, com preço no aws_eip',
      publicIpv4: 'IPv4 público',
      associatePublicIp: 'associate_public_ip_address atribui um IPv4 público',
      subnetPublicIp: (subnet: string) => `A sub-rede ${subnet} atribui um IPv4 público (map_public_ip_on_launch)`,
      aurora: 'O Aurora é cobrado por instância do cluster e por E/S (fora da tabela de preços)',
      auroraStandard: (storage: string, io: string) =>
        `Cobrado pelo uso: ${storage} por GB-mês de armazenamento e ${io} por milhão de requisições de E/S (Aurora Standard).`,
      auroraIoOptimized: (storage: string) =>
        `Cobrado pelo uso: ${storage} por GB-mês de armazenamento, E/S incluída (Aurora I/O-Optimized).`,
      auroraInstances: 'As instâncias (aws_rds_cluster_instance) são cobradas por hora, à parte',
      auroraServerless: 'A capacidade sem servidor (ACUs) é cobrada por hora de uso, à parte',
      deployment: (engine: string, multi: boolean) =>
        `${engine}, ${multi ? 'Multi-AZ (uma réplica de espera em uma segunda zona)' : 'Single-AZ'}`,
      noStorage: 'Sem allocated_storage literal, então o armazenamento não está incluído',
      storageType: 'O tipo de armazenamento',
      storageDefault: (type: string) => `storage_type não definido: ${type}, o padrão da AWS`,
      iops: 'As IOPS provisionadas são cobradas à parte',
      backups: 'Backups além da cota gratuita e snapshots são cobrados à parte',
      replicationGroup: 'Os nós são cobrados pelo grupo de replicação',
      cacheNodes: (nodes: number, engine: string) => `${countPt(nodes, 'nó', 'nós')}, ${engine}`,
      clusterEc2: 'Roda nas instâncias EC2 do cluster: elas são cobradas, não o serviço',
      noTaskDefinition: 'A definição de tarefa não está neste projeto, então a CPU e a memória são desconhecidas',
      taskNoCpu: (task: string) => `A definição de tarefa ${task} não tem cpu e memory literais`,
      tasks: (tasks: number, vcpu: number, gb: number) => `${countPt(tasks, 'tarefa', 'tarefas')} (${n(vcpu)} vCPU, ${n(gb)} GB)`,
      fargateRate: (arm: boolean, vcpu: number, vcpuRate: string, gb: number, gbRate: string) =>
        `Fargate ${arm ? 'ARM' : 'Linux/x86'}: ${n(vcpu)} vCPU × ${vcpuRate} + ${n(gb)} GB × ${gbRate} por hora de tarefa`,
      noDesiredCount: 'desired_count não definido: o Terraform inicia 0 tarefas',
      tasksAllMonth: (tasks: number) => `${countPt(tasks, 'tarefa rodando', 'tarefas rodando')} o mês todo (o autoscaling muda isso)`,
      desiredSize: 'scaling_config.desired_size não é um número literal',
      nodeGroupNodes: (nodes: number, defaultType: boolean) =>
        `${countPt(nodes, 'nó', 'nós')} (desired_size; o autoscaling muda isso)${defaultType ? ', t3.medium (o tipo de instância padrão)' : ''}`,
      nodeGroupDisk: (gb: number) => `Disco raiz gp2 de ${n(gb)} GB por nó (o padrão do EKS)`,
      albLcu: (rate: string) => `Mais ${rate} por LCU-hora, conforme o uso (conexões, tráfego, avaliações de regras)`,
      nlbLcu: (rate: string) => `Mais ${rate} por NLCU-hora, conforme o uso`,
      natGateway: 'NAT gateway',
      perGbProcessed: (rate: string) => `Mais ${rate} por GB processado`,
      eipBilled: 'Endereços IPv4 públicos são cobrados estando associados ou não',
      hostedZone: 'Zona hospedada',
      queries: (rate: string) => `Mais ${rate} por milhão de consultas padrão`,
      kmsKey: 'Chave gerenciada pelo cliente',
      kmsRequests: (rate: string) => `Mais ${rate} a cada 10.000 requisições`,
      secret: 'Segredo',
      secretCalls: (rate: string) => `Mais ${rate} a cada 10.000 chamadas de API`,
      eksControlPlane: 'Plano de controle do EKS',
      eksSupport: 'Suporte padrão de versões do Kubernetes (o suporte estendido custa mais)',
      eksNodes: 'Os nós de trabalho têm preço nos respectivos grupos de nós',
      ebsSize: 'size não é um número literal (um volume criado de um snapshot tem o tamanho do snapshot)',
      ebsType: 'type não definido: gp3',
      s3: (rate: string) => `Cobrado pelo uso: ${rate} por GB-mês no S3 Standard, mais requisições e transferência de dados de saída.`,
      lambda: (requests: string, gbSecond: string) =>
        `Cobrado por requisição (${requests} por milhão) e por tempo de computação (${gbSecond} por GB-segundo). Nível gratuito: 1 milhão de requisições e 400.000 GB-segundos por mês.`,
      cloudfront: (gb: string, https: string) =>
        `Pagamento conforme o uso: a partir de ${gb} por GB entregue e ${https} a cada 10.000 requisições HTTPS. Planos de preço fixo, incluindo um gratuito, são uma alternativa.`,
      dynamoProvisioned: 'A capacidade provisionada (o billing_mode padrão do Terraform) não está na tabela de preços',
      dynamoOnDemand: (write: string, read: string, gb: string) =>
        `Sob demanda: ${write} por milhão de gravações, ${read} por milhão de leituras e ${gb} por GB-mês armazenado.`,
      sqs: (rate: string) => `${rate} por milhão de requisições. Nível gratuito: o primeiro milhão de requisições de cada mês.`,
      sns: (rate: string) => `${rate} por milhão de publicações, mais as entregas (com preço por protocolo).`,
      websocket: 'APIs WebSocket são cobradas por mensagem e por minuto de conexão.',
      httpApi: (rate: string) => `${rate} por milhão de requisições de API HTTP.`,
      ecr: (rate: string) => `${rate} por GB-mês de imagens armazenadas, mais a transferência de dados de saída.`,
      logs: 'Cobrado por GB ingerido e armazenado.',
      free: {
        igw: 'A transferência de dados por ele é cobrada à parte',
        viaLoadBalancer: 'Cobrado pelo balanceador de carga',
        cluster: 'O que roda nele é cobrado',
        taskDefinition: 'Cobrada pelo serviço ECS que a executa',
        record: 'Incluído na zona hospedada; as consultas são cobradas lá',
        viaApi: 'Cobrado pela API',
        subscription: 'As entregas são cobradas no tópico',
        launchTemplate: 'As instâncias iniciadas a partir dele são cobradas',
      },
    },

    azure: {
      functions: (executions: string, gbSecond: string) =>
        `Plano de consumo: ${executions} por milhão de execuções e ${gbSecond} por GB-segundo. Concessão gratuita: 1 milhão de execuções e 400.000 GB-s por mês.`,
      linuxPayg: 'Linux, pagamento conforme o uso',
      osDisk: (gb: number, tier: string) => `Disco do SO de ${n(gb)} GB (${tier})`,
      osDiskDefault: 'Disco do SO: o tamanho da imagem, 30 GB presumidos',
      hddTransactions: 'Discos HDD Standard também cobram por transação',
      osDiskMissing: (type: string | undefined) =>
        `Disco do SO ${type ?? '(sem storage_account_type)'} não está na tabela de preços, então não está incluído`,
      flexConsumption: 'Flex Consumption: cobrado por execução e por GB-segundo, com uma concessão gratuita menor.',
      freeTier: (sku: string) => `${sku} é o nível gratuito do App Service`,
      workers: (workers: number) => `${countPt(workers, 'instância', 'instâncias')} (worker_count; o autoscale muda isso)`,
      elasticPool: 'Cobrado pelo pool elástico',
      noSku: 'sku_name não está definido: o Azure escolhe um nível vCore, que não está na tabela de preços',
      serverless: 'Serverless: cobrado por vCore-segundo usado, mais o armazenamento.',
      dtu: 'Modelo DTU; o armazenamento incluído no nível (mais armazenamento e backups de longo prazo são cobrados à parte)',
      storage: (copies: number, gb: number) => `${copies === 2 ? `2 × ${n(gb)}` : n(gb)} GB de armazenamento`,
      ha: (mode: string | undefined) =>
        mode ? `Alta disponibilidade (${mode}): a réplica de espera é cobrada como a primária` : 'Sem alta disponibilidade',
      storageDefault: 'storage_mb não definido: 32 GB',
      retiredIp: (sku: string) => `IPs públicos ${sku} foram descontinuados em 30 de setembro de 2025 e estão fora da tabela de preços`,
      standardIpv4: 'IPv4 público Standard',
      registry: (sku: string) => `Registro ${sku}`,
      registryExtra: 'Mais o armazenamento além do incluído e a transferência de dados',
      busBasic: 'Basic: cobrado por milhão de operações de mensagens.',
      busBase: 'Cobrança base Standard',
      busOperations: 'Mais as operações de mensagens, conforme o uso',
      busUnit: 'Unidade de mensagens Premium',
      busUnits: (units: number) => `${countPt(units, 'unidade de mensagens', 'unidades de mensagens')} (capacity)`,
      aksTier: (tier: 'Standard' | 'Premium') => `AKS nível ${tier}`,
      aksFree: 'Plano de controle do nível Free (sem SLA de disponibilidade)',
      aksNodes: (nodes: number) => `${countPt(nodes, 'nó', 'nós')} no pool padrão (o autoscaling muda isso)`,
      ephemeral: 'Discos de SO efêmeros: sem cobrança de disco',
      aksDisk: (nodes: number, gb: number, tier: string) => `${n(nodes)} × disco do SO de ${n(gb)} GB (${tier})`,
      aksDiskNote: (gb: number, premium: boolean) =>
        `Disco do SO gerenciado de ${n(gb)} GB por nó (o padrão do AKS), com preço de ${premium ? 'Premium SSD' : 'Standard SSD'}`,
      blob: (rate: string, other: string | undefined) =>
        `Cobrado pelo uso: ${rate} por GB-mês para blobs Hot LRS, mais operações e transferência de dados.${other ? ` ${other} custa mais.` : ''}`,
      keyVault: (rate: string) => `${rate} a cada 10.000 operações.`,
      cdn: 'Cobrado por GB entregue e por requisição.',
      free: {
        vnet: 'Peering e transferência de dados são cobrados à parte',
        sqlServer: 'O servidor é gratuito, mas cada banco de dados é cobrado',
        webApp: 'Cobrado pelo plano do App Service',
        functionApp: 'Cobrado pelo plano do App Service (Y1: por execução)',
        queue: 'Cobrado pelo namespace',
        staticWebsite: 'Servido pela conta de armazenamento, cobrado pelo uso lá',
        cdnEndpoint: 'Cobrado pelo perfil de CDN, conforme o uso',
      },
    },

    gcp: {
      bootDiskDefault: (gb: number) => `Disco de inicialização: o tamanho da imagem, ${n(gb)} GB presumidos`,
      externalIpv4: 'IPv4 externo',
      sustainedUse: 'Os descontos por uso contínuo (automáticos para N1 / N2 / N2D) não são aplicados, então a conta pode ser menor',
      e2MicroFree: 'O nível gratuito cobre uma e2-micro por mês em us-west1, us-central1 ou us-east1 (não abatido)',
      sqlServer: 'As licenças do SQL Server não estão na tabela de preços',
      enterprisePlus: 'A edição Enterprise Plus não está na tabela de preços',
      sqlStorage: (copies: number, gb: number, disk: string) => `${copies === 2 ? `2 × ${n(gb)}` : n(gb)} GB ${disk}`,
      sqlHa: (ha: boolean) =>
        ha ? 'Alta disponibilidade (REGIONAL): computação e armazenamento são cobrados em dobro' : 'Zona única (sem alta disponibilidade)',
      sqlCustom: (vcpu: string, vcpuRate: string, gb: number, gbRate: string) =>
        `${vcpu} vCPU × ${vcpuRate} + ${n(gb)} GB × ${gbRate} por hora`,
      diskDefault: 'disk_size não definido: 10 GB',
      gkeFee: 'Taxa do cluster GKE',
      gkeFree: 'O nível gratuito cobre a taxa de um cluster zonal ou Autopilot por mês (não abatido)',
      autopilot: 'Autopilot: os pods são cobrados pela CPU e memória que solicitam, conforme o uso',
      poolNodes: 'Os nós têm preço nos respectivos node pools',
      defaultPool: (nodes: number, perZone: number, zones: number) =>
        `Node pool padrão: ${countPt(nodes, 'nó', 'nós')}${zonesPt(perZone, zones)}, cada um com um disco de inicialização pd-balanced de 100 GB, a menos que node_config diga outra coisa`,
      pool: (nodes: number, perZone: number, zones: number, autoscaling: boolean) =>
        `${countPt(nodes, 'nó', 'nós')}${zonesPt(perZone, zones)}${autoscaling ? ', o autoscaling muda isso' : ''}`,
      memorystore: (gb: number, ha: boolean) => `${n(gb)} GB ${ha ? 'Standard (HA)' : 'Basic'}`,
      perGbHour: (rate: string) => `${rate} por GB-hora nesta faixa de capacidade`,
      forwardingRule: 'Regra de encaminhamento',
      lbData: 'Mais os dados processados pelo balanceador de carga, conforme o uso',
      managedZone: 'Zona gerenciada',
      queries: 'Mais as consultas, conforme o uso',
      nat: (vmHour: string, maxHour: string, gb: string) =>
        `${vmHour} por hora de VM que o usa (no máximo ${maxHour} por hora por gateway), mais ${gb} por GB processado.`,
      cloudRun: (vcpu: string, gib: string, requests: string) =>
        `Cobrado por vCPU-segundo (${vcpu}) e GiB-segundo (${gib}) enquanto atende, mais ${requests} por milhão de requisições. Nível gratuito: 2 milhões de requisições, 180.000 vCPU-segundos e 360.000 GiB-segundos por mês.`,
      minInstances: (min: number) => `min_instance_count = ${min}: essas instâncias são cobradas também quando ociosas`,
      functions: 'Cobrado por invocação e tempo de computação (Cloud Run functions). Nível gratuito: 2 milhões de invocações por mês.',
      storage: (rate: string) =>
        `${rate} por GB-mês (Standard), mais operações e transferência de dados. Nível gratuito: 5 GB-mês em regiões dos EUA.`,
      bigquery: (rate: string) =>
        `${rate} por TiB lido sob demanda, mais o armazenamento. Nível gratuito: 1 TiB de consultas e 10 GiB de armazenamento por mês.`,
      pubsub: (rate: string) => `${rate} por TiB de mensagens. Nível gratuito: 10 GiB por mês.`,
      subscription: 'As mensagens entregues contam para a vazão do Pub/Sub, cobrada conforme o uso.',
      artifacts: (rate: string) => `${rate} por GB-mês armazenado; os primeiros 0,5 GB são gratuitos.`,
      secrets: (rate: string) =>
        `${rate} por versão de secret ativa por mês, mais as operações de acesso. Nível gratuito: 6 versões e 10.000 acessos por mês.`,
      cdn: 'Cloud CDN: cobrado por GB entregue e por preenchimento de cache.',
      viaLb: 'Servido pelo balanceador de carga, cobrado na regra de encaminhamento dele',
      free: {
        lbPart: 'Parte do balanceador de carga, cobrado na regra de encaminhamento',
        record: 'Incluído na zona gerenciada; as consultas são cobradas lá',
      },
    },
  },
);

export type ServiceMessages = (typeof serviceMessages)['en'];
