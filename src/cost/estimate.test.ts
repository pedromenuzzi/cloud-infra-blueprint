import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { TEMPLATES } from '@/templates';
import { estimateProject, estimateResource, projectCost, regionFactor } from './estimate';
import { approx, describeLines, priceDate, rate, usd } from './format';
import { multiplicity, resolveNumber, resolveString, resourceRegion } from './resolve';
import { TEST_BOOK } from './testing';
import type { ResourceCost } from './types';

const book = TEST_BOOK;
const AWS = 'provider "aws" {\n  region = "us-east-1"\n}\n';

function project(hcl: string) {
  return parseProject({ 'main.tf': hcl }).ir;
}

/** the estimate of `address` in a project made of `hcl` */
function cost(hcl: string, address: string): ResourceCost {
  const ir = project(hcl);
  const r = ir.resources.find((x) => x.id === address);
  if (!r) throw new Error(`no ${address} in the project`);
  return estimateResource(r, ir, book);
}

const close = (value: number | null, expected: number) => expect(value).toBeCloseTo(expected, 6);

describe('format', () => {
  it('prints amounts, rates and headline totals', () => {
    expect(usd(7.592)).toBe('$7.59');
    expect(usd(1234.5)).toBe('$1,234.50');
    expect(rate(0.0104)).toBe('$0.0104');
    expect(rate(0.115)).toBe('$0.115');
    expect(rate(0.08)).toBe('$0.08');
    expect(rate(0.1)).toBe('$0.10');
    expect(rate(0.0000166667)).toBe('$0.00001667');
    expect(rate(1)).toBe('$1.00');
    expect(approx(0)).toBe('$0');
    expect(approx(8.232)).toBe('~$8.23');
    expect(approx(27.4)).toBe('~$27');
    expect(approx(1234.4)).toBe('~$1,234');
    expect(approx(12_345)).toBe('~$12.3k');
  });
});

describe('EC2', () => {
  it('prices the instance hours and the default root volume', () => {
    const c = cost(`${AWS}resource "aws_instance" "web" {\n  ami = "ami-1"\n  instance_type = "t3.micro"\n}\n`, 'aws_instance.web');
    expect(c.kind).toBe('fixed');
    close(c.monthly, 730 * 0.0104 + 8 * 0.08);
    expect(describeLines(c.breakdown)).toBe('t3.micro 730 h × $0.0104 = $7.59 + 8 GB gp3 × $0.08 = $0.64');
    expect(c.assumptions.join(' ')).toMatch(/8 GB gp3, a typical AMI default/);
  });

  it('follows root_block_device and extra EBS volumes', () => {
    const c = cost(
      `${AWS}resource "aws_instance" "web" {\n  instance_type = "t3.micro"\n  root_block_device {\n    volume_size = 30\n    volume_type = "gp2"\n  }\n  ebs_block_device {\n    device_name = "/dev/sdf"\n    volume_size = 100\n  }\n}\n`,
      'aws_instance.web',
    );
    expect(c.breakdown.map((l) => l.label)).toEqual(['t3.micro', '30 GB gp2', '100 GB gp3']);
    close(c.monthly, 730 * 0.0104 + 30 * 0.1 + 100 * 0.08);
  });

  it('adds the public IPv4 a public subnet assigns — unless an Elastic IP replaces it', () => {
    const base = `${AWS}resource "aws_subnet" "pub" {\n  vpc_id = "vpc-1"\n  map_public_ip_on_launch = true\n}\nresource "aws_instance" "web" {\n  instance_type = "t3.micro"\n  subnet_id = aws_subnet.pub.id\n}\n`;
    const c = cost(base, 'aws_instance.web');
    expect(c.breakdown.at(-1)).toMatchObject({ label: 'Public IPv4' });
    close(c.breakdown.at(-1)!.monthly, 730 * 0.005);
    expect(c.assumptions).toContain('Subnet pub gives it a public IPv4 (map_public_ip_on_launch)');

    const withEip = cost(`${base}resource "aws_eip" "ip" {\n  instance = aws_instance.web.id\n}\n`, 'aws_instance.web');
    expect(withEip.breakdown.map((l) => l.label)).not.toContain('Public IPv4');
    const optedOut = cost(base.replace('subnet_id', 'associate_public_ip_address = false\n  subnet_id'), 'aws_instance.web');
    expect(optedOut.breakdown).toHaveLength(2);
  });

  it('reads the instance type through a variable default', () => {
    const c = cost(
      `${AWS}variable "size" {\n  default = "t3.small"\n}\nresource "aws_instance" "web" {\n  instance_type = var.size\n}\n`,
      'aws_instance.web',
    );
    expect(c.breakdown[0]).toMatchObject({ label: 't3.small', detail: '730 h × $0.0208' });
  });

  it('says why when the type has no price', () => {
    const unlisted = cost(`${AWS}resource "aws_instance" "web" {\n  instance_type = "x2iedn.32xlarge"\n}\n`, 'aws_instance.web');
    expect(unlisted).toMatchObject({ kind: 'unknown', monthly: null });
    expect(unlisted.note).toBe('instance_type "x2iedn.32xlarge" isn\'t in the price table');
    const expression = cost(`${AWS}resource "aws_instance" "web" {\n  instance_type = local.size\n}\n`, 'aws_instance.web');
    expect(expression.note).toBe("instance_type isn't set to a literal value");
    const variableWithoutDefault = cost(`${AWS}variable "size" {}\nresource "aws_instance" "web" {\n  instance_type = var.size\n}\n`, 'aws_instance.web');
    expect(variableWithoutDefault.kind).toBe('unknown');
  });
});

