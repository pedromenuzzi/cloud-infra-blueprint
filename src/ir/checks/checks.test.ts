import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { validateProject } from '@/ir/validate';
import { buildCatalogIR, CATALOG_PROVIDERS } from '@/resources/catalogProject';
import { getDef } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import { TUTORIALS } from '@/tutorials';
import { runChecks } from './index';

const AWS = 'provider "aws" {\n  region = "us-east-1"\n}\n';
const GCP = 'provider "google" {\n  region = "us-central1"\n}\n';

/** messages of the checks for a project (one main.tf, plus providers) */
function messages(main: string, providers = AWS): string[] {
  const { ir, diagnostics } = parseProject({ 'main.tf': main, 'providers.tf': providers });
  expect(diagnostics.filter((d) => d.severity === 'error'), 'the test HCL parses').toEqual([]);
  return runChecks(ir, getDef, () => ({})).map((d) => d.message);
}

const vpc = (name: string, cidr: string, extra = '') => `resource "aws_vpc" "${name}" {\n  cidr_block = "${cidr}"\n${extra}}\n`;
/** `cidr` is quoted when it looks like an address range, else written as an expression */
const subnet = (name: string, cidr: string, extra = '', parent = 'main') =>
  `resource "aws_subnet" "${name}" {\n  vpc_id     = aws_vpc.${parent}.id\n  cidr_block = ${/^[\d./]+$|:/.test(cidr) ? `"${cidr}"` : cidr}\n${extra}}\n`;

