/**
 * The data source catalog: the lookups real projects use most, per provider
 * (`data "aws_ami"`, `data "aws_availability_zones"`, `data
 * "azurerm_client_config"`, `data "google_compute_zones"`…), each with the
 * arguments it's added with and which resource arguments usually read it
 * (`ami = data.aws_ami.ubuntu.id`).
 *
 * The English text here is the source; screens read it through ./i18n.ts,
 * which takes the Portuguese from ./catalog.messages.ts.
 */
import { block, blocks, lit, list, obj, ref } from '@/ir/expr';
import type { Expression, IR, Provider } from '@/ir/types';

/** A resource argument that usually reads this data source: `aws_instance.ami ← data.aws_ami.x.id`. */
export interface DataFeed {
  /** resource types that take it */
  resourceTypes: string[];
  arg: string;
  /** what is read: `id`, `names[0]`, `json` */
  read: string;
}

/** What the catalog knows about a data source type (any number of presets may add it). */
export interface DataSourceTypeDef<T extends string = string> {
  type: T;
  provider: Provider;
  displayName: string;
  /** the canvas node's type line */
  shortName: string;
  description: string;
  /** the attributes it is mostly read for, the first one by default (the schema lists them all) */
  attributes: string[];
  feeds?: DataFeed[];
}

/** One palette entry: a data source type added with a name and arguments. */
export interface DataSourcePreset<K extends string = string> {
  key: K;
  type: string;
  /** the Terraform name it's added with (`ubuntu`, `current`, `available`) */
  name: string;
  /** palette name and description when they differ from the type's (two AMI presets) */
  displayName?: string;
  description?: string;
  /** its arguments; `ir` lets a lookup point at what the project already has (a VPC) */
  args(ir: IR): Record<string, Expression>;
}

const defineType = <const T extends string>(def: DataSourceTypeDef<T>) => def;
const definePreset = <const K extends string>(p: DataSourcePreset<K>) => p;

/** a `filter { name = … values = [...] }` block */
const filter = (name: string, values: Expression[]) => ({ name: lit(name), values: list(values) });

/** a project VPC to look subnets up in: a resource first, then a data source */
function vpcRef(ir: IR): Expression | undefined {
  const vpc = ir.resources.find((r) => r.type === 'aws_vpc');
  if (vpc) return ref(`${vpc.id}.id`);
  const looked = ir.data.find((d) => d.type === 'aws_vpc');
  return looked ? ref(`${looked.id}.id`) : undefined;
}

/* ---------------------------------------------------------------- types */

