/**
 * Templates: macros that build a fully-connected IR and emit it as real
 * Terraform files. After instantiation they are plain resources the user can
 * customize freely — no lock-in, no magic.
 */
import { block, blocks, lit, list, obj, raw, ref } from '@/ir/expr';
import { emitProject } from '@/hcl/emitter';
import type {
  CanvasPosition,
  Expression,
  IR,
  Provider,
  ResourceNode,
} from '@/ir/types';
import { emptyIR, providerOfType, providerSourceName, resourceAddress } from '@/ir/types';
import { cloudName, nameSlug } from '@/resources/naming';
import { getDef } from '@/resources/registry';

export type TemplateSlug =
  | 'aws-web-app'
  | 'aws-static-site'
  | 'aws-container-stack'
  | 'aws-serverless-api'
  | 'aws-secure-3tier'
  | 'azure-web-app'
  | 'azure-static-site'
  | 'gcp-web-app'
  | 'gcp-cloud-run'
  | 'gcp-static-site'
  | 'multi-cloud-dr';

export type TemplateTag = 'Web Apps' | 'Static Sites' | 'Containers' | 'Serverless' | 'Security' | 'Data';

export interface TemplateDef {
  slug: TemplateSlug;
  /** English source text; show `templateName()` / `templateDescription()` (./i18n) */
  name: string;
  description: string;
  providers: Provider[];
  tags: TemplateTag[];
  /** approximate resource count shown on the card */
  resourceCount: number;
  build(appName: string): Record<string, string>;
}

// --- small builder helpers --------------------------------------------------

function res(
  type: string,
  name: string,
  args: Record<string, Expression>,
  position?: CanvasPosition,
  leadingComments: string[] = [],
): ResourceNode {
  return {
    id: resourceAddress(type, name),
    provider: providerOfType(type),
    type,
    name,
    args,
    position,
    trivia: { leadingComments },
  };
}

function variable(
  name: string,
  opts: { description?: string; type?: string; default?: Expression; sensitive?: boolean },
) {
  const args: Record<string, Expression> = {};
  if (opts.description) args.description = lit(opts.description);
  if (opts.type) args.type = ref(opts.type);
  if (opts.default) args.default = opts.default;
  if (opts.sensitive) args.sensitive = lit(true);
  return { id: `var.${name}`, name, args, trivia: { leadingComments: [] } };
}

/**
 * Cloud-side names for a template: `<app-slug>-<suffix>`, valid for the
 * resource type (hyphens, alphanumeric-only storage accounts, length caps) —
 * never the Terraform-style `my_app` identifier.
 */
function namer(appName: string) {
  const slug = nameSlug(appName);
  const name = (type: string, suffix: string) => lit(cloudName(slug, getDef(type)?.naming, suffix));
  return { slug, name };
}

function output(name: string, value: Expression, description?: string) {
  const args: Record<string, Expression> = { value };
  if (description) args.description = lit(description);
  return { id: `output.${name}`, name, args, trivia: { leadingComments: [] } };
}

const PROVIDER_VERSIONS: Record<string, { source: string; version: string }> = {
  aws: { source: 'hashicorp/aws', version: '~> 6.0' },
  azurerm: { source: 'hashicorp/azurerm', version: '~> 5.0' },
  google: { source: 'hashicorp/google', version: '~> 8.0' },
};

function versionsBlock(providers: Provider[]) {
  const entries = providers
    .map((p) => providerSourceName(p))
    .map((name) => {
      const info = PROVIDER_VERSIONS[name];
      return `    ${name} = {\n      source  = "${info.source}"\n      version = "${info.version}"\n    }`;
    })
    .join('\n\n');
  const text = `terraform {\n  required_version = ">= 1.5.0"\n\n  required_providers {\n${entries}\n  }\n}`;
  return {
    id: 'raw.versions',
    text,
    trivia: { leadingComments: [] as string[], sourceFile: 'versions.tf' },
  };
}

function providerBlock(provider: Provider, args: Record<string, Expression>) {
  const name = providerSourceName(provider);
  return { id: `provider.${name}.0`, name, args, trivia: { leadingComments: [] as string[] } };
}

/**
 * What makes `aws_vpc.main`'s public subnets public: an internet gateway, a
 * route table sending 0.0.0.0/0 to it, and that table associated with each
 * subnet. The gateway and table sit inside the VPC; associations are top-level.
 */
function awsPublicRouting(
  subnets: string[],
  at: { gateway: CanvasPosition; table: CanvasPosition; associations: CanvasPosition[] },
): ResourceNode[] {
  return [
    res('aws_internet_gateway', 'igw', { vpc_id: ref('aws_vpc.main.id') }, at.gateway, [
      '# Internet access — the default route that makes the public subnets public',
    ]),
    res(
      'aws_route_table',
      'public',
      {
        vpc_id: ref('aws_vpc.main.id'),
        route: block({ cidr_block: lit('0.0.0.0/0'), gateway_id: ref('aws_internet_gateway.igw.id') }),
      },
      at.table,
    ),
    ...subnets.map((subnet, i) =>
      res(
        'aws_route_table_association',
        subnet,
        { subnet_id: ref(`aws_subnet.${subnet}.id`), route_table_id: ref('aws_route_table.public.id') },
        at.associations[i],
      ),
    ),
  ];
}

// --- AWS · Web App -----------------------------------------------------------