describe('CIDR checks', () => {
  it('flags ranges that are not valid CIDRs, and nothing that depends on them', () => {
    const out = messages(vpc('main', '10.0.0/16') + subnet('a', '10.1.0.0/24'));
    expect(out).toEqual([
      'aws_vpc.main: cidr_block "10.0.0/16" isn\'t a valid CIDR range (expected something like 10.0.0.0/16)',
    ]);
  });

  it('flags host bits and the wrong address family', () => {
    expect(messages(vpc('main', '10.0.0.0/16') + subnet('a', '10.0.1.5/24'))).toEqual([
      'aws_subnet.a: cidr_block "10.0.1.5/24" has host bits set — the range it describes is 10.0.1.0/24, write that instead',
    ]);
    expect(messages(vpc('main', '10.0.0.0/16') + subnet('a', '2600:1f18::/64'))).toEqual([
      'aws_subnet.a: cidr_block "2600:1f18::/64" is an IPv6 range — put it in ipv6_cidr_block',
    ]);
    const gcp = messages(
      'resource "google_compute_network" "n" {\n  name = "n"\n}\nresource "google_compute_subnetwork" "s" {\n  name          = "s"\n  network       = google_compute_network.n.id\n  ip_cidr_range = "2600:1f18::/64"\n}\n',
      GCP,
    );
    expect(gcp).toEqual(['google_compute_subnetwork.s: ip_cidr_range "2600:1f18::/64" is an IPv6 range — ip_cidr_range takes IPv4 ranges']);
  });

  it('flags a subnet outside its VPC, counting secondary ranges', () => {
    expect(messages(vpc('main', '10.0.0.0/16') + subnet('a', '10.1.0.0/24'))).toEqual([
      "aws_subnet.a: cidr_block 10.1.0.0/24 is outside aws_vpc.main's range (10.0.0.0/16)",
    ]);
    const secondary = 'resource "aws_vpc_ipv4_cidr_block_association" "extra" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.1.0.0/16"\n}\n';
    expect(messages(vpc('main', '10.0.0.0/16') + secondary + subnet('a', '10.1.0.0/24'))).toEqual([]);
    expect(messages(vpc('main', '10.0.0.0/16') + secondary + subnet('a', '10.2.0.0/24'))).toEqual([
      "aws_subnet.a: cidr_block 10.2.0.0/24 is outside aws_vpc.main's ranges (10.0.0.0/16, 10.1.0.0/16)",
    ]);
  });

  it('resolves variable defaults and skips what it cannot resolve', () => {
    const variable = 'variable "vpc_cidr" {\n  default = "10.0.0.0/16"\n}\n';
    const viaVar = 'resource "aws_vpc" "main" {\n  cidr_block = var.vpc_cidr\n}\n';
    expect(messages(variable + viaVar + subnet('a', '10.9.0.0/24'))).toEqual([
      "aws_subnet.a: cidr_block 10.9.0.0/24 is outside aws_vpc.main's range (10.0.0.0/16)",
    ]);
    expect(messages(variable + viaVar + subnet('a', 'var.vpc_cidr'))).toEqual([]);
    const unknown = 'variable "vpc_cidr" {}\nresource "aws_vpc" "main" {\n  cidr_block = var.vpc_cidr\n}\n';
    expect(messages(unknown + subnet('a', '10.9.0.0/24') + subnet('b', 'cidrsubnet(aws_vpc.main.cidr_block, 8, 1)'))).toEqual([]);
    const ipam = 'resource "aws_vpc" "main" {\n  ipv4_ipam_pool_id = "ipam-pool-1"\n}\n';
    expect(messages(ipam + subnet('a', '10.9.0.0/24'))).toEqual([]);
    const badVar = 'variable "subnet_cidr" {\n  default = "10.0.1/24"\n}\n';
    expect(messages(badVar + vpc('main', '10.0.0.0/16') + subnet('a', 'var.subnet_cidr'))).toEqual([
      'aws_subnet.a: cidr_block "10.0.1/24" (from var.subnet_cidr) isn\'t a valid CIDR range (expected something like 10.0.0.0/16)',
    ]);
  });

  it('flags overlapping subnets in one VPC, but not repeated or separate ones', () => {
    expect(messages(vpc('main', '10.0.0.0/16') + subnet('a', '10.0.1.0/24') + subnet('b', '10.0.1.128/25'))).toEqual([
      'aws_subnet.b: cidr_block 10.0.1.128/25 overlaps aws_subnet.a (10.0.1.0/24) — subnets in one VPC need ranges of their own',
    ]);
    expect(messages(vpc('main', '10.0.0.0/16') + subnet('a', '10.0.1.0/24') + subnet('b', '10.0.2.0/24'))).toEqual([]);
    const counted = subnet('b', '10.0.1.0/24', '  count      = var.enabled ? 1 : 0\n');
    expect(messages(vpc('main', '10.0.0.0/16') + subnet('a', '10.0.1.0/24') + counted)).toEqual([]);
    // the same range in two VPCs is fine
    expect(messages(vpc('main', '10.0.0.0/16') + vpc('other', '10.1.0.0/16') + subnet('a', '10.0.1.0/24') + subnet('b', '10.1.1.0/24', '', 'other'))).toEqual([]);
  });

  it('flags overlapping VPCs: firmly when peered, softly otherwise', () => {
    const peering = 'resource "aws_vpc_peering_connection" "p" {\n  vpc_id      = aws_vpc.a.id\n  peer_vpc_id = aws_vpc.b.id\n}\n';
    expect(messages(vpc('a', '10.0.0.0/16') + vpc('b', '10.0.0.0/16') + peering)).toEqual([
      "aws_vpc_peering_connection.p: aws_vpc.a (10.0.0.0/16) and aws_vpc.b (10.0.0.0/16) overlap — AWS can't peer VPCs whose ranges overlap",
    ]);
    expect(messages(vpc('a', '10.0.0.0/16') + vpc('b', '10.0.128.0/17'))).toEqual([
      'aws_vpc.b: 10.0.128.0/17 overlaps aws_vpc.a (10.0.0.0/16) — fine while the two VPCs stay apart, but they could never be peered',
    ]);
    expect(messages(vpc('a', '10.0.0.0/16') + vpc('b', '10.1.0.0/16') + peering)).toEqual([]);
  });

  it('knows the AWS size limits', () => {
    expect(messages(vpc('main', '10.0.0.0/8'))).toEqual([
      'aws_vpc.main: cidr_block 10.0.0.0/8 is too large for a VPC — AWS allows /16 to /28',
    ]);
    expect(messages(vpc('main', '10.0.0.0/16') + subnet('a', '10.0.0.0/29'))).toEqual([
      'aws_subnet.a: cidr_block 10.0.0.0/29 is too small for a subnet — AWS allows /16 to /28',
    ]);
  });

  it('handles IPv6 ranges: checked when written out, skipped when Amazon assigns them', () => {
    const dual = vpc('main', '10.0.0.0/16', '  assign_generated_ipv6_cidr_block = true\n');
    const v6 = '  ipv6_cidr_block = cidrsubnet(aws_vpc.main.ipv6_cidr_block, 8, 1)\n';
    expect(messages(dual + subnet('a', '10.0.1.0/24', v6))).toEqual([]);
    const literal = vpc('main', '10.0.0.0/16', '  ipv6_cidr_block = "2600:1f18:1000::/56"\n');
    expect(messages(literal + subnet('a', '10.0.1.0/24', '  ipv6_cidr_block = "2600:1f18:1000:1::/64"\n'))).toEqual([]);
    expect(messages(literal + subnet('a', '10.0.1.0/24', '  ipv6_cidr_block = "2600:1f18:2000:1::/64"\n'))).toEqual([
      "aws_subnet.a: ipv6_cidr_block 2600:1f18:2000:1::/64 is outside aws_vpc.main's range (2600:1f18:1000::/56)",
    ]);
    expect(messages(dual + subnet('a', '10.0.1.0/24', '  ipv6_cidr_block = "10.0.2.0/24"\n'))).toEqual([
      'aws_subnet.a: ipv6_cidr_block "10.0.2.0/24" is an IPv4 range — put it in cidr_block',
    ]);
  });

  describe('Azure', () => {
    const vnet = (space: string) =>
      `resource "azurerm_virtual_network" "main" {\n  name                = "vnet"\n  location            = "eastus"\n  resource_group_name = "rg"\n  address_space       = ${space}\n}\n`;
    const sub = (name: string, prefixes: string) =>
      `resource "azurerm_subnet" "${name}" {\n  name                 = "${name}"\n  resource_group_name  = "rg"\n  virtual_network_name = azurerm_virtual_network.main.name\n  address_prefixes     = ${prefixes}\n}\n`;

    it('checks address prefixes against the address space, dual-stack included', () => {
      expect(messages(vnet('["10.0.0.0/16", "fd00:db8::/48"]') + sub('a', '["10.0.1.0/24", "fd00:db8:0:1::/64"]'), '')).toEqual([]);
      expect(messages(vnet('["10.0.0.0/24"]') + sub('a', '["10.0.0.0/23"]'), '')).toEqual([
        "azurerm_subnet.a: address_prefixes 10.0.0.0/23 is not fully inside azurerm_virtual_network.main's range (10.0.0.0/24)",
      ]);
      expect(messages(vnet('["10.0.0.0/16"]') + sub('a', '["10.0.1.0/24", "fd00:db8:0:1::/64"]'), '')).toEqual([
        'azurerm_subnet.a: address_prefixes fd00:db8:0:1::/64 is IPv6, but azurerm_virtual_network.main has no IPv6 range',
      ]);
    });

    it('knows the Azure subnet sizes and flags overlaps', () => {
      expect(messages(vnet('["10.0.0.0/16"]') + sub('a', '["10.0.1.0/30"]'), '')).toEqual([
        'azurerm_subnet.a: address_prefixes 10.0.1.0/30 is too small — Azure subnets must be /29 or larger',
      ]);
      expect(messages(vnet('["10.0.0.0/16", "fd00:db8::/48"]') + sub('a', '["fd00:db8:0:1::/80"]'), '')).toEqual([
        "azurerm_subnet.a: address_prefixes fd00:db8:0:1::/80 can't be used — Azure IPv6 subnets must be exactly /64",
      ]);
      expect(messages(vnet('["10.0.0.0/16"]') + sub('a', '["10.0.1.0/24"]') + sub('b', '["10.0.1.0/24"]'), '')).toEqual([
        'azurerm_subnet.b: address_prefixes 10.0.1.0/24 overlaps azurerm_subnet.a (10.0.1.0/24) — subnets in one VNet need ranges of their own',
      ]);
    });

    it('reads a list variable and skips an address space it cannot read', () => {
      const spaces = 'variable "spaces" {\n  default = ["10.0.0.0/16"]\n}\n';
      expect(messages(spaces + vnet('var.spaces') + sub('a', '["10.1.0.0/24"]'), '')).toEqual([
        "azurerm_subnet.a: address_prefixes 10.1.0.0/24 is outside azurerm_virtual_network.main's range (10.0.0.0/16)",
      ]);
      expect(messages(vnet('[var.space]') + sub('a', '["10.1.0.0/24"]'), '')).toEqual([]);
    });

    it('flags peered VNets with overlapping address spaces', () => {
      const other = 'resource "azurerm_virtual_network" "other" {\n  name                = "other"\n  location            = "eastus"\n  resource_group_name = "rg"\n  address_space       = ["10.0.0.0/16"]\n}\n';
      const peering = 'resource "azurerm_virtual_network_peering" "p" {\n  name                      = "p"\n  resource_group_name       = "rg"\n  virtual_network_name      = azurerm_virtual_network.main.name\n  remote_virtual_network_id = azurerm_virtual_network.other.id\n}\n';
      expect(messages(vnet('["10.0.0.0/16"]') + other + peering, '')).toEqual([
        "azurerm_virtual_network_peering.p: azurerm_virtual_network.main (10.0.0.0/16) and azurerm_virtual_network.other (10.0.0.0/16) overlap — Azure can't peer virtual networks whose address spaces overlap",
      ]);
    });
  });

  describe('GCP', () => {
    const net = (name: string) => `resource "google_compute_network" "${name}" {\n  name = "${name}"\n}\n`;
    const sub = (name: string, cidr: string, network = 'main', extra = '') =>
      `resource "google_compute_subnetwork" "${name}" {\n  name          = "${name}"\n  network       = google_compute_network.${network}.id\n  ip_cidr_range = "${cidr}"\n${extra}}\n`;

    it('flags overlaps between subnetworks of one network only', () => {
      expect(messages(net('main') + sub('a', '10.0.0.0/16') + sub('b', '10.0.1.0/24'), GCP)).toEqual([
        'google_compute_subnetwork.b: ip_cidr_range 10.0.1.0/24 overlaps google_compute_subnetwork.a (10.0.0.0/16) — subnetworks of one network need ranges of their own',
      ]);
      expect(messages(net('main') + net('other') + sub('a', '10.0.0.0/16') + sub('b', '10.0.1.0/24', 'other'), GCP)).toEqual([]);
    });

    it('counts secondary ranges and knows the smallest size', () => {
      const pods = '  secondary_ip_range {\n    range_name    = "pods"\n    ip_cidr_range = "10.1.0.0/16"\n  }\n';
      expect(messages(net('main') + sub('a', '10.0.0.0/20', 'main', pods) + sub('b', '10.1.4.0/24'), GCP)).toEqual([
        'google_compute_subnetwork.b: ip_cidr_range 10.1.4.0/24 overlaps google_compute_subnetwork.a (10.1.0.0/16) — subnetworks of one network need ranges of their own',
      ]);
      expect(messages(net('main') + sub('a', '10.0.0.0/30'), GCP)).toEqual([
        'google_compute_subnetwork.a: ip_cidr_range 10.0.0.0/30 is too small — GCP subnet ranges must be /29 or larger',
      ]);
    });
  });
});