export const DATA_SOURCE_TYPES = [
  /* AWS */
  defineType({
    type: 'aws_ami',
    provider: 'aws',
    displayName: 'AMI',
    shortName: 'AMI',
    description: 'The most recent machine image that matches a filter',
    attributes: ['id', 'name', 'architecture'],
    feeds: [
      { resourceTypes: ['aws_instance'], arg: 'ami', read: 'id' },
      { resourceTypes: ['aws_launch_template'], arg: 'image_id', read: 'id' },
    ],
  }),
  defineType({
    type: 'aws_availability_zones',
    provider: 'aws',
    displayName: 'Availability Zones',
    shortName: 'Availability zones',
    description: 'The availability zones of the region',
    attributes: ['names', 'zone_ids'],
    feeds: [{ resourceTypes: ['aws_subnet', 'aws_instance', 'aws_ebs_volume'], arg: 'availability_zone', read: 'names[0]' }],
  }),
  defineType({
    type: 'aws_caller_identity',
    provider: 'aws',
    displayName: 'Caller Identity',
    shortName: 'Account',
    description: 'The account ID and ARN of the credentials in use',
    attributes: ['account_id', 'arn', 'user_id'],
  }),
  defineType({
    type: 'aws_region',
    provider: 'aws',
    displayName: 'Current Region',
    shortName: 'Region',
    description: 'The region the provider is configured with',
    attributes: ['region', 'description', 'endpoint'],
  }),
  defineType({
    type: 'aws_partition',
    provider: 'aws',
    displayName: 'Partition',
    shortName: 'Partition',
    description: 'The AWS partition (aws, aws-cn, aws-us-gov), to build ARNs',
    attributes: ['partition', 'dns_suffix'],
  }),
  defineType({
    type: 'aws_iam_policy_document',
    provider: 'aws',
    displayName: 'IAM Policy Document',
    shortName: 'Policy document',
    description: 'An IAM policy written in HCL and read as JSON',
    attributes: ['json', 'minified_json'],
    feeds: [
      { resourceTypes: ['aws_iam_role'], arg: 'assume_role_policy', read: 'json' },
      { resourceTypes: ['aws_iam_policy', 'aws_iam_role_policy', 'aws_s3_bucket_policy', 'aws_sqs_queue_policy', 'aws_sns_topic_policy'], arg: 'policy', read: 'json' },
    ],
  }),
  defineType({
    type: 'aws_vpc',
    provider: 'aws',
    displayName: 'Existing VPC',
    shortName: 'Existing VPC',
    description: 'A VPC that already exists (the default one, or found by its tags)',
    attributes: ['id', 'cidr_block', 'arn'],
    feeds: [{ resourceTypes: ['aws_subnet', 'aws_security_group', 'aws_lb_target_group', 'aws_internet_gateway', 'aws_route_table'], arg: 'vpc_id', read: 'id' }],
  }),
  defineType({
    type: 'aws_subnets',
    provider: 'aws',
    displayName: 'Existing Subnets',
    shortName: 'Existing subnets',
    description: 'The IDs of the subnets that match a filter',
    attributes: ['ids'],
    feeds: [
      { resourceTypes: ['aws_instance'], arg: 'subnet_id', read: 'ids[0]' },
      { resourceTypes: ['aws_lb'], arg: 'subnets', read: 'ids' },
      { resourceTypes: ['aws_db_subnet_group', 'aws_elasticache_subnet_group'], arg: 'subnet_ids', read: 'ids' },
    ],
  }),
  defineType({
    type: 'aws_route53_zone',
    provider: 'aws',
    displayName: 'Route 53 Zone',
    shortName: 'Route 53 zone',
    description: 'A hosted zone that already exists, found by its domain',
    attributes: ['zone_id', 'name', 'name_servers'],
    feeds: [{ resourceTypes: ['aws_route53_record'], arg: 'zone_id', read: 'zone_id' }],
  }),
  defineType({
    type: 'aws_acm_certificate',
    provider: 'aws',
    displayName: 'ACM Certificate',
    shortName: 'Certificate',
    description: 'An issued certificate, found by its domain',
    attributes: ['arn', 'domain', 'status'],
    feeds: [{ resourceTypes: ['aws_lb_listener'], arg: 'certificate_arn', read: 'arn' }],
  }),
  defineType({
    type: 'aws_ssm_parameter',
    provider: 'aws',
    displayName: 'SSM Parameter',
    shortName: 'Parameter',
    description: 'A value kept in Parameter Store',
    attributes: ['value', 'arn', 'version'],
  }),
  defineType({
    type: 'aws_ecs_cluster',
    provider: 'aws',
    displayName: 'Existing ECS Cluster',
    shortName: 'Existing ECS cluster',
    description: 'An ECS cluster that already exists, found by its name',
    attributes: ['arn', 'id', 'status'],
    feeds: [{ resourceTypes: ['aws_ecs_service'], arg: 'cluster', read: 'arn' }],
  }),
  /* Azure */
  defineType({
    type: 'azurerm_client_config',
    provider: 'azure',
    displayName: 'Client Config',
    shortName: 'Client config',
    description: 'The tenant, subscription and object IDs of the credentials in use',
    attributes: ['tenant_id', 'subscription_id', 'object_id', 'client_id'],
    feeds: [{ resourceTypes: ['azurerm_key_vault'], arg: 'tenant_id', read: 'tenant_id' }],
  }),
  defineType({
    type: 'azurerm_subscription',
    provider: 'azure',
    displayName: 'Current Subscription',
    shortName: 'Subscription',
    description: 'The subscription the provider works in',
    attributes: ['subscription_id', 'display_name', 'tenant_id'],
  }),
  defineType({
    type: 'azurerm_resource_group',
    provider: 'azure',
    displayName: 'Existing Resource Group',
    shortName: 'Existing resource group',
    description: 'A resource group that already exists, found by its name',
    attributes: ['name', 'location', 'id'],
    feeds: [
      {
        resourceTypes: ['azurerm_virtual_network', 'azurerm_storage_account', 'azurerm_key_vault', 'azurerm_network_security_group', 'azurerm_service_plan', 'azurerm_public_ip'],
        arg: 'resource_group_name',
        read: 'name',
      },
      {
        resourceTypes: ['azurerm_virtual_network', 'azurerm_storage_account', 'azurerm_key_vault', 'azurerm_network_security_group', 'azurerm_service_plan', 'azurerm_public_ip'],
        arg: 'location',
        read: 'location',
      },
    ],
  }),
  defineType({
    type: 'azurerm_virtual_network',
    provider: 'azure',
    displayName: 'Existing Virtual Network',
    shortName: 'Existing virtual network',
    description: 'A virtual network that already exists, found by its name',
    attributes: ['id', 'name', 'address_space'],
    feeds: [{ resourceTypes: ['azurerm_subnet'], arg: 'virtual_network_name', read: 'name' }],
  }),
  defineType({
    type: 'azurerm_subnet',
    provider: 'azure',
    displayName: 'Existing Subnet',
    shortName: 'Existing subnet',
    description: 'A subnet that already exists in a virtual network',
    attributes: ['id', 'address_prefixes'],
  }),
  defineType({
    type: 'azurerm_key_vault',
    provider: 'azure',
    displayName: 'Existing Key Vault',
    shortName: 'Existing key vault',
    description: 'A key vault that already exists, found by its name',
    attributes: ['id', 'vault_uri', 'tenant_id'],
  }),
  /* Google Cloud */
  defineType({
    type: 'google_client_config',
    provider: 'gcp',
    displayName: 'Client Config',
    shortName: 'Client config',
    description: 'The project, region and access token the provider uses',
    attributes: ['project', 'region', 'zone', 'access_token'],
  }),
  defineType({
    type: 'google_project',
    provider: 'gcp',
    displayName: 'Current Project',
    shortName: 'Project',
    description: 'The project the provider works in: its ID and number',
    attributes: ['project_id', 'number', 'name'],
  }),
  defineType({
    type: 'google_compute_zones',
    provider: 'gcp',
    displayName: 'Compute Zones',
    shortName: 'Zones',
    description: 'The zones available in a region',
    attributes: ['names'],
    feeds: [{ resourceTypes: ['google_compute_instance'], arg: 'zone', read: 'names[0]' }],
  }),
  defineType({
    type: 'google_compute_network',
    provider: 'gcp',
    displayName: 'Existing VPC Network',
    shortName: 'Existing VPC network',
    description: 'A VPC network that already exists, found by its name',
    attributes: ['id', 'self_link', 'name'],
    feeds: [{ resourceTypes: ['google_compute_subnetwork', 'google_compute_firewall'], arg: 'network', read: 'id' }],
  }),
  defineType({
    type: 'google_compute_subnetwork',
    provider: 'gcp',
    displayName: 'Existing Subnetwork',
    shortName: 'Existing subnetwork',
    description: 'A subnetwork that already exists in a region',
    attributes: ['id', 'self_link', 'ip_cidr_range'],
  }),
  defineType({
    type: 'google_compute_image',
    provider: 'gcp',
    displayName: 'Compute Image',
    shortName: 'Image',
    description: 'The latest image of a family',
    attributes: ['self_link', 'id', 'name'],
  }),
  /* any provider */
  defineType({
    type: 'terraform_remote_state',
    provider: 'other',
    displayName: 'Remote State',
    shortName: 'Remote state',
    description: "The outputs of another Terraform configuration's state",
    attributes: ['outputs'],
  }),
] as const;

