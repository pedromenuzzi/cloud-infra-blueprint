/**
 * Real-world Terraform snippets used by the round-trip suite.
 *
 * Each fixture is a small, self-contained slice of HCL that exercises a
 * specific feature: literals, lists, objects, references, nested blocks,
 * heredocs, comments, multi-resource files, etc.
 *
 * Every snippet is run through:
 *
 *   1. parse(adapter)    -> IR
 *   2. emitIR(ir)        -> { 'main.tf': '...' }
 *   3. parse() again     -> IR'
 *
 * The test asserts IR === IR' (semantic round-trip) and that the second
 * emit produces stable output. We do NOT assert byte-equality with the
 * original because the emitter is canonical (own indentation/spacing).
 */

export interface Fixture {
  name: string;
  /** Filename hint (controls which generated file the resource goes in). */
  filename?: string;
  /** HCL source. */
  source: string;
  /** Optional: expected number of resources after parse, for sanity. */
  expectResources?: number;
  expectModules?: number;
  expectVariables?: number;
  expectOutputs?: number;
  expectProviders?: number;
  /** Optional: tags so we can run `--grep` style filters. */
  tags?: string[];
}

export const fixtures: Fixture[] = [
  {
    name: 'aws.empty_vpc',
    expectResources: 1,
    source: `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
`.trim(),
  },
  {
    name: 'aws.vpc_with_tags',
    expectResources: 1,
    source: `
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = {
    Name        = "main"
    Environment = "production"
  }
}
`.trim(),
  },
  {
    name: 'aws.subnet_with_ref',
    expectResources: 2,
    source: `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public_a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
`.trim(),
  },
  {
    name: 'aws.ec2_with_list',
    expectResources: 1,
    source: `
resource "aws_instance" "web" {
  ami                    = "ami-0abcdef0123456789"
  instance_type          = "t3.micro"
  vpc_security_group_ids = ["sg-12345678", "sg-87654321"]
}
`.trim(),
  },
  {
    name: 'aws.s3_bucket_minimal',
    expectResources: 1,
    source: `
resource "aws_s3_bucket" "logs" {
  bucket        = "my-app-logs"
  force_destroy = true
}
`.trim(),
  },
  {
    name: 'aws.security_group_with_interpolation',
    expectResources: 1,
    source: `
resource "aws_security_group" "web" {
  name        = "web-sg-\${var.environment}"
  description = "Web SG"
  vpc_id      = aws_vpc.main.id
}
`.trim(),
  },
  {
    name: 'aws.iam_role_minimal',
    expectResources: 1,
    source: `
resource "aws_iam_role" "lambda_exec" {
  name               = "lambda-exec"
  assume_role_policy = "{\\"Version\\":\\"2012-10-17\\",\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Principal\\":{\\"Service\\":\\"lambda.amazonaws.com\\"},\\"Action\\":\\"sts:AssumeRole\\"}]}"
}
`.trim(),
  },
  {
    name: 'aws.rds_postgres',
    expectResources: 1,
    source: `
resource "aws_db_instance" "main" {
  identifier          = "production-db"
  engine              = "postgres"
  engine_version      = "16.3"
  instance_class      = "db.t3.medium"
  allocated_storage   = 100
  db_name             = "app"
  username            = "appuser"
  skip_final_snapshot = true
}
`.trim(),
  },
  {
    name: 'mixed.variable_and_output',
    expectVariables: 1,
    expectOutputs: 1,
    expectResources: 1,
    source: `
variable "region" {
  type        = "string"
  default     = "us-east-1"
  description = "AWS region"
}

resource "aws_s3_bucket" "data" {
  bucket = "my-app-data"
}

output "bucket_arn" {
  value       = aws_s3_bucket.data.arn
  description = "ARN of the data bucket"
}
`.trim(),
  },
  {
    name: 'mixed.provider_with_region',
    expectProviders: 1,
    expectResources: 1,
    source: `
provider "aws" {
  region = "us-east-1"
}

resource "aws_s3_bucket" "x" {
  bucket = "x"
}
`.trim(),
  },
  {
    name: 'mixed.module_block',
    expectModules: 1,
    source: `
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.1.2"
  name    = "production-vpc"
  cidr    = "10.0.0.0/16"
}
`.trim(),
  },
  {
    name: 'azure.resource_group_and_vnet',
    expectResources: 2,
    source: `
resource "azurerm_resource_group" "main" {
  name     = "production"
  location = "eastus"
}

resource "azurerm_virtual_network" "main" {
  name                = "production-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}
`.trim(),
  },
  {
    name: 'gcp.compute_network',
    expectResources: 2,
    source: `
resource "google_compute_network" "main" {
  name                    = "production"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

resource "google_compute_subnetwork" "main" {
  name          = "production-subnet"
  network       = google_compute_network.main.id
  region        = "us-central1"
  ip_cidr_range = "10.10.0.0/16"
}
`.trim(),
  },
  {
    name: 'gcp.storage_bucket',
    expectResources: 1,
    source: `
resource "google_storage_bucket" "static" {
  name                        = "static-site-12345"
  location                    = "US"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
}
`.trim(),
  },
  {
    name: 'mixed.numbers_and_booleans',
    expectResources: 1,
    source: `
resource "aws_db_instance" "main" {
  allocated_storage   = 20
  iops                = 3000
  multi_az            = true
  publicly_accessible = false
  port                = 5432
}
`.trim(),
  },
  {
    name: 'mixed.empty_object_arg',
    expectResources: 1,
    source: `
resource "aws_s3_bucket" "x" {
  bucket = "x"
  tags   = {}
}
`.trim(),
  },
  {
    name: 'mixed.nested_object',
    expectResources: 1,
    source: `
resource "aws_s3_bucket" "x" {
  bucket = "x"
  tags = {
    "Name"      = "x"
    "ManagedBy" = "terraform"
    "Owner"     = "team-platform"
  }
}
`.trim(),
  },
  {
    name: 'multi.three_resources',
    expectResources: 3,
    source: `
resource "aws_vpc" "a" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_vpc" "b" {
  cidr_block = "10.1.0.0/16"
}

resource "aws_vpc" "c" {
  cidr_block = "10.2.0.0/16"
}
`.trim(),
  },
  {
    name: 'multi.references_form_edges',
    expectResources: 4,
    source: `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_subnet" "b" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.2.0/24"
}

resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
}
`.trim(),
  },
  {
    name: 'mixed.output_with_ref',
    expectResources: 1,
    expectOutputs: 1,
    source: `
resource "aws_eip" "nat" {
  domain = "vpc"
}

output "nat_ip" {
  value = aws_eip.nat.public_ip
}
`.trim(),
  },
];

/**
 * Generate a synthetic stress fixture of `n` resources for benchmarking.
 * Each resource has a few literal args; collectively they exercise the
 * walker on a file ~ n * 6 lines long.
 */
export function makeBenchSource(n: number): string {
  const blocks: string[] = [];
  for (let i = 0; i < n; i++) {
    blocks.push(`resource "aws_s3_bucket" "b_${i}" {
  bucket        = "bucket-${i}"
  force_destroy = ${i % 2 === 0 ? 'true' : 'false'}
  tags = {
    Index = "${i}"
    Name  = "bucket-${i}"
  }
}`);
  }
  return blocks.join('\n\n');
}
