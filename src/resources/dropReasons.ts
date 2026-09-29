/**
 * Why a resource can't be drawn inside a container — the words behind the
 * canvas's "can't go here" hints, in both languages.
 *
 * NOUNS: every catalog type as a common noun with what each language needs
 * to put it in a sentence (English a/an, Portuguese gender for um/uma, no/na…).
 * REASONS: sentence templates. The drop rules (features/editor/dropRules.ts)
 * pick one from the containment rules (a security group dropped on a subnet
 * → "belongs to the whole VPC"), or the resource's family below when it is
 * never inside anything (a bucket is a regional service, a listener is part
 * of its load balancer…).
 */
import { formatList } from '@/i18n/format';
import { defineMessages } from '@/i18n/messages';
import type { Provider } from '@/ir/types';

export interface Noun {
  en: string;
  /** "an EC2 instance" */
  an?: boolean;
  pt: string;
  /** feminine in Portuguese: "uma sub-rede", "na VPC" */
  f?: boolean;
}

const n = (en: string, pt: string, opts: { an?: boolean; f?: boolean } = {}): Noun => ({ en, pt, ...opts });

export const NOUNS: Record<string, Noun> = {
  // AWS
  aws_vpc: n('VPC', 'VPC', { f: true }),
  aws_subnet: n('subnet', 'sub-rede', { f: true }),
  aws_security_group: n('security group', 'grupo de segurança'),
  aws_instance: n('EC2 instance', 'instância EC2', { an: true, f: true }),
  aws_db_instance: n('RDS database', 'banco RDS', { an: true }),
  aws_s3_bucket: n('S3 bucket', 'bucket S3', { an: true }),
  aws_iam_role: n('IAM role', 'função do IAM', { an: true, f: true }),
  aws_lb: n('load balancer', 'balanceador de carga'),
  aws_lb_target_group: n('target group', 'grupo de destino'),
  aws_lb_listener: n('listener', 'listener'),
  aws_ecr_repository: n('ECR repository', 'repositório ECR', { an: true }),
  aws_ecs_cluster: n('ECS cluster', 'cluster ECS', { an: true }),
  aws_ecs_service: n('ECS service', 'serviço ECS', { an: true }),
  aws_ecs_task_definition: n('task definition', 'definição de tarefa', { f: true }),
  aws_cloudfront_distribution: n('CloudFront distribution', 'distribuição CloudFront', { f: true }),
  aws_route53_zone: n('Route 53 zone', 'zona do Route 53', { f: true }),
  aws_route53_record: n('DNS record', 'registro DNS'),
  aws_internet_gateway: n('internet gateway', 'internet gateway', { an: true }),
  aws_eip: n('Elastic IP', 'Elastic IP', { an: true }),
  aws_nat_gateway: n('NAT gateway', 'NAT gateway'),
  aws_lambda_function: n('Lambda function', 'função Lambda', { f: true }),
  aws_apigatewayv2_api: n('API Gateway', 'API Gateway', { an: true }),
  aws_apigatewayv2_integration: n('API integration', 'integração da API', { an: true, f: true }),
  aws_apigatewayv2_route: n('API route', 'rota da API', { an: true, f: true }),
  aws_apigatewayv2_stage: n('API stage', 'estágio da API', { an: true }),
  aws_lambda_permission: n('Lambda permission', 'permissão da Lambda', { f: true }),
  aws_iam_role_policy: n('role policy', 'política da função', { f: true }),
  aws_sqs_queue: n('SQS queue', 'fila SQS', { an: true, f: true }),
  aws_sns_topic: n('SNS topic', 'tópico SNS', { an: true }),
  aws_sns_topic_subscription: n('SNS subscription', 'assinatura SNS', { an: true, f: true }),
  aws_dynamodb_table: n('DynamoDB table', 'tabela DynamoDB', { f: true }),
  aws_elasticache_cluster: n('ElastiCache cluster', 'cluster ElastiCache', { an: true }),
  aws_kms_key: n('KMS key', 'chave KMS', { f: true }),
  aws_secretsmanager_secret: n('secret', 'segredo'),
  aws_eks_cluster: n('EKS cluster', 'cluster EKS', { an: true }),
  aws_eks_node_group: n('EKS node group', 'grupo de nós EKS', { an: true }),
  aws_vpc_security_group_ingress_rule: n('security group rule', 'regra do grupo de segurança', { f: true }),
  aws_vpc_security_group_egress_rule: n('security group rule', 'regra do grupo de segurança', { f: true }),
  aws_network_acl: n('network ACL', 'network ACL', { f: true }),
  aws_route_table: n('route table', 'tabela de rotas', { f: true }),
  aws_route_table_association: n('route table association', 'associação de tabela de rotas', { f: true }),
  aws_s3_bucket_public_access_block: n('public access block', 'bloqueio de acesso público'),
  aws_db_subnet_group: n('DB subnet group', 'grupo de sub-redes do banco'),
  aws_elasticache_subnet_group: n('cache subnet group', 'grupo de sub-redes do cache'),
  // Azure
  azurerm_resource_group: n('resource group', 'grupo de recursos'),
  azurerm_virtual_network: n('virtual network', 'rede virtual', { f: true }),
  azurerm_subnet: n('subnet', 'sub-rede', { f: true }),
  azurerm_network_security_group: n('network security group', 'grupo de segurança de rede'),
  azurerm_network_interface: n('network interface', 'interface de rede', { f: true }),
  azurerm_linux_virtual_machine: n('virtual machine', 'máquina virtual', { f: true }),
  azurerm_storage_account: n('storage account', 'conta de armazenamento', { f: true }),
  azurerm_storage_account_static_website: n('static website', 'site estático'),
  azurerm_mssql_server: n('SQL server', 'servidor SQL'),
  azurerm_cdn_profile: n('CDN profile', 'perfil de CDN'),
  azurerm_cdn_endpoint: n('CDN endpoint', 'endpoint de CDN'),
  azurerm_mssql_database: n('SQL database', 'banco SQL'),
  azurerm_public_ip: n('public IP', 'IP público'),
  azurerm_service_plan: n('App Service plan', 'plano do App Service', { an: true }),
  azurerm_linux_web_app: n('web app', 'aplicativo web'),
  azurerm_linux_function_app: n('function app', 'aplicativo de funções'),
  azurerm_kubernetes_cluster: n('AKS cluster', 'cluster AKS', { an: true }),
  azurerm_container_registry: n('container registry', 'registro de contêiner'),
  azurerm_key_vault: n('Key Vault', 'Key Vault'),
  azurerm_postgresql_flexible_server: n('PostgreSQL server', 'servidor PostgreSQL'),
  azurerm_redis_cache: n('Redis cache', 'cache Redis'),
  azurerm_servicebus_namespace: n('Service Bus namespace', 'namespace do Service Bus'),
  azurerm_servicebus_queue: n('Service Bus queue', 'fila do Service Bus', { f: true }),
  azurerm_subnet_network_security_group_association: n('NSG association', 'associação de NSG', { an: true, f: true }),
  // Google Cloud
  google_compute_network: n('VPC network', 'rede VPC', { f: true }),
  google_compute_subnetwork: n('subnetwork', 'sub-rede', { f: true }),
  google_compute_firewall: n('firewall rule', 'regra de firewall', { f: true }),
  google_compute_instance: n('Compute Engine VM', 'VM do Compute Engine', { f: true }),
  google_storage_bucket: n('Cloud Storage bucket', 'bucket do Cloud Storage'),
  google_sql_database_instance: n('Cloud SQL instance', 'instância do Cloud SQL', { f: true }),
  google_compute_backend_bucket: n('backend bucket', 'backend bucket'),
  google_compute_url_map: n('URL map', 'URL map'),
  google_compute_target_http_proxy: n('HTTP proxy', 'proxy HTTP', { an: true }),
  google_compute_global_forwarding_rule: n('forwarding rule', 'regra de encaminhamento', { f: true }),
  google_artifact_registry_repository: n('Artifact Registry repository', 'repositório do Artifact Registry', { an: true }),
  google_cloud_run_v2_service: n('Cloud Run service', 'serviço do Cloud Run'),
  google_dns_managed_zone: n('Cloud DNS zone', 'zona do Cloud DNS', { f: true }),
  google_dns_record_set: n('DNS record', 'registro DNS'),
  google_compute_router: n('Cloud Router', 'Cloud Router'),
  google_compute_router_nat: n('Cloud NAT', 'Cloud NAT'),
  google_cloudfunctions2_function: n('Cloud Function', 'Cloud Function', { f: true }),
  google_container_cluster: n('GKE cluster', 'cluster GKE'),
  google_container_node_pool: n('GKE node pool', 'pool de nós do GKE'),
  google_pubsub_topic: n('Pub/Sub topic', 'tópico do Pub/Sub'),
  google_pubsub_subscription: n('Pub/Sub subscription', 'assinatura do Pub/Sub', { f: true }),
  google_redis_instance: n('Memorystore instance', 'instância do Memorystore', { f: true }),
  google_bigquery_dataset: n('BigQuery dataset', 'dataset do BigQuery'),
  google_service_account: n('service account', 'conta de serviço', { f: true }),
  google_secret_manager_secret: n('secret', 'segredo'),
};