describe('count and for_each', () => {
  const instance = (meta: string) => `${AWS}variable "n" {\n  default = 2\n}\nresource "aws_instance" "web" {\n  ${meta}\n  instance_type = "t3.micro"\n}\n`;
  const one = 730 * 0.0104 + 8 * 0.08;

  it('multiplies by a literal count, or a variable default', () => {
    const three = cost(instance('count = 3'), 'aws_instance.web');
    expect(three).toMatchObject({ kind: 'fixed', count: 3 });
    close(three.monthly, one * 3);
    // the breakdown stays per instance
    close(three.breakdown.reduce((s, l) => s + l.monthly, 0), one);
    close(cost(instance('count = var.n'), 'aws_instance.web').monthly, one * 2);
  });

  it('prices count = 0 at nothing', () => {
    const none = cost(instance('count = 0'), 'aws_instance.web');
    expect(none).toMatchObject({ kind: 'fixed', monthly: 0, count: 0 });
    expect(none.assumptions[0]).toBe('count = 0: not created');
  });

  it('makes a computed count or for_each unknown, but says what one costs', () => {
    const computed = cost(instance('count = length(var.names)'), 'aws_instance.web');
    expect(computed).toMatchObject({ kind: 'unknown', monthly: null });
    expect(computed.note).toBe(`count is an expression: how many instances is decided at plan time. One costs about ${usd(one)} a month.`);
    const each = cost(instance('for_each = toset(["a", "b"])'), 'aws_instance.web');
    expect(each.kind).toBe('unknown');
    expect(each.note).toMatch(/^for_each/);
  });

  it('keeps free and usage-based resources as they are', () => {
    const sg = cost(`${AWS}resource "aws_security_group" "sg" {\n  for_each = var.groups\n  name = each.key\n}\n`, 'aws_security_group.sg');
    expect(sg).toMatchObject({ kind: 'free', monthly: 0 });
    const queue = cost(`${AWS}resource "aws_sqs_queue" "q" {\n  count = length(var.q)\n}\n`, 'aws_sqs_queue.q');
    expect(queue.kind).toBe('usage');
  });

  it('reads multiplicity and literals directly', () => {
    const ir = project('variable "n" {\n  default = "4"\n}\nresource "aws_instance" "a" {\n  count = var.n\n}\n');
    expect(multiplicity(ir.resources[0], ir)).toEqual({ n: 4 });
    expect(resolveNumber(ir.resources[0].args.count, ir)).toBe(4);
    expect(resolveString(ir.resources[0].args.count, ir)).toBe('4');
  });
});

