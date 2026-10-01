/**
 * The data source catalog in Brazilian Portuguese: every type's name, canvas
 * short name and description, and the presets that have a name or
 * description of their own. English stays in ./catalog.ts as the source;
 * read both through ./i18n.ts. Keyed by the catalog's types and preset keys,
 * so an entry added without a translation doesn't compile. Names follow the
 * consoles in Portuguese (src/i18n/GLOSSARY.md); product names stay.
 */
import type { DataSourcePresetKey, DataSourceType } from './catalog';

export interface DataSourceText {
  name: string;
  shortName: string;
  description: string;
}

export const DATA_TYPES_PT_BR: Record<DataSourceType, DataSourceText> = {
  aws_ami: { name: 'AMI', shortName: 'AMI', description: 'A imagem de máquina mais recente que atende a um filtro' },
  aws_availability_zones: {
    name: 'Zonas de disponibilidade',
    shortName: 'Zonas de disponibilidade',
    description: 'As zonas de disponibilidade da região',
  },
  aws_caller_identity: { name: 'Identidade da conta', shortName: 'Conta', description: 'O ID da conta e o ARN das credenciais em uso' },
  aws_region: { name: 'Região atual', shortName: 'Região', description: 'A região configurada no provider' },
  aws_partition: { name: 'Partição', shortName: 'Partição', description: 'A partição AWS (aws, aws-cn, aws-us-gov), para montar ARNs' },
  aws_iam_policy_document: {
    name: 'Documento de política do IAM',
    shortName: 'Documento de política',
    description: 'Uma política do IAM escrita em HCL e lida como JSON',
  },
  aws_vpc: {
    name: 'VPC existente',
    shortName: 'VPC existente',
    description: 'Uma VPC que já existe (a padrão, ou encontrada pelas tags)',
  },
  aws_subnets: { name: 'Sub-redes existentes', shortName: 'Sub-redes existentes', description: 'Os IDs das sub-redes que atendem a um filtro' },
  aws_route53_zone: {
    name: 'Zona do Route 53',
    shortName: 'Zona do Route 53',
    description: 'Uma zona hospedada que já existe, encontrada pelo domínio',
  },
  aws_acm_certificate: { name: 'Certificado ACM', shortName: 'Certificado', description: 'Um certificado emitido, encontrado pelo domínio' },
  aws_ssm_parameter: { name: 'Parâmetro do SSM', shortName: 'Parâmetro', description: 'Um valor guardado no Parameter Store' },
  aws_ecs_cluster: {
    name: 'Cluster ECS existente',
    shortName: 'Cluster ECS existente',
    description: 'Um cluster ECS que já existe, encontrado pelo nome',
  },
  azurerm_client_config: {
    name: 'Configuração do cliente',
    shortName: 'Configuração do cliente',
    description: 'Os IDs do tenant, da assinatura e do objeto das credenciais em uso',
  },
  azurerm_subscription: { name: 'Assinatura atual', shortName: 'Assinatura', description: 'A assinatura em que o provider trabalha' },
  azurerm_resource_group: {
    name: 'Grupo de recursos existente',
    shortName: 'Grupo de recursos existente',
    description: 'Um grupo de recursos que já existe, encontrado pelo nome',
  },
  azurerm_virtual_network: {
    name: 'Rede virtual existente',
    shortName: 'Rede virtual existente',
    description: 'Uma rede virtual que já existe, encontrada pelo nome',
  },
  azurerm_subnet: { name: 'Sub-rede existente', shortName: 'Sub-rede existente', description: 'Uma sub-rede que já existe em uma rede virtual' },
  azurerm_key_vault: {
    name: 'Cofre de chaves existente',
    shortName: 'Cofre de chaves existente',
    description: 'Um Key Vault que já existe, encontrado pelo nome',
  },
  google_client_config: {
    name: 'Configuração do cliente',
    shortName: 'Configuração do cliente',
    description: 'O projeto, a região e o token de acesso que o provider usa',
  },
  google_project: { name: 'Projeto atual', shortName: 'Projeto', description: 'O projeto em que o provider trabalha: o ID e o número dele' },
  google_compute_zones: { name: 'Zonas do Compute', shortName: 'Zonas', description: 'As zonas disponíveis em uma região' },
  google_compute_network: {
    name: 'Rede VPC existente',
    shortName: 'Rede VPC existente',
    description: 'Uma rede VPC que já existe, encontrada pelo nome',
  },
  google_compute_subnetwork: {
    name: 'Sub-rede existente',
    shortName: 'Sub-rede existente',
    description: 'Uma sub-rede que já existe em uma região',
  },
  google_compute_image: { name: 'Imagem do Compute', shortName: 'Imagem', description: 'A imagem mais recente de uma família' },
  terraform_remote_state: {
    name: 'Estado remoto',
    shortName: 'Estado remoto',
    description: 'Os outputs do estado de outra configuração do Terraform',
  },
};

/** presets with a name or description of their own (the others read as their type) */
export const DATA_PRESETS_PT_BR: Partial<Record<DataSourcePresetKey, { name?: string; description?: string }>> = {
  'aws_ami.ubuntu': { name: 'AMI Ubuntu', description: 'A imagem Ubuntu 24.04 LTS mais recente, publicada pela Canonical' },
  'aws_ami.al2023': { name: 'AMI Amazon Linux', description: 'A imagem Amazon Linux 2023 mais recente, publicada pela AWS' },
  aws_iam_policy_document: { description: 'Uma política de confiança que permite ao EC2 assumir um perfil, lida como JSON' },
  'google_compute_image.debian': { name: 'Imagem Debian', description: 'A imagem Debian 12 mais recente, publicada pelo Google' },
};
