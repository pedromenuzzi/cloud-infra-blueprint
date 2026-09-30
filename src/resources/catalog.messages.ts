/**
 * The catalog in Brazilian Portuguese: every resource's display name, canvas
 * short name and description, plus the help of the fields that have any
 * (`label`, `doc`). English stays in the defs (./aws.ts, ./azure.ts,
 * ./gcp.ts) as the source text; read both through ./i18n.ts.
 *
 * Keyed by `CatalogType`, so a resource added to the catalog without a
 * translation doesn't compile; ./i18n.test.ts checks the field help matches
 * the defs one for one. Names follow the AWS / Azure / Google consoles in
 * Portuguese (src/i18n/GLOSSARY.md); product names stay as they are.
 */
import type { CatalogType } from './registry';

export interface FieldText {
  label?: string;
  doc?: string;
}

export interface CatalogText {
  name: string;
  shortName: string;
  description: string;
  /** by argument name: exactly the fields whose def has a `label` or `doc` */
  fields?: Record<string, FieldText>;
}

const SECURITY_GROUPS: FieldText = { label: 'Grupos de segurança' };
const SUBNETS: FieldText = { label: 'Sub-redes' };
const NAME_32: FieldText = { doc: 'Letras, dígitos e hifens, até 32' };
const JSON_POLICY: FieldText = { doc: 'Documento de política em JSON' };
const GLOBALLY_UNIQUE: FieldText = { doc: 'Único globalmente' };