function buildAwsWebApp(appName: string): Record<string, string> {
  const { slug, name } = namer(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('app_name', { description: 'Application name', type: 'string', default: lit(slug) }),
    variable('region', { description: 'AWS region', type: 'string', default: lit('us-east-1') }),
    variable('db_password', { description: 'Master password for RDS', type: 'string', sensitive: true }),
  );
  ir.providers.push(providerBlock('aws', { region: ref('var.region') }));
  ir.extras.push(versionsBlock(['aws']));

  ir.resources.push(
    res(
      'aws_vpc',
      'main',
      { cidr_block: lit('10.0.0.0/16'), enable_dns_hostnames: lit(true), tags: obj({ Name: ref('var.app_name') }) },
      { x: 40, y: 60, w: 680, h: 500 },
      ['# Networking'],
    ),
    res(
      'aws_subnet',
      'public_a',
      {
        vpc_id: ref('aws_vpc.main.id'),
        cidr_block: lit('10.0.1.0/24'),
        availability_zone: lit('us-east-1a'),
        map_public_ip_on_launch: lit(true),
      },
      { x: 32, y: 64, w: 300, h: 176 },
    ),
    res(
      'aws_subnet',
      'public_b',
      {
        vpc_id: ref('aws_vpc.main.id'),
        cidr_block: lit('10.0.2.0/24'),
        availability_zone: lit('us-east-1b'),
        map_public_ip_on_launch: lit(true),
      },
      { x: 356, y: 64, w: 300, h: 176 },
    ),
    res(
      'aws_security_group',
      'web',
      {
        name: name('aws_security_group', 'web-sg'),
        description: lit('Allow HTTP/HTTPS in, Postgres to the DB'),
        vpc_id: ref('aws_vpc.main.id'),
        ingress: blocks([
          {
            description: lit('HTTP'),
            from_port: lit(80),
            to_port: lit(80),
            protocol: lit('tcp'),
            cidr_blocks: list([lit('0.0.0.0/0')]),
          },
          {
            description: lit('HTTPS'),
            from_port: lit(443),
            to_port: lit(443),
            protocol: lit('tcp'),
            cidr_blocks: list([lit('0.0.0.0/0')]),
          },
          {
            description: lit('Postgres between the web server and the DB'),
            from_port: lit(5432),
            to_port: lit(5432),
            protocol: lit('tcp'),
            self: lit(true),
          },
        ]),
        egress: block({
          from_port: lit(0),
          to_port: lit(0),
          protocol: lit('-1'),
          cidr_blocks: list([lit('0.0.0.0/0')]),
        }),
      },
      { x: 32, y: 280 },
    ),
    ...awsPublicRouting(['public_a', 'public_b'], {
      gateway: { x: 264, y: 280 },
      table: { x: 264, y: 392 },
      associations: [
        { x: 790, y: 440 },
        { x: 1030, y: 440 },
      ],
    }),
    res(
      'aws_instance',
      'web',
      {
        ami: lit('ami-0c02fb55956c7d316'),
        instance_type: lit('t3.micro'),
        subnet_id: ref('aws_subnet.public_a.id'),
        vpc_security_group_ids: list([ref('aws_security_group.web.id')]),
        tags: obj({ Name: raw('"${var.app_name}-web"') }),
      },
      { x: 44, y: 64 },
      ['# Compute'],
    ),
    res(
      'aws_db_instance',
      'main',
      {
        identifier: name('aws_db_instance', 'db'),
        engine: lit('postgres'),
        engine_version: lit('15.4'),
        instance_class: lit('db.t3.micro'),
        allocated_storage: lit(20),
        username: lit('appuser'),
        password: ref('var.db_password'),
        vpc_security_group_ids: list([ref('aws_security_group.web.id')]),
        skip_final_snapshot: lit(true),
      },
      { x: 790, y: 300 },
      ['# Database'],
    ),
    res(
      'aws_iam_role',
      'web',
      {
        name: name('aws_iam_role', 'web-role'),
        assume_role_policy: raw(
          `jsonencode({\n    Version = "2012-10-17"\n    Statement = [{\n      Action    = "sts:AssumeRole"\n      Effect    = "Allow"\n      Principal = { Service = "ec2.amazonaws.com" }\n    }]\n  })`,
        ),
      },
      { x: 790, y: 120 },
      ['# Identity'],
    ),
  );

  ir.outputs.push(
    output('web_public_ip', ref('aws_instance.web.public_ip'), 'Public IP of the web server'),
    output('db_endpoint', ref('aws_db_instance.main.endpoint'), 'RDS connection endpoint'),
  );

  return emitProject(ir);
}

// --- AWS · Static Site -------------------------------------------------------

function buildAwsStaticSite(appName: string): Record<string, string> {
  const { name } = namer(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('domain_name', { description: 'Site domain', type: 'string', default: lit('example.com') }),
  );
  ir.providers.push(providerBlock('aws', { region: lit('us-east-1') }));
  ir.extras.push(versionsBlock(['aws']));

  ir.resources.push(
    res(
      'aws_s3_bucket',
      'site',
      { bucket: name('aws_s3_bucket', 'site'), force_destroy: lit(true) },
      { x: 60, y: 220 },
      ['# Static assets'],
    ),
    res(
      'aws_cloudfront_distribution',
      'cdn',
      {
        enabled: lit(true),
        default_root_object: lit('index.html'),
        origin: block({
          domain_name: ref('aws_s3_bucket.site.bucket_regional_domain_name'),
          origin_id: lit('s3-site'),
        }),
        default_cache_behavior: block({
          allowed_methods: list([lit('GET'), lit('HEAD')]),
          cached_methods: list([lit('GET'), lit('HEAD')]),
          target_origin_id: lit('s3-site'),
          viewer_protocol_policy: lit('redirect-to-https'),
          forwarded_values: block({
            query_string: lit(false),
            cookies: block({ forward: lit('none') }),
          }),
        }),
        restrictions: block({
          geo_restriction: block({ restriction_type: lit('none') }),
        }),
        viewer_certificate: block({ cloudfront_default_certificate: lit(true) }),
      },
      { x: 400, y: 220 },
      ['# CDN'],
    ),
    res('aws_route53_zone', 'main', { name: ref('var.domain_name') }, { x: 740, y: 100 }, [
      '# DNS',
    ]),
    res(
      'aws_route53_record',
      'www',
      {
        zone_id: ref('aws_route53_zone.main.zone_id'),
        name: raw('"www.${var.domain_name}"'),
        type: lit('A'),
        alias: block({
          name: ref('aws_cloudfront_distribution.cdn.domain_name'),
          zone_id: ref('aws_cloudfront_distribution.cdn.hosted_zone_id'),
          evaluate_target_health: lit(false),
        }),
      },
      { x: 740, y: 300 },
    ),
  );

  ir.outputs.push(output('cdn_domain', ref('aws_cloudfront_distribution.cdn.domain_name')));

  return emitProject(ir);
}

// --- AWS · Container Stack ----------------------------------------------------

