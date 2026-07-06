/**
 * Templates: macros that build a fully-connected IR and emit it as real
 * Terraform files. After instantiation they are plain resources the user can
 * customize freely — no lock-in, no magic.
 */
import { block, lit, list, obj, raw, ref } from '@/ir/expr';
import { emitProject } from '@/hcl/emitter';
import type {
  CanvasPosition,
  Expression,
  IR,
  Provider,
  ResourceNode,
} from '@/ir/types';
import { emptyIR, providerOfType, providerSourceName, resourceAddress } from '@/ir/types';
import { tfName } from '@/lib/utils';

export interface TemplateDef {
  slug: string;
  name: string;
  description: string;
  providers: Provider[];
  tags: string[];
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

function output(name: string, value: Expression, description?: string) {
  const args: Record<string, Expression> = { value };
  if (description) args.description = lit(description);
  return { id: `output.${name}`, name, args, trivia: { leadingComments: [] } };
}

const PROVIDER_VERSIONS: Record<string, { source: string; version: string }> = {
  aws: { source: 'hashicorp/aws', version: '~> 5.0' },
  azurerm: { source: 'hashicorp/azurerm', version: '~> 4.0' },
  google: { source: 'hashicorp/google', version: '~> 6.0' },
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

// --- AWS · Web App -----------------------------------------------------------

function buildAwsWebApp(appName: string): Record<string, string> {
  const app = tfName(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('app_name', { description: 'Application name', type: 'string', default: lit(app) }),
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
      { x: 40, y: 60, w: 680, h: 430 },
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
        name: lit(`${app}-web-sg`),
        description: lit('Allow HTTP/HTTPS in, Postgres to the DB'),
        vpc_id: ref('aws_vpc.main.id'),
        ingress: block({
          description: lit('HTTP'),
          from_port: lit(80),
          to_port: lit(80),
          protocol: lit('tcp'),
          cidr_blocks: list([lit('0.0.0.0/0')]),
        }),
        egress: block({
          from_port: lit(0),
          to_port: lit(0),
          protocol: lit('-1'),
          cidr_blocks: list([lit('0.0.0.0/0')]),
        }),
      },
      { x: 32, y: 280 },
    ),
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
        identifier: lit(`${app}-db`),
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
        name: lit(`${app}-web-role`),
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
  const app = tfName(appName);
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
      { bucket: lit(`${app}-site`), force_destroy: lit(true) },
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
  const app = tfName(appName);
  const ir: IR = emptyIR();

  ir.variables.push(
    variable('app_name', { description: 'Application name', type: 'string', default: lit(app) }),
    variable('region', { description: 'AWS region', type: 'string', default: lit('us-east-1') }),
  );
  ir.providers.push(providerBlock('aws', { region: ref('var.region') }));
  ir.extras.push(versionsBlock(['aws']));

  ir.resources.push(
    res(
      'aws_vpc',
      'main',
      { cidr_block: lit('10.0.0.0/16'), enable_dns_hostnames: lit(true) },
      { x: 40, y: 60, w: 700, h: 400 },
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
        name: lit(`${app}-svc-sg`),
        description: lit('Service + ALB traffic'),
        vpc_id: ref('aws_vpc.main.id'),
      },
      { x: 32, y: 248 },
    ),
    res(
      'aws_lb',
      'main',
      {
        name: lit(`${app}-alb`),
        internal: lit(false),
        load_balancer_type: lit('application'),
        subnets: list([ref('aws_subnet.public_a.id'), ref('aws_subnet.public_b.id')]),
        security_groups: list([ref('aws_security_group.service.id')]),
      },
      { x: 380, y: 260 },
      ['# Load balancing'],
    ),
    res(
      'aws_lb_target_group',
      'app',
      {
        name: lit(`${app}-tg`),
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
      { name: lit(`${app}-app`) },
      { x: 790, y: 170 },
      ['# Containers'],
    ),
    res('aws_ecs_cluster', 'main', { name: lit(`${app}-cluster`) }, { x: 790, y: 280, w: 340, h: 190 }),
    res(
      'aws_ecs_service',
      'app',
      {
        name: lit(`${app}-svc`),
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
        family: lit(app),
        requires_compatibilities: list([lit('FARGATE')]),
        cpu: lit('256'),
        memory: lit('512'),
        network_mode: lit('awsvpc'),
        container_definitions: raw(
          `jsonencode([{\n    name      = "app"\n    image     = "\${aws_ecr_repository.app.repository_url}:latest"\n    essential = true\n    portMappings = [{ containerPort = 3000 }]\n  }])`,
        ),
      },
      { x: 1180, y: 300 },
    ),
  );

  ir.outputs.push(output('alb_dns_name', ref('aws_lb.main.dns_name'), 'Public URL of the ALB'));

  return emitProject(ir);
}

// --- Azure · Web App ----------------------------------------------------------

function buildAzureWebApp(appName: string): Record<string, string> {
  const app = tfName(appName);
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
      { name: lit(`${app}-rg`), location: ref('var.location') },
      { x: 40, y: 60, w: 900, h: 520 },
      ['# Everything lives in one resource group'],
    ),
    res(
      'azurerm_virtual_network',
      'main',
      {
        name: lit(`${app}-vnet`),
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
        name: lit(`${app}-nsg`),
        location: ref('azurerm_resource_group.main.location'),
        resource_group_name: ref('azurerm_resource_group.main.name'),
      },
      { x: 490, y: 64 },
    ),
    res(
      'azurerm_network_interface',
      'app',
      {
        name: lit(`${app}-nic`),
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
        name: lit(`${app}-vm`),
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
        name: lit(`${app}-sqlserver`),
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
        name: lit(`${app}-db`),
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
  const app = tfName(appName);
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
        name: lit(`${app}-site`),
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
        name: lit(`${app}-backend`),
        bucket_name: ref('google_storage_bucket.site.name'),
        enable_cdn: lit(true),
      },
      { x: 380, y: 240 },
      ['# Global HTTP load balancer'],
    ),
    res(
      'google_compute_url_map',
      'site',
      { name: lit(`${app}-urlmap`), default_service: ref('google_compute_backend_bucket.site.id') },
      { x: 700, y: 240 },
    ),
    res(
      'google_compute_target_http_proxy',
      'site',
      { name: lit(`${app}-proxy`), url_map: ref('google_compute_url_map.site.id') },
      { x: 1020, y: 240 },
    ),
    res(
      'google_compute_global_forwarding_rule',
      'site',
      {
        name: lit(`${app}-fwd`),
        target: ref('google_compute_target_http_proxy.site.id'),
        port_range: lit('80'),
      },
      { x: 1020, y: 80 },
    ),
    res(
      'google_dns_managed_zone',
      'main',
      { name: lit(`${app}-zone`), dns_name: ref('var.domain_name') },
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
    description: 'VPC with two public subnets, an EC2 web server, RDS PostgreSQL and security groups.',
    providers: ['aws'],
    tags: ['Web Apps'],
    resourceCount: 7,
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
    resourceCount: 11,
    build: buildAwsContainerStack,
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
    slug: 'gcp-static-site',
    name: 'GCP Static Site',
    description: 'Cloud Storage bucket behind a global HTTP load balancer with Cloud CDN and DNS.',
    providers: ['gcp'],
    tags: ['Static Sites'],
    resourceCount: 7,
    build: buildGcpStaticSite,
  },
];

export function getTemplate(slug: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}
