import { lit, literalString, raw } from '@/ir/expr';
import { defineResource } from './types';

const litStr = literalString;

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
      { name: 'cidr_block', type: 'string', required: true, placeholder: '10.0.0.0/16' },
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
      { name: 'cidr_block', type: 'string', required: true, placeholder: '10.0.1.0/24' },
      { name: 'availability_zone', type: 'string', placeholder: 'us-east-1a' },
      { name: 'map_public_ip_on_launch', type: 'boolean' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: { cidr_block: lit('10.0.1.0/24') },
    connections: [{ targetTypes: ['aws_vpc'], arg: 'vpc_id', attr: 'id', mode: 'set' }],
    subtitle: (args) => litStr(args.cidr_block),
  }),

  defineResource({
    type: 'aws_security_group',
    provider: 'aws',
    category: 'network',
    displayName: 'Security Group',
    shortName: 'Security Group',
    description: 'Stateful firewall rules',
    containment: [{ arg: 'vpc_id', parentTypes: ['aws_vpc'] }],
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'string' },
      { name: 'vpc_id', type: 'string', refTo: ['aws_vpc'] },
      { name: 'tags', type: 'tags' },
    ],
    connections: [{ targetTypes: ['aws_vpc'], arg: 'vpc_id', attr: 'id', mode: 'set' }],
    subtitle: (args) => litStr(args.description) ?? 'firewall',
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
      { name: 'ami', type: 'string', required: true, placeholder: 'ami-0c02fb55956c7d316' },
      {
        name: 'instance_type',
        type: 'select',
        required: true,
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
        required: true,
        options: ['postgres', 'mysql', 'mariadb'],
      },
      { name: 'engine_version', type: 'string', placeholder: '15.4' },
      {
        name: 'instance_class',
        type: 'select',
        required: true,
        options: ['db.t3.micro', 'db.t3.small', 'db.t3.medium', 'db.m5.large'],
      },
      { name: 'allocated_storage', type: 'number' },
      { name: 'username', type: 'string' },
      { name: 'password', type: 'string', doc: 'Prefer var.db_password over a literal' },
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
    connections: [
      { targetTypes: ['aws_security_group'], arg: 'vpc_security_group_ids', attr: 'id', mode: 'append' },
    ],
    subtitle: (args) => {
      const engine = litStr(args.engine);
      const version = litStr(args.engine_version);
      return engine ? `${engine}${version ? ` ${version}` : ''}` : undefined;
    },
  }),

  defineResource({
    type: 'aws_s3_bucket',
    provider: 'aws',
    category: 'storage',
    displayName: 'S3 Bucket',
    shortName: 'S3',
    description: 'Object storage bucket',
    fields: [
      { name: 'bucket', type: 'string', required: true, placeholder: 'my-unique-bucket-name' },
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
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'assume_role_policy', type: 'string', required: true, doc: 'JSON policy document' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: {
      assume_role_policy: raw(
        `jsonencode({\n    Version = "2012-10-17"\n    Statement = [{\n      Action    = "sts:AssumeRole"\n      Effect    = "Allow"\n      Principal = { Service = "ec2.amazonaws.com" }\n    }]\n  })`,
      ),
    },
    subtitle: () => 'IAM role',
  }),

  defineResource({
    type: 'aws_lb',
    provider: 'aws',
    category: 'network',
    displayName: 'Application Load Balancer',
    shortName: 'ALB',
    description: 'Load balancer for HTTP/TCP traffic',
    fields: [
      { name: 'name', type: 'string', required: true },
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
    subtitle: (args) => litStr(args.load_balancer_type) ?? 'load balancer',
  }),

  defineResource({
    type: 'aws_lb_target_group',
    provider: 'aws',
    category: 'network',
    displayName: 'Target Group',
    shortName: 'Target Group',
    description: 'Routes requests to registered targets',
    containment: [{ arg: 'vpc_id', parentTypes: ['aws_vpc'] }],
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'port', type: 'number', required: true },
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
      { name: 'port', type: 'number', required: true },
      { name: 'protocol', type: 'select', options: ['HTTP', 'HTTPS'] },
    ],
    defaults: { port: lit(80), protocol: lit('HTTP') },
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
    subtitle: () => 'container registry',
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
      { name: 'desired_count', type: 'number' },
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
    fields: [
      { name: 'family', type: 'string', required: true },
      { name: 'cpu', type: 'select', options: ['256', '512', '1024', '2048'] },
      { name: 'memory', type: 'select', options: ['512', '1024', '2048', '4096'] },
      { name: 'network_mode', type: 'select', options: ['awsvpc', 'bridge', 'host'] },
    ],
    defaults: { cpu: lit('256'), memory: lit('512'), network_mode: lit('awsvpc') },
    subtitle: (args) => {
      const cpu = litStr(args.cpu);
      return cpu ? `${cpu} CPU units` : undefined;
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
    defaults: { enabled: lit(true) },
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
      { name: 'ttl', type: 'number' },
      { name: 'records', type: 'list' },
    ],
    defaults: { type: lit('A'), ttl: lit(300) },
    connections: [
      { targetTypes: ['aws_route53_zone'], arg: 'zone_id', attr: 'zone_id', mode: 'set' },
    ],
    subtitle: (args) => litStr(args.type),
  }),
];