function buildAwsContainerStack(appName: string): Record<string, string> {
  const { slug, name } = namer(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('app_name', { description: 'Application name', type: 'string', default: lit(slug) }),
    variable('region', { description: 'AWS region', type: 'string', default: lit('us-east-1') }),
  );
  ir.providers.push(providerBlock('aws', { region: ref('var.region') }));
  ir.extras.push(versionsBlock(['aws']));

  ir.resources.push(
    res(
      'aws_vpc',
      'main',
      { cidr_block: lit('10.0.0.0/16'), enable_dns_hostnames: lit(true) },
      { x: 40, y: 60, w: 720, h: 430 },
      ['# Networking'],
    ),
    res(
      'aws_subnet',
      'public_a',
      {
        vpc_id: ref('aws_vpc.main.id'),
        cidr_block: lit('10.0.1.0/24'),
        availability_zone: lit('us-east-1a'),
        map_public_ip_on_launch: lit(true),
      },
      { x: 32, y: 64, w: 300, h: 140 },
    ),
    res(
      'aws_subnet',
      'public_b',
      {
        vpc_id: ref('aws_vpc.main.id'),
        cidr_block: lit('10.0.2.0/24'),
        availability_zone: lit('us-east-1b'),
        map_public_ip_on_launch: lit(true),
      },
      { x: 368, y: 64, w: 300, h: 140 },
    ),
    res(
      'aws_security_group',
      'service',
      {
        name: name('aws_security_group', 'svc-sg'),
        description: lit('Service + ALB traffic'),
        vpc_id: ref('aws_vpc.main.id'),
      },
      { x: 32, y: 248 },
    ),
    ...awsPublicRouting(['public_a', 'public_b'], {
      gateway: { x: 264, y: 248 },
      table: { x: 496, y: 248 },
      associations: [
        { x: 290, y: 530 },
        { x: 540, y: 530 },
      ],
    }),
    res(
      'aws_lb',
      'main',
      {
        name: name('aws_lb', 'alb'),
        internal: lit(false),
        load_balancer_type: lit('application'),
        subnets: list([ref('aws_subnet.public_a.id'), ref('aws_subnet.public_b.id')]),
        security_groups: list([ref('aws_security_group.service.id')]),
      },
      // not inside a subnet: it spans both public subnets (see `subnets`)
      { x: 40, y: 530 },
      ['# Load balancing'],
    ),
    res(
      'aws_lb_target_group',
      'app',
      {
        name: name('aws_lb_target_group', 'tg'),
        port: lit(3000),
        protocol: lit('HTTP'),
        vpc_id: ref('aws_vpc.main.id'),
        target_type: lit('ip'),
      },
      { x: 380, y: 330 },
    ),
    res(
      'aws_lb_listener',
      'http',
      {
        load_balancer_arn: ref('aws_lb.main.arn'),
        port: lit(80),
        protocol: lit('HTTP'),
        default_action: block({
          type: lit('forward'),
          target_group_arn: ref('aws_lb_target_group.app.arn'),
        }),
      },
      { x: 790, y: 60 },
    ),
    res(
      'aws_ecr_repository',
      'app',
      { name: name('aws_ecr_repository', 'app') },
      { x: 790, y: 170 },
      ['# Containers'],
    ),
    res('aws_ecs_cluster', 'main', { name: name('aws_ecs_cluster', 'cluster') }, { x: 790, y: 280, w: 340, h: 190 }),
    res(
      'aws_ecs_service',
      'app',
      {
        name: name('aws_ecs_service', 'svc'),
        cluster: ref('aws_ecs_cluster.main.id'),
        task_definition: ref('aws_ecs_task_definition.app.arn'),
        desired_count: lit(2),
        launch_type: lit('FARGATE'),
        network_configuration: block({
          subnets: list([ref('aws_subnet.public_a.id'), ref('aws_subnet.public_b.id')]),
          security_groups: list([ref('aws_security_group.service.id')]),
          assign_public_ip: lit(true),
        }),
      },
      { x: 36, y: 64 },
    ),
    res(
      'aws_ecs_task_definition',
      'app',
      {
        family: lit(slug),
        requires_compatibilities: list([lit('FARGATE')]),
        cpu: lit('256'),
        memory: lit('512'),
        network_mode: lit('awsvpc'),
        container_definitions: raw(
          `jsonencode([{\n    name         = "app"\n    image        = "\${aws_ecr_repository.app.repository_url}:latest"\n    essential    = true\n    portMappings = [{ containerPort = 3000 }]\n  }])`,
        ),
      },
      { x: 1180, y: 300 },
    ),
  );

  ir.outputs.push(output('alb_dns_name', ref('aws_lb.main.dns_name'), 'Public URL of the ALB'));

  return emitProject(ir);
}

// --- AWS · Serverless API -----------------------------------------------------

function buildAwsServerlessApi(appName: string): Record<string, string> {
  const { name } = namer(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('region', { description: 'AWS region', type: 'string', default: lit('us-east-1') }),
  );
  ir.providers.push(providerBlock('aws', { region: ref('var.region') }));
  ir.extras.push(versionsBlock(['aws']));

  ir.resources.push(
    res(
      'aws_apigatewayv2_api',
      'http',
      { name: name('aws_apigatewayv2_api', 'api'), protocol_type: lit('HTTP') },
      { x: 40, y: 60, w: 520, h: 290 },
      ['# HTTP API'],
    ),
    res(
      'aws_apigatewayv2_route',
      'default',
      {
        api_id: ref('aws_apigatewayv2_api.http.id'),
        route_key: lit('$default'),
        target: raw('"integrations/${aws_apigatewayv2_integration.lambda.id}"'),
      },
      { x: 28, y: 64 },
    ),
    res(
      'aws_apigatewayv2_integration',
      'lambda',
      {
        api_id: ref('aws_apigatewayv2_api.http.id'),
        integration_type: lit('AWS_PROXY'),
        integration_method: lit('POST'),
        integration_uri: ref('aws_lambda_function.api.invoke_arn'),
        payload_format_version: lit('2.0'),
      },
      { x: 284, y: 64 },
    ),
    res(
      'aws_apigatewayv2_stage',
      'default',
      { api_id: ref('aws_apigatewayv2_api.http.id'), name: lit('$default'), auto_deploy: lit(true) },
      { x: 28, y: 180 },
    ),
    res(
      'aws_lambda_function',
      'api',
      {
        function_name: name('aws_lambda_function', 'api'),
        role: ref('aws_iam_role.lambda.arn'),
        runtime: lit('nodejs22.x'),
        handler: lit('index.handler'),
        filename: lit('lambda.zip'),
        memory_size: lit(256),
        timeout: lit(10),
        environment: block({ variables: obj({ TABLE_NAME: ref('aws_dynamodb_table.items.name') }) }),
      },
      { x: 640, y: 124 },
      ['# Function — package your handler as lambda.zip next to these files'],
    ),
    res(
      'aws_lambda_permission',
      'api',
      {
        function_name: ref('aws_lambda_function.api.function_name'),
        action: lit('lambda:InvokeFunction'),
        principal: lit('apigateway.amazonaws.com'),
        source_arn: raw('"${aws_apigatewayv2_api.http.execution_arn}/*/*"'),
      },
      { x: 640, y: 250 },
    ),
    res(
      'aws_dynamodb_table',
      'items',
      {
        name: name('aws_dynamodb_table', 'items'),
        billing_mode: lit('PAY_PER_REQUEST'),
        hash_key: lit('id'),
        attribute: block({ name: lit('id'), type: lit('S') }),
      },
      { x: 940, y: 124 },
      ['# Data'],
    ),
    res(
      'aws_iam_role',
      'lambda',
      {
        name: name('aws_iam_role', 'lambda-role'),
        assume_role_policy: raw(
          `jsonencode({\n    Version = "2012-10-17"\n    Statement = [{\n      Action    = "sts:AssumeRole"\n      Effect    = "Allow"\n      Principal = { Service = "lambda.amazonaws.com" }\n    }]\n  })`,
        ),
      },
      { x: 640, y: 390 },
      ['# Identity — least privilege: this table + CloudWatch logs'],
    ),
    res(
      'aws_iam_role_policy',
      'lambda',
      {
        name: name('aws_iam_role_policy', 'lambda-access'),
        role: ref('aws_iam_role.lambda.id'),
        policy: raw(
          `jsonencode({\n    Version = "2012-10-17"\n    Statement = [\n      {\n        Effect   = "Allow"\n        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"]\n        Resource = aws_dynamodb_table.items.arn\n      },\n      {\n        Effect   = "Allow"\n        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]\n        Resource = "*"\n      }\n    ]\n  })`,
        ),
      },
      { x: 940, y: 390 },
    ),
  );

  ir.outputs.push(
    output('api_url', ref('aws_apigatewayv2_stage.default.invoke_url'), 'Base URL of the HTTP API'),
  );

  return emitProject(ir);
}