export type DataSourceType = (typeof DATA_SOURCE_TYPES)[number]['type'];

/* -------------------------------------------------------------- presets */

const remoteState = (key: string, backend: string, config: Record<string, Expression>) =>
  definePreset({
    key,
    type: 'terraform_remote_state',
    name: 'network',
    args: () => ({ backend: lit(backend), config: obj(config) }),
  });

export const DATA_SOURCE_PRESETS = [
  /* AWS */
  definePreset({
    key: 'aws_ami.ubuntu',
    type: 'aws_ami',
    name: 'ubuntu',
    displayName: 'Ubuntu AMI',
    description: 'The latest Ubuntu 24.04 LTS image, published by Canonical',
    args: () => ({
      most_recent: lit(true),
      // Canonical's account
      owners: list([lit('099720109477')]),
      filter: blocks([
        filter('name', [lit('ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*')]),
        filter('virtualization-type', [lit('hvm')]),
      ]),
    }),
  }),
  definePreset({
    key: 'aws_ami.al2023',
    type: 'aws_ami',
    name: 'al2023',
    displayName: 'Amazon Linux AMI',
    description: 'The latest Amazon Linux 2023 image, published by AWS',
    args: () => ({
      most_recent: lit(true),
      owners: list([lit('amazon')]),
      filter: blocks([filter('name', [lit('al2023-ami-2023.*-x86_64')]), filter('architecture', [lit('x86_64')])]),
    }),
  }),
  definePreset({
    key: 'aws_availability_zones',
    type: 'aws_availability_zones',
    name: 'available',
    args: () => ({ state: lit('available') }),
  }),
  definePreset({ key: 'aws_caller_identity', type: 'aws_caller_identity', name: 'current', args: () => ({}) }),
  definePreset({ key: 'aws_region', type: 'aws_region', name: 'current', args: () => ({}) }),
  definePreset({ key: 'aws_partition', type: 'aws_partition', name: 'current', args: () => ({}) }),
  definePreset({
    key: 'aws_iam_policy_document',
    type: 'aws_iam_policy_document',
    name: 'assume_role',
    description: 'A trust policy that lets EC2 assume a role, read as JSON',
    args: () => ({
      statement: block({
        effect: lit('Allow'),
        actions: list([lit('sts:AssumeRole')]),
        principals: block({ type: lit('Service'), identifiers: list([lit('ec2.amazonaws.com')]) }),
      }),
    }),
  }),
  definePreset({ key: 'aws_vpc', type: 'aws_vpc', name: 'default', args: () => ({ default: lit(true) }) }),
  definePreset({
    key: 'aws_subnets',
    type: 'aws_subnets',
    name: 'selected',
    // the subnets of a VPC the project has; without one, the default subnets
    args: (ir) => {
      const vpc = vpcRef(ir);
      return { filter: block(vpc ? filter('vpc-id', [vpc]) : filter('default-for-az', [lit('true')])) };
    },
  }),
  definePreset({
    key: 'aws_route53_zone',
    type: 'aws_route53_zone',
    name: 'main',
    args: () => ({ name: lit('example.com'), private_zone: lit(false) }),
  }),
  definePreset({
    key: 'aws_acm_certificate',
    type: 'aws_acm_certificate',
    name: 'main',
    args: () => ({ domain: lit('example.com'), statuses: list([lit('ISSUED')]), most_recent: lit(true) }),
  }),
  definePreset({ key: 'aws_ssm_parameter', type: 'aws_ssm_parameter', name: 'config', args: () => ({ name: lit('/app/config') }) }),
  definePreset({ key: 'aws_ecs_cluster', type: 'aws_ecs_cluster', name: 'main', args: () => ({ cluster_name: lit('main') }) }),
  remoteState('terraform_remote_state.s3', 's3', {
    bucket: lit('my-terraform-state'),
    key: lit('network/terraform.tfstate'),
    region: lit('us-east-1'),
  }),
  /* Azure */
  definePreset({ key: 'azurerm_client_config', type: 'azurerm_client_config', name: 'current', args: () => ({}) }),
  definePreset({ key: 'azurerm_subscription', type: 'azurerm_subscription', name: 'current', args: () => ({}) }),
  definePreset({ key: 'azurerm_resource_group', type: 'azurerm_resource_group', name: 'main', args: () => ({ name: lit('rg-main') }) }),
  definePreset({
    key: 'azurerm_virtual_network',
    type: 'azurerm_virtual_network',
    name: 'main',
    args: () => ({ name: lit('vnet-main'), resource_group_name: lit('rg-network') }),
  }),
  definePreset({
    key: 'azurerm_subnet',
    type: 'azurerm_subnet',
    name: 'main',
    args: () => ({ name: lit('snet-app'), virtual_network_name: lit('vnet-main'), resource_group_name: lit('rg-network') }),
  }),
  definePreset({
    key: 'azurerm_key_vault',
    type: 'azurerm_key_vault',
    name: 'main',
    args: () => ({ name: lit('kv-main'), resource_group_name: lit('rg-security') }),
  }),
  remoteState('terraform_remote_state.azurerm', 'azurerm', {
    resource_group_name: lit('rg-terraform'),
    storage_account_name: lit('tfstate'),
    container_name: lit('tfstate'),
    key: lit('network.terraform.tfstate'),
  }),
  /* Google Cloud */
  definePreset({ key: 'google_client_config', type: 'google_client_config', name: 'current', args: () => ({}) }),
  definePreset({ key: 'google_project', type: 'google_project', name: 'current', args: () => ({}) }),
  definePreset({ key: 'google_compute_zones', type: 'google_compute_zones', name: 'available', args: () => ({ status: lit('UP') }) }),
  definePreset({ key: 'google_compute_network', type: 'google_compute_network', name: 'main', args: () => ({ name: lit('default') }) }),
  definePreset({
    key: 'google_compute_subnetwork',
    type: 'google_compute_subnetwork',
    name: 'main',
    args: () => ({ name: lit('default'), region: lit('us-central1') }),
  }),
  definePreset({
    key: 'google_compute_image',
    type: 'google_compute_image',
    name: 'debian',
    displayName: 'Debian Image',
    description: 'The latest Debian 12 image, published by Google',
    args: () => ({ family: lit('debian-12'), project: lit('debian-cloud') }),
  }),
  remoteState('terraform_remote_state.gcs', 'gcs', { bucket: lit('my-terraform-state'), prefix: lit('network') }),
] as const;