describe('name checks', () => {
  const bucket = (name: string) => `resource "aws_s3_bucket" "b" {\n  bucket = "${name}"\n}\n`;

  it('knows the S3 bucket rules', () => {
    const problems = ['My-Bucket', 'my_bucket', 'ab', '192.168.1.1', '-bucket', 'bucket.', 'my..bucket', 'xn--bucket', 'data-s3alias'].map(
      (name) => messages(bucket(name))[0],
    );
    expect(problems).toEqual([
      'aws_s3_bucket.b: bucket "My-Bucket" has uppercase letters — S3 bucket names must be lowercase',
      'aws_s3_bucket.b: bucket "my_bucket" has an underscore — S3 bucket names can\'t contain underscores (use hyphens)',
      'aws_s3_bucket.b: bucket "ab" is 2 characters — S3 bucket names must be 3 to 63',
      "aws_s3_bucket.b: bucket \"192.168.1.1\" looks like an IP address, which S3 doesn't allow",
      'aws_s3_bucket.b: bucket "-bucket" must start and end with a letter or digit',
      'aws_s3_bucket.b: bucket "bucket." must start and end with a letter or digit',
      'aws_s3_bucket.b: bucket "my..bucket" can\'t contain two dots in a row',
      'aws_s3_bucket.b: bucket "xn--bucket" starts with a prefix S3 reserves (xn--, sthree-)',
      'aws_s3_bucket.b: bucket "data-s3alias" ends with a suffix S3 reserves (-s3alias, --ol-s3)',
    ]);
    expect(messages(bucket('logs.example-2026'))).toEqual([]);
  });

  it('applies each type’s characters and lengths', () => {
    const lb = (name: string) => `resource "aws_lb" "web" {\n  name = "${name}"\n}\n`;
    expect(messages(lb('web_lb'))).toEqual([
      'aws_lb.web: name "web_lb" isn\'t a valid Application Load Balancer name — use letters, digits and hyphens, starting and ending with a letter or digit',
    ]);
    expect(messages(lb('internal-web'))).toEqual(['aws_lb.web: name "internal-web" can\'t start with "internal-" — AWS reserves it']);
    expect(messages(lb('a'.repeat(33)))).toEqual([
      `aws_lb.web: name "${'a'.repeat(33)}" is 33 characters — Application Load Balancer names can be at most 32`,
    ]);
    expect(messages(lb('Web-LB-1'))).toEqual([]);
    expect(messages('resource "google_compute_network" "n" {\n  name = "Main_Net"\n}\n', GCP)).toEqual([
      'google_compute_network.n: name "Main_Net" isn\'t a valid VPC Network name — use lowercase letters, digits and hyphens, starting with a letter and not ending with a hyphen',
    ]);
    const storage = (name: string) => `resource "azurerm_storage_account" "s" {\n  name = "${name}"\n}\n`;
    expect(messages(storage('Web-Data'), '')).toEqual([
      'azurerm_storage_account.s: name "Web-Data" isn\'t a valid Storage Account name — use lowercase letters and digits only',
    ]);
    expect(messages(storage('a'.repeat(25)), '')[0]).toMatch(/is 25 characters — Storage Account names can be at most 24$/);
    expect(messages('resource "azurerm_key_vault" "k" {\n  name = "kv--main"\n}\n', '')).toEqual([
      'azurerm_key_vault.k: name "kv--main" can\'t contain two hyphens in a row',
    ]);
    expect(messages('resource "aws_security_group" "s" {\n  name = "sg-web"\n}\n')).toEqual([
      'aws_security_group.s: name "sg-web" can\'t start with "sg-" — AWS reserves it for group IDs',
    ]);
  });

  it('leaves names it cannot read alone, and allows what the clouds allow', () => {
    expect(messages('resource "aws_lb" "web" {\n  name = "${var.app}_lb"\n}\n')).toEqual([]);
    expect(messages('resource "aws_iam_role" "r" {\n  name               = "App.Role+CI@team"\n  assume_role_policy = "{}"\n}\n')).toEqual([]);
    expect(messages('resource "aws_sqs_queue" "q" {\n  name = "Jobs_Queue.fifo"\n}\n')).toEqual([]);
    expect(messages('resource "azurerm_resource_group" "rg" {\n  name     = "Rg_Prod(Main)"\n  location = "eastus"\n}\n', '')).toEqual([]);
    expect(messages(`resource "google_storage_bucket" "b" {\n  name     = "assets.${'a'.repeat(60)}.example.com"\n  location = "US"\n}\n`, GCP)).toEqual([]);
    expect(messages('resource "google_storage_bucket" "b" {\n  name     = "goog-assets"\n  location = "US"\n}\n', GCP)).toEqual([
      'google_storage_bucket.b: name "goog-assets" can\'t start with "goog" or contain "google"',
    ]);
  });
});