// --- AWS · Secure 3-tier ------------------------------------------------------

function buildAwsSecure3Tier(appName: string): Record<string, string> {
  const { slug, name } = namer(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('region', { description: 'AWS region', type: 'string', default: lit('us-east-1') }),
    variable('certificate_arn', { description: 'ACM certificate for the HTTPS listener', type: 'string' }),
    variable('db_password', { description: 'Master password for the database', type: 'string', sensitive: true }),
  );
  ir.providers.push(providerBlock('aws', { region: ref('var.region') }));
  ir.extras.push(versionsBlock(['aws']));

  const subnet = (name: string, cidr: string, az: string, x: number, y: number) =>
    res(
      'aws_subnet',
      name,
      { vpc_id: ref('aws_vpc.main.id'), cidr_block: lit(cidr), availability_zone: lit(az) },
      { x, y, w: 400, h: 150 },
    );
  const sgRule = (description: string, port: number, source: Record<string, Expression>) => ({
    description: lit(description),
    from_port: lit(port),
    to_port: lit(port),
    protocol: lit('tcp'),
    ...source,
  });
  const internet = { cidr_blocks: list([lit('0.0.0.0/0')]) };
  const assoc = (name: string, subnetName: string, table: string, x: number) =>
    res(
      'aws_route_table_association',
      name,
      { subnet_id: ref(`aws_subnet.${subnetName}.id`), route_table_id: ref(`aws_route_table.${table}.id`) },
      { x, y: 730 },
    );

  ir.resources.push(
    // --- edge: the only thing the internet can reach
    res(
      'aws_lb',
      'web',
      {
        name: name('aws_lb', 'alb'),
        internal: lit(false),
        load_balancer_type: lit('application'),
        subnets: list([ref('aws_subnet.public_a.id'), ref('aws_subnet.public_b.id')]),
        security_groups: list([ref('aws_security_group.alb.id')]),
        drop_invalid_header_fields: lit(true),
      },
      { x: 40, y: 120 },
      ['# Edge — the load balancer is the only internet-facing resource'],
    ),
    res(
      'aws_lb_listener',
      'https',
      {
        load_balancer_arn: ref('aws_lb.web.arn'),
        port: lit(443),
        protocol: lit('HTTPS'),
        ssl_policy: lit('ELBSecurityPolicy-TLS13-1-2-2021-06'),
        certificate_arn: ref('var.certificate_arn'),
        default_action: block({ type: lit('forward'), target_group_arn: ref('aws_lb_target_group.app.arn') }),
      },
      { x: 40, y: 250 },
    ),
    res(
      'aws_lb_listener',
      'http_redirect',
      {
        load_balancer_arn: ref('aws_lb.web.arn'),
        port: lit(80),
        protocol: lit('HTTP'),
        default_action: block({
          type: lit('redirect'),
          redirect: block({ port: lit('443'), protocol: lit('HTTPS'), status_code: lit('HTTP_301') }),
        }),
      },
      { x: 40, y: 350 },
    ),
    res(
      'aws_lb_target_group',
      'app',
      {
        name: name('aws_lb_target_group', 'tg'),
        port: lit(8080),
        protocol: lit('HTTP'),
        vpc_id: ref('aws_vpc.main.id'),
        target_type: lit('instance'),
      },
      // lives in the VPC (vpc_id), next to the security groups — not in a subnet
      { x: 900, y: 166 },
    ),

    // --- network
    res(
      'aws_vpc',
      'main',
      { cidr_block: lit('10.0.0.0/16'), enable_dns_hostnames: lit(true), tags: obj({ Name: lit(slug) }) },
      { x: 320, y: 40, w: 1380, h: 640 },
      ['# Network — public, app and data tiers across two AZs'],
    ),
    subnet('public_a', '10.0.1.0/24', 'us-east-1a', 32, 64),
    subnet('public_b', '10.0.2.0/24', 'us-east-1b', 456, 64),
    subnet('app_a', '10.0.11.0/24', 'us-east-1a', 32, 250),
    subnet('app_b', '10.0.12.0/24', 'us-east-1b', 456, 250),
    subnet('db_a', '10.0.21.0/24', 'us-east-1a', 32, 436),
    subnet('db_b', '10.0.22.0/24', 'us-east-1b', 456, 436),
    res('aws_internet_gateway', 'igw', { vpc_id: ref('aws_vpc.main.id') }, { x: 1140, y: 276 }),
    res('aws_eip', 'nat', { domain: lit('vpc') }, { x: 1760, y: 100 }),
    res(
      'aws_nat_gateway',
      'nat',
      { subnet_id: ref('aws_subnet.public_a.id'), allocation_id: ref('aws_eip.nat.id'), connectivity_type: lit('public') },
      { x: 24, y: 52 },
    ),
    res(
      'aws_route_table',
      'public',
      {
        vpc_id: ref('aws_vpc.main.id'),
        route: block({ cidr_block: lit('0.0.0.0/0'), gateway_id: ref('aws_internet_gateway.igw.id') }),
      },
      { x: 1140, y: 64 },
    ),
    res(
      'aws_route_table',
      'private',
      {
        vpc_id: ref('aws_vpc.main.id'),
        route: block({ cidr_block: lit('0.0.0.0/0'), nat_gateway_id: ref('aws_nat_gateway.nat.id') }),
      },
      { x: 1140, y: 170 },
    ),
    assoc('public_a', 'public_a', 'public', 320),
    assoc('public_b', 'public_b', 'public', 560),
    assoc('app_a', 'app_a', 'private', 800),
    assoc('app_b', 'app_b', 'private', 1040),

    // --- security: each tier only accepts traffic from the tier in front of it
    res(
      'aws_security_group',
      'alb',
      {
        name: name('aws_security_group', 'alb-sg'),
        description: lit('Public HTTPS (and HTTP → HTTPS redirect) to the load balancer'),
        vpc_id: ref('aws_vpc.main.id'),
        ingress: blocks([sgRule('HTTPS from the internet', 443, internet), sgRule('HTTP, redirected to HTTPS', 80, internet)]),
        egress: block(sgRule('To the app tier', 8080, { cidr_blocks: list([lit('10.0.0.0/16')]) })),
      },
      { x: 900, y: 64 },
      ['# Security — each tier only accepts traffic from the tier in front of it'],
    ),
    res(
      'aws_security_group',
      'app',
      {
        name: name('aws_security_group', 'app-sg'),
        description: lit('App servers: only the load balancer can reach them'),
        vpc_id: ref('aws_vpc.main.id'),
        ingress: block(sgRule('From the load balancer', 8080, { security_groups: list([ref('aws_security_group.alb.id')]) })),
        egress: block({
          description: lit('Outbound through the NAT gateway'),
          from_port: lit(0),
          to_port: lit(0),
          protocol: lit('-1'),
          cidr_blocks: list([lit('0.0.0.0/0')]),
        }),
      },
      { x: 900, y: 270 },
    ),
    res(
      'aws_security_group',
      'db',
      {
        name: name('aws_security_group', 'db-sg'),
        description: lit('Database: only the app tier can reach it'),
        vpc_id: ref('aws_vpc.main.id'),
        ingress: block(sgRule('PostgreSQL from the app tier', 5432, { security_groups: list([ref('aws_security_group.app.id')]) })),
      },
      { x: 900, y: 460 },
    ),
    res(
      'aws_network_acl',
      'db',
      {
        vpc_id: ref('aws_vpc.main.id'),
        subnet_ids: list([ref('aws_subnet.db_a.id'), ref('aws_subnet.db_b.id')]),
        ingress: blocks([
          { rule_no: lit(100), action: lit('allow'), protocol: lit('tcp'), from_port: lit(5432), to_port: lit(5432), cidr_block: lit('10.0.11.0/24') },
          { rule_no: lit(110), action: lit('allow'), protocol: lit('tcp'), from_port: lit(5432), to_port: lit(5432), cidr_block: lit('10.0.12.0/24') },
        ]),
        egress: block({
          rule_no: lit(100),
          action: lit('allow'),
          protocol: lit('tcp'),
          from_port: lit(1024),
          to_port: lit(65535),
          cidr_block: lit('10.0.0.0/16'),
        }),
      },
      { x: 1140, y: 460 },
    ),

    // --- compute & data
    res(
      'aws_instance',
      'app',
      {
        ami: lit('ami-0c02fb55956c7d316'),
        instance_type: lit('t3.micro'),
        subnet_id: ref('aws_subnet.app_a.id'),
        vpc_security_group_ids: list([ref('aws_security_group.app.id')]),
        metadata_options: block({ http_endpoint: lit('enabled'), http_tokens: lit('required') }),
        root_block_device: block({ encrypted: lit(true) }),
      },
      { x: 24, y: 52 },
      ['# Compute — private app server, IMDSv2 only'],
    ),
    res(
      'aws_db_subnet_group',
      'main',
      { name: name('aws_db_subnet_group', 'db'), subnet_ids: list([ref('aws_subnet.db_a.id'), ref('aws_subnet.db_b.id')]) },
      { x: 1760, y: 570 },
    ),
    res(
      'aws_db_instance',
      'main',
      {
        identifier: name('aws_db_instance', 'db'),
        engine: lit('postgres'),
        engine_version: lit('16'),
        instance_class: lit('db.t3.micro'),
        allocated_storage: lit(20),
        username: lit('appuser'),
        password: ref('var.db_password'),
        db_subnet_group_name: ref('aws_db_subnet_group.main.name'),
        vpc_security_group_ids: list([ref('aws_security_group.db.id')]),
        storage_encrypted: lit(true),
        publicly_accessible: lit(false),
        skip_final_snapshot: lit(true),
      },
      { x: 1760, y: 460 },
      ['# Data — private, encrypted PostgreSQL'],
    ),
  );

  ir.outputs.push(
    output('alb_dns_name', ref('aws_lb.web.dns_name'), 'Public entry point'),
    output('db_endpoint', ref('aws_db_instance.main.endpoint'), 'Private database endpoint'),
  );
  return emitProject(ir);
}