describe('RDS, ElastiCache, containers', () => {
  it('prices an RDS instance and its storage, Single-AZ or Multi-AZ', () => {
    const db = (extra = '') =>
      cost(`${AWS}resource "aws_db_instance" "db" {\n  engine = "postgres"\n  instance_class = "db.t3.micro"\n  allocated_storage = 20\n${extra}}\n`, 'aws_db_instance.db');
    const single = db();
    expect(describeLines(single.breakdown)).toBe('db.t3.micro 730 h × $0.018 = $13.14 + 20 GB gp2 × $0.115 = $2.30');
    expect(single.assumptions).toContain('storage_type not set: gp2, the AWS default');
    const multi = db('  multi_az = true\n');
    close(multi.monthly, 730 * 0.036 + 20 * 0.23);
    expect(multi.assumptions[0]).toMatch(/Multi-AZ/);
  });

  it('does not price Aurora or unlisted engines', () => {
    const aurora = cost(`${AWS}resource "aws_db_instance" "db" {\n  engine = "aurora-postgresql"\n  instance_class = "db.t3.micro"\n}\n`, 'aws_db_instance.db');
    expect(aurora.kind).toBe('unknown');
    const oracle = cost(`${AWS}resource "aws_db_instance" "db" {\n  engine = "oracle-se2"\n  instance_class = "db.t3.micro"\n}\n`, 'aws_db_instance.db');
    expect(oracle.note).toBe('engine "oracle-se2" isn\'t in the price table');
  });

  it('prices cache nodes', () => {
    const c = cost(`${AWS}resource "aws_elasticache_cluster" "c" {\n  engine = "redis"\n  node_type = "cache.t4g.micro"\n  num_cache_nodes = 2\n}\n`, 'aws_elasticache_cluster.c');
    expect(c.breakdown[0].detail).toBe('2 × 730 h × $0.016');
    close(c.monthly, 2 * 730 * 0.016);
  });

  it('prices Fargate tasks from the task definition the service runs', () => {
    const hcl = `${AWS}resource "aws_ecs_task_definition" "app" {\n  family = "app"\n  cpu = "256"\n  memory = "512"\n}\nresource "aws_ecs_service" "svc" {\n  launch_type = "FARGATE"\n  desired_count = 2\n  task_definition = aws_ecs_task_definition.app.arn\n}\n`;
    const svc = cost(hcl, 'aws_ecs_service.svc');
    close(svc.monthly, 2 * 730 * (0.25 * 0.04048 + 0.5 * 0.004445));
    expect(svc.breakdown[0].label).toBe('2 tasks (0.25 vCPU, 0.5 GB)');
    expect(cost(hcl, 'aws_ecs_task_definition.app')).toMatchObject({ kind: 'free', note: 'Billed through the ECS service that runs it' });
    expect(cost(hcl.replace('launch_type = "FARGATE"', 'launch_type = "EC2"'), 'aws_ecs_service.svc').kind).toBe('free');
    expect(cost(`${AWS}resource "aws_ecs_service" "svc" {\n  launch_type = "FARGATE"\n  task_definition = "app:3"\n}\n`, 'aws_ecs_service.svc').kind).toBe('unknown');
  });

  it('prices the EKS control plane and node groups', () => {
    close(cost(`${AWS}resource "aws_eks_cluster" "k" {\n  name = "k"\n}\n`, 'aws_eks_cluster.k').monthly, 73);
    const ng = cost(`${AWS}resource "aws_eks_node_group" "ng" {\n  instance_types = ["t3.medium"]\n  scaling_config {\n    desired_size = 2\n    max_size = 3\n    min_size = 1\n  }\n}\n`, 'aws_eks_node_group.ng');
    close(ng.monthly, 2 * 730 * 0.0416 + 2 * 20 * 0.1);
  });
});