describe('region checks', () => {
  it('flags an AZ outside the provider region, resolving variables and aliases', () => {
    const a = subnet('a', '10.0.1.0/24', '  availability_zone = "eu-west-1a"\n');
    expect(messages(vpc('main', '10.0.0.0/16') + a)).toEqual([
      'aws_subnet.a: availability_zone "eu-west-1a" is in eu-west-1, but the AWS provider deploys to us-east-1',
    ]);
    const viaVar = 'variable "region" {\n  default = "us-east-2"\n}\nprovider "aws" {\n  region = var.region\n}\n';
    const b = subnet('b', '10.0.2.0/24', '  availability_zone = "${var.region}a"\n');
    expect(messages(vpc('main', '10.0.0.0/16') + a + b, viaVar)).toEqual([
      'aws_subnet.a: availability_zone "eu-west-1a" is in eu-west-1, but the AWS provider deploys to us-east-2 (from var.region)',
    ]);
    const west = `${AWS}provider "aws" {\n  alias  = "west"\n  region = "us-west-2"\n}\n`;
    const aliased = (az: string) => subnet('w', '10.0.3.0/24', `  provider          = aws.west\n  availability_zone = "${az}"\n`);
    expect(messages(vpc('main', '10.0.0.0/16') + aliased('us-west-2b'), west)).toEqual([]);
    expect(messages(vpc('main', '10.0.0.0/16') + aliased('us-east-1b'), west)).toEqual([
      'aws_subnet.w: availability_zone "us-east-1b" is in us-east-1, but the aws.west provider deploys to us-west-2',
    ]);
  });

  it('skips zone IDs, Local Zones and regions it cannot read', () => {
    const az = (value: string) => subnet('a', '10.0.1.0/24', `  availability_zone = "${value}"\n`);
    expect(messages(vpc('main', '10.0.0.0/16') + az('use1-az1'))).toEqual([]);
    expect(messages(vpc('main', '10.0.0.0/16') + az('us-east-1-bos-1a'))).toEqual([]);
    expect(messages(vpc('main', '10.0.0.0/16') + az('eu-west-1a'), 'variable "region" {}\nprovider "aws" {\n  region = var.region\n}\n')).toEqual([]);
  });

  it('keeps GCP instances and clusters in their subnetwork’s region', () => {
    const base =
      'variable "region" {\n  default = "us-central1"\n}\nresource "google_compute_network" "n" {\n  name = "n"\n}\nresource "google_compute_subnetwork" "s" {\n  name          = "s"\n  network       = google_compute_network.n.id\n  ip_cidr_range = "10.0.1.0/24"\n  region        = var.region\n}\n';
    const vm = (zone: string) =>
      `resource "google_compute_instance" "vm" {\n  name         = "vm"\n  machine_type = "e2-micro"\n  zone         = ${zone}\n  network_interface {\n    subnetwork = google_compute_subnetwork.s.id\n  }\n}\n`;
    expect(messages(base + vm('"${var.region}-a"'), GCP)).toEqual([]);
    expect(messages(base + vm('"europe-west1-b"'), GCP)).toEqual([
      'google_compute_instance.vm: zone "europe-west1-b" is in europe-west1, but google_compute_subnetwork.s is in us-central1 (from var.region) — an instance must be in its subnetwork\'s region',
    ]);
    expect(messages(base + vm('"us-central1"'), GCP)).toEqual([
      'google_compute_instance.vm: zone "us-central1" is a region — instances need a zone such as us-central1-a',
    ]);
    const gke = 'resource "google_container_cluster" "k" {\n  name       = "k"\n  location   = "europe-west1"\n  subnetwork = google_compute_subnetwork.s.id\n}\n';
    expect(messages(base + gke, GCP)).toEqual([
      "google_container_cluster.k: location \"europe-west1\" is in europe-west1, but google_compute_subnetwork.s is in us-central1 (from var.region) — a cluster must be in its subnetwork's region",
    ]);
  });
});