// --- Azure · Web App ----------------------------------------------------------

function buildAzureWebApp(appName: string): Record<string, string> {
  const { name } = namer(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('location', { description: 'Azure region', type: 'string', default: lit('eastus') }),
    variable('admin_password', { description: 'VM + SQL admin password', type: 'string', sensitive: true }),
  );
  ir.providers.push(providerBlock('azure', { features: block({}) }));
  ir.extras.push(versionsBlock(['azure']));

  ir.resources.push(
    res(
      'azurerm_resource_group',
      'main',
      { name: name('azurerm_resource_group', 'rg'), location: ref('var.location') },
      { x: 40, y: 60, w: 900, h: 520 },
      ['# Everything lives in one resource group'],
    ),
    res(
      'azurerm_virtual_network',
      'main',
      {
        name: name('azurerm_virtual_network', 'vnet'),
        address_space: list([lit('10.10.0.0/16')]),
        location: ref('azurerm_resource_group.main.location'),
        resource_group_name: ref('azurerm_resource_group.main.name'),
      },
      { x: 32, y: 64, w: 420, h: 260 },
    ),
    res(
      'azurerm_subnet',
      'app',
      {
        name: lit('app'),
        resource_group_name: ref('azurerm_resource_group.main.name'),
        virtual_network_name: ref('azurerm_virtual_network.main.name'),
        address_prefixes: list([lit('10.10.1.0/24')]),
      },
      { x: 32, y: 64, w: 260, h: 150 },
    ),
    res(
      'azurerm_network_security_group',
      'app',
      {
        name: name('azurerm_network_security_group', 'nsg'),
        location: ref('azurerm_resource_group.main.location'),
        resource_group_name: ref('azurerm_resource_group.main.name'),
      },
      { x: 490, y: 64 },
    ),
    res(
      'azurerm_network_interface',
      'app',
      {
        name: name('azurerm_network_interface', 'nic'),
        location: ref('azurerm_resource_group.main.location'),
        resource_group_name: ref('azurerm_resource_group.main.name'),
        ip_configuration: block({
          name: lit('internal'),
          subnet_id: ref('azurerm_subnet.app.id'),
          private_ip_address_allocation: lit('Dynamic'),
        }),
      },
      { x: 490, y: 160 },
    ),
    res(
      'azurerm_linux_virtual_machine',
      'app',
      {
        name: name('azurerm_linux_virtual_machine', 'vm'),
        location: ref('azurerm_resource_group.main.location'),
        resource_group_name: ref('azurerm_resource_group.main.name'),
        size: lit('Standard_B1s'),
        admin_username: lit('azureuser'),
        admin_password: ref('var.admin_password'),
        disable_password_authentication: lit(false),
        network_interface_ids: list([ref('azurerm_network_interface.app.id')]),
        os_disk: block({
          caching: lit('ReadWrite'),
          storage_account_type: lit('Standard_LRS'),
        }),
        source_image_reference: block({
          publisher: lit('Canonical'),
          offer: lit('ubuntu-24_04-lts'),
          sku: lit('server'),
          version: lit('latest'),
        }),
      },
      { x: 32, y: 360 },
      ['# Compute'],
    ),
    res(
      'azurerm_mssql_server',
      'main',
      {
        name: name('azurerm_mssql_server', 'sqlserver'),
        resource_group_name: ref('azurerm_resource_group.main.name'),
        location: ref('azurerm_resource_group.main.location'),
        version: lit('12.0'),
        administrator_login: lit('sqladmin'),
        administrator_login_password: ref('var.admin_password'),
      },
      { x: 490, y: 360 },
      ['# Database'],
    ),
    res(
      'azurerm_mssql_database',
      'app',
      {
        name: name('azurerm_mssql_database', 'db'),
        server_id: ref('azurerm_mssql_server.main.id'),
        sku_name: lit('Basic'),
      },
      { x: 990, y: 420 },
    ),
  );

  ir.outputs.push(output('vm_private_ip', ref('azurerm_network_interface.app.private_ip_address')));

  return emitProject(ir);
}