/** the noun for a type: the table above, else its short name */
export function nounFor(type: string, shortName?: string): Noun {
  return NOUNS[type] ?? { en: shortName ?? type, pt: shortName ?? type };
}

// --- families of resources that are never drawn inside a container ----------

export type Family =
  | 'regional'
  | 'identity'
  | 'edge'
  | 'lambda'
  | 'serverless'
  | 'spans'
  | 'eks'
  | 'links'
  | 'partOf'
  | 'eip'
  | 'top'
  | 'ecsCluster'
  | 'gcpLb'
  | 'cloudSql';

export const FAMILY: Record<string, Family> = {
  aws_s3_bucket: 'regional',
  aws_dynamodb_table: 'regional',
  aws_sqs_queue: 'regional',
  aws_sns_topic: 'regional',
  aws_kms_key: 'regional',
  aws_secretsmanager_secret: 'regional',
  aws_ecr_repository: 'regional',
  aws_apigatewayv2_api: 'regional',
  google_storage_bucket: 'regional',
  google_bigquery_dataset: 'regional',
  google_pubsub_topic: 'regional',
  google_secret_manager_secret: 'regional',
  google_artifact_registry_repository: 'regional',
  aws_iam_role: 'identity',
  aws_iam_role_policy: 'identity',
  aws_lambda_permission: 'identity',
  google_service_account: 'identity',
  aws_route53_zone: 'edge',
  aws_route53_record: 'edge',
  aws_cloudfront_distribution: 'edge',
  google_dns_managed_zone: 'edge',
  google_dns_record_set: 'edge',
  aws_lambda_function: 'lambda',
  google_cloud_run_v2_service: 'serverless',
  google_cloudfunctions2_function: 'serverless',
  aws_lb: 'spans',
  aws_eks_cluster: 'eks',
  aws_route_table_association: 'links',
  azurerm_subnet_network_security_group_association: 'links',
  aws_lb_listener: 'partOf',
  aws_ecs_task_definition: 'partOf',
  aws_s3_bucket_public_access_block: 'partOf',
  aws_sns_topic_subscription: 'partOf',
  aws_vpc_security_group_ingress_rule: 'partOf',
  aws_vpc_security_group_egress_rule: 'partOf',
  azurerm_mssql_database: 'partOf',
  azurerm_storage_account_static_website: 'partOf',
  google_compute_router_nat: 'partOf',
  google_pubsub_subscription: 'partOf',
  aws_eip: 'eip',
  aws_vpc: 'top',
  google_compute_network: 'top',
  azurerm_resource_group: 'top',
  aws_ecs_cluster: 'ecsCluster',
  google_compute_backend_bucket: 'gcpLb',
  google_compute_url_map: 'gcpLb',
  google_compute_target_http_proxy: 'gcpLb',
  google_compute_global_forwarding_rule: 'gcpLb',
  google_sql_database_instance: 'cloudSql',
};