describe('network and usage-based services', () => {
  it('prices load balancers, NAT gateways and public IPs by the hour, with the usage part noted', () => {
    const alb = cost(`${AWS}resource "aws_lb" "lb" {\n  load_balancer_type = "application"\n}\n`, 'aws_lb.lb');
    close(alb.monthly, 730 * 0.0225);
    expect(alb.assumptions.join(' ')).toMatch(/\$0\.008 per LCU-hour/);
    close(cost(`${AWS}resource "aws_lb" "lb" {\n  load_balancer_type = "network"\n}\n`, 'aws_lb.lb').monthly, 730 * 0.0225);
    expect(cost(`${AWS}resource "aws_lb" "lb" {\n  load_balancer_type = "gateway"\n}\n`, 'aws_lb.lb').kind).toBe('unknown');
    close(cost(`${AWS}resource "aws_nat_gateway" "n" {}\n`, 'aws_nat_gateway.n').monthly, 730 * 0.045);
    close(cost(`${AWS}resource "aws_eip" "ip" {}\n`, 'aws_eip.ip').monthly, 730 * 0.005);
  });

  it('never gives a number to usage-based services', () => {
    for (const [type, pattern] of [
      ['aws_lambda_function', /\$0\.20 per million\).*Free tier: 1 million requests and 400,000 GB-seconds/],
      ['aws_s3_bucket', /\$0\.023 per GB-month/],
      ['aws_cloudfront_distribution', /\$0\.085 per GB/],
      ['aws_sqs_queue', /first 1 million requests/],
      ['aws_sns_topic', /\$0\.50 per million publishes/],
      ['aws_apigatewayv2_api', /\$1\.00 per million HTTP API requests/],
    ] as const) {
      const c = cost(`${AWS}resource "${type}" "x" {}\n`, `${type}.x`);
      expect(c, type).toMatchObject({ kind: 'usage', monthly: null, breakdown: [] });
      expect(c.note, type).toMatch(pattern);
    }
    expect(cost(`${AWS}resource "aws_dynamodb_table" "t" {\n  billing_mode = "PAY_PER_REQUEST"\n}\n`, 'aws_dynamodb_table.t').kind).toBe('usage');
    expect(cost(`${AWS}resource "aws_dynamodb_table" "t" {}\n`, 'aws_dynamodb_table.t').kind).toBe('unknown');
  });

  it('knows what is free, runs locally, or is not in the table', () => {
    expect(cost(`${AWS}resource "aws_vpc" "v" {}\n`, 'aws_vpc.v').kind).toBe('free');
    expect(cost(`${AWS}resource "aws_iam_policy" "p" {}\n`, 'aws_iam_policy.p').kind).toBe('free');
    expect(cost('resource "random_password" "p" {\n  length = 16\n}\n', 'random_password.p').note).toMatch(/inside Terraform/);
    const unknownType = cost(`${AWS}resource "aws_rds_cluster" "c" {}\n`, 'aws_rds_cluster.c');
    expect(unknownType).toMatchObject({ kind: 'unknown', note: "This resource type isn't in the price table yet" });
  });
});

describe('regions', () => {
  const instance = (region: string) => `provider "aws" {\n  region = "${region}"\n}\nresource "aws_instance" "web" {\n  instance_type = "t3.micro"\n}\n`;

  it('scales the default region by the multiplier table', () => {
    const c = cost(instance('sa-east-1'), 'aws_instance.web');
    expect(c).toMatchObject({ region: 'sa-east-1', multiplier: 1.5 });
    expect(c.breakdown[0].detail).toBe('730 h × $0.0156');
    close(c.monthly, (730 * 0.0104 + 8 * 0.08) * 1.5);
    expect(c.assumptions[0]).toBe('sa-east-1: us-east-1 prices × 1.50 (regional multiplier)');
  });

  it('keeps default prices, and says so, for a region outside the table', () => {
    const c = cost(instance('ap-east-9'), 'aws_instance.web');
    expect(c.multiplier).toBe(1);
    expect(c.assumptions[0]).toBe('Prices for us-east-1 — ap-east-9 may differ');
    const none = cost('resource "aws_instance" "web" {\n  instance_type = "t3.micro"\n}\n', 'aws_instance.web');
    expect(none.assumptions[0]).toBe('No region in the code — priced at us-east-1');
  });

  it('reads the region of an aliased provider, a variable, an Azure location or a GCP zone', () => {
    const ir = project(
      'variable "region" {\n  default = "eu-west-1"\n}\nprovider "aws" {\n  region = var.region\n}\nprovider "aws" {\n  alias = "br"\n  region = "sa-east-1"\n}\n' +
        'resource "aws_instance" "a" {}\nresource "aws_instance" "b" {\n  provider = aws.br\n}\n' +
        'resource "azurerm_resource_group" "rg" {\n  location = "Brazil South"\n}\nresource "azurerm_public_ip" "ip" {\n  location = azurerm_resource_group.rg.location\n}\n' +
        'resource "google_compute_instance" "vm" {\n  zone = "southamerica-east1-b"\n}\n',
    );
    const region = (id: string) => resourceRegion(ir.resources.find((r) => r.id === id)!, ir);
    expect(region('aws_instance.a')).toBe('eu-west-1');
    expect(region('aws_instance.b')).toBe('sa-east-1');
    expect(region('azurerm_public_ip.ip')).toBe('brazilsouth');
    expect(region('google_compute_instance.vm')).toBe('southamerica-east1');
    expect(regionFactor(book, 'azure', 'brazilsouth').multiplier).toBe(1.6);
  });

  it('does not scale global services', () => {
    close(cost(`provider "aws" {\n  region = "sa-east-1"\n}\nresource "aws_route53_zone" "z" {\n  name = "example.com"\n}\n`, 'aws_route53_zone.z').monthly, 0.5);
  });
});