// --- GCP · Static Site ----------------------------------------------------------

function buildGcpStaticSite(appName: string): Record<string, string> {
  const { name } = namer(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('project_id', { description: 'GCP project id', type: 'string' }),
    variable('domain_name', { description: 'Site domain', type: 'string', default: lit('example.com.') }),
  );
  ir.providers.push(
    providerBlock('gcp', { project: ref('var.project_id'), region: lit('us-central1') }),
  );
  ir.extras.push(versionsBlock(['gcp']));

  ir.resources.push(
    res(
      'google_storage_bucket',
      'site',
      {
        name: name('google_storage_bucket', 'site'),
        location: lit('US'),
        storage_class: lit('STANDARD'),
        uniform_bucket_level_access: lit(true),
        website: block({ main_page_suffix: lit('index.html') }),
      },
      { x: 60, y: 240 },
      ['# Static assets'],
    ),
    res(
      'google_compute_backend_bucket',
      'site',
      {
        name: name('google_compute_backend_bucket', 'backend'),
        bucket_name: ref('google_storage_bucket.site.name'),
        enable_cdn: lit(true),
      },
      { x: 380, y: 240 },
      ['# Global HTTP load balancer'],
    ),
    res(
      'google_compute_url_map',
      'site',
      { name: name('google_compute_url_map', 'urlmap'), default_service: ref('google_compute_backend_bucket.site.id') },
      { x: 700, y: 240 },
    ),
    res(
      'google_compute_target_http_proxy',
      'site',
      { name: name('google_compute_target_http_proxy', 'proxy'), url_map: ref('google_compute_url_map.site.id') },
      { x: 1020, y: 240 },
    ),
    res(
      'google_compute_global_forwarding_rule',
      'site',
      {
        name: name('google_compute_global_forwarding_rule', 'fwd'),
        target: ref('google_compute_target_http_proxy.site.id'),
        port_range: lit('80'),
      },
      { x: 1020, y: 80 },
    ),
    res(
      'google_dns_managed_zone',
      'main',
      { name: name('google_dns_managed_zone', 'zone'), dns_name: ref('var.domain_name') },
      { x: 60, y: 80 },
      ['# DNS'],
    ),
    res(
      'google_dns_record_set',
      'root',
      {
        name: ref('var.domain_name'),
        managed_zone: ref('google_dns_managed_zone.main.name'),
        type: lit('A'),
        ttl: lit(300),
        rrdatas: list([ref('google_compute_global_forwarding_rule.site.ip_address')]),
      },
      { x: 380, y: 80 },
    ),
  );

  ir.outputs.push(output('lb_ip', ref('google_compute_global_forwarding_rule.site.ip_address')));

  return emitProject(ir);
}

// --- Azure · Static Site --------------------------------------------------------

