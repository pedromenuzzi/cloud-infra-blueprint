/**
 * Benchmark control titles (compliance.ts). English is the published title;
 * Portuguese follows the AWS Security Hub documentation in Portuguese for
 * FSBP and a faithful rendering of the CIS wording ("Ensure…" → "Garantir
 * que…"). Control IDs, framework names and versions are never translated.
 */
import { defineMessages } from '@/i18n/messages';

export type ControlRef =
  | 'cis-aws 5.1'
  | 'cis-aws 5.2'
  | 'cis-aws 5.3'
  | 'cis-aws 5.4'
  | 'aws-fsbp EC2.2'
  | 'aws-fsbp EC2.8'
  | 'aws-fsbp EC2.13'
  | 'aws-fsbp EC2.14'
  | 'aws-fsbp EC2.18'
  | 'aws-fsbp EC2.19'
  | 'aws-fsbp EC2.21'
  | 'aws-fsbp RDS.2'
  | 'aws-fsbp RDS.3'
  | 'aws-fsbp S3.1'
  | 'aws-fsbp S3.8'
  | 'aws-fsbp ELB.1'
  | 'cis-azure 6.1'
  | 'cis-azure 6.2'
  | 'cis-gcp 3.6'
  | 'cis-gcp 3.7';

export const complianceMessages = defineMessages<Record<ControlRef, string>>(
  {
    'cis-aws 5.1': 'Ensure no Network ACLs allow ingress from 0.0.0.0/0 to remote server administration ports',
    'cis-aws 5.2': 'Ensure no security groups allow ingress from 0.0.0.0/0 to remote server administration ports',
    'cis-aws 5.3': 'Ensure no security groups allow ingress from ::/0 to remote server administration ports',
    'cis-aws 5.4': 'Ensure the default security group of every VPC restricts all traffic',
    'aws-fsbp EC2.2': 'VPC default security groups should not allow inbound or outbound traffic',
    'aws-fsbp EC2.8': 'EC2 instances should use Instance Metadata Service Version 2 (IMDSv2)',
    'aws-fsbp EC2.13': 'Security groups should not allow ingress from 0.0.0.0/0 or ::/0 to port 22',
    'aws-fsbp EC2.14': 'Security groups should not allow ingress from 0.0.0.0/0 or ::/0 to port 3389',
    'aws-fsbp EC2.18': 'Security groups should only allow unrestricted incoming traffic for authorized ports',
    'aws-fsbp EC2.19': 'Security groups should not allow unrestricted access to ports with high risk',
    'aws-fsbp EC2.21': 'Network ACLs should not allow ingress from 0.0.0.0/0 to port 22 or port 3389',
    'aws-fsbp RDS.2': 'RDS DB instances should prohibit public access, as determined by the PubliclyAccessible configuration',
    'aws-fsbp RDS.3': 'RDS DB instances should have encryption at-rest enabled',
    'aws-fsbp S3.1': 'S3 general purpose buckets should have block public access settings enabled',
    'aws-fsbp S3.8': 'S3 general purpose buckets should block public access',
    'aws-fsbp ELB.1': 'Application Load Balancer should be configured to redirect all HTTP requests to HTTPS',
    'cis-azure 6.1': 'Ensure that RDP access from the Internet is evaluated and restricted',
    'cis-azure 6.2': 'Ensure that SSH access from the Internet is evaluated and restricted',
    'cis-gcp 3.6': 'Ensure that SSH access is restricted from the internet',
    'cis-gcp 3.7': 'Ensure that RDP access is restricted from the internet',
  },
  {
    'cis-aws 5.1': 'Garantir que nenhuma ACL de rede permita entrada de 0.0.0.0/0 nas portas de administração remota de servidores',
    'cis-aws 5.2': 'Garantir que nenhum grupo de segurança permita entrada de 0.0.0.0/0 nas portas de administração remota de servidores',
    'cis-aws 5.3': 'Garantir que nenhum grupo de segurança permita entrada de ::/0 nas portas de administração remota de servidores',
    'cis-aws 5.4': 'Garantir que o grupo de segurança padrão de cada VPC restrinja todo o tráfego',
    'aws-fsbp EC2.2': 'Os grupos de segurança padrão da VPC não devem permitir tráfego de entrada nem de saída',
    'aws-fsbp EC2.8': 'As instâncias EC2 devem usar o Instance Metadata Service versão 2 (IMDSv2)',
    'aws-fsbp EC2.13': 'Os grupos de segurança não devem permitir entrada de 0.0.0.0/0 ou ::/0 na porta 22',
    'aws-fsbp EC2.14': 'Os grupos de segurança não devem permitir entrada de 0.0.0.0/0 ou ::/0 na porta 3389',
    'aws-fsbp EC2.18': 'Os grupos de segurança só devem permitir tráfego de entrada irrestrito em portas autorizadas',
    'aws-fsbp EC2.19': 'Os grupos de segurança não devem permitir acesso irrestrito a portas de alto risco',
    'aws-fsbp EC2.21': 'As ACLs de rede não devem permitir entrada de 0.0.0.0/0 na porta 22 ou na porta 3389',
    'aws-fsbp RDS.2': 'As instâncias de banco de dados do RDS devem proibir o acesso público, conforme a configuração PubliclyAccessible',
    'aws-fsbp RDS.3': 'As instâncias de banco de dados do RDS devem ter a criptografia em repouso ativada',
    'aws-fsbp S3.1': 'Os buckets de uso geral do S3 devem ter as configurações de bloqueio de acesso público ativadas',
    'aws-fsbp S3.8': 'Os buckets de uso geral do S3 devem bloquear o acesso público',
    'aws-fsbp ELB.1': 'O Application Load Balancer deve ser configurado para redirecionar todas as requisições HTTP para HTTPS',
    'cis-azure 6.1': 'Garantir que o acesso RDP pela internet seja avaliado e restrito',
    'cis-azure 6.2': 'Garantir que o acesso SSH pela internet seja avaliado e restrito',
    'cis-gcp 3.6': 'Garantir que o acesso SSH pela internet seja restrito',
    'cis-gcp 3.7': 'Garantir que o acesso RDP pela internet seja restrito',
  },
);