/** partOf: what the resource belongs to */
export const OWNER: Record<string, string> = {
  aws_lb_listener: 'aws_lb',
  aws_ecs_task_definition: 'aws_ecs_service',
  aws_s3_bucket_public_access_block: 'aws_s3_bucket',
  aws_sns_topic_subscription: 'aws_sns_topic',
  aws_vpc_security_group_ingress_rule: 'aws_security_group',
  aws_vpc_security_group_egress_rule: 'aws_security_group',
  azurerm_mssql_database: 'azurerm_mssql_server',
  azurerm_storage_account_static_website: 'azurerm_storage_account',
  google_compute_router_nat: 'google_compute_router',
  google_pubsub_subscription: 'google_pubsub_topic',
};

/** resources that run in a subnet group rather than in one subnet */
export const SUBNET_GROUP_OF: Record<string, string> = {
  aws_db_instance: 'aws_db_subnet_group',
  aws_elasticache_cluster: 'aws_elasticache_subnet_group',
};

/** reasons specific to a resource with containment, for some of the parents it refuses */
export type Override = 'azureVm' | 'azureNic' | 'azureApp' | 'ecsService' | 'eksNodeGroup' | 'natGateway';

export const OVERRIDE: Record<string, { override: Override; on: string[] }> = {
  azurerm_linux_virtual_machine: { override: 'azureVm', on: ['azurerm_subnet', 'azurerm_virtual_network'] },
  azurerm_network_interface: { override: 'azureNic', on: ['azurerm_subnet', 'azurerm_virtual_network'] },
  azurerm_linux_web_app: { override: 'azureApp', on: ['azurerm_subnet', 'azurerm_virtual_network'] },
  azurerm_linux_function_app: { override: 'azureApp', on: ['azurerm_subnet', 'azurerm_virtual_network'] },
  aws_ecs_service: { override: 'ecsService', on: ['aws_subnet', 'aws_vpc'] },
  aws_eks_node_group: { override: 'eksNodeGroup', on: ['aws_subnet', 'aws_vpc'] },
  aws_nat_gateway: { override: 'natGateway', on: ['aws_vpc'] },
};