function buildAzureStaticSite(appName: string): Record<string, string> {
  const { name } = namer(appName);
  const ir: IR = emptyIR();

  ir.providers.push(providerBlock('azure', { features: block({}) }));
  ir.extras.push(versionsBlock(['azure']));

  ir.resources.push(
    res(
      'azurerm_resource_group',
      'main',
      { name: name('azurerm_resource_group', 'rg'), location: lit('eastus') },
      { x: 40, y: 60, w: 860, h: 320 },
      ['# Everything lives in one resource group'],
    ),
    res(
      'azurerm_storage_account',
      'site',
      {
        name: name('azurerm_storage_account', 'site'),
        resource_group_name: ref('azurerm_resource_group.main.name'),
        location: ref('azurerm_resource_group.main.location'),
        account_tier: lit('Standard'),
        account_replication_type: lit('LRS'),
      },
      { x: 40, y: 80 },
      ['# Static assets served from blob storage'],
    ),
    res(
      'azurerm_storage_account_static_website',
      'site',
      {
        storage_account_id: ref('azurerm_storage_account.site.id'),
        index_document: lit('index.html'),
        error_404_document: lit('404.html'),
      },
      { x: 40, y: 420 },
    ),
    res(
      'azurerm_cdn_profile',
      'main',
      {
        name: name('azurerm_cdn_profile', 'cdn'),
        location: lit('global'),
        resource_group_name: ref('azurerm_resource_group.main.name'),
        sku: lit('Standard_Microsoft'),
      },
      { x: 340, y: 80 },
      ['# CDN'],
    ),
    res(
      'azurerm_cdn_endpoint',
      'site',
      {
        name: name('azurerm_cdn_endpoint', 'endpoint'),
        profile_name: ref('azurerm_cdn_profile.main.name'),
        location: lit('global'),
        resource_group_name: ref('azurerm_resource_group.main.name'),
        origin: block({
          name: lit('storage'),
          host_name: ref('azurerm_storage_account.site.primary_web_host'),
        }),
      },
      { x: 610, y: 80 },
    ),
  );

  ir.outputs.push(
    output('site_url', ref('azurerm_storage_account.site.primary_web_endpoint')),
    output('cdn_url', raw('"https://${azurerm_cdn_endpoint.site.fqdn}"')),
  );

  return emitProject(ir);
}

// --- GCP · Web App ---------------------------------------------------------------

function buildGcpWebApp(appName: string): Record<string, string> {
  const { name } = namer(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('project_id', { description: 'GCP project id', type: 'string' }),
    variable('region', { description: 'GCP region', type: 'string', default: lit('us-central1') }),
  );
  ir.providers.push(providerBlock('gcp', { project: ref('var.project_id'), region: ref('var.region') }));
  ir.extras.push(versionsBlock(['gcp']));

  ir.resources.push(
    res(
      'google_compute_network',
      'main',
      { name: name('google_compute_network', 'network'), auto_create_subnetworks: lit(false) },
      { x: 40, y: 60, w: 700, h: 360 },
      ['# Networking'],
    ),
    res(
      'google_compute_subnetwork',
      'app',
      {
        name: name('google_compute_subnetwork', 'subnet'),
        ip_cidr_range: lit('10.0.1.0/24'),
        region: ref('var.region'),
        network: ref('google_compute_network.main.id'),
      },
      { x: 32, y: 64, w: 320, h: 180 },
    ),
    res(
      'google_compute_firewall',
      'allow_http',
      {
        name: name('google_compute_firewall', 'allow-http'),
        network: ref('google_compute_network.main.id'),
        direction: lit('INGRESS'),
        source_ranges: list([lit('0.0.0.0/0')]),
        allow: block({
          protocol: lit('tcp'),
          ports: list([lit('80'), lit('22')]),
        }),
      },
      { x: 400, y: 90 },
    ),
    res(
      'google_compute_instance',
      'web',
      {
        name: name('google_compute_instance', 'web'),
        machine_type: lit('e2-micro'),
        zone: raw('"${var.region}-a"'),
        boot_disk: block({
          initialize_params: block({ image: lit('debian-cloud/debian-12') }),
        }),
        network_interface: block({
          subnetwork: ref('google_compute_subnetwork.app.id'),
          access_config: block({}),
        }),
        metadata: obj({
          'db-connection': ref('google_sql_database_instance.main.connection_name'),
        }),
      },
      { x: 48, y: 70 },
      ['# Compute'],
    ),
    res(
      'google_sql_database_instance',
      'main',
      {
        name: name('google_sql_database_instance', 'db'),
        database_version: lit('POSTGRES_16'),
        region: ref('var.region'),
        deletion_protection: lit(false),
        settings: block({ tier: lit('db-f1-micro') }),
      },
      { x: 800, y: 240 },
      ['# Database'],
    ),
  );

  ir.outputs.push(
    output('web_ip', raw('google_compute_instance.web.network_interface[0].access_config[0].nat_ip')),
    output('db_connection', ref('google_sql_database_instance.main.connection_name')),
  );

  return emitProject(ir);
}

// --- GCP · Cloud Run ---------------------------------------------------------------

function buildGcpCloudRun(appName: string): Record<string, string> {
  const { name } = namer(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('project_id', { description: 'GCP project id', type: 'string' }),
    variable('region', { description: 'GCP region', type: 'string', default: lit('us-central1') }),
  );
  ir.providers.push(providerBlock('gcp', { project: ref('var.project_id'), region: ref('var.region') }));
  ir.extras.push(versionsBlock(['gcp']));

  ir.resources.push(
    res(
      'google_artifact_registry_repository',
      'app',
      {
        repository_id: name('google_artifact_registry_repository', 'images'),
        format: lit('DOCKER'),
        location: ref('var.region'),
      },
      { x: 60, y: 120 },
      ['# Container images'],
    ),
    res(
      'google_cloud_run_v2_service',
      'app',
      {
        name: name('google_cloud_run_v2_service', 'svc'),
        location: ref('var.region'),
        ingress: lit('INGRESS_TRAFFIC_ALL'),
        template: block({
          containers: block({
            image: raw(
              '"${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/app:latest"',
            ),
            ports: block({ container_port: lit(3000) }),
          }),
          scaling: block({ min_instance_count: lit(0), max_instance_count: lit(4) }),
        }),
      },
      { x: 420, y: 120 },
      ['# Serverless service'],
    ),
  );

  ir.outputs.push(output('service_url', ref('google_cloud_run_v2_service.app.uri')));

  return emitProject(ir);
}

// --- Multi-cloud · DR storage ---------------------------------------------------------

