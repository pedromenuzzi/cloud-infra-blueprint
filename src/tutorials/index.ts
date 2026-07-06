/**
 * Interactive tutorials: each step is a full, valid Terraform project shown
 * simultaneously as diagram + code (with the new lines highlighted). Any step
 * can be opened in the real editor to keep experimenting.
 */
import type { Provider } from '@/ir/types';

export interface TutorialStep {
  title: string;
  /** paragraphs; `backticks` render as inline code */
  body: string[];
  files: Record<string, string>;
  /** file tab to focus (default main.tf) */
  focusFile?: string;
}

export interface TutorialDef {
  slug: string;
  title: string;
  description: string;
  level: 'Beginner' | 'Intermediate';
  minutes: number;
  providers: Provider[];
  steps: TutorialStep[];
}

const AWS_PROVIDERS_TF = `provider "aws" {
  region = "us-east-1"
}
`;

const AWS_VERSIONS_TF = `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
`;

const AZURE_PROVIDERS_TF = `provider "azurerm" {
  features {}
}
`;

const AZURE_VERSIONS_TF = `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}
`;

/* ------------------------------------------------------------------ T1 */

const t1Step2Main = `# Networking
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
}
`;

const t1Step3Main = `# Networking
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
}
`;

const t1Step4Main = `${t1Step3Main}
# Compute
resource "aws_instance" "web" {
  ami           = "ami-0c02fb55956c7d316"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.public_a.id
}
`;

const t1Step5Main = `# Networking
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
}

resource "aws_security_group" "web" {
  name        = "web-sg"
  description = "Allow HTTP in, everything out"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Compute
resource "aws_instance" "web" {
  ami                    = "ami-0c02fb55956c7d316"
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.web.id]
}
`;