describe('wiring checks', () => {
  const sg = (name: string, sgName: string, vpcName = 'main') =>
    `resource "aws_security_group" "${name}" {\n  name   = "${sgName}"\n  vpc_id = aws_vpc.${vpcName}.id\n}\n`;

  it('flags names that must be unique in their scope', () => {
    expect(messages(vpc('main', '10.0.0.0/16') + sg('a', 'web') + sg('b', 'web'))).toEqual([
      'aws_security_group.b: name "web" is already used by aws_security_group.a in the same VPC — AWS needs security group names to be unique per VPC',
    ]);
    expect(messages(vpc('main', '10.0.0.0/16') + vpc('other', '10.1.0.0/16') + sg('a', 'web') + sg('b', 'web', 'other'))).toEqual([]);
    const buckets = 'resource "aws_s3_bucket" "a" {\n  bucket = "shared-assets"\n}\nresource "aws_s3_bucket" "b" {\n  bucket = "shared-assets"\n}\n';
    expect(messages(buckets)).toEqual([
      'aws_s3_bucket.b: bucket "shared-assets" is already used by aws_s3_bucket.a — S3 bucket names are global across all AWS accounts',
    ]);
  });

  it('flags security groups and route tables of another VPC', () => {
    const net = vpc('main', '10.0.0.0/16') + vpc('other', '10.1.0.0/16') + subnet('a', '10.0.1.0/24') + sg('far', 'far', 'other');
    const instance = 'resource "aws_instance" "web" {\n  ami                    = "ami-1"\n  instance_type          = "t3.micro"\n  subnet_id              = aws_subnet.a.id\n  vpc_security_group_ids = [aws_security_group.far.id]\n}\n';
    expect(messages(net + instance)).toEqual([
      'aws_instance.web: aws_security_group.far belongs to aws_vpc.other, but aws_subnet.a is in aws_vpc.main — an instance can only use security groups of its own VPC',
    ]);
    const table = 'resource "aws_route_table" "rt" {\n  vpc_id = aws_vpc.other.id\n}\nresource "aws_route_table_association" "a" {\n  subnet_id      = aws_subnet.a.id\n  route_table_id = aws_route_table.rt.id\n}\n';
    expect(messages(net + table)).toEqual([
      'aws_route_table_association.a: aws_route_table.rt belongs to aws_vpc.other, but aws_subnet.a is in aws_vpc.main — a subnet can only use a route table of its own VPC',
    ]);
  });
});

