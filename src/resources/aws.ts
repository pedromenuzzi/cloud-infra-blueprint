import { block, list, lit, literalString, raw } from '@/ir/expr';
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
    subtitle: () => 'internet access',
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
    subtitle: () => 'static IP',
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
      { name: 'subnet_id', type: 'string', required: true, refTo: ['aws_subnet'], doc: 'A public subnet' },
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
      { name: 'memory_size', type: 'number' },
      { name: 'timeout', type: 'number', doc: 'Seconds (max 900)' },
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
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'role', type: 'string', required: true, refTo: ['aws_iam_role'] },
      { name: 'policy', type: 'string', required: true, doc: 'JSON policy document' },
    ],
    defaults: {
      policy: raw(
        `jsonencode({\n    Version = "2012-10-17"\n    Statement = [{\n      Effect   = "Allow"\n      Action   = ["s3:GetObject"]\n      Resource = "*"\n    }]\n  })`,
      ),
    },
    connections: [{ targetTypes: ['aws_iam_role'], arg: 'role', attr: 'id', mode: 'set' }],
    subtitle: () => 'inline policy',
  }),

  defineResource({
    type: 'aws_sqs_queue',
    provider: 'aws',
    category: 'integration',
    displayName: 'SQS Queue',
    shortName: 'SQS',
    description: 'Managed message queue',
    fields: [
      { name: 'name', type: 'string', doc: 'FIFO queue names must end in .fifo' },
      { name: 'fifo_queue', type: 'boolean' },
      { name: 'visibility_timeout_seconds', type: 'number' },
      { name: 'message_retention_seconds', type: 'number' },
      { name: 'tags', type: 'tags' },
    ],
    subtitle: (args) =>
      args.fifo_queue?.kind === 'literal' && args.fifo_queue.value === true ? 'FIFO queue' : 'queue',
  }),

  defineResource({
    type: 'aws_sns_topic',
    provider: 'aws',
    category: 'integration',
    displayName: 'SNS Topic',
    shortName: 'SNS',
    description: 'Pub/sub notification topic',
    fields: [
      { name: 'name', type: 'string' },
      { name: 'fifo_topic', type: 'boolean' },
      { name: 'tags', type: 'tags' },
    ],
    subtitle: () => 'topic',
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
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'billing_mode', type: 'select', options: ['PAY_PER_REQUEST', 'PROVISIONED'] },
      { name: 'hash_key', type: 'string', required: true, doc: 'Needs a matching attribute block' },
      { name: 'range_key', type: 'string' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: {
      billing_mode: lit('PAY_PER_REQUEST'),
      hash_key: lit('id'),
      attribute: block({ name: lit('id'), type: lit('S') }),
    },
    subtitle: (args) => (litStr(args.billing_mode) === 'PROVISIONED' ? 'provisioned' : 'on-demand'),
  }),

  defineResource({
    type: 'aws_elasticache_cluster',
    provider: 'aws',
    category: 'database',
    displayName: 'ElastiCache Cluster',
    shortName: 'ElastiCache',
    description: 'Managed Redis or Memcached cache',
    nameArg: 'cluster_id',
    fields: [
      { name: 'cluster_id', type: 'string', required: true },
      { name: 'engine', type: 'select', options: ['redis', 'memcached'], required: true },
      {
        name: 'node_type',
        type: 'select',
        options: ['cache.t4g.micro', 'cache.t4g.small', 'cache.t4g.medium', 'cache.m7g.large'],
        required: true,
      },
      { name: 'num_cache_nodes', type: 'number', required: true, doc: 'Must be 1 for Redis' },
      { name: 'port', type: 'number' },
      { name: 'subnet_group_name', type: 'string' },
      {
        name: 'security_group_ids',
        type: 'list',
        refTo: ['aws_security_group'],
        label: 'Security groups',
      },
    ],
    defaults: { engine: lit('redis'), node_type: lit('cache.t4g.micro'), num_cache_nodes: lit(1) },
    connections: [
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
      { name: 'deletion_window_in_days', type: 'number', doc: '7–30 days' },
      { name: 'enable_key_rotation', type: 'boolean' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: { deletion_window_in_days: lit(10), enable_key_rotation: lit(true) },
    subtitle: () => 'encryption key',
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
      { name: 'recovery_window_in_days', type: 'number', doc: '0 deletes immediately, else 7–30' },
      { name: 'tags', type: 'tags' },
    ],
    connections: [{ targetTypes: ['aws_kms_key'], arg: 'kms_key_id', attr: 'arn', mode: 'set' }],
    subtitle: () => 'secret',
  }),

  defineResource({
    type: 'aws_eks_cluster',
    provider: 'aws',
    category: 'containers',
    displayName: 'EKS Cluster',
    shortName: 'EKS',
    description: 'Managed Kubernetes control plane',
    container: true,
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'role_arn', type: 'string', required: true, refTo: ['aws_iam_role'], refAttr: 'arn' },
      { name: 'version', type: 'string', placeholder: '1.33', doc: 'Kubernetes minor version' },
      { name: 'tags', type: 'tags' },
    ],
    defaults: { vpc_config: block({ subnet_ids: list([]) }) },
    connections: [{ targetTypes: ['aws_iam_role'], arg: 'role_arn', attr: 'arn', mode: 'set' }],
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
    subtitle: (args) => {
      const it = args.instance_types;
      return it?.kind === 'list' && it.items[0] ? litStr(it.items[0]) : 'worker nodes';
    },
  }),
];
