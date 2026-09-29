/**
 * Template text shown in the UI, in Portuguese. English is the source and
 * lives with each template in ./index.ts (tests and generated names rely on
 * it); the template HCL, comments included, is never translated. The types
 * make a missing template or tag a compile error. Read through ./i18n.ts.
 */
import type { TemplateSlug, TemplateTag } from './index';

export interface TemplateText {
  name: string;
  description: string;
}

export const TEMPLATE_TEXT_PT: Record<TemplateSlug, TemplateText> = {
  'aws-web-app': {
    name: 'App web na AWS',
    description:
      'VPC com duas sub-redes públicas atrás de um internet gateway, um servidor web EC2, RDS PostgreSQL e grupos de segurança.',
  },
  'aws-static-site': {
    name: 'Site estático com CDN',
    description: 'Bucket S3 servido pelo CloudFront, com registros DNS no Route 53.',
  },
  'aws-container-stack': {
    name: 'Stack ECS Fargate',
    description: 'Serviço ECS Fargate atrás de um ALB, com registro ECR e toda a rede da VPC.',
  },
  'aws-serverless-api': {
    name: 'API sem servidor na AWS',
    description: 'API Gateway HTTP → Lambda → DynamoDB, com um perfil do IAM de privilégio mínimo.',
  },
  'aws-secure-3tier': {
    name: 'App seguro em 3 camadas na AWS',
    description:
      'Arquitetura de referência com nota A: ALB só com HTTPS, camadas de aplicação e de dados privadas, grupos de segurança encadeados, NACLs, NAT e RDS criptografado.',
  },
  'azure-web-app': {
    name: 'App web no Azure',
    description: 'Grupo de recursos com VNet, VM Linux, NSG e banco de dados Azure SQL.',
  },
  'azure-static-site': {
    name: 'Site estático no Azure',
    description: 'Site estático no Blob Storage servido pelo Azure CDN.',
  },
  'gcp-web-app': {
    name: 'App web no GCP',
    description: 'Rede VPC com um servidor web no Compute Engine, regras de firewall e Cloud SQL.',
  },
  'gcp-cloud-run': {
    name: 'Cloud Run no GCP',
    description: 'Contêineres sem servidor no Cloud Run, com imagens vindas do Artifact Registry.',
  },
  'gcp-static-site': {
    name: 'Site estático no GCP',
    description: 'Bucket do Cloud Storage atrás de um balanceador de carga HTTP global, com Cloud CDN e DNS.',
  },
  'multi-cloud-dr': {
    name: 'DR multicloud',
    description:
      'Bucket S3 principal com réplica warm no GCP, arquivo frio no Azure e DNS de failover no Route 53.',
  },
};

export const TEMPLATE_TAGS_PT: Record<TemplateTag, string> = {
  'Web Apps': 'Apps web',
  'Static Sites': 'Sites estáticos',
  Containers: 'Contêineres',
  Serverless: 'Sem servidor',
  Security: 'Segurança',
  Data: 'Dados',
};