describe('no false positives', () => {
  for (const t of TEMPLATES) {
    it(`template ${t.slug}`, () => {
      for (const app of ['production-web', 'My Demo App', 'a really long application name for a template']) {
        const { ir } = parseProject(t.build(app));
        expect(runChecks(ir, getDef, () => ({}))).toEqual([]);
      }
    });
  }

  for (const provider of CATALOG_PROVIDERS) {
    it(`catalog project for ${provider}`, () => {
      expect(runChecks(buildCatalogIR(provider), getDef, () => ({}))).toEqual([]);
    });
  }

  it('every tutorial step', () => {
    for (const tutorial of TUTORIALS) {
      for (const step of tutorial.steps) {
        expect(runChecks(parseProject(step.files).ir, getDef, () => ({})), `${tutorial.slug}: ${step.title}`).toEqual([]);
      }
    }
  });

  it('a module-style network written with expressions and loops', () => {
    const hcl = `
variable "cidr" {
  type = string
}
variable "azs" {
  default = ["us-east-1a", "us-east-1b"]
}
resource "aws_vpc" "main" {
  cidr_block                       = var.cidr
  assign_generated_ipv6_cidr_block = true
}
resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.cidr, 8, count.index)
  ipv6_cidr_block   = cidrsubnet(aws_vpc.main.ipv6_cidr_block, 8, count.index)
  availability_zone = var.azs[count.index]
}
resource "aws_subnet" "public" {
  for_each          = { a = "10.0.100.0/24", b = "10.0.101.0/24" }
  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value
  availability_zone = "us-east-1\${each.key}"
}
resource "aws_security_group" "web" {
  name_prefix = "web-"
  vpc_id      = aws_vpc.main.id
}
resource "aws_s3_bucket" "logs" {
  bucket_prefix = "logs-"
}
`;
    expect(messages(hcl)).toEqual([]);
  });
});

describe('markers', () => {
  it('point at the offending argument', () => {
    const text = `${vpc('main', '10.0.0.0/16')}${subnet('a', '10.1.0.0/24')}`;
    const { ir } = parseProject({ 'main.tf': text });
    const warning = validateProject(ir, getDef).find((w) => w.message.includes('outside'))!;
    expect(warning.nodeId).toBe('aws_subnet.a');
    const line = text.split('\n').findIndex((l) => l.includes('"10.1.0.0/24"')) + 1;
    expect(warning.start).toEqual({ line, col: 3 });
    expect(warning.end).toEqual({ line, col: 3 + 'cidr_block'.length });
  });
});