// --- sentences ------------------------------------------------------------------

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const a = (x: Noun) => `${x.an ? 'an' : 'a'} ${x.en}`;
const A = (x: Noun) => cap(a(x));
const um = (x: Noun) => `${x.f ? 'uma' : 'um'} ${x.pt}`;
const Um = (x: Noun) => cap(um(x));
const em = (x: Noun) => `${x.f ? 'na' : 'no'} ${x.pt}`;
const de = (x: Noun) => `${x.f ? 'da' : 'do'} ${x.pt}`;
const ao = (x: Noun) => `${x.f ? 'à' : 'ao'} ${x.pt}`;
/** object pronoun after a hyphen: "solte-o" / "solte-a" */
const lo = (x: Noun) => (x.f ? 'a' : 'o');
const ele = (x: Noun) => (x.f ? 'ela' : 'ele');
const o = (x: Noun) => `${x.f ? 'a' : 'o'} ${x.pt}`;

/** articles and contractions for putting a noun in a sentence */
export const phrase = { a, A, um, Um, o, em, de, ao };

const CLOUD_EN: Record<Provider, string> = { aws: 'an AWS', azure: 'an Azure', gcp: 'a Google Cloud', other: 'another' };
const CLOUD_PT: Record<Provider, string> = { aws: 'da AWS', azure: 'do Azure', gcp: 'do Google Cloud', other: 'de outra nuvem' };