export type DataSourcePresetKey = (typeof DATA_SOURCE_PRESETS)[number]['key'];

/** which provider's palette a preset shows in (remote state: the one of its backend) */
export function presetProvider(p: DataSourcePreset): Exclude<Provider, 'other'> {
  if (p.key.endsWith('.azurerm')) return 'azure';
  if (p.key.endsWith('.gcs')) return 'gcp';
  const t = typeDef(p.type);
  return t && t.provider !== 'other' ? t.provider : 'aws';
}

const TYPES = new Map<string, DataSourceTypeDef>(DATA_SOURCE_TYPES.map((t) => [t.type, t]));
const PRESETS = new Map<string, DataSourcePreset>(DATA_SOURCE_PRESETS.map((p) => [p.key, p]));

/** the catalog's description of a data source type, when it has one */
export function typeDef(type: string): DataSourceTypeDef | undefined {
  return TYPES.get(type);
}

export function presetByKey(key: string): DataSourcePreset | undefined {
  return PRESETS.get(key);
}

/** the presets a provider's palette lists, in catalog order */
export function presetsFor(provider: Provider): DataSourcePreset[] {
  return DATA_SOURCE_PRESETS.filter((p) => presetProvider(p) === provider);
}

/* ---------------------------------------------------------------- links */

/** hashicorp providers whose data sources have Registry pages under their own name */
const HASHICORP = new Set(['aws', 'azurerm', 'azuread', 'google', 'archive', 'tls', 'http', 'external', 'local', 'cloudinit', 'dns', 'kubernetes', 'helm', 'time', 'null']);

/**
 * The Terraform docs page of a data source type: the Registry's
 * `…/docs/data-sources/<name>` page (`aws_ami` → hashicorp/aws …/ami),
 * Terraform's own page for `terraform_remote_state`.
 */
export function dataDocsUrl(type: string): string | undefined {
  if (type === 'terraform_remote_state') return 'https://developer.hashicorp.com/terraform/language/state/remote-state-data';
  if (type === 'http' || type === 'external') {
    return `https://registry.terraform.io/providers/hashicorp/${type}/latest/docs/data-sources/${type}`;
  }
  const m = /^([a-z0-9]+)_(.+)$/.exec(type);
  if (!m || !HASHICORP.has(m[1])) return undefined;
  return `https://registry.terraform.io/providers/hashicorp/${m[1]}/latest/docs/data-sources/${m[2]}`;
}
