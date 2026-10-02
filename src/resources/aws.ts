import type { Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { block, list, lit, literalString, raw } from '@/ir/expr';
import type { Expression } from '@/ir/types';
import { blocksOf } from '@/security/model';
import { resourceMessages } from './messages';
import { defineResource } from './types';

const litStr = literalString;
/** subtitle text in the UI language (or `locale`) */
const t = (locale?: Locale) => messagesFor(resourceMessages, locale);

/** "2 subnets" — subtitle of a subnet group */
const subnetCount = (args: Record<string, Expression>, locale?: Locale) =>
  t(locale).subnetCount(args.subnet_ids?.kind === 'list' ? args.subnet_ids.items.length : 0);

export const AWS_RESOURCES = [
  defineResource({
    type: 'aws_vpc',
    provider: 'aws',
    category: 'network',
    displayName: 'VPC',
    shortName: 'VPC',
    description: 'Isolated virtual network',
    container: true,
    fields: [
      { name: 'cidr_block', type: 'string', placeholder: '10.0.0.0/16' },
      { name: 'enable_dns_support', type: 'boolean' },
      { name: 'enable_dns_hostnames', type: 'boolean' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: { cidr_block: lit('10.0.0.0/16') },
    subtitle: (args) => litStr(args.cidr_block),
  }),

  defineResource({
    type: 'aws_subnet',
    provider: 'aws',
    category: 'network',
    displayName: 'Subnet',
    shortName: 'Subnet',
    description: 'Subnet inside a VPC',
    container: true,
    containment: [{ arg: 'vpc_id', parentTypes: ['aws_vpc'] }],
    fields: [
      { name: 'vpc_id', type: 'string', required: true, refTo: ['aws_vpc'] },
      { name: 'cidr_block', type: 'string', placeholder: '10.0.1.0/24' },
      { name: 'availability_zone', type: 'string', placeholder: 'us-east-1a' },
      { name: 'map_public_ip_on_launch', type: 'boolean' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: { cidr_block: lit('10.0.1.0/24') },
    subnetCidr: { arg: 'cidr_block', parentArg: 'cidr_block' },
    connections: [{ targetTypes: ['aws_vpc'], arg: 'vpc_id', attr: 'id', mode: 'set' }],
    subtitle: (args) => litStr(args.cidr_block),
  }),

  defineResource({
    type: 'aws_security_group',
    provider: 'aws',
    category: 'identity',
    displayName: 'Security Group',
    shortName: 'Security Group',
    description: 'Stateful firewall rules',
    containment: [{ arg: 'vpc_id', parentTypes: ['aws_vpc'] }],
    naming: { maxLength: 255 },
    fields: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'vpc_id', type: 'string', refTo: ['aws_vpc'] },
      { name: 'tags', type: 'tags' },
    ],
    connections: [{ targetTypes: ['aws_vpc'], arg: 'vpc_id', attr: 'id', mode: 'set' }],
    subtitle: (args, locale) => {
      const inbound = blocksOf(args.ingress).length;
      const outbound = blocksOf(args.egress).length;
      if (inbound + outbound === 0) return litStr(args.description) ?? t(locale).noInlineRules;
      return t(locale).inboundOutbound(inbound, outbound);
    },
  }),

  defineResource({
    type: 'aws_instance',
    provider: 'aws',
    category: 'compute',
    displayName: 'EC2 Instance',
    shortName: 'EC2',
    description: 'Virtual machine',
    containment: [{ arg: 'subnet_id', parentTypes: ['aws_subnet'] }],
    fields: [
      { name: 'ami', type: 'string', placeholder: 'ami-0c02fb55956c7d316' },
      {
        name: 'instance_type',
        type: 'select',
        options: ['t3.micro', 't3.small', 't3.medium', 't3.large', 'm5.large', 'c5.large'],
      },
      { name: 'subnet_id', type: 'string', refTo: ['aws_subnet'] },
      {
        name: 'vpc_security_group_ids',
        type: 'list',
        refTo: ['aws_security_group'],
        label: 'Security groups',
      },
      { name: 'key_name', type: 'string' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: {
      ami: lit('ami-0c02fb55956c7d316'),
      instance_type: lit('t3.micro'),
    },
    connections: [
      { targetTypes: ['aws_subnet'], arg: 'subnet_id', attr: 'id', mode: 'set' },
      { targetTypes: ['aws_security_group'], arg: 'vpc_security_group_ids', attr: 'id', mode: 'append' },
    ],
    subtitle: (args) => litStr(args.instance_type),
  }),

  defineResource({
    type: 'aws_db_instance',
    provider: 'aws',
    category: 'database',
    displayName: 'RDS Instance',
    shortName: 'RDS',
    description: 'Managed relational database',
    fields: [
      { name: 'identifier', type: 'string' },
      {
        name: 'engine',
        type: 'select',
        options: ['postgres', 'mysql', 'mariadb'],
      },
      { name: 'engine_version', type: 'string', placeholder: '15.4' },
      {
        name: 'instance_class',
        type: 'select',
        required: true,
        options: ['db.t3.micro', 'db.t3.small', 'db.t3.medium', 'db.m5.large'],
      },
      { name: 'allocated_storage', type: 'number', min: 20, max: 65536, doc: 'GiB' },
      { name: 'username', type: 'string' },
      { name: 'password', type: 'string', doc: 'Prefer var.db_password over a literal' },
      {
        name: 'db_subnet_group_name',
        type: 'string',
        refTo: ['aws_db_subnet_group'],
        refAttr: 'name',
        label: 'DB subnet group',
        doc: 'The subnets (2+ AZs) the database runs in',
      },
      {
        name: 'vpc_security_group_ids',
        type: 'list',
        refTo: ['aws_security_group'],
        label: 'Security groups',
      },
      { name: 'skip_final_snapshot', type: 'boolean' },
    ],
    defaults: {
      engine: lit('postgres'),
      instance_class: lit('db.t3.micro'),
      allocated_storage: lit(20),
    },
    // not in one subnet: RDS runs in a DB subnet group that spans several
    containment: [{ arg: 'db_subnet_group_name', parentTypes: ['aws_db_subnet_group'] }],
    connections: [
      { targetTypes: ['aws_db_subnet_group'], arg: 'db_subnet_group_name', attr: 'name', mode: 'set' },
      { targetTypes: ['aws_security_group'], arg: 'vpc_security_group_ids', attr: 'id', mode: 'append' },
    ],
    subtitle: (args) => {
      const engine = litStr(args.engine);
      const version = litStr(args.engine_version);
      return engine ? `${engine}${version ? ` ${version}` : ''}` : undefined;
    },
  }),

  defineResource({
    type: 'aws_rds_cluster',
    provider: 'aws',
    category: 'database',
    displayName: 'Aurora Cluster',
    shortName: 'Aurora',
    description: 'Managed Aurora database cluster (MySQL or PostgreSQL compatible)',
    nameArg: 'cluster_identifier',
    naming: { maxLength: 63 },
    fields: [
      { name: 'cluster_identifier', type: 'string', doc: 'Lowercase letters, digits and hyphens, up to 63' },
      { name: 'engine', type: 'select', required: true, options: ['aurora-postgresql', 'aurora-mysql'] },
      { name: 'engine_version', type: 'string', placeholder: '16.4' },
      { name: 'database_name', type: 'string' },
      { name: 'master_username', type: 'string' },
      { name: 'manage_master_user_password', type: 'boolean', doc: 'Keeps the password in Secrets Manager' },
      {
        name: 'db_subnet_group_name',
        type: 'string',
        refTo: ['aws_db_subnet_group'],
        refAttr: 'name',
        label: 'DB subnet group',
        doc: 'The subnets (2+ AZs) the cluster runs in',
      },
      {
        name: 'vpc_security_group_ids',
        type: 'list',
        refTo: ['aws_security_group'],
        label: 'Security groups',
      },
      { name: 'storage_encrypted', type: 'boolean' },
      { name: 'skip_final_snapshot', type: 'boolean' },
    ],
    defaults: {
      engine: lit('aurora-postgresql'),
      master_username: lit('dbadmin'),
      manage_master_user_password: lit(true),
      storage_encrypted: lit(true),
    },
    // its instances (aws_rds_cluster_instance) are drawn inside it
    container: true,
    // like an RDS instance: it runs in a DB subnet group that spans several zones
    containment: [{ arg: 'db_subnet_group_name', parentTypes: ['aws_db_subnet_group'] }],
    connections: [
      { targetTypes: ['aws_db_subnet_group'], arg: 'db_subnet_group_name', attr: 'name', mode: 'set' },
      { targetTypes: ['aws_security_group'], arg: 'vpc_security_group_ids', attr: 'id', mode: 'append' },
    ],
    subtitle: (args) => {
      const engine = litStr(args.engine);
      const version = litStr(args.engine_version);
      return engine ? `${engine}${version ? ` ${version}` : ''}` : undefined;
    },
  }),

  defineResource({
    type: 'aws_rds_cluster_instance',
    provider: 'aws',
    category: 'database',
    displayName: 'Aurora Instance',
    shortName: 'Aurora Instance',
    description: 'A database instance of an Aurora cluster (the writer or a reader)',
    nameArg: 'identifier',
    naming: { maxLength: 63 },
    fields: [
      { name: 'identifier', type: 'string', doc: 'Lowercase letters, digits and hyphens, up to 63' },
      {
        name: 'cluster_identifier',
        type: 'string',
        required: true,
        refTo: ['aws_rds_cluster'],
        label: 'Aurora cluster',
        doc: 'The cluster it belongs to: its storage, network and engine',
      },
      {
        name: 'instance_class',
        type: 'select',
        required: true,
        options: [
          'db.t4g.medium',
          'db.t4g.large',
          'db.t3.medium',
          'db.r6g.large',
          'db.r6g.xlarge',
          'db.r7g.large',
          'db.r7g.xlarge',
          'db.r8g.large',
          'db.r6i.large',
          'db.serverless',
        ],
        doc: 'db.serverless: Aurora Serverless v2, sized by the cluster',
      },
      { name: 'engine', type: 'select', required: true, options: ['aurora-postgresql', 'aurora-mysql'], doc: "The cluster's engine" },
      { name: 'engine_version', type: 'string', placeholder: '16.4' },
      { name: 'publicly_accessible', type: 'boolean' },
    ],
    defaults: {
      instance_class: lit('db.t4g.medium'),
      engine: lit('aurora-postgresql'),
    },
    // dropped in a cluster, it takes the cluster's engine (and version) by reference
    inherit: ['engine', 'engine_version'],
    // instances belong to a cluster: drawn inside the one cluster_identifier names
    containment: [{ arg: 'cluster_identifier', parentTypes: ['aws_rds_cluster'] }],
    connections: [{ targetTypes: ['aws_rds_cluster'], arg: 'cluster_identifier', attr: 'id', mode: 'set' }],
    subtitle: (args) => litStr(args.instance_class),
  }),

  defineResource({
    type: 'aws_s3_bucket',
    provider: 'aws',
    category: 'storage',
    displayName: 'S3 Bucket',
    shortName: 'S3',
    description: 'Object storage bucket',
    naming: { minLength: 3, maxLength: 63 },
    fields: [
      { name: 'bucket', type: 'string', placeholder: 'my-unique-bucket-name', doc: 'Globally unique; AWS picks one when empty' },
      { name: 'force_destroy', type: 'boolean' },
      { name: 'tags', type: 'tags' },
    ],
    subtitle: (args) => litStr(args.bucket),
  }),

  defineResource({
    type: 'aws_iam_role',
    provider: 'aws',
    category: 'identity',
    displayName: 'IAM Role',
    shortName: 'IAM Role',
    description: 'Identity with assumable permissions',
    naming: { maxLength: 64 },
    fields: [
      { name: 'name', type: 'string' },
      { name: 'assume_role_policy', type: 'string', required: true, doc: 'JSON policy document' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: {
      assume_role_policy: raw(
        `jsonencode({\n    Version = "2012-10-17"\n    Statement = [{\n      Action    = "sts:AssumeRole"\n      Effect    = "Allow"\n      Principal = { Service = "ec2.amazonaws.com" }\n    }]\n  })`,
      ),
    },
    subtitle: (_, locale) => t(locale).iamRole,
  }),

  defineResource({
    type: 'aws_lb',
    provider: 'aws',
    category: 'network',
    displayName: 'Application Load Balancer',
    shortName: 'ALB',
    description: 'Load balancer for HTTP/TCP traffic',
    naming: { maxLength: 32 },
    fields: [
      { name: 'name', type: 'string', doc: 'Letters, digits and hyphens, up to 32' },
      { name: 'internal', type: 'boolean' },
      {
        name: 'load_balancer_type',
        type: 'select',
        options: ['application', 'network'],
      },
      { name: 'subnets', type: 'list', refTo: ['aws_subnet'] },
      { name: 'security_groups', type: 'list', refTo: ['aws_security_group'] },
    ],
    defaults: { load_balancer_type: lit('application') },
    connections: [
      { targetTypes: ['aws_subnet'], arg: 'subnets', attr: 'id', mode: 'append' },
      { targetTypes: ['aws_security_group'], arg: 'security_groups', attr: 'id', mode: 'append' },
    ],
    subtitle: (args, locale) => litStr(args.load_balancer_type) ?? t(locale).loadBalancer,
  }),

  defineResource({
    type: 'aws_lb_target_group',
    provider: 'aws',
    category: 'network',
    displayName: 'Target Group',
    shortName: 'Target Group',
    description: 'Routes requests to registered targets',
    containment: [{ arg: 'vpc_id', parentTypes: ['aws_vpc'] }],
    naming: { maxLength: 32 },
    fields: [
      { name: 'name', type: 'string', doc: 'Letters, digits and hyphens, up to 32' },
      { name: 'port', type: 'number', min: 1, max: 65535 },
      { name: 'protocol', type: 'select', options: ['HTTP', 'HTTPS', 'TCP'] },
      { name: 'vpc_id', type: 'string', refTo: ['aws_vpc'] },
      { name: 'target_type', type: 'select', options: ['instance', 'ip', 'lambda'] },
    ],
    defaults: { port: lit(80), protocol: lit('HTTP') },
    connections: [{ targetTypes: ['aws_vpc'], arg: 'vpc_id', attr: 'id', mode: 'set' }],
    subtitle: (args) => {
      const port = args.port?.kind === 'literal' ? String(args.port.value) : undefined;
      return port ? `${litStr(args.protocol) ?? 'HTTP'}:${port}` : undefined;
    },
  }),

  defineResource({
    type: 'aws_lb_listener',
    provider: 'aws',
    category: 'network',
    displayName: 'ALB Listener',
    shortName: 'Listener',
    description: 'Listens on a port and forwards to a target group',
    fields: [
      { name: 'load_balancer_arn', type: 'string', refTo: ['aws_lb'], refAttr: 'arn', required: true },
      { name: 'port', type: 'number', min: 1, max: 65535 },
      { name: 'protocol', type: 'select', options: ['HTTP', 'HTTPS'] },
      { name: 'certificate_arn', type: 'string', doc: 'ACM certificate (required for HTTPS)' },
      {
        name: 'ssl_policy',
        type: 'select',
        options: ['ELBSecurityPolicy-TLS13-1-2-2021-06', 'ELBSecurityPolicy-TLS13-1-3-2021-06'],
      },
    ],
    defaults: {
      port: lit(80),
      protocol: lit('HTTP'),
      // until it forwards to a target group, answer every request with a 404
      default_action: block({
        type: lit('fixed-response'),
        fixed_response: block({ content_type: lit('text/plain'), status_code: lit('404') }),
      }),
    },
    connections: [
      { targetTypes: ['aws_lb'], arg: 'load_balancer_arn', attr: 'arn', mode: 'set' },
    ],
    subtitle: (args) => {
      const port = args.port?.kind === 'literal' ? String(args.port.value) : undefined;
      return port ? `${litStr(args.protocol) ?? 'HTTP'}:${port}` : undefined;
    },
  }),

  defineResource({
    type: 'aws_ecr_repository',
    provider: 'aws',
    category: 'containers',
    displayName: 'ECR Repository',
    shortName: 'ECR',
    description: 'Private container image registry',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'image_tag_mutability', type: 'select', options: ['MUTABLE', 'IMMUTABLE'] },
    ],
    subtitle: (_, locale) => t(locale).containerRegistry,
  }),

  defineResource({
    type: 'aws_ecs_cluster',
    provider: 'aws',
    category: 'containers',
    displayName: 'ECS Cluster',
    shortName: 'ECS Cluster',
    description: 'Container orchestration cluster',
    container: true,
    fields: [{ name: 'name', type: 'string', required: true }],
    subtitle: () => 'Fargate / EC2',
  }),

  defineResource({
    type: 'aws_ecs_service',
    provider: 'aws',
    category: 'containers',
    displayName: 'ECS Service',
    shortName: 'ECS Service',
    description: 'Long-running task scheduler',
    containment: [{ arg: 'cluster', parentTypes: ['aws_ecs_cluster'] }],
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'cluster', type: 'string', refTo: ['aws_ecs_cluster'] },
      {
        name: 'task_definition',
        type: 'string',
        refTo: ['aws_ecs_task_definition'],
        refAttr: 'arn',
      },
      { name: 'desired_count', type: 'number', min: 0 },
      { name: 'launch_type', type: 'select', options: ['FARGATE', 'EC2'] },
    ],
    defaults: { desired_count: lit(2), launch_type: lit('FARGATE') },
    connections: [
      { targetTypes: ['aws_ecs_cluster'], arg: 'cluster', attr: 'id', mode: 'set' },
      { targetTypes: ['aws_ecs_task_definition'], arg: 'task_definition', attr: 'arn', mode: 'set' },
    ],
    subtitle: (args) => {
      const count = args.desired_count?.kind === 'literal' ? args.desired_count.value : undefined;
      return `${litStr(args.launch_type) ?? 'FARGATE'}${count !== undefined ? ` ×${count}` : ''}`;
    },
  }),

  defineResource({
    type: 'aws_ecs_task_definition',
    provider: 'aws',
    category: 'containers',
    displayName: 'ECS Task Definition',
    shortName: 'Task Def',
    description: 'Blueprint for containers to run',
    nameArg: 'family',
    fields: [
      { name: 'family', type: 'string', required: true },
      { name: 'cpu', type: 'select', options: ['256', '512', '1024', '2048'] },
      { name: 'memory', type: 'select', options: ['512', '1024', '2048', '4096'] },
      { name: 'network_mode', type: 'select', options: ['awsvpc', 'bridge', 'host'] },
      { name: 'container_definitions', type: 'string', required: true, doc: 'JSON list of containers (jsonencode)' },
    ],
    defaults: {
      cpu: lit('256'),
      memory: lit('512'),
      network_mode: lit('awsvpc'),
      requires_compatibilities: list([lit('FARGATE')]),
      container_definitions: raw(
        `jsonencode([{\n    name         = "app"\n    image        = "public.ecr.aws/nginx/nginx:latest"\n    essential    = true\n    portMappings = [{ containerPort = 80 }]\n  }])`,
      ),
    },
    subtitle: (args, locale) => {
      const cpu = litStr(args.cpu);
      return cpu ? t(locale).cpuUnits(cpu) : undefined;
    },
  }),

  defineResource({
    type: 'aws_cloudfront_distribution',
    provider: 'aws',
    category: 'edge',
    displayName: 'CloudFront Distribution',
    shortName: 'CloudFront',
    description: 'Global CDN',
    fields: [
      { name: 'enabled', type: 'boolean', required: true },
      { name: 'default_root_object', type: 'string', placeholder: 'index.html' },
      {
        name: 'price_class',
        type: 'select',
        options: ['PriceClass_100', 'PriceClass_200', 'PriceClass_All'],
      },
    ],
    defaults: {
      enabled: lit(true),
      // placeholder origin: point domain_name at your site, bucket or load balancer
      origin: block({
        domain_name: lit('origin.example.com'),
        origin_id: lit('origin'),
        custom_origin_config: block({
          http_port: lit(80),
          https_port: lit(443),
          origin_protocol_policy: lit('https-only'),
          origin_ssl_protocols: list([lit('TLSv1.2')]),
        }),
      }),
      default_cache_behavior: block({
        allowed_methods: list([lit('GET'), lit('HEAD')]),
        cached_methods: list([lit('GET'), lit('HEAD')]),
        target_origin_id: lit('origin'),
        viewer_protocol_policy: lit('redirect-to-https'),
        // AWS managed cache policy "CachingOptimized"
        cache_policy_id: lit('658327ea-f89d-4fab-a63d-7e88639e58f6'),
      }),
      restrictions: block({ geo_restriction: block({ restriction_type: lit('none') }) }),
      viewer_certificate: block({ cloudfront_default_certificate: lit(true) }),
    },
    subtitle: () => 'CDN',
  }),

  defineResource({
    type: 'aws_route53_zone',
    provider: 'aws',
    category: 'edge',
    displayName: 'Route 53 Zone',
    shortName: 'Route 53',
    description: 'DNS hosted zone',
    fields: [{ name: 'name', type: 'string', required: true, placeholder: 'example.com' }],
    subtitle: (args) => litStr(args.name),
  }),

  defineResource({
    type: 'aws_route53_record',
    provider: 'aws',
    category: 'edge',
    displayName: 'Route 53 Record',
    shortName: 'DNS Record',
    description: 'DNS record in a hosted zone',
    fields: [
      { name: 'zone_id', type: 'string', refTo: ['aws_route53_zone'], refAttr: 'zone_id', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'type', type: 'select', options: ['A', 'AAAA', 'CNAME', 'TXT', 'MX'], required: true },
      { name: 'ttl', type: 'number', min: 0 },
      { name: 'records', type: 'list', doc: 'Or an alias block (load balancer, CloudFront…)' },
    ],
    // 192.0.2.0/24 is reserved for documentation — replace with the real target
    defaults: { type: lit('A'), ttl: lit(300), records: list([lit('192.0.2.10')]) },
    connections: [
      { targetTypes: ['aws_route53_zone'], arg: 'zone_id', attr: 'zone_id', mode: 'set' },
    ],
    subtitle: (args) => litStr(args.type),
  }),

  defineResource({
    type: 'aws_internet_gateway',
    provider: 'aws',
    category: 'network',
    displayName: 'Internet Gateway',
    shortName: 'IGW',
    description: 'Connects a VPC to the internet',
    containment: [{ arg: 'vpc_id', parentTypes: ['aws_vpc'] }],
    fields: [
      { name: 'vpc_id', type: 'string', refTo: ['aws_vpc'] },
      { name: 'tags', type: 'tags' },
    ],
    connections: [{ targetTypes: ['aws_vpc'], arg: 'vpc_id', attr: 'id', mode: 'set' }],
    subtitle: (_, locale) => t(locale).internetAccess,
  }),

  defineResource({
    type: 'aws_eip',
    provider: 'aws',
    category: 'network',
    displayName: 'Elastic IP',
    shortName: 'EIP',
    description: 'Static public IPv4 address',
    fields: [
      { name: 'domain', type: 'select', options: ['vpc', 'standard'] },
      { name: 'instance', type: 'string', refTo: ['aws_instance'] },
      { name: 'tags', type: 'tags' },
    ],
    defaults: { domain: lit('vpc') },
    connections: [{ targetTypes: ['aws_instance'], arg: 'instance', attr: 'id', mode: 'set' }],
    subtitle: (_, locale) => t(locale).staticIp,
  }),

  defineResource({
    type: 'aws_nat_gateway',
    provider: 'aws',
    category: 'network',
    displayName: 'NAT Gateway',
    shortName: 'NAT',
    description: 'Outbound internet for private subnets',
    containment: [{ arg: 'subnet_id', parentTypes: ['aws_subnet'] }],
    fields: [
      { name: 'subnet_id', type: 'string', refTo: ['aws_subnet'], doc: 'A public subnet' },
      { name: 'allocation_id', type: 'string', refTo: ['aws_eip'], label: 'Elastic IP' },
      { name: 'connectivity_type', type: 'select', options: ['public', 'private'] },
      { name: 'tags', type: 'tags' },
    ],
    defaults: { connectivity_type: lit('public') },
    connections: [
      { targetTypes: ['aws_subnet'], arg: 'subnet_id', attr: 'id', mode: 'set' },
      { targetTypes: ['aws_eip'], arg: 'allocation_id', attr: 'id', mode: 'set' },
    ],
    subtitle: (args) => litStr(args.connectivity_type) ?? 'public',
  }),

  defineResource({
    type: 'aws_lambda_function',
    provider: 'aws',
    category: 'compute',
    displayName: 'Lambda Function',
    shortName: 'Lambda',
    description: 'Serverless function',
    nameArg: 'function_name',
    naming: { maxLength: 64 },
    fields: [
      { name: 'function_name', type: 'string', required: true },
      { name: 'role', type: 'string', required: true, refTo: ['aws_iam_role'], refAttr: 'arn' },
      {
        name: 'runtime',
        type: 'select',
        options: [
          'nodejs22.x',
          'nodejs20.x',
          'python3.13',
          'python3.12',
          'java21',
          'dotnet8',
          'ruby3.3',
          'provided.al2023',
        ],
      },
      { name: 'handler', type: 'string', placeholder: 'index.handler' },
      { name: 'filename', type: 'string', placeholder: 'lambda.zip', doc: 'Deployment package (or use image_uri / s3_bucket)' },
      { name: 'memory_size', type: 'number', min: 128, max: 10240, doc: 'MB' },
      { name: 'timeout', type: 'number', min: 1, max: 900, doc: 'Seconds (max 900)' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: {
      runtime: lit('nodejs22.x'),
      handler: lit('index.handler'),
      filename: lit('lambda.zip'),
      memory_size: lit(128),
      timeout: lit(10),
    },
    connections: [{ targetTypes: ['aws_iam_role'], arg: 'role', attr: 'arn', mode: 'set' }],
    subtitle: (args) => litStr(args.runtime),
  }),

  defineResource({
    type: 'aws_apigatewayv2_api',
    provider: 'aws',
    category: 'integration',
    displayName: 'API Gateway (HTTP)',
    shortName: 'API Gateway',
    description: 'HTTP or WebSocket API front door',
    container: true,
    naming: { maxLength: 128 },
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'protocol_type', type: 'select', options: ['HTTP', 'WEBSOCKET'], required: true },
      { name: 'description', type: 'string' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: { protocol_type: lit('HTTP') },
    subtitle: (args) => `${litStr(args.protocol_type) ?? 'HTTP'} API`,
  }),

  defineResource({
    type: 'aws_apigatewayv2_integration',
    provider: 'aws',
    category: 'integration',
    displayName: 'API Integration',
    shortName: 'Integration',
    description: 'Routes API requests to a Lambda or HTTP backend',
    containment: [{ arg: 'api_id', parentTypes: ['aws_apigatewayv2_api'] }],
    fields: [
      { name: 'api_id', type: 'string', required: true, refTo: ['aws_apigatewayv2_api'] },
      { name: 'integration_type', type: 'select', options: ['AWS_PROXY', 'HTTP_PROXY'], required: true },
      { name: 'integration_method', type: 'select', options: ['POST', 'GET', 'ANY'] },
      {
        name: 'integration_uri',
        type: 'string',
        refTo: ['aws_lambda_function'],
        refAttr: 'invoke_arn',
        doc: 'Lambda invoke ARN, or a URL for HTTP_PROXY',
      },
      { name: 'payload_format_version', type: 'select', options: ['2.0', '1.0'] },
    ],
    defaults: {
      integration_type: lit('AWS_PROXY'),
      integration_method: lit('POST'),
      payload_format_version: lit('2.0'),
    },
    connections: [
      { targetTypes: ['aws_apigatewayv2_api'], arg: 'api_id', attr: 'id', mode: 'set' },
      { targetTypes: ['aws_lambda_function'], arg: 'integration_uri', attr: 'invoke_arn', mode: 'set' },
    ],
    subtitle: (args) => litStr(args.integration_type),
  }),

  defineResource({
    type: 'aws_apigatewayv2_route',
    provider: 'aws',
    category: 'integration',
    displayName: 'API Route',
    shortName: 'Route',
    description: 'Maps a method + path to an integration',
    containment: [{ arg: 'api_id', parentTypes: ['aws_apigatewayv2_api'] }],
    fields: [
      { name: 'api_id', type: 'string', required: true, refTo: ['aws_apigatewayv2_api'] },
      { name: 'route_key', type: 'string', required: true, placeholder: 'GET /items', doc: '"$default" catches everything' },
      { name: 'target', type: 'string', doc: '"integrations/${aws_apigatewayv2_integration.<name>.id}"' },
    ],
    defaults: { route_key: lit('$default') },
    connections: [{ targetTypes: ['aws_apigatewayv2_api'], arg: 'api_id', attr: 'id', mode: 'set' }],
    subtitle: (args) => litStr(args.route_key),
  }),

  defineResource({
    type: 'aws_apigatewayv2_stage',
    provider: 'aws',
    category: 'integration',
    displayName: 'API Stage',
    shortName: 'Stage',
    description: 'A deployed, invokable version of an API',
    containment: [{ arg: 'api_id', parentTypes: ['aws_apigatewayv2_api'] }],
    fields: [
      { name: 'api_id', type: 'string', required: true, refTo: ['aws_apigatewayv2_api'] },
      { name: 'name', type: 'string', required: true, doc: '"$default" serves at the API root' },
      { name: 'auto_deploy', type: 'boolean' },
    ],
    defaults: { name: lit('$default'), auto_deploy: lit(true) },
    connections: [{ targetTypes: ['aws_apigatewayv2_api'], arg: 'api_id', attr: 'id', mode: 'set' }],
    subtitle: (args) => litStr(args.name),
  }),

  defineResource({
    type: 'aws_lambda_permission',
    provider: 'aws',
    category: 'identity',
    displayName: 'Lambda Permission',
    shortName: 'Invoke Permission',
    description: 'Lets a service (API Gateway, SNS, S3…) invoke a function',
    fields: [
      {
        name: 'function_name',
        type: 'string',
        required: true,
        refTo: ['aws_lambda_function'],
        refAttr: 'function_name',
      },
      { name: 'action', type: 'string', required: true },
      {
        name: 'principal',
        type: 'select',
        options: ['apigateway.amazonaws.com', 'sns.amazonaws.com', 's3.amazonaws.com', 'events.amazonaws.com'],
        required: true,
      },
      { name: 'source_arn', type: 'string', doc: 'Restrict to one API / topic / bucket' },
    ],
    defaults: { action: lit('lambda:InvokeFunction'), principal: lit('apigateway.amazonaws.com') },
    connections: [
      { targetTypes: ['aws_lambda_function'], arg: 'function_name', attr: 'function_name', mode: 'set' },
    ],
    subtitle: (args) => litStr(args.principal)?.split('.')[0],
  }),

  defineResource({
    type: 'aws_iam_role_policy',
    provider: 'aws',
    category: 'identity',
    displayName: 'IAM Role Policy',
    shortName: 'Role Policy',
    description: 'Inline permissions attached to a role',
    naming: { maxLength: 128 },
    fields: [
      { name: 'name', type: 'string' },
      { name: 'role', type: 'string', required: true, refTo: ['aws_iam_role'] },
      { name: 'policy', type: 'string', required: true, doc: 'JSON policy document' },
    ],
    defaults: {
      policy: raw(
        `jsonencode({\n    Version = "2012-10-17"\n    Statement = [{\n      Effect   = "Allow"\n      Action   = ["s3:GetObject"]\n      Resource = "*"\n    }]\n  })`,
      ),
    },
    connections: [{ targetTypes: ['aws_iam_role'], arg: 'role', attr: 'id', mode: 'set' }],
    subtitle: (_, locale) => t(locale).inlinePolicy,
  }),

  defineResource({
    type: 'aws_sqs_queue',
    provider: 'aws',
    category: 'integration',
    displayName: 'SQS Queue',
    shortName: 'SQS',
    description: 'Managed message queue',
    naming: { maxLength: 80 },
    fields: [
      { name: 'name', type: 'string', doc: 'FIFO queue names must end in .fifo' },
      { name: 'fifo_queue', type: 'boolean' },
      { name: 'visibility_timeout_seconds', type: 'number', min: 0, max: 43200 },
      { name: 'message_retention_seconds', type: 'number', min: 60, max: 1209600 },
      { name: 'tags', type: 'tags' },
    ],
    subtitle: (args, locale) =>
      args.fifo_queue?.kind === 'literal' && args.fifo_queue.value === true ? t(locale).fifoQueue : t(locale).queue,
  }),

  defineResource({
    type: 'aws_sns_topic',
    provider: 'aws',
    category: 'integration',
    displayName: 'SNS Topic',
    shortName: 'SNS',
    description: 'Pub/sub notification topic',
    naming: { maxLength: 256 },
    fields: [
      { name: 'name', type: 'string' },
      { name: 'fifo_topic', type: 'boolean' },
      { name: 'tags', type: 'tags' },
    ],
    subtitle: (_, locale) => t(locale).topic,
  }),

  defineResource({
    type: 'aws_sns_topic_subscription',
    provider: 'aws',
    category: 'integration',
    displayName: 'SNS Subscription',
    shortName: 'Subscription',
    description: 'Delivers topic messages to a queue, function or endpoint',
    fields: [
      { name: 'topic_arn', type: 'string', required: true, refTo: ['aws_sns_topic'], refAttr: 'arn' },
      { name: 'protocol', type: 'select', options: ['sqs', 'lambda', 'https', 'email'], required: true },
      {
        name: 'endpoint',
        type: 'string',
        required: true,
        refTo: ['aws_sqs_queue', 'aws_lambda_function'],
        refAttr: 'arn',
      },
    ],
    defaults: { protocol: lit('sqs') },
    connections: [
      { targetTypes: ['aws_sns_topic'], arg: 'topic_arn', attr: 'arn', mode: 'set' },
      { targetTypes: ['aws_sqs_queue', 'aws_lambda_function'], arg: 'endpoint', attr: 'arn', mode: 'set' },
    ],
    subtitle: (args) => `→ ${litStr(args.protocol) ?? 'sqs'}`,
  }),

  defineResource({
    type: 'aws_dynamodb_table',
    provider: 'aws',
    category: 'database',
    displayName: 'DynamoDB Table',
    shortName: 'DynamoDB',
    description: 'Serverless key-value / document database',
    naming: { minLength: 3, maxLength: 255 },
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'billing_mode', type: 'select', options: ['PAY_PER_REQUEST', 'PROVISIONED'] },
      { name: 'hash_key', type: 'string', doc: 'Needs a matching attribute block' },
      { name: 'range_key', type: 'string' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: {
      billing_mode: lit('PAY_PER_REQUEST'),
      hash_key: lit('id'),
      attribute: block({ name: lit('id'), type: lit('S') }),
    },
    subtitle: (args, locale) => (litStr(args.billing_mode) === 'PROVISIONED' ? t(locale).provisioned : t(locale).onDemand),
  }),

  defineResource({
    type: 'aws_elasticache_cluster',
    provider: 'aws',
    category: 'database',
    displayName: 'ElastiCache Cluster',
    shortName: 'ElastiCache',
    description: 'Managed Redis or Memcached cache',
    nameArg: 'cluster_id',
    naming: { maxLength: 50 },
    fields: [
      { name: 'cluster_id', type: 'string', required: true, doc: 'Lowercase letters, digits and hyphens, up to 50' },
      { name: 'engine', type: 'select', options: ['redis', 'memcached'] },
      {
        name: 'node_type',
        type: 'select',
        options: ['cache.t4g.micro', 'cache.t4g.small', 'cache.t4g.medium', 'cache.m7g.large'],
      },
      { name: 'num_cache_nodes', type: 'number', min: 1, max: 40, doc: 'Must be 1 for Redis' },
      { name: 'port', type: 'number', min: 1, max: 65535 },
      {
        name: 'subnet_group_name',
        type: 'string',
        refTo: ['aws_elasticache_subnet_group'],
        refAttr: 'name',
        label: 'Cache subnet group',
      },
      {
        name: 'security_group_ids',
        type: 'list',
        refTo: ['aws_security_group'],
        label: 'Security groups',
      },
    ],
    defaults: { engine: lit('redis'), node_type: lit('cache.t4g.micro'), num_cache_nodes: lit(1) },
    containment: [{ arg: 'subnet_group_name', parentTypes: ['aws_elasticache_subnet_group'] }],
    connections: [
      { targetTypes: ['aws_elasticache_subnet_group'], arg: 'subnet_group_name', attr: 'name', mode: 'set' },
      { targetTypes: ['aws_security_group'], arg: 'security_group_ids', attr: 'id', mode: 'append' },
    ],
    subtitle: (args) => litStr(args.engine),
  }),

  defineResource({
    type: 'aws_kms_key',
    provider: 'aws',
    category: 'identity',
    displayName: 'KMS Key',
    shortName: 'KMS',
    description: 'Managed encryption key',
    fields: [
      { name: 'description', type: 'string' },
      { name: 'deletion_window_in_days', type: 'number', min: 7, max: 30, doc: '7–30 days' },
      { name: 'enable_key_rotation', type: 'boolean' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: { deletion_window_in_days: lit(10), enable_key_rotation: lit(true) },
    subtitle: (_, locale) => t(locale).encryptionKey,
  }),

  defineResource({
    type: 'aws_secretsmanager_secret',
    provider: 'aws',
    category: 'identity',
    displayName: 'Secrets Manager Secret',
    shortName: 'Secret',
    description: 'Stores credentials, tokens and API keys',
    fields: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'kms_key_id', type: 'string', refTo: ['aws_kms_key'], refAttr: 'arn', label: 'KMS key' },
      { name: 'recovery_window_in_days', type: 'number', min: 0, max: 30, doc: '0 deletes immediately, else 7–30' },
      { name: 'tags', type: 'tags' },
    ],
    connections: [{ targetTypes: ['aws_kms_key'], arg: 'kms_key_id', attr: 'arn', mode: 'set' }],
    subtitle: (_, locale) => t(locale).secret,
  }),

  defineResource({
    type: 'aws_eks_cluster',
    provider: 'aws',
    category: 'containers',
    displayName: 'EKS Cluster',
    shortName: 'EKS',
    description: 'Managed Kubernetes control plane',
    container: true,
    naming: { maxLength: 100 },
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'role_arn', type: 'string', required: true, refTo: ['aws_iam_role'], refAttr: 'arn' },
      { name: 'version', type: 'string', placeholder: '1.33', doc: 'Kubernetes minor version' },
      { name: 'tags', type: 'tags' },
    ],
    // connect two or more subnets to fill vpc_config.subnet_ids
    defaults: { vpc_config: block({}) },
    connections: [{ targetTypes: ['aws_iam_role'], arg: 'role_arn', attr: 'arn', mode: 'set' }],
    blockConnections: [
      { targetTypes: ['aws_subnet'], block: 'vpc_config', arg: 'subnet_ids', attr: 'id', mode: 'append' },
    ],
    subtitle: (args) => {
      const v = litStr(args.version);
      return v ? `Kubernetes ${v}` : 'Kubernetes';
    },
  }),

  defineResource({
    type: 'aws_eks_node_group',
    provider: 'aws',
    category: 'containers',
    displayName: 'EKS Node Group',
    shortName: 'Node Group',
    description: 'Managed worker nodes for an EKS cluster',
    containment: [{ arg: 'cluster_name', parentTypes: ['aws_eks_cluster'] }],
    fields: [
      { name: 'cluster_name', type: 'string', required: true, refTo: ['aws_eks_cluster'], refAttr: 'name' },
      { name: 'node_role_arn', type: 'string', required: true, refTo: ['aws_iam_role'], refAttr: 'arn' },
      { name: 'subnet_ids', type: 'list', required: true, refTo: ['aws_subnet'], label: 'Subnets' },
      { name: 'instance_types', type: 'list' },
    ],
    defaults: {
      instance_types: list([lit('t3.medium')]),
      scaling_config: block({ desired_size: lit(2), max_size: lit(3), min_size: lit(1) }),
    },
    connections: [
      { targetTypes: ['aws_eks_cluster'], arg: 'cluster_name', attr: 'name', mode: 'set' },
      { targetTypes: ['aws_iam_role'], arg: 'node_role_arn', attr: 'arn', mode: 'set' },
      { targetTypes: ['aws_subnet'], arg: 'subnet_ids', attr: 'id', mode: 'append' },
    ],
    subtitle: (args, locale) => {
      const it = args.instance_types;
      return it?.kind === 'list' && it.items[0] ? litStr(it.items[0]) : t(locale).workerNodes;
    },
  }),

  defineResource({
    type: 'aws_vpc_security_group_ingress_rule',
    provider: 'aws',
    category: 'identity',
    displayName: 'SG Ingress Rule',
    shortName: 'Ingress Rule',
    description: 'One inbound rule of a security group (recommended over inline rules)',
    fields: [
      { name: 'security_group_id', type: 'string', required: true, refTo: ['aws_security_group'] },
      { name: 'ip_protocol', type: 'select', options: ['tcp', 'udp', 'icmp', '-1'], required: true },
      { name: 'from_port', type: 'number', min: -1, max: 65535 },
      { name: 'to_port', type: 'number', min: -1, max: 65535 },
      { name: 'cidr_ipv4', type: 'string', placeholder: '10.0.0.0/16' },
      { name: 'referenced_security_group_id', type: 'string', refTo: ['aws_security_group'], label: 'From security group' },
      { name: 'description', type: 'string' },
    ],
    defaults: { ip_protocol: lit('tcp'), from_port: lit(443), to_port: lit(443), cidr_ipv4: lit('10.0.0.0/16') },
    connections: [{ targetTypes: ['aws_security_group'], arg: 'security_group_id', attr: 'id', mode: 'set' }],
    subtitle: (args, locale) => {
      const from = args.from_port?.kind === 'literal' ? args.from_port.value : undefined;
      return t(locale).ingressRule(litStr(args.ip_protocol) ?? 'tcp', from);
    },
  }),

  defineResource({
    type: 'aws_vpc_security_group_egress_rule',
    provider: 'aws',
    category: 'identity',
    displayName: 'SG Egress Rule',
    shortName: 'Egress Rule',
    description: 'One outbound rule of a security group',
    fields: [
      { name: 'security_group_id', type: 'string', required: true, refTo: ['aws_security_group'] },
      { name: 'ip_protocol', type: 'select', options: ['-1', 'tcp', 'udp', 'icmp'], required: true },
      { name: 'from_port', type: 'number', min: -1, max: 65535 },
      { name: 'to_port', type: 'number', min: -1, max: 65535 },
      { name: 'cidr_ipv4', type: 'string', placeholder: '0.0.0.0/0' },
      { name: 'referenced_security_group_id', type: 'string', refTo: ['aws_security_group'], label: 'To security group' },
      { name: 'description', type: 'string' },
    ],
    defaults: { ip_protocol: lit('-1'), cidr_ipv4: lit('0.0.0.0/0') },
    connections: [{ targetTypes: ['aws_security_group'], arg: 'security_group_id', attr: 'id', mode: 'set' }],
    subtitle: (args, locale) => {
      const protocol = litStr(args.ip_protocol);
      return t(locale).egressRule(protocol === '-1' ? undefined : protocol);
    },
  }),

  defineResource({
    type: 'aws_network_acl',
    provider: 'aws',
    category: 'identity',
    displayName: 'Network ACL',
    shortName: 'NACL',
    description: 'Stateless subnet firewall with numbered allow / deny rules',
    containment: [{ arg: 'vpc_id', parentTypes: ['aws_vpc'] }],
    fields: [
      { name: 'vpc_id', type: 'string', required: true, refTo: ['aws_vpc'] },
      { name: 'subnet_ids', type: 'list', refTo: ['aws_subnet'], label: 'Subnets' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: {
      ingress: block({
        rule_no: lit(100),
        action: lit('allow'),
        protocol: lit('tcp'),
        from_port: lit(443),
        to_port: lit(443),
        cidr_block: lit('0.0.0.0/0'),
      }),
      egress: block({
        rule_no: lit(100),
        action: lit('allow'),
        protocol: lit('tcp'),
        from_port: lit(1024),
        to_port: lit(65535),
        cidr_block: lit('0.0.0.0/0'),
      }),
    },
    connections: [
      { targetTypes: ['aws_vpc'], arg: 'vpc_id', attr: 'id', mode: 'set' },
      { targetTypes: ['aws_subnet'], arg: 'subnet_ids', attr: 'id', mode: 'append' },
    ],
    subtitle: (args, locale) => t(locale).ruleCount(blocksOf(args.ingress).length + blocksOf(args.egress).length),
  }),

  defineResource({
    type: 'aws_route_table',
    provider: 'aws',
    category: 'network',
    displayName: 'Route Table',
    shortName: 'Route Table',
    description: 'Routes for subnets: a 0.0.0.0/0 route to an internet gateway makes them public',
    containment: [{ arg: 'vpc_id', parentTypes: ['aws_vpc'] }],
    fields: [
      { name: 'vpc_id', type: 'string', required: true, refTo: ['aws_vpc'] },
      { name: 'tags', type: 'tags' },
    ],
    connections: [{ targetTypes: ['aws_vpc'], arg: 'vpc_id', attr: 'id', mode: 'set' }],
    subtitle: (args, locale) => {
      const routes = blocksOf(args.route);
      return routes.length ? t(locale).routeCount(routes.length) : t(locale).localOnly;
    },
  }),

  defineResource({
    type: 'aws_route_table_association',
    provider: 'aws',
    category: 'network',
    displayName: 'Route Table Association',
    shortName: 'RT Association',
    description: 'Attaches a route table to a subnet',
    fields: [
      { name: 'subnet_id', type: 'string', refTo: ['aws_subnet'] },
      { name: 'route_table_id', type: 'string', required: true, refTo: ['aws_route_table'] },
    ],
    connections: [
      { targetTypes: ['aws_subnet'], arg: 'subnet_id', attr: 'id', mode: 'set' },
      { targetTypes: ['aws_route_table'], arg: 'route_table_id', attr: 'id', mode: 'set' },
    ],
    subtitle: (_, locale) => t(locale).subnetRoutes,
  }),

  defineResource({
    type: 'aws_s3_bucket_public_access_block',
    provider: 'aws',
    category: 'identity',
    displayName: 'S3 Public Access Block',
    shortName: 'Public Access Block',
    description: 'Guarantees a bucket can never be made public',
    fields: [
      { name: 'bucket', type: 'string', required: true, refTo: ['aws_s3_bucket'] },
      { name: 'block_public_acls', type: 'boolean' },
      { name: 'block_public_policy', type: 'boolean' },
      { name: 'ignore_public_acls', type: 'boolean' },
      { name: 'restrict_public_buckets', type: 'boolean' },
    ],
    defaults: {
      block_public_acls: lit(true),
      block_public_policy: lit(true),
      ignore_public_acls: lit(true),
      restrict_public_buckets: lit(true),
    },
    connections: [{ targetTypes: ['aws_s3_bucket'], arg: 'bucket', attr: 'id', mode: 'set' }],
    subtitle: (_, locale) => t(locale).neverPublic,
  }),

  defineResource({
    type: 'aws_db_subnet_group',
    provider: 'aws',
    category: 'database',
    displayName: 'DB Subnet Group',
    shortName: 'DB Subnets',
    description: 'Private subnets (2+ AZs) where RDS places the database',
    naming: { maxLength: 255 },
    // the database is drawn inside it, and it inside the VPC of its subnets
    container: true,
    containment: [{ arg: 'subnet_ids', parentTypes: ['aws_vpc'], via: ['aws_subnet'] }],
    fields: [
      { name: 'name', type: 'string' },
      { name: 'subnet_ids', type: 'list', required: true, refTo: ['aws_subnet'], label: 'Subnets' },
      { name: 'tags', type: 'tags' },
    ],
    connections: [{ targetTypes: ['aws_subnet'], arg: 'subnet_ids', attr: 'id', mode: 'append' }],
    subtitle: subnetCount,
  }),

  defineResource({
    type: 'aws_elasticache_subnet_group',
    provider: 'aws',
    category: 'database',
    displayName: 'Cache Subnet Group',
    shortName: 'Cache Subnets',
    description: 'Private subnets where ElastiCache places the cache nodes',
    naming: { maxLength: 255 },
    container: true,
    containment: [{ arg: 'subnet_ids', parentTypes: ['aws_vpc'], via: ['aws_subnet'] }],
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'subnet_ids', type: 'list', required: true, refTo: ['aws_subnet'], label: 'Subnets' },
      { name: 'tags', type: 'tags' },
    ],
    connections: [{ targetTypes: ['aws_subnet'], arg: 'subnet_ids', attr: 'id', mode: 'append' }],
    subtitle: subnetCount,
  }),
];