export const reasonMessages = defineMessages(
  {
    // derived from the containment rules
    wider: (r: Noun, p: Noun, c: Noun) => `${A(r)} belongs to the whole ${p.en}, not to one ${c.en}`,
    narrower: (r: Noun, p: Noun, c: Noun) => `${A(r)} goes inside ${a(p)}, not directly in the ${c.en} — drop it on ${a(p)}`,
    unrelated: (r: Noun, ps: Noun[], c: Noun) => `${A(r)} goes inside ${formatList(ps.map(a), 'disjunction', 'en')}, not ${a(c)}`,
    otherCloud: (r: Noun, rCloud: Provider, c: Noun, cCloud: Provider) =>
      `${A(r)} is ${CLOUD_EN[rCloud]} resource — it can't go inside ${CLOUD_EN[cCloud]} ${c.en}`,
    notInside: (r: Noun, c: Noun) => `${A(r)} isn't placed inside ${a(c)} — none of its settings puts it there`,
    // resources that live in a subnet group
    subnetGroup: (r: Noun, group: Noun) =>
      `${A(r)} isn't placed in one subnet — it runs in ${a(group)} that spans two or more availability zones`,
    subnetGroupVpc: (r: Noun, group: Noun) =>
      `${A(r)} goes inside ${a(group)}, not directly in the VPC — the group's subnets decide where it runs`,
    groupSpans: (r: Noun) => `${A(r)} spans subnets instead of sitting in one — connect it to each subnet it should use`,
    viaStays: (r: Noun, p: Noun) => `${A(r)} is drawn in the ${p.en} of the subnets it lists — change its subnets to move it`,
    viaConnect: (r: Noun) => `${A(r)} is drawn in the VPC of the subnets it lists — connect it to this VPC's subnets`,
    // families
    regional: (r: Noun, c: Noun) =>
      `${A(r)} is a managed regional service outside your networks — what runs in the ${c.en} reaches it over the network or a private endpoint`,
    identity: (r: Noun) => `${A(r)} is an identity and permissions setting, not part of a network — connect it to the resources that use it`,
    edge: (r: Noun, c: Noun) => `${A(r)} is a global edge service — it isn't placed inside ${a(c)}, it points at what it serves`,
    lambda: () => 'A Lambda function runs outside your VPC by default — to reach private resources, give it subnets in vpc_config (in code)',
    serverless: (r: Noun) =>
      `${A(r)} is serverless and runs outside your VPC network — reach private resources through a Serverless VPC Access connector (in code)`,
    spans: (r: Noun, inSubnet: boolean) =>
      inSubnet
        ? `${A(r)} spans several subnets — it's connected to each one instead of being drawn inside`
        : `${A(r)} isn't drawn inside the VPC — connect it to the subnets it serves`,
    eks: () => "An EKS cluster spans the subnets listed in vpc_config — it's connected to them, not drawn inside",
    links: (r: Noun) => `${A(r)} links two resources — it's drawn beside them, with a line to each`,
    partOf: (r: Noun, owner: Noun, c: Noun) => `${A(r)} is part of its ${owner.en} — it's drawn beside it, not inside ${a(c)}`,
    eip: (c: Noun) => `An Elastic IP isn't placed inside ${a(c)} — it's attached to an instance or a NAT gateway`,
    top: (r: Noun, c: Noun) => `${A(r)} is a top-level container — it isn't placed inside ${a(c)}`,
    ecsCluster: () => 'An ECS cluster is a logical group — its services pick their subnets in network_configuration (in code)',
    gcpLb: (r: Noun, c: Noun) => `${A(r)} is part of a global load balancer — it isn't placed inside ${a(c)}`,
    cloudSql: () =>
      "A Cloud SQL instance runs in Google's network — connect it to your VPC network with a private IP (settings.ip_configuration, in code)",
    // overrides
    azureVm: () => 'A virtual machine joins a subnet through its network interface — the VM itself is drawn in its resource group',
    azureNic: () => "A network interface connects to a subnet through ip_configuration — it's drawn in its resource group",
    azureApp: (r: Noun) => `${A(r)} runs in its App Service plan — VNet integration is set in code`,
    ecsService: () => "An ECS service goes inside an ECS cluster — its tasks' subnets are set in network_configuration (in code)",
    eksNodeGroup: () => 'An EKS node group goes inside its EKS cluster — its subnets are listed in subnet_ids (in code)',
    natGateway: () => 'A NAT gateway goes inside a public subnet, not directly in the VPC — drop it on one',
  },
  {
    wider: (r: Noun, p: Noun, c: Noun) => `${Um(r)} pertence ${ao(p)} inteir${p.f ? 'a' : 'o'}, não a ${um(c)}`,
    narrower: (r: Noun, p: Noun, c: Noun) =>
      `${Um(r)} fica dentro de ${um(p)}, não direto ${em(c)} — solte-${lo(r)} sobre ${um(p)}`,
    unrelated: (r: Noun, ps: Noun[], c: Noun) => `${Um(r)} fica dentro de ${formatList(ps.map(um), 'disjunction', 'pt-BR')}, não ${em(c)}`,
    otherCloud: (r: Noun, rCloud: Provider, c: Noun, cCloud: Provider) =>
      `${Um(r)} é um recurso ${CLOUD_PT[rCloud]} — não pode ficar dentro de ${um(c)} ${CLOUD_PT[cCloud]}`,
    notInside: (r: Noun, c: Noun) =>
      `${Um(r)} não fica dentro de ${um(c)} — nenhuma configuração ${r.f ? 'dela' : 'dele'} ${lo(r)} coloca lá`,
    subnetGroup: (r: Noun, group: Noun) =>
      // the AWS term on first mention, as the glossary says
      `${Um(r)} não fica em uma sub-rede só — ${ele(r)} roda em ${um(group)} (${group.en}) que cobre duas ou mais zonas de disponibilidade`,
    subnetGroupVpc: (r: Noun, group: Noun) =>
      `${Um(r)} fica dentro de ${um(group)}, não direto na VPC — as sub-redes do grupo decidem onde ${ele(r)} roda`,
    groupSpans: (r: Noun) => `${Um(r)} cobre sub-redes em vez de ficar dentro de uma — conecte-${lo(r)} a cada sub-rede que deve usar`,
    viaStays: (r: Noun, p: Noun) =>
      `${Um(r)} aparece ${em(p)} das sub-redes que lista — troque as sub-redes para movê-${r.f ? 'la' : 'lo'}`,
    viaConnect: (r: Noun) => `${Um(r)} aparece na VPC das sub-redes que lista — conecte-${lo(r)} às sub-redes desta VPC`,
    regional: (r: Noun, c: Noun) =>
      `${Um(r)} é um serviço regional gerenciado, fora das suas redes — o que roda ${em(c)} o acessa pela rede ou por um endpoint privado`,
    identity: (r: Noun) =>
      `${Um(r)} é uma configuração de identidade e permissões, não faz parte de uma rede — conecte-a aos recursos que a usam`,
    edge: (r: Noun, c: Noun) => `${Um(r)} é um serviço global de borda — não fica dentro de ${um(c)}, só aponta para o que atende`,
    lambda: () =>
      'Uma função Lambda roda fora da sua VPC por padrão — para acessar recursos privados, defina sub-redes em vpc_config (no código)',
    serverless: (r: Noun) =>
      `${Um(r)} é serverless e roda fora da sua rede VPC — acesse recursos privados por um conector de Acesso VPC sem servidor (no código)`,
    spans: (r: Noun, inSubnet: boolean) =>
      inSubnet
        ? `${Um(r)} cobre várias sub-redes — ${ele(r)} é conectad${lo(r)} a cada uma em vez de ficar dentro`
        : `${Um(r)} não fica dentro da VPC — conecte-${lo(r)} às sub-redes que ${ele(r)} atende`,
    eks: () => 'Um cluster EKS cobre as sub-redes listadas em vpc_config — ele é conectado a elas, não fica dentro',
    links: (r: Noun) => `${Um(r)} liga dois recursos — fica ao lado deles, com uma linha para cada um`,
    partOf: (r: Noun, owner: Noun, c: Noun) =>
      `${Um(r)} faz parte ${de(owner)} — fica ao lado ${owner.f ? 'dela' : 'dele'}, não dentro de ${um(c)}`,
    eip: (c: Noun) => `Um Elastic IP não fica dentro de ${um(c)} — ele é associado a uma instância ou a um NAT gateway`,
    top: (r: Noun, c: Noun) => `${Um(r)} é um contêiner de nível mais alto — não fica dentro de ${um(c)}`,
    ecsCluster: () =>
      'Um cluster ECS é um agrupamento lógico — os serviços dele escolhem as sub-redes em network_configuration (no código)',
    gcpLb: (r: Noun, c: Noun) => `${Um(r)} faz parte de um balanceador de carga global — não fica dentro de ${um(c)}`,
    cloudSql: () =>
      'Uma instância do Cloud SQL roda na rede do Google — conecte à sua rede VPC com um IP privado (settings.ip_configuration, no código)',
    azureVm: () => 'Uma máquina virtual entra em uma sub-rede pela interface de rede — a VM fica no grupo de recursos',
    azureNic: () => 'Uma interface de rede se conecta a uma sub-rede pelo ip_configuration — ela fica no grupo de recursos',
    azureApp: (r: Noun) => `${Um(r)} roda no seu plano do App Service — a integração com a VNet é configurada no código`,
    ecsService: () =>
      'Um serviço ECS fica dentro de um cluster ECS — as sub-redes das tarefas são definidas em network_configuration (no código)',
    eksNodeGroup: () => 'Um grupo de nós EKS fica dentro do cluster EKS — as sub-redes dele são listadas em subnet_ids (no código)',
    natGateway: () => 'Um NAT gateway fica dentro de uma sub-rede pública, não direto na VPC — solte-o sobre uma',
  },
);