describe('Azure', () => {
  const rg = 'resource "azurerm_resource_group" "rg" {\n  location = "eastus"\n}\n';

  it('prices a Linux VM and the disk tier of its OS disk', () => {
    const c = cost(
      `${rg}resource "azurerm_linux_virtual_machine" "vm" {\n  size = "Standard_B1s"\n  location = azurerm_resource_group.rg.location\n  os_disk {\n    caching = "ReadWrite"\n    storage_account_type = "Standard_LRS"\n  }\n}\n`,
      'azurerm_linux_virtual_machine.vm',
    );
    expect(describeLines(c.breakdown)).toBe('Standard_B1s 730 h × $0.0104 = $7.59 + 30 GB OS disk (S4) $1.54');
    expect(c.assumptions).toContain('OS disk: the image size, 30 GB assumed');
  });

  it('prices App Service plans per OS, and consumption plans by usage', () => {
    const plan = (sku: string, os = 'Linux') => cost(`${rg}resource "azurerm_service_plan" "p" {\n  location = "eastus"\n  os_type = "${os}"\n  sku_name = "${sku}"\n}\n`, 'azurerm_service_plan.p');
    close(plan('B1').monthly, 730 * 0.018);
    close(plan('B1', 'Windows').monthly, 730 * 0.075);
    expect(plan('F1').kind).toBe('free');
    expect(plan('Y1')).toMatchObject({ kind: 'usage' });
    expect(plan('Y1').note).toMatch(/1 million executions and 400,000 GB-s/);
    expect(plan('P9v9').kind).toBe('unknown');
  });

  it('prices SQL databases, PostgreSQL (twice with HA), public IPs, Redis', () => {
    close(cost(`${rg}resource "azurerm_mssql_database" "db" {\n  sku_name = "Basic"\n}\n`, 'azurerm_mssql_database.db').monthly, 4.9);
    expect(cost(`${rg}resource "azurerm_mssql_database" "db" {}\n`, 'azurerm_mssql_database.db').kind).toBe('unknown');
    const pg = (ha: string) =>
      cost(`${rg}resource "azurerm_postgresql_flexible_server" "pg" {\n  location = "eastus"\n  sku_name = "B_Standard_B1ms"\n  storage_mb = 32768\n${ha}}\n`, 'azurerm_postgresql_flexible_server.pg');
    close(pg('').monthly, 730 * 0.0207 + 32 * 0.115);
    close(pg('  high_availability {\n    mode = "ZoneRedundant"\n  }\n').monthly, 2 * (730 * 0.0207 + 32 * 0.115));
    close(cost(`${rg}resource "azurerm_public_ip" "ip" {\n  location = "eastus"\n  sku = "Standard"\n}\n`, 'azurerm_public_ip.ip').monthly, 730 * 0.005);
    expect(cost(`${rg}resource "azurerm_public_ip" "ip" {\n  location = "eastus"\n  sku = "Basic"\n}\n`, 'azurerm_public_ip.ip').kind).toBe('unknown');
    close(cost(`${rg}resource "azurerm_redis_cache" "r" {\n  location = "eastus"\n  capacity = 0\n  family = "C"\n  sku_name = "Basic"\n}\n`, 'azurerm_redis_cache.r').monthly, 730 * 0.022);
  });

  it('prices AKS nodes and their OS disks; the free tier has no control-plane fee', () => {
    const c = cost(
      `${rg}resource "azurerm_kubernetes_cluster" "k" {\n  location = "eastus"\n  default_node_pool {\n    name = "default"\n    node_count = 2\n    vm_size = "Standard_B2s"\n  }\n}\n`,
      'azurerm_kubernetes_cluster.k',
    );
    close(c.monthly, 2 * 730 * 0.0416 + 2 * 19.71);
    expect(c.assumptions).toContain('Free tier control plane (no uptime SLA)');
  });

  it('scales by the location', () => {
    const c = cost(`resource "azurerm_public_ip" "ip" {\n  location = "brazilsouth"\n}\n`, 'azurerm_public_ip.ip');
    close(c.monthly, 730 * 0.005 * 1.6);
  });
});