const firstVpcEc2: TutorialDef = {
  slug: 'first-vpc-ec2',
  title: 'Your first VPC + EC2',
  description: 'Build the classic starter stack from zero: network, subnet, server, firewall.',
  level: 'Beginner',
  minutes: 10,
  providers: ['aws'],
  steps: [
    {
      title: 'Providers & versions',
      body: [
        'Every Terraform project starts by declaring which cloud it talks to. The `provider "aws"` block sets the region; the `terraform` block pins the provider version so the project builds the same way next year.',
        'The canvas is still empty — these two blocks configure the project but create no infrastructure. That is why nothing is drawn yet.',
      ],
      files: {
        'main.tf': '# Resources will land here in the next step.\n',
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
      focusFile: 'providers.tf',
    },
    {
      title: 'The VPC',
      body: [
        'A VPC is your private slice of the AWS network. `cidr_block = "10.0.0.0/16"` reserves 65,536 private IP addresses for everything you will build inside it.',
        'On the blueprint, a VPC is a *container*: the dashed box. Anything that references it will be drawn inside — nesting on this canvas is never decoration, it is derived from real references in the code.',
      ],
      files: {
        'main.tf': t1Step2Main,
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
    },
    {
      title: 'A subnet inside',
      body: [
        'Subnets split the VPC into smaller networks, one per availability zone. Look at the highlighted line `vpc_id = aws_vpc.main.id` — that reference is the *only* reason the subnet is drawn inside the VPC box.',
        '`map_public_ip_on_launch = true` makes this a public subnet: instances placed here get an internet-facing IP.',
      ],
      files: {
        'main.tf': t1Step3Main,
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
    },
    {
      title: 'The web server',
      body: [
        'The `aws_instance` is the actual virtual machine. `ami` picks the disk image (this one is Amazon Linux 2), `instance_type` picks the hardware — `t3.micro` is free-tier eligible.',
        'Its `subnet_id` reference nests it two levels deep: instance → subnet → VPC. In the editor you get the same result by dragging an EC2 from the palette and dropping it inside the subnet.',
      ],
      files: {
        'main.tf': t1Step4Main,
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
    },
    {
      title: 'Lock it down',
      body: [
        'A security group is a stateful firewall. The `ingress` block admits HTTP on port 80 from anywhere; the `egress` block lets the server reach out freely.',
        'The instance attaches it via `vpc_security_group_ids = [...]` — a *list* of references. On the canvas that reference is the dashed orange connection. Delete the edge and the reference disappears from the code; delete the line and the edge disappears from the canvas.',
        'That is the whole stack. Open this step in the editor and try both directions yourself.',
      ],
      files: {
        'main.tf': t1Step5Main,
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
    },
  ],
};

/* ------------------------------------------------------------------ T2 */

const t2Step1Main = `# Static assets
resource "aws_s3_bucket" "site" {
  bucket        = "my-site-assets"
  force_destroy = true
}
`;

const t2Step2Main = `${t2Step1Main}
# CDN
resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  default_root_object = "index.html"

  origin {
    domain_name = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id   = "s3-site"
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
`;

const t2Step3Main = `${t2Step2Main}
# DNS
resource "aws_route53_zone" "main" {
  name = "example.com"
}

resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "www.example.com"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}
`;

const t2Outputs = `output "cdn_domain" {
  description = "Point your browser here"
  value       = aws_cloudfront_distribution.cdn.domain_name
}
`;

const staticSiteCdn: TutorialDef = {
  slug: 'static-site-cdn',
  title: 'Static site with S3 + CloudFront',
  description: 'Host files in a bucket, cache them at the edge, put a domain in front.',
  level: 'Beginner',
  minutes: 8,
  providers: ['aws'],
  steps: [
    {
      title: 'The bucket',
      body: [
        'An S3 bucket is a bottomless folder in the cloud — your HTML, CSS and images live here. Bucket names are globally unique, so pick something specific.',
        '`force_destroy = true` lets `terraform destroy` delete the bucket even when it still has files — handy for demos, dangerous for production.',
      ],
      files: {
        'main.tf': t2Step1Main,
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
    },
    {
      title: 'Cache it at the edge',
      body: [
        'CloudFront replicates your files to hundreds of edge locations. The `origin` block points at the bucket — that reference is the line you see between the two nodes.',
        'Nested blocks like `default_cache_behavior` configure how requests are cached and always redirected to HTTPS. Blocks inside blocks are normal HCL — the canvas keeps them intact even when you edit the resource visually.',
      ],
      files: {
        'main.tf': t2Step2Main,
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
    },
    {
      title: 'A real domain',
      body: [
        'Route 53 hosts the DNS zone; the `alias` block inside the record points `www.example.com` straight at the distribution. Alias records are AWS magic — they behave like CNAMEs but work at the zone apex too.',
        'Follow the arrows on the diagram: record → zone, record → distribution → bucket. The whole request path is visible at a glance.',
      ],
      files: {
        'main.tf': t2Step3Main,
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
    },
    {
      title: 'Outputs',
      body: [
        'Outputs are what Terraform prints after `terraform apply` — the values you actually need, like the CDN address to open in a browser.',
        'They live in `outputs.tf` by convention. Export the project as a zip and the file structure matches exactly what you see in these tabs.',
      ],
      files: {
        'main.tf': t2Step3Main,
        'outputs.tf': t2Outputs,
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
      focusFile: 'outputs.tf',
    },
  ],
};

/* ------------------------------------------------------------------ T3 */

const t3Step1Main = `resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_instance" "web" {
  ami           = "ami-0c02fb55956c7d316"
  instance_type = "t3.micro"
}
`;

const t3Step2Main = `resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_instance" "web" {
  ami           = "ami-0c02fb55956c7d316"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.a.id
}
`;

const t3Step3Main = `resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_security_group" "web" {
  name   = "web-sg"
  vpc_id = aws_vpc.main.id
}

resource "aws_instance" "web" {
  ami                    = "ami-0c02fb55956c7d316"
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.a.id
  vpc_security_group_ids = [aws_security_group.web.id]
}
`;

const refsToConnections: TutorialDef = {
  slug: 'refs-become-connections',
  title: 'How references become the diagram',
  description: 'The mental model behind the sync: nesting and edges are derived, never drawn.',
  level: 'Intermediate',
  minutes: 6,
  providers: ['aws'],
  steps: [
    {
      title: 'Three loose resources',
      body: [
        'Note the order in the file: the subnet is declared *before* the VPC it references. Terraform does not care — it builds a dependency graph from references, not from line order. The canvas reads the same graph.',
        'The instance has no references yet, so it floats outside the VPC box, disconnected.',
      ],
      files: {
        'main.tf': t3Step1Main,
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
    },
    {
      title: 'One line moves a node',
      body: [
        'A single highlighted line changed: `subnet_id = aws_subnet.a.id`. That is enough for the instance to jump inside the subnet on the diagram.',
        'The reverse also works — in the editor, dragging the instance into the subnet *writes this exact line* for you. There is no hidden diagram state: the code is the diagram.',
      ],
      files: {
        'main.tf': t3Step2Main,
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
    },
    {
      title: 'Lists make edges',
      body: [
        'Security groups attach through a list: `vpc_security_group_ids = [aws_security_group.web.id]`. References inside lists (or nested blocks, or even function calls) are found too — each one becomes an edge.',
        'Dashed orange edges are security relationships; solid blue ones are plain references. Deleting the edge on the canvas removes the item from the list — and unsets the argument when the list empties.',
      ],
      files: {
        'main.tf': t3Step3Main,
        'providers.tf': AWS_PROVIDERS_TF,
        'versions.tf': AWS_VERSIONS_TF,
      },
    },
  ],
};

/* ------------------------------------------------------------------ T4 */

const t4Step1Main = `# Everything in Azure lives inside a resource group
resource "azurerm_resource_group" "main" {
  name     = "demo-rg"
  location = "eastus"
}
`;

const t4Step2Main = `${t4Step1Main}
resource "azurerm_virtual_network" "main" {
  name                = "demo-vnet"
  address_space       = ["10.10.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_subnet" "app" {
  name                 = "app"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.10.1.0/24"]
}
`;

const t4Step3Main = `${t4Step2Main}
resource "azurerm_storage_account" "data" {
  name                     = "demodatastore01"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
`;

const t4Step4Main = `${t4Step3Main}
resource "azurerm_mssql_server" "main" {
  name                         = "demo-sqlserver-01"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  version                      = "12.0"
  administrator_login          = "sqladmin"
  administrator_login_password = var.sql_admin_password
}

resource "azurerm_mssql_database" "app" {
  name      = "appdb"
  server_id = azurerm_mssql_server.main.id
  sku_name  = "Basic"
}
`;

const t4Variables = `variable "sql_admin_password" {
  description = "Admin password for SQL Server"
  type        = string
  sensitive   = true
}
`;

const azureNesting: TutorialDef = {
  slug: 'azure-nesting',
  title: 'Azure: resource groups & nesting',
  description: 'Azure organizes by name, not by id — see how the canvas follows along.',
  level: 'Beginner',
  minutes: 8,
  providers: ['azure'],
  steps: [
    {
      title: 'The resource group',
      body: [
        'Azure requires every resource to belong to a *resource group* — a folder with a location. Deleting the group deletes everything inside, which makes cleanup delightfully easy.',
        'On the blueprint the group is the outermost dashed container. Everything you add next will nest inside it.',
      ],
      files: {
        'main.tf': t4Step1Main,
        'providers.tf': AZURE_PROVIDERS_TF,
        'versions.tf': AZURE_VERSIONS_TF,
      },
    },
    {
      title: 'Network in, subnet deeper',
      body: [
        'Where AWS links by id, Azure links by *name*: `resource_group_name = azurerm_resource_group.main.name`. Same idea, different attribute — and the canvas nests on it just the same.',
        'The subnet goes one level deeper via `virtual_network_name`. Notice `location` is also a reference: change the group location once and everything follows.',
      ],
      files: {
        'main.tf': t4Step2Main,
        'providers.tf': AZURE_PROVIDERS_TF,
        'versions.tf': AZURE_VERSIONS_TF,
      },
    },
    {
      title: 'Storage account',
      body: [
        'Storage account names are strict: 3–24 characters, lowercase letters and digits only, globally unique — no dashes. The inspector warns you when a required field is missing.',
        '`LRS` keeps three copies in one datacenter; `GRS` replicates to a paired region for disaster recovery.',
      ],
      files: {
        'main.tf': t4Step3Main,
        'providers.tf': AZURE_PROVIDERS_TF,
        'versions.tf': AZURE_VERSIONS_TF,
      },
    },
    {
      title: 'SQL Server + database',
      body: [
        'The database attaches to its server via `server_id` — an id reference this time, drawn as an edge instead of nesting (a database is not *inside* the server box conceptually; it belongs to it).',
        'The password comes from `var.sql_admin_password`, declared as `sensitive` in variables.tf — never hard-code secrets. Open the variables tab to see the declaration.',
      ],
      files: {
        'main.tf': t4Step4Main,
        'variables.tf': t4Variables,
        'providers.tf': AZURE_PROVIDERS_TF,
        'versions.tf': AZURE_VERSIONS_TF,
      },
    },
  ],
};

export const TUTORIALS: TutorialDef[] = [
  firstVpcEc2,
  staticSiteCdn,
  refsToConnections,
  azureNesting,
];

export function getTutorial(slug: string): TutorialDef | undefined {
  return TUTORIALS.find((t) => t.slug === slug);
}