export const CATALOG_PT_BR: Record<CatalogType, CatalogText> = {
  /* ------------------------------------------------------------------ AWS */
  aws_vpc: { name: 'VPC', shortName: 'VPC', description: 'Rede virtual isolada' },
  aws_subnet: { name: 'Sub-rede', shortName: 'Sub-rede', description: 'Sub-rede dentro de uma VPC' },
  aws_security_group: {
    name: 'Grupo de segurança',
    shortName: 'Grupo de segurança',
    description: 'Regras de firewall com estado (stateful)',
  },
  aws_instance: {
    name: 'Instância EC2',
    shortName: 'EC2',
    description: 'Máquina virtual',
    fields: { vpc_security_group_ids: SECURITY_GROUPS },
  },
  aws_db_instance: {
    name: 'Instância RDS',
    shortName: 'RDS',
    description: 'Banco de dados relacional gerenciado',
    fields: {
      allocated_storage: { doc: 'GiB' },
      password: { doc: 'Prefira var.db_password a um valor literal' },
      db_subnet_group_name: { label: 'Grupo de sub-redes do banco', doc: 'As sub-redes (2+ AZs) onde o banco de dados roda' },
      vpc_security_group_ids: SECURITY_GROUPS,
    },
  },
  aws_rds_cluster: {
    name: 'Cluster Aurora',
    shortName: 'Aurora',
    description: 'Cluster de banco de dados Aurora gerenciado (compatível com MySQL ou PostgreSQL)',
    fields: {
      cluster_identifier: { doc: 'Letras minúsculas, dígitos e hifens, até 63' },
      manage_master_user_password: { doc: 'Guarda a senha no Secrets Manager' },
      db_subnet_group_name: { label: 'Grupo de sub-redes do banco', doc: 'As sub-redes (2+ AZs) onde o cluster roda' },
      vpc_security_group_ids: SECURITY_GROUPS,
    },
  },
  aws_s3_bucket: {
    name: 'Bucket S3',
    shortName: 'S3',
    description: 'Bucket de armazenamento de objetos',
    fields: { bucket: { doc: 'Único globalmente; a AWS escolhe um quando fica vazio' } },
  },
  aws_iam_role: {
    name: 'Perfil do IAM',
    shortName: 'Perfil do IAM',
    description: 'Identidade com permissões que podem ser assumidas',
    fields: { assume_role_policy: JSON_POLICY },
  },
  aws_lb: {
    name: 'Application Load Balancer',
    shortName: 'ALB',
    description: 'Balanceador de carga para tráfego HTTP/TCP',
    fields: { name: NAME_32 },
  },
  aws_lb_target_group: {
    name: 'Grupo de destino',
    shortName: 'Grupo de destino',
    description: 'Encaminha solicitações para os destinos registrados',
    fields: { name: NAME_32 },
  },
  aws_lb_listener: {
    name: 'Listener do ALB',
    shortName: 'Listener',
    description: 'Escuta em uma porta e encaminha para um grupo de destino',
    fields: { certificate_arn: { doc: 'Certificado do ACM — obrigatório para HTTPS' } },
  },
  aws_ecr_repository: { name: 'Repositório ECR', shortName: 'ECR', description: 'Registro privado de imagens de contêiner' },
  aws_ecs_cluster: { name: 'Cluster ECS', shortName: 'Cluster ECS', description: 'Cluster de orquestração de contêineres' },
  aws_ecs_service: { name: 'Serviço ECS', shortName: 'Serviço ECS', description: 'Mantém tarefas de longa duração em execução' },
  aws_ecs_task_definition: {
    name: 'Definição de tarefa do ECS',
    shortName: 'Def. de tarefa',
    description: 'Modelo dos contêineres a executar',
    fields: { container_definitions: { doc: 'Lista JSON de contêineres (jsonencode)' } },
  },
  aws_cloudfront_distribution: { name: 'Distribuição do CloudFront', shortName: 'CloudFront', description: 'CDN global' },
  aws_route53_zone: { name: 'Zona do Route 53', shortName: 'Route 53', description: 'Zona hospedada de DNS' },
  aws_route53_record: {
    name: 'Registro do Route 53',
    shortName: 'Registro DNS',
    description: 'Registro DNS em uma zona hospedada',
    fields: { records: { doc: 'Ou um bloco alias (balanceador de carga, CloudFront…)' } },
  },
  aws_internet_gateway: { name: 'Internet gateway', shortName: 'IGW', description: 'Conecta uma VPC à internet' },
  aws_eip: { name: 'IP elástico', shortName: 'EIP', description: 'Endereço IPv4 público estático' },
  aws_nat_gateway: {
    name: 'NAT gateway',
    shortName: 'NAT',
    description: 'Saída para a internet de sub-redes privadas',
    fields: { subnet_id: { doc: 'Uma sub-rede pública' }, allocation_id: { label: 'IP elástico' } },
  },
  aws_lambda_function: {
    name: 'Função Lambda',
    shortName: 'Lambda',
    description: 'Função sem servidor',
    fields: {
      filename: { doc: 'Pacote de implantação (ou use image_uri / s3_bucket)' },
      memory_size: { doc: 'MB' },
      timeout: { doc: 'Segundos (máx. 900)' },
    },
  },
  aws_apigatewayv2_api: {
    name: 'API Gateway (HTTP)',
    shortName: 'API Gateway',
    description: 'Porta de entrada de APIs HTTP ou WebSocket',
  },
  aws_apigatewayv2_integration: {
    name: 'Integração de API',
    shortName: 'Integração',
    description: 'Encaminha as solicitações da API para uma Lambda ou um back-end HTTP',
    fields: { integration_uri: { doc: 'ARN de invocação da Lambda, ou uma URL para HTTP_PROXY' } },
  },
  aws_apigatewayv2_route: {
    name: 'Rota de API',
    shortName: 'Rota',
    description: 'Associa um método + caminho a uma integração',
    fields: {
      route_key: { doc: '"$default" captura tudo' },
      target: { doc: '"integrations/${aws_apigatewayv2_integration.<nome>.id}"' },
    },
  },
  aws_apigatewayv2_stage: {
    name: 'Estágio de API',
    shortName: 'Estágio',
    description: 'Uma versão implantada e invocável de uma API',
    fields: { name: { doc: '"$default" responde na raiz da API' } },
  },
  aws_lambda_permission: {
    name: 'Permissão da Lambda',
    shortName: 'Permissão de invocação',
    description: 'Permite que um serviço (API Gateway, SNS, S3…) invoque uma função',
    fields: { source_arn: { doc: 'Restringe a uma API / um tópico / um bucket' } },
  },
  aws_iam_role_policy: {
    name: 'Política de perfil do IAM',
    shortName: 'Política do perfil',
    description: 'Permissões inline anexadas a um perfil',
    fields: { policy: JSON_POLICY },
  },
  aws_sqs_queue: {
    name: 'Fila SQS',
    shortName: 'SQS',
    description: 'Fila de mensagens gerenciada',
    fields: { name: { doc: 'Nomes de filas FIFO precisam terminar em .fifo' } },
  },
  aws_sns_topic: { name: 'Tópico SNS', shortName: 'SNS', description: 'Tópico de notificações pub/sub' },
  aws_sns_topic_subscription: {
    name: 'Assinatura SNS',
    shortName: 'Assinatura',
    description: 'Entrega as mensagens do tópico a uma fila, função ou endpoint',
  },
  aws_dynamodb_table: {
    name: 'Tabela do DynamoDB',
    shortName: 'DynamoDB',
    description: 'Banco de dados chave-valor / de documentos sem servidor',
    fields: { hash_key: { doc: 'Precisa de um bloco attribute correspondente' } },
  },
  aws_elasticache_cluster: {
    name: 'Cluster do ElastiCache',
    shortName: 'ElastiCache',
    description: 'Cache Redis ou Memcached gerenciado',
    fields: {
      cluster_id: { doc: 'Letras minúsculas, dígitos e hifens, até 50' },
      num_cache_nodes: { doc: 'Precisa ser 1 para Redis' },
      subnet_group_name: { label: 'Grupo de sub-redes do cache' },
      security_group_ids: SECURITY_GROUPS,
    },
  },
  aws_kms_key: {
    name: 'Chave do KMS',
    shortName: 'KMS',
    description: 'Chave de criptografia gerenciada',
    fields: { deletion_window_in_days: { doc: '7–30 dias' } },
  },
  aws_secretsmanager_secret: {
    name: 'Segredo do Secrets Manager',
    shortName: 'Segredo',
    description: 'Guarda credenciais, tokens e chaves de API',
    fields: {
      kms_key_id: { label: 'Chave do KMS' },
      recovery_window_in_days: { doc: '0 exclui na hora; senão, 7–30' },
    },
  },
  aws_eks_cluster: {
    name: 'Cluster EKS',
    shortName: 'EKS',
    description: 'Plano de controle Kubernetes gerenciado',
    fields: { version: { doc: 'Versão secundária do Kubernetes' } },
  },
  aws_eks_node_group: {
    name: 'Grupo de nós do EKS',
    shortName: 'Grupo de nós',
    description: 'Nós de trabalho gerenciados de um cluster EKS',
    fields: { subnet_ids: SUBNETS },
  },
  aws_vpc_security_group_ingress_rule: {
    name: 'Regra de entrada do SG',
    shortName: 'Regra de entrada',
    description: 'Uma regra de entrada de um grupo de segurança (recomendada no lugar de regras inline)',
    fields: { referenced_security_group_id: { label: 'Do grupo de segurança' } },
  },
  aws_vpc_security_group_egress_rule: {
    name: 'Regra de saída do SG',
    shortName: 'Regra de saída',
    description: 'Uma regra de saída de um grupo de segurança',
    fields: { referenced_security_group_id: { label: 'Para o grupo de segurança' } },
  },
  aws_network_acl: {
    name: 'ACL de rede',
    shortName: 'NACL',
    description: 'Firewall sem estado da sub-rede, com regras numeradas de permitir / negar',
    fields: { subnet_ids: SUBNETS },
  },
  aws_route_table: {
    name: 'Tabela de rotas',
    shortName: 'Tabela de rotas',
    description: 'Rotas das sub-redes — uma rota 0.0.0.0/0 para um internet gateway as torna públicas',
  },
  aws_route_table_association: {
    name: 'Associação de tabela de rotas',
    shortName: 'Associação de RT',
    description: 'Associa uma tabela de rotas a uma sub-rede',
  },
  aws_s3_bucket_public_access_block: {
    name: 'Bloqueio de acesso público do S3',
    shortName: 'Bloqueio de acesso público',
    description: 'Garante que um bucket nunca possa se tornar público',
  },
  aws_db_subnet_group: {
    name: 'Grupo de sub-redes do banco',
    shortName: 'Sub-redes do banco',
    description: 'Sub-redes privadas (2+ AZs) onde o RDS coloca o banco de dados',
    fields: { subnet_ids: SUBNETS },
  },
  aws_elasticache_subnet_group: {
    name: 'Grupo de sub-redes do cache',
    shortName: 'Sub-redes do cache',
    description: 'Sub-redes privadas onde o ElastiCache coloca os nós do cache',
    fields: { subnet_ids: SUBNETS },
  },

  /* ---------------------------------------------------------------- Azure */
  azurerm_resource_group: {
    name: 'Grupo de recursos',
    shortName: 'Grupo de recursos',
    description: 'Contêiner lógico de recursos do Azure',
  },
  azurerm_virtual_network: { name: 'Rede virtual', shortName: 'VNet', description: 'Rede isolada no Azure' },
  azurerm_subnet: { name: 'Sub-rede', shortName: 'Sub-rede', description: 'Sub-rede dentro de uma VNet' },
  azurerm_network_security_group: {
    name: 'Grupo de segurança de rede',
    shortName: 'NSG',
    description: 'Regras que filtram o tráfego de rede',
  },
  azurerm_network_interface: { name: 'Interface de rede', shortName: 'NIC', description: 'Interface de rede virtual de uma VM' },
  azurerm_linux_virtual_machine: {
    name: 'Máquina virtual Linux',
    shortName: 'VM do Azure',
    description: 'Máquina virtual Linux',
    fields: { network_interface_ids: { label: 'Interfaces de rede' } },
  },
  azurerm_storage_account: {
    name: 'Conta de armazenamento',
    // the service's name: "ARMAZENAMENTO" alone is wider than a canvas node's header
    shortName: 'Storage',
    description: 'Armazenamento de blobs / arquivos / filas',
    fields: { name: { doc: '3–24 letras minúsculas e números, único globalmente' } },
  },
  azurerm_storage_account_static_website: {
    name: 'Site estático',
    shortName: 'Site estático',
    description: 'Serve o contêiner $web de uma conta de armazenamento como site',
    fields: { storage_account_id: { label: 'Conta de armazenamento' } },
  },
  azurerm_mssql_server: {
    name: 'SQL Server',
    shortName: 'SQL Server',
    description: 'SQL Server gerenciado',
    fields: {
      administrator_login: { doc: 'Ou autenticação do Microsoft Entra' },
      administrator_login_password: { doc: 'Prefira var.sql_admin_password a um valor literal' },
    },
  },
  azurerm_cdn_profile: { name: 'Perfil da CDN', shortName: 'Perfil da CDN', description: 'Contêiner de endpoints da CDN' },
  azurerm_cdn_endpoint: {
    name: 'Endpoint da CDN',
    shortName: 'Endpoint da CDN',
    description: 'Serve conteúdo em cache a partir da borda',
  },
  azurerm_mssql_database: { name: 'Banco de dados SQL', shortName: 'BD SQL', description: 'Banco de dados em um SQL Server' },
  azurerm_public_ip: { name: 'IP público', shortName: 'IP público', description: 'Endereço IP público estático ou dinâmico' },
  azurerm_service_plan: {
    name: 'Plano do App Service',
    shortName: 'Plano de serviço',
    description: 'Computação que hospeda aplicativos web e de funções',
    fields: { sku_name: { doc: 'Y1 = plano de consumo do Functions' } },
  },
  azurerm_linux_web_app: {
    name: 'Aplicativo web Linux',
    shortName: 'Aplicativo web',
    description: 'Aplicativo web gerenciado (App Service)',
    fields: { name: { doc: 'Único globalmente (vira <nome>.azurewebsites.net)' } },
  },
  azurerm_linux_function_app: {
    name: 'Aplicativo de funções Linux',
    shortName: 'Aplicativo de funções',
    description: 'Funções sem servidor no App Service',
    fields: {
      storage_account_name: { doc: 'Ou defina storage_key_vault_secret_id' },
      storage_account_access_key: { doc: 'Em geral, azurerm_storage_account.<nome>.primary_access_key' },
    },
  },
  azurerm_kubernetes_cluster: {
    name: 'Cluster AKS',
    shortName: 'AKS',
    description: 'Kubernetes gerenciado',
    fields: { dns_prefix: { doc: 'Ou dns_prefix_private_cluster' } },
  },
  azurerm_container_registry: {
    name: 'Registro de contêiner',
    shortName: 'ACR',
    description: 'Registro privado de imagens de contêiner',
    fields: { name: { doc: '5–50 letras e números, único globalmente' } },
  },
  azurerm_key_vault: {
    name: 'Key Vault',
    shortName: 'Key Vault',
    description: 'Segredos, chaves e certificados',
    fields: {
      name: { doc: '3–24 caracteres, único globalmente' },
      tenant_id: {
        doc: 'Valor provisório — use o ID do seu tenant, em geral data.azurerm_client_config.current.tenant_id (adicione `data "azurerm_client_config" "current" {}`)',
      },
      rbac_authorization_enabled: { doc: 'RBAC do Azure em vez de políticas de acesso (obrigatório a partir do azurerm 5)' },
      soft_delete_retention_days: { doc: '7–90 dias' },
    },
  },
  azurerm_postgresql_flexible_server: {
    name: 'Servidor flexível do PostgreSQL',
    shortName: 'PostgreSQL',
    description: 'PostgreSQL gerenciado',
    fields: { administrator_password: { doc: 'Prefira var.pg_admin_password a um valor literal' } },
  },
  azurerm_redis_cache: {
    name: 'Cache do Azure para Redis',
    shortName: 'Redis',
    description: 'Cache em memória gerenciado',
    fields: { capacity: { doc: 'Tamanho dentro da família (C: 0–6, P: 1–5)' } },
  },
  azurerm_servicebus_namespace: {
    name: 'Namespace do Service Bus',
    shortName: 'Service Bus',
    description: 'Contêiner de filas e tópicos',
    fields: { name: GLOBALLY_UNIQUE },
  },
  azurerm_servicebus_queue: { name: 'Fila do Service Bus', shortName: 'Fila', description: 'Fila de mensagens durável' },
  azurerm_subnet_network_security_group_association: {
    name: 'Associação de NSG à sub-rede',
    shortName: 'Associação de NSG',
    description: 'Aplica um grupo de segurança de rede a uma sub-rede',
  },

  /* ------------------------------------------------------------------ GCP */
  google_compute_network: { name: 'Rede VPC', shortName: 'Rede VPC', description: 'Rede virtual global' },
  google_compute_subnetwork: { name: 'Sub-rede', shortName: 'Sub-rede', description: 'Sub-rede regional' },
  google_compute_firewall: {
    name: 'Regra de firewall',
    shortName: 'Firewall',
    description: 'Regra de firewall da rede',
    fields: {
      priority: { doc: '0–65535, o menor vence (padrão 1000)' },
      source_ranges: { doc: 'INGRESS precisa de intervalos de origem ou de tags de origem' },
      target_tags: { doc: 'Vale para as instâncias com essas tags de rede (todas, se vazio)' },
    },
  },
  google_compute_instance: { name: 'Instância do Compute Engine', shortName: 'Compute', description: 'Máquina virtual' },
  google_storage_bucket: {
    name: 'Bucket do Cloud Storage',
    shortName: 'Cloud Storage',
    description: 'Bucket de armazenamento de objetos',
    fields: { name: GLOBALLY_UNIQUE },
  },
  google_sql_database_instance: {
    name: 'Instância do Cloud SQL',
    shortName: 'Cloud SQL',
    description: 'Banco de dados relacional gerenciado',
  },
  google_compute_backend_bucket: {
    name: 'Bucket de back-end',
    shortName: 'Bucket de back-end',
    description: 'Serve um bucket de armazenamento pelo balanceador de carga',
  },
  google_compute_url_map: { name: 'Mapa de URL', shortName: 'Mapa de URL', description: 'Encaminha as solicitações para os back-ends' },
  google_compute_target_http_proxy: {
    name: 'Proxy HTTP',
    shortName: 'Proxy HTTP',
    description: 'Termina o HTTP do balanceador de carga',
  },
  google_compute_global_forwarding_rule: {
    name: 'Regra de encaminhamento',
    shortName: 'Regra de encaminhamento',
    description: 'Ponto de entrada anycast global',
  },
  google_artifact_registry_repository: {
    name: 'Artifact Registry',
    shortName: 'Artifact Registry',
    description: 'Registro de imagens de contêiner e de pacotes',
  },
  google_cloud_run_v2_service: { name: 'Serviço do Cloud Run', shortName: 'Cloud Run', description: 'Contêineres sem servidor' },
  google_dns_managed_zone: { name: 'Zona do Cloud DNS', shortName: 'Cloud DNS', description: 'Zona DNS gerenciada' },
  google_dns_record_set: {
    name: 'Conjunto de registros DNS',
    shortName: 'Registro DNS',
    description: 'Registro DNS em uma zona gerenciada',
    fields: { name: { doc: 'Totalmente qualificado, terminando em "." (www.example.com.)' } },
  },
  google_compute_router: {
    name: 'Cloud Router',
    shortName: 'Roteador',
    description: 'Roteador regional (necessário para o Cloud NAT)',
  },
  google_compute_router_nat: {
    name: 'Cloud NAT',
    shortName: 'Cloud NAT',
    description: 'Saída para a internet de instâncias privadas',
  },
  google_cloudfunctions2_function: {
    name: 'Função do Cloud Functions',
    shortName: 'Função',
    description: 'Função sem servidor (2ª geração)',
  },
  google_container_cluster: {
    name: 'Cluster GKE',
    shortName: 'GKE',
    description: 'Kubernetes gerenciado',
    fields: {
      location: { doc: 'Uma região (ou uma zona, para um cluster zonal)' },
      remove_default_node_pool: { doc: 'Gerencie os nós com pools de nós separados' },
    },
  },
  google_container_node_pool: {
    name: 'Pool de nós do GKE',
    shortName: 'Pool de nós',
    description: 'Grupo de nós de trabalho de um cluster GKE',
  },
  google_pubsub_topic: { name: 'Tópico do Pub/Sub', shortName: 'Pub/Sub', description: 'Tópico de mensagens assíncronas' },
  google_pubsub_subscription: {
    name: 'Assinatura do Pub/Sub',
    shortName: 'Assinatura',
    description: 'Entrega pull ou push a partir de um tópico',
  },
  google_redis_instance: { name: 'Memorystore for Redis', shortName: 'Memorystore', description: 'Redis gerenciado' },
  google_bigquery_dataset: {
    name: 'Conjunto de dados do BigQuery',
    shortName: 'BigQuery',
    description: 'Conjunto de dados de um data warehouse analítico',
    fields: { dataset_id: { doc: 'Letras, números e sublinhados' } },
  },
  google_service_account: {
    name: 'Conta de serviço',
    shortName: 'Conta de serviço',
    description: 'Identidade para cargas de trabalho',
    fields: { account_id: { doc: '6–30 letras minúsculas, dígitos e hifens' } },
  },
  google_secret_manager_secret: {
    name: 'Segredo do Secret Manager',
    shortName: 'Segredo',
    description: 'Guarda chaves de API, senhas e certificados',
  },
};