describe('Google Cloud', () => {
  it('prices a VM, its boot disk and its external IP', () => {
    const vm = (nic: string) =>
      cost(`resource "google_compute_instance" "vm" {\n  machine_type = "e2-micro"\n  zone = "us-central1-a"\n  network_interface {\n${nic}  }\n}\n`, 'google_compute_instance.vm');
    const internal = vm('');
    close(internal.monthly, 730 * 0.008376428 + 10 * 0.04);
    expect(internal.assumptions.join(' ')).toMatch(/free tier covers one e2-micro/);
    const external = vm('    access_config {}\n');
    expect(external.breakdown.at(-1)).toMatchObject({ label: 'External IPv4' });
  });

  it('prices Cloud SQL tiers, custom machines and high availability', () => {
    const sql = (settings: string) =>
      cost(`resource "google_sql_database_instance" "db" {\n  database_version = "POSTGRES_16"\n  region = "us-central1"\n  settings {\n${settings}  }\n}\n`, 'google_sql_database_instance.db');
    close(sql('    tier = "db-f1-micro"\n').monthly, 730 * 0.0105 + 10 * 0.17);
    close(sql('    tier = "db-custom-2-7680"\n').monthly, 730 * (2 * 0.0413 + 7.5 * 0.007) + 10 * 0.17);
    close(sql('    tier = "db-f1-micro"\n    availability_type = "REGIONAL"\n').monthly, 2 * (730 * 0.0105 + 10 * 0.17));
    expect(sql('    tier = "db-perf-optimized-N-2"\n').kind).toBe('unknown');
    const mssql = cost('resource "google_sql_database_instance" "db" {\n  database_version = "SQLSERVER_2019_STANDARD"\n}\n', 'google_sql_database_instance.db');
    expect(mssql.kind).toBe('unknown');
  });

  it('prices a regional GKE cluster with nodes in 3 zones', () => {
    const c = cost('resource "google_container_cluster" "k" {\n  location = "us-central1"\n  initial_node_count = 1\n}\n', 'google_container_cluster.k');
    close(c.monthly, 730 * 0.1 + 3 * 730 * 0.033505712 + 3 * 100 * 0.1);
    const bare = cost('resource "google_container_cluster" "k" {\n  location = "us-central1-a"\n  remove_default_node_pool = true\n  initial_node_count = 1\n}\n', 'google_container_cluster.k');
    close(bare.monthly, 73);
  });

  it('prices Memorystore by capacity tier, and Cloud Run by usage', () => {
    close(cost('resource "google_redis_instance" "r" {\n  memory_size_gb = 1\n  tier = "BASIC"\n}\n', 'google_redis_instance.r').monthly, 730 * 0.049);
    close(cost('resource "google_redis_instance" "r" {\n  memory_size_gb = 10\n  tier = "STANDARD_HA"\n}\n', 'google_redis_instance.r').monthly, 10 * 730 * 0.03);
    const run = cost('resource "google_cloud_run_v2_service" "s" {\n  location = "us-central1"\n}\n', 'google_cloud_run_v2_service.s');
    expect(run).toMatchObject({ kind: 'usage', monthly: null });
    expect(run.note).toMatch(/2 million requests/);
  });
});