function buildMultiCloudDr(appName: string): Record<string, string> {
  const { name } = namer(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('domain_name', { description: 'Public domain', type: 'string', default: lit('example.com') }),
    variable('gcp_project_id', { description: 'GCP project id', type: 'string' }),
  );
  ir.providers.push(
    providerBlock('aws', { region: lit('us-east-1') }),
    providerBlock('gcp', { project: ref('var.gcp_project_id'), region: lit('us-central1') }),
    providerBlock('azure', { features: block({}) }),
  );
  ir.extras.push(versionsBlock(['aws', 'gcp', 'azure']));

  ir.resources.push(
    // Primary — AWS
    res(
      'aws_s3_bucket',
      'primary',
      { bucket: name('aws_s3_bucket', 'primary'), force_destroy: lit(true) },
      { x: 40, y: 120 },
      ['# Primary copy — AWS', '# Replication to the other clouds runs out-of-band (rclone / storage transfer).'],
    ),
    res(
      'aws_route53_zone',
      'main',
      { name: ref('var.domain_name') },
      { x: 40, y: 300 },
      ['# DNS — flip this record to fail over'],
    ),
    res(
      'aws_route53_record',
      'data',
      {
        zone_id: ref('aws_route53_zone.main.zone_id'),
        name: raw('"data.${var.domain_name}"'),
        type: lit('CNAME'),
        ttl: lit(60),
        records: list([raw('aws_s3_bucket.primary.bucket_regional_domain_name')]),
      },
      { x: 340, y: 300 },
    ),
    // Replica — GCP
    res(
      'google_storage_bucket',
      'replica',
      {
        name: name('google_storage_bucket', 'replica'),
        location: lit('US'),
        storage_class: lit('STANDARD'),
        uniform_bucket_level_access: lit(true),
      },
      { x: 640, y: 120 },
      ['# Warm replica — GCP'],
    ),
    // Cold archive — Azure
    res(
      'azurerm_resource_group',
      'dr',
      { name: name('azurerm_resource_group', 'dr-rg'), location: lit('eastus') },
      { x: 940, y: 60, w: 380, h: 260 },
      ['# Cold archive — Azure'],
    ),
    res(
      'azurerm_storage_account',
      'archive',
      {
        name: name('azurerm_storage_account', 'archive'),
        resource_group_name: ref('azurerm_resource_group.dr.name'),
        location: ref('azurerm_resource_group.dr.location'),
        account_tier: lit('Standard'),
        account_replication_type: lit('GRS'),
      },
      { x: 40, y: 80 },
    ),
  );

  ir.outputs.push(
    output('primary_bucket', ref('aws_s3_bucket.primary.id')),
    output('replica_bucket', ref('google_storage_bucket.replica.name')),
    output('archive_account', ref('azurerm_storage_account.archive.name')),
  );

  return emitProject(ir);
}

// --- Blank project ------------------------------------------------------------

export function scratchProject(provider: Provider, appName: string): Record<string, string> {
  const ir: IR = emptyIR();
  const source = providerSourceName(provider);
  const args: Record<string, Expression> =
    provider === 'aws'
      ? { region: lit('us-east-1') }
      : provider === 'azure'
        ? { features: block({}) }
        : { project: ref('var.project_id'), region: lit('us-central1') };
  if (provider === 'gcp') {
    ir.variables.push(variable('project_id', { description: 'GCP project id', type: 'string' }));
  }
  ir.providers.push({ id: `provider.${source}.0`, name: source, args, trivia: { leadingComments: [] } });
  ir.extras.push(versionsBlock([provider]));
  const files = emitProject(ir);
  files['main.tf'] = `# ${appName}\n# Drag resources from the palette, or start typing Terraform here.\n`;
  return files;
}

// --- registry -------------------------------------------------------------------

export const TEMPLATES: TemplateDef[] = [
  {
    slug: 'aws-web-app',
    name: 'Web App on AWS',
    description: 'VPC with two public subnets behind an internet gateway, an EC2 web server, RDS PostgreSQL and security groups.',
    providers: ['aws'],
    tags: ['Web Apps'],
    resourceCount: 11,
    build: buildAwsWebApp,
  },
  {
    slug: 'aws-static-site',
    name: 'Static Site CDN',
    description: 'S3 bucket served through CloudFront with Route 53 DNS records.',
    providers: ['aws'],
    tags: ['Static Sites'],
    resourceCount: 4,
    build: buildAwsStaticSite,
  },
  {
    slug: 'aws-container-stack',
    name: 'ECS Fargate Stack',
    description: 'ECS Fargate service behind an ALB, with ECR registry and full VPC networking.',
    providers: ['aws'],
    tags: ['Containers', 'Web Apps'],
    resourceCount: 15,
    build: buildAwsContainerStack,
  },
  {
    slug: 'aws-serverless-api',
    name: 'Serverless API on AWS',
    description: 'HTTP API Gateway → Lambda → DynamoDB, with a least-privilege IAM role.',
    providers: ['aws'],
    tags: ['Serverless', 'Web Apps'],
    resourceCount: 9,
    build: buildAwsServerlessApi,
  },
  {
    slug: 'aws-secure-3tier',
    name: 'Secure 3-tier on AWS',
    description: 'Reference architecture that scores an A: HTTPS-only ALB, private app and data tiers, chained security groups, NACLs, NAT, encrypted RDS.',
    providers: ['aws'],
    tags: ['Web Apps', 'Security'],
    resourceCount: 27,
    build: buildAwsSecure3Tier,
  },
  {
    slug: 'azure-web-app',
    name: 'Azure Web App',
    description: 'Resource group with VNet, Linux VM, NSG and Azure SQL database.',
    providers: ['azure'],
    tags: ['Web Apps'],
    resourceCount: 8,
    build: buildAzureWebApp,
  },
  {
    slug: 'azure-static-site',
    name: 'Azure Static Site',
    description: 'Blob storage static website served through Azure CDN.',
    providers: ['azure'],
    tags: ['Static Sites'],
    resourceCount: 5,
    build: buildAzureStaticSite,
  },
  {
    slug: 'gcp-web-app',
    name: 'GCP Web App',
    description: 'VPC network with a Compute Engine web server, firewall rules and Cloud SQL.',
    providers: ['gcp'],
    tags: ['Web Apps'],
    resourceCount: 5,
    build: buildGcpWebApp,
  },
  {
    slug: 'gcp-cloud-run',
    name: 'GCP Cloud Run',
    description: 'Serverless containers on Cloud Run pulling images from Artifact Registry.',
    providers: ['gcp'],
    tags: ['Containers', 'Serverless'],
    resourceCount: 2,
    build: buildGcpCloudRun,
  },
  {
    slug: 'gcp-static-site',
    name: 'GCP Static Site',
    description: 'Cloud Storage bucket behind a global HTTP load balancer with Cloud CDN and DNS.',
    providers: ['gcp'],
    tags: ['Static Sites'],
    resourceCount: 7,
    build: buildGcpStaticSite,
  },
  {
    slug: 'multi-cloud-dr',
    name: 'Multi-cloud DR',
    description: 'Primary S3 bucket with a GCP warm replica, Azure cold archive and Route 53 failover DNS.',
    providers: ['aws', 'gcp', 'azure'],
    tags: ['Data'],
    resourceCount: 6,
    build: buildMultiCloudDr,
  },
];

export function getTemplate(slug: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}