describe('project totals', () => {
  const hcl =
    `${AWS}resource "aws_vpc" "v" {}\nresource "aws_instance" "web" {\n  instance_type = "t3.micro"\n  count = 2\n}\n` +
    'resource "aws_db_instance" "db" {\n  engine = "postgres"\n  instance_class = "db.t3.micro"\n  allocated_storage = 20\n}\n' +
    'resource "aws_lambda_function" "fn" {}\nresource "aws_instance" "big" {\n  instance_type = "u-24tb1.metal"\n}\n' +
    'resource "google_compute_instance" "vm" {\n  machine_type = "e2-micro"\n  zone = "us-central1-a"\n}\n';

  it('sums the fixed items and counts the rest', () => {
    const ir = project(hcl);
    const p = estimateProject(ir, book);
    const web = 2 * (730 * 0.0104 + 8 * 0.08);
    const db = 730 * 0.018 + 20 * 0.115;
    const vm = 730 * 0.008376428 + 10 * 0.04;
    close(p.total, web + db + vm);
    expect(p.counts).toEqual({ fixed: 3, usage: 1, unknown: 1, free: 1 });
    const compute = p.byCategory.find((g) => g.key === 'compute')!;
    close(compute.monthly, web + vm);
    expect(compute).toMatchObject({ resources: 4, priced: 2 });
    expect(p.byCategory.find((g) => g.key === 'database')).toMatchObject({ resources: 1, priced: 1 });
    const aws = p.byProvider.find((g) => g.key === 'aws')!;
    close(aws.monthly, web + db);
    expect(aws).toMatchObject({ region: 'us-east-1', retrieved: '2026-09-29', resources: 5 });
    expect(p.byProvider.map((g) => g.key)).toEqual(['aws', 'gcp']);
    expect(p.assumptions[0]).toBe('On-demand list prices, 730 hours a month.');
    expect(p.assumptions).toContain('AWS: us-east-1 prices as of Sep 29, 2026; other regions scaled by a regional multiplier.');
  });

  it('is memoized per IR', () => {
    const ir = project(hcl);
    expect(projectCost(ir, book)).toBe(projectCost(ir, book));
    expect(projectCost(project(hcl), book)).not.toBe(projectCost(ir, book));
  });
});

describe('in Portuguese', () => {
  const NBSP = ' ';
  const pt = (hcl: string, address: string) => {
    const ir = project(hcl);
    return estimateResource(ir.resources.find((x) => x.id === address)!, ir, book, 'pt-BR');
  };

  it('writes US dollars the Brazilian way', () => {
    expect(usd(7.592, 'pt-BR')).toBe(`US$${NBSP}7,59`);
    expect(usd(1234.5, 'pt-BR')).toBe(`US$${NBSP}1.234,50`);
    expect(rate(0.0104, 'pt-BR')).toBe(`US$${NBSP}0,0104`);
    expect(rate(0.1, 'pt-BR')).toBe(`US$${NBSP}0,10`);
    expect(rate(0.0000166667, 'pt-BR')).toBe(`US$${NBSP}0,00001667`);
    expect(approx(0, 'pt-BR')).toBe(`US$${NBSP}0`);
    expect(approx(8.232, 'pt-BR')).toBe(`~US$${NBSP}8,23`);
    expect(approx(1234.4, 'pt-BR')).toBe(`~US$${NBSP}1.234`);
    expect(approx(12_345, 'pt-BR')).toBe(`~US$${NBSP}12,3 mil`);
    expect(approx(2_345_678, 'pt-BR')).toBe(`~US$${NBSP}2,3 mi`);
    expect(priceDate('2026-09-29', 'pt-BR')).toBe('29 de set. de 2026');
  });

  it('breakdowns, assumptions, region notes and reasons', () => {
    const c = pt(`${AWS}resource "aws_instance" "web" {\n  ami = "ami-1"\n  instance_type = "t3.micro"\n}\n`, 'aws_instance.web');
    expect(describeLines(c.breakdown, 'pt-BR')).toBe(
      `t3.micro 730 h × US$${NBSP}0,0104 = US$${NBSP}7,59 + 8 GB gp3 × US$${NBSP}0,08 = US$${NBSP}0,64`,
    );
    expect(c.assumptions).toEqual([
      'Linux, locação compartilhada (uma AMI Windows ou licenciada custa mais)',
      'Volume raiz: 8 GB gp3, um padrão comum de AMI (defina root_block_device para mudar)',
    ]);
    const sa = pt(`provider "aws" {\n  region = "sa-east-1"\n}\nresource "aws_instance" "web" {\n  instance_type = "t3.micro"\n}\n`, 'aws_instance.web');
    expect(sa.assumptions[0]).toBe('sa-east-1: preços de us-east-1 × 1,50 (multiplicador regional)');
    const fargate = `${AWS}resource "aws_ecs_task_definition" "app" {\n  family = "app"\n  cpu = "256"\n  memory = "512"\n}\nresource "aws_ecs_service" "svc" {\n  launch_type = "FARGATE"\n  desired_count = 2\n  task_definition = aws_ecs_task_definition.app.arn\n}\n`;
    expect(pt(fargate, 'aws_ecs_service.svc').breakdown[0].label).toBe('2 tarefas (0,25 vCPU, 0,5 GB)');
    expect(pt(fargate, 'aws_ecs_task_definition.app').note).toBe('Cobrada pelo serviço ECS que a executa');
    expect(pt(`${AWS}resource "aws_instance" "web" {\n  instance_type = "x2iedn.32xlarge"\n}\n`, 'aws_instance.web').note).toBe(
      'instance_type "x2iedn.32xlarge" não está na tabela de preços',
    );
    const counted = pt(`${AWS}variable "n" {}\nresource "aws_instance" "web" {\n  count = var.n\n  instance_type = "t3.micro"\n}\n`, 'aws_instance.web');
    expect(counted.note).toMatch(/^count é uma expressão: o número de instâncias só é decidido no plan\. Uma unidade custa cerca de US\$ \d+,\d\d por mês\.$/);
    const p = estimateProject(project(`${AWS}resource "aws_instance" "web" {\n  instance_type = "t3.micro"\n}\n`), book, 'pt-BR');
    expect(p.assumptions[0]).toBe('Preços de tabela sob demanda, 730 horas por mês.');
    expect(p.assumptions).toContain('AWS: preços de us-east-1 em 29 de set. de 2026; outras regiões ajustadas por um multiplicador regional.');
  });

  it('every rule the templates use is worded in Portuguese, with the same numbers', () => {
    for (const t of TEMPLATES) {
      const ir = parseProject(t.build('demo')).ir;
      const en = estimateProject(ir, book, 'en');
      const ptBr = estimateProject(ir, book, 'pt-BR');
      expect(ptBr.total, t.slug).toBe(en.total);
      ptBr.items.forEach((item, i) => {
        const english = en.items[i];
        expect([item.kind, item.monthly], `${t.slug} ${item.id}`).toEqual([english.kind, english.monthly]);
        if (english.note) expect(item.note, `${t.slug} ${item.id}: ${english.note}`).not.toBe(english.note);
        // "PostgreSQL, Single-AZ" is product vocabulary in both languages
        const names = /^\w+, Single-AZ$/;
        item.assumptions.forEach((a, j) => {
          if (!names.test(a)) expect(a, `${t.slug} ${item.id}: ${english.assumptions[j]}`).not.toBe(english.assumptions[j]);
        });
      });
    }
  });

  it('the shared estimate is re-worded on a language switch', () => {
    const ir = project(`${AWS}resource "aws_instance" "web" {\n  instance_type = "t3.micro"\n}\n`);
    const en = projectCost(ir, book, 'en');
    const ptBr = projectCost(ir, book, 'pt-BR');
    expect(ptBr).not.toBe(en);
    expect(projectCost(ir, book, 'pt-BR')).toBe(ptBr);
    expect(ptBr.total).toBe(en.total);
  });
});

