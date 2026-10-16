/**
 * Level 7 · Guided projects (code). Three real architectures, each built in
 * three steps, and each step starts exactly where the previous one ended
 * (`start` is the previous `solution`): a static website (7.1 to 7.3), a
 * serverless API (7.4 to 7.6) and a three-tier app (7.7 to 7.9), which the
 * challenge (C7) makes ready for production. Every project ships its files
 * from its first step, each holding the plan of its step until the learner
 * writes it, so the architecture grows file by file.
 */
import { all, any, applied, argIs, argRefs, has, noFinding, output, variable } from '../goals';
import type { Files, Lesson } from '../types';
import { bucketPrivate, bucketVersioned } from './predicates-01';
import { grade, reachableOn, subnetsAcrossZones } from './predicates-23';
import { optional } from './predicates-5';
import {
  APP_TYPES,
  aliasToDistribution,
  apiMayInvoke,
  appServersIn,
  appliedWith,
  bucketPolicyFor,
  certificateIn,
  certificateValidated,
  databaseInPrivateSubnets,
  distributionUsesCertificate,
  forwards,
  functionLogs,
  functionWithRole,
  healthChecked,
  httpApiLive,
  httpsListener,
  keyDeclared,
  loadBalancerPublic,
  natRouteForPrivate,
  objectAt,
  offByDefault,
  onlyFrom,
  passwordKeptSecret,
  redirectsToHttps,
  routeToFunction,
  scopedToTable,
  tableInEnvironment,
  withinBudget,
} from './predicates-7';
import { AWS_HEADER } from './shared';

/** the monthly budget of the challenge, in US dollars */
const BUDGET = 75;

/* ================================================================ project A: static website */

const SITE_PLAN = `# Project A: a static website, built in three steps.
#   7.1 main.tf: a private bucket for the site's files
#   7.2 cdn.tf: CloudFront in front of it
#   7.3 dns.tf: your own domain, over HTTPS
`;

const SITE_MAIN_START = `${AWS_HEADER}
${SITE_PLAN}
# TODO: a bucket whose name AWS completes (bucket_prefix), with
# versioning, a public access block, and an index.html page in it.
`;

const SITE_MAIN = `${AWS_HEADER}
# The site's files: a private bucket that only CloudFront will read.

resource "aws_s3_bucket" "site" {
  bucket_prefix = "learn-site-"
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_object" "index" {
  bucket       = aws_s3_bucket.site.id
  key          = "index.html"
  content_type = "text/html"
  content      = <<-EOT
    <!doctype html>
    <title>Hello, Terraform</title>
    <h1>This site was built with code.</h1>
  EOT
}
`;

const CDN_PLAN = `# Step 7.2 builds the front door here:
#   a CloudFront distribution that serves the bucket over HTTPS,
#   an origin access control that signs its requests to S3,
#   and a bucket policy that lets in this distribution only.
`;

const DNS_PLAN = `# Step 7.3 gives the site a name of its own here:
#   a hosted zone for your domain, a certificate validated through DNS,
#   and a record that points the domain at the distribution.
`;

/** the distribution: on its `cloudfront.net` address (7.2), or on your domain with your certificate (7.3) */
const cdn = (domain: boolean) => `# The front door: CloudFront serves the bucket from edge locations
# around the world, and is the only reader the bucket accepts.

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "learn-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  default_root_object = "index.html"
${domain ? '  aliases             = [var.domain_name]\n' : ''}
  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    # CachingOptimized, a cache policy AWS manages for static files
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
${
  domain
    ? `    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"`
    : '    cloudfront_default_certificate = true'
}
  }
}

# The bucket policy: CloudFront may read the objects, and only on
# behalf of this distribution.
data "aws_iam_policy_document" "site" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["\${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json
}

output "site_url" {
  value = "https://\${${domain ? 'var.domain_name' : 'aws_cloudfront_distribution.site.domain_name'}}"
}
`;

const DNS = `# Your own name, and a certificate for it.

variable "domain_name" {
  description = "A domain you own, like example.com"
  type        = string
  default     = "example.com"
}

resource "aws_route53_zone" "site" {
  name = var.domain_name
}

# CloudFront only reads certificates from us-east-1, the region of
# this provider.
resource "aws_acm_certificate" "site" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  # the record ACM asks for, to prove the domain is yours
  validation = tolist(aws_acm_certificate.site.domain_validation_options)[0]
}

resource "aws_route53_record" "validation" {
  zone_id = aws_route53_zone.site.zone_id
  name    = local.validation.resource_record_name
  type    = local.validation.resource_record_type
  records = [local.validation.resource_record_value]
  ttl     = 300
}

resource "aws_acm_certificate_validation" "site" {
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [aws_route53_record.validation.fqdn]
}

resource "aws_route53_record" "site" {
  zone_id = aws_route53_zone.site.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
`;

/** each step's solution, the next step's start */
export const SITE_BUCKET: Files = { 'main.tf': SITE_MAIN, 'cdn.tf': CDN_PLAN, 'dns.tf': DNS_PLAN };
export const SITE_CDN: Files = { ...SITE_BUCKET, 'cdn.tf': cdn(false) };
export const SITE_DNS_HTTPS: Files = { ...SITE_CDN, 'cdn.tf': cdn(true), 'dns.tf': DNS };

/* ================================================================ project B: serverless API */

const API_HEADER = AWS_HEADER.replace(
  `      version = "~> 5.0"
    }
`,
  `      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
`,
);

const API_MAIN_START = `${API_HEADER}
# Project B: a serverless API, built in three steps.
#   7.4 main.tf: a DynamoDB table for the data
#   7.5 function.tf: a Lambda function that reads it
#   7.6 api.tf: an HTTP API that puts the function on the internet
#
# TODO: a table billed per request, whose partition key is "id", that
# can be restored to any point in time; and an output with its name.
`;

const API_MAIN = `${API_HEADER}
# The data: one table of items, billed per request.

resource "aws_dynamodb_table" "items" {
  name         = "learn-items"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

output "table_name" {
  value = aws_dynamodb_table.items.name
}
`;

/** the app team's handler, zipped by the archive provider (no `\${` inside: Terraform would read it as a template) */
const HANDLER = `data "archive_file" "api" {
  type        = "zip"
  output_path = "\${path.module}/build/api.zip"

  source {
    filename = "index.mjs"
    content  = <<-EOT
      import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";

      const db = new DynamoDBClient({});

      export const handler = async () => {
        const result = await db.send(new ScanCommand({ TableName: process.env.TABLE_NAME }));
        return { statusCode: 200, body: JSON.stringify(result.Items) };
      };
    EOT
  }
}
`;

const FUNCTION_PLAN = `# The app team's code: a function that lists the table's items.
# Step 7.5 builds what it runs in, below the zip: a role Lambda may
# assume, permissions for this table only, a log group that forgets,
# and the Lambda function itself.

${HANDLER}`;

const FUNCTION = `# The app team's code: a function that lists the table's items.

${HANDLER}
resource "aws_iam_role" "api" {
  name = "learn-api"

  # The trust policy: the Lambda service may assume this role.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# What the function may do: work with this one table, and write its logs.
resource "aws_iam_role_policy" "api" {
  name = "items-and-logs"
  role = aws_iam_role.api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Scan"]
        Resource = aws_dynamodb_table.items.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "\${aws_cloudwatch_log_group.api.arn}:*"
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/learn-api"
  retention_in_days = 14
}

resource "aws_lambda_function" "api" {
  function_name    = "learn-api"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.items.name
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.api.name
  }
}
`;

const API_PLAN = `# Step 7.6 opens the API here:
#   an HTTP API with a stage that deploys itself,
#   a route, GET /items, that hands each request to the function,
#   a permission for this API to invoke the function,
#   and an output with the address to call.
`;

const API = `# The front door: an HTTP API that hands each request to the function.

resource "aws_apigatewayv2_api" "api" {
  name          = "learn-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "items" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "list_items" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /items"
  target    = "integrations/\${aws_apigatewayv2_integration.items.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

# Lambda refuses every caller it wasn't told about: let this API in.
resource "aws_lambda_permission" "api" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "\${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

output "api_url" {
  value = "\${aws_apigatewayv2_api.api.api_endpoint}/items"
}
`;

export const API_TABLE: Files = { 'main.tf': API_MAIN, 'function.tf': FUNCTION_PLAN, 'api.tf': API_PLAN };
export const API_FUNCTION: Files = { ...API_TABLE, 'function.tf': FUNCTION };
export const API_GATEWAY: Files = { ...API_FUNCTION, 'api.tf': API };

/* ================================================================ project C: three-tier app */

const TIER_MAIN = `${AWS_HEADER}
# Project C: a three-tier app, built in three steps.
#   7.7 network.tf: public and private subnets in two zones
#   7.8 app.tf: a load balancer, and servers behind it
#   7.9 database.tf: PostgreSQL behind the servers
`;

const NETWORK_TOP = `# The network: a public and a private subnet in each of two zones.
`;

const NETWORK_BASE = `locals {
  zones = ["us-east-1a", "us-east-1b"]
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true

  tags = {
    Name = "learn-app"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}
`;

const NETWORK_START = `${NETWORK_TOP}
${NETWORK_BASE}
# TODO: in each zone, a public subnet routed to the internet gateway,
# and a private subnet with a route table of its own.

# TODO: a NAT gateway that gives the private subnets a way out, behind
# a bool variable that is off by default.
`;

const NETWORK = `${NETWORK_TOP}
variable "enable_nat" {
  description = "Give the private subnets a way out to the internet through a NAT gateway"
  type        = bool
  default     = false
}

${NETWORK_BASE}
resource "aws_subnet" "public" {
  count                   = length(local.zones)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = local.zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "public-\${local.zones[count.index]}"
  }
}

resource "aws_subnet" "private" {
  count             = length(local.zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone = local.zones[count.index]

  tags = {
    Name = "private-\${local.zones[count.index]}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  count          = length(local.zones)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
}

resource "aws_route_table_association" "private" {
  count          = length(local.zones)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# The way out for the private subnets, behind the switch.
resource "aws_eip" "nat" {
  count  = var.enable_nat ? 1 : 0
  domain = "vpc"
}

resource "aws_nat_gateway" "main" {
  count         = var.enable_nat ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
}

resource "aws_route" "private_nat" {
  count                  = var.enable_nat ? 1 : 0
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[0].id
}
`;

const APP_PLAN = `# Step 7.8 builds the app tier here:
#   an application load balancer in the public subnets, open on port 80,
#   two servers in the private subnets, open to the load balancer only,
#   a target group that checks their health, a listener that forwards
#   to it, and an output with the app's address.
`;

const DATABASE_PLAN = `# Step 7.9 builds the data tier here:
#   PostgreSQL in the private subnets of both zones, encrypted,
#   reachable from the app servers only, with no password in the code.
`;

/** the app tier: plain HTTP (7.8, 7.9), or HTTPS with HTTP redirected to it (C7) */
const app = (https: boolean) => `# The app: a load balancer in the public subnets, in front of two
# servers in the private ones.

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

resource "aws_security_group" "alb" {
  name        = "learn-alb"
  description = "Web traffic from the internet"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "${https ? 'HTTP from anywhere, only to be redirected' : 'HTTP from anywhere'}"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
${
  https
    ? `
  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
`
    : ''
}
  egress {
    description = "To the app servers"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }
}

resource "aws_security_group" "app" {
  name        = "learn-app"
  description = "App servers: traffic from the load balancer only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from the load balancer"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "Anywhere, for updates through the NAT gateway"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "app" {
  count                  = length(local.zones)
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.private[count.index].id
  vpc_security_group_ids = [aws_security_group.app.id]

  # A tiny web server that needs nothing from the internet.
  user_data = <<-EOT
    #!/bin/bash
    mkdir -p /srv/www
    echo "Hello from $(hostname)" > /srv/www/index.html
    cd /srv/www && nohup python3 -m http.server 80 &
  EOT

  metadata_options {
    http_tokens = "required"
  }

  tags = {
    Name = "app-\${local.zones[count.index]}"
  }
}

resource "aws_lb" "app" {
  name                       = "learn-app"
  load_balancer_type         = "application"
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "app" {
  name     = "learn-app"
  port     = 80
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  health_check {
    path                = "/"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

resource "aws_lb_target_group_attachment" "app" {
  count            = length(local.zones)
  target_group_arn = aws_lb_target_group.app.arn
  target_id        = aws_instance.app[count.index].id
}
${
  https
    ? `
variable "certificate_arn" {
  description = "ARN of an ACM certificate for the app's domain, in this region"
  type        = string

  # a stand in, so this terminal can plan: pass the real one with -var
  # or a terraform.tfvars file
  default = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}
`
    : `
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
`
}
output "app_url" {
  value = "${https ? 'https' : 'http'}://\${aws_lb.app.dns_name}"
}
`;

/** the data tier: one zone (7.9), or a standby in the other zone (C7) */
const database = (multiAz: boolean) => `# The database: PostgreSQL in the private subnets, reachable from the
# app servers only.

resource "aws_db_subnet_group" "main" {
  name       = "learn-app"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "db" {
  name        = "learn-db"
  description = "PostgreSQL from the app servers only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from the app servers"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}

resource "aws_db_instance" "main" {
  identifier        = "learn-app"
  engine            = "postgres"
  instance_class    = "${multiAz ? 'db.t3.micro' : 'db.t3.small'}"
  allocated_storage = 20
  storage_type      = "gp3"
  db_name           = "app"
  username          = "app"

  # RDS creates the password and keeps it in Secrets Manager:
  # it never appears in the code or in the state.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  storage_encrypted      = true
${
  multiAz
    ? `
  # a standby copy in the other zone, promoted in a minute or two
  multi_az = true
`
    : ''
}
  backup_retention_period = 7
  skip_final_snapshot     = true
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}
`;

const TIER_START: Files = { 'main.tf': TIER_MAIN, 'network.tf': NETWORK_START, 'app.tf': APP_PLAN, 'database.tf': DATABASE_PLAN };
export const TIER_NETWORK: Files = { ...TIER_START, 'network.tf': NETWORK };
export const TIER_APP: Files = { ...TIER_NETWORK, 'app.tf': app(false) };
export const TIER_DATABASE: Files = { ...TIER_APP, 'database.tf': database(false) };
export const SECURE_THREE_TIER: Files = { ...TIER_DATABASE, 'app.tf': app(true), 'database.tf': database(true) };

/* ================================================================ lessons */

export const lessons: Lesson[] = [
  /* ------------------------------------------------------------ 7.1 */
  {
    slug: 'site-bucket',
    code: '7.1',
    kind: 'lesson',
    mode: 'code',
    minutes: 10,
    xp: 80,
    title: { en: 'A bucket for the site', pt: 'Um bucket para o site' },
    summary: {
      en: 'Project A begins: a private, versioned bucket with your first page in it.',
      pt: 'Começa o projeto A: um bucket privado e versionado, com a sua primeira página dentro.',
    },
    body: [
      {
        en: 'Level 7 is three real architectures, each built in three steps, and every step starts exactly where the last one ended. Project A is the classic static website: files in S3, CloudFront in front, your own domain over HTTPS. Look at the tabs: `cdn.tf` and `dns.tf` are already there, holding the plan of steps 7.2 and 7.3.',
        pt: 'O nível 7 são três arquiteturas reais, cada uma construída em três etapas, e cada etapa começa exatamente onde a anterior terminou. O projeto A é o site estático clássico: arquivos no S3, CloudFront na frente, seu próprio domínio com HTTPS. Olhe as abas: `cdn.tf` e `dns.tf` já estão lá, com o plano das etapas 7.2 e 7.3.',
      },
      {
        en: 'First the bucket. Bucket names are global, shared by every AWS account in the world, so let AWS finish yours: `bucket_prefix = "learn-site-"` adds a unique suffix. Turn on versioning, so an overwritten page can come back, and add a public access block with its four settings `true`.',
        pt: 'Primeiro, o bucket. Nomes de bucket são globais, compartilhados por todas as contas da AWS no mundo, então deixe a AWS completar o seu: `bucket_prefix = "learn-site-"` acrescenta um sufixo único. Ligue o versionamento, para que uma página sobrescrita possa voltar, e adicione um bloqueio de acesso público com as quatro opções em `true`.',
      },
      {
        en: 'Wait, a *private* bucket for a *public* website? Yes, and that is the whole trick of this project. Nobody will read the bucket directly: in the next step CloudFront becomes its only reader. Private by default, opened to exactly one door.',
        pt: 'Espera, um bucket *privado* para um site *público*? Sim, e esse é todo o truque deste projeto. Ninguém vai ler o bucket diretamente: na próxima etapa, o CloudFront vira o único leitor dele. Privado por padrão, aberto para uma única porta.',
      },
      {
        en: 'Last, the page itself: an `aws_s3_object` with `key = "index.html"`, its HTML in `content` and `content_type = "text/html"`. S3 doesn\'t guess types, and without one the browser downloads the page instead of showing it. Apply, then open the security panel: an A, for a bucket that will soon serve the whole internet.',
        pt: 'Por último, a própria página: um `aws_s3_object` com `key = "index.html"`, o HTML em `content` e `content_type = "text/html"`. O S3 não adivinha tipos, e sem um o navegador baixa a página em vez de mostrá-la. Aplique e abra o painel de segurança: nota A, para um bucket que logo vai servir a internet inteira.',
      },
    ],
    asides: [
      {
        title: { en: 'Why not S3 website hosting?', pt: 'Por que não a hospedagem de sites do S3?' },
        body: [
          {
            en: 'S3 can serve a site on its own: a website configuration and a public bucket policy. It is one of the oldest recipes on the web, with two catches: its address speaks plain HTTP only, and the bucket must be public. CloudFront fixes both, which is why this project takes the longer road.',
            pt: 'O S3 consegue servir um site sozinho: uma configuração de site e uma política de bucket pública. É uma das receitas mais antigas da web, com dois poréns: o endereço dela só fala HTTP sem criptografia, e o bucket precisa ser público. O CloudFront resolve os dois, e é por isso que este projeto pega o caminho mais longo.',
          },
        ],
      },
      {
        title: { en: 'Text on many lines: heredocs', pt: 'Texto em várias linhas: heredocs' },
        body: [
          {
            en: '`<<-EOT` opens a block of text that runs until a line holding only `EOT`. The `-` lets you indent the text along with the code: Terraform removes the common indentation before using it.',
            pt: '`<<-EOT` abre um bloco de texto que vai até uma linha só com `EOT`. O `-` deixa você indentar o texto junto com o código: o Terraform remove a indentação comum antes de usá-lo.',
          },
        ],
      },
    ],
    start: { 'main.tf': SITE_MAIN_START, 'cdn.tf': CDN_PLAN, 'dns.tf': DNS_PLAN },
    solution: SITE_BUCKET,
    goals: [
      {
        id: 'bucket',
        text: { en: 'A bucket with versioning on', pt: 'Um bucket com versionamento ligado' },
        hint: {
          en: '`resource "aws_s3_bucket" "site"` with `bucket_prefix = "learn-site-"`. Then an `aws_s3_bucket_versioning` with `bucket = aws_s3_bucket.site.id` and a `versioning_configuration` block with `status = "Enabled"`.',
          pt: '`resource "aws_s3_bucket" "site"` com `bucket_prefix = "learn-site-"`. Depois um `aws_s3_bucket_versioning` com `bucket = aws_s3_bucket.site.id` e um bloco `versioning_configuration` com `status = "Enabled"`.',
        },
        test: all(has('aws_s3_bucket'), bucketVersioned),
      },
      {
        id: 'private',
        text: { en: 'Public access blocked, all four ways', pt: 'Acesso público bloqueado, das quatro formas' },
        hint: {
          en: 'An `aws_s3_bucket_public_access_block` on the bucket with `block_public_acls`, `block_public_policy`, `ignore_public_acls` and `restrict_public_buckets`, each `true`.',
          pt: 'Um `aws_s3_bucket_public_access_block` no bucket com `block_public_acls`, `block_public_policy`, `ignore_public_acls` e `restrict_public_buckets`, todos `true`.',
        },
        test: bucketPrivate,
      },
      {
        id: 'page',
        text: { en: 'An `index.html` page in it, served as HTML', pt: 'Uma página `index.html` dentro dele, servida como HTML' },
        hint: {
          en: 'An `aws_s3_object` with `bucket = aws_s3_bucket.site.id`, `key = "index.html"`, `content_type = "text/html"` and the page in `content`, written as a heredoc between `<<-EOT` and `EOT`.',
          pt: 'Um `aws_s3_object` com `bucket = aws_s3_bucket.site.id`, `key = "index.html"`, `content_type = "text/html"` e a página em `content`, escrita como heredoc entre `<<-EOT` e `EOT`.',
        },
        test: objectAt('index.html', /^text\/html\b/),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. The bucket comes first, and everything that names it after.',
          pt: 'No terminal: `init`, `plan`, `apply`. O bucket vem primeiro, e tudo o que cita o nome dele depois.',
        },
        test: all(applied('aws_s3_bucket'), applied('aws_s3_object')),
      },
    ],
    teaches: ['aws_s3_bucket', 'aws_s3_bucket_versioning', 'aws_s3_bucket_public_access_block', 'aws_s3_object'],
  },

  /* ------------------------------------------------------------ 7.2 */
  {
    slug: 'site-cdn',
    code: '7.2',
    kind: 'lesson',
    mode: 'code',
    minutes: 13,
    xp: 100,
    title: { en: 'CloudFront in front', pt: 'CloudFront na frente' },
    summary: {
      en: 'Serve the bucket through CloudFront over HTTPS, and let only your distribution read it.',
      pt: 'Sirva o bucket pelo CloudFront com HTTPS e deixe só a sua distribuição lê-lo.',
    },
    body: [
      {
        en: 'Your bucket holds a page nobody can read. Time to open exactly one door. *CloudFront* is the content delivery network of AWS: hundreds of edge locations that keep copies of your files close to every visitor, over HTTPS, at an address like `d111111abcdef8.cloudfront.net`.',
        pt: 'Seu bucket guarda uma página que ninguém consegue ler. Hora de abrir exatamente uma porta. O *CloudFront* é a rede de distribuição de conteúdo da AWS: centenas de pontos de presença que guardam cópias dos seus arquivos perto de cada visitante, com HTTPS, num endereço como `d111111abcdef8.cloudfront.net`.',
      },
      {
        en: 'In `cdn.tf`, write the distribution. Its `origin` is the bucket, through `bucket_regional_domain_name`. `default_root_object = "index.html"` answers the bare address with your page, and in `default_cache_behavior`, `viewer_protocol_policy = "redirect-to-https"` sends every plain HTTP visitor to HTTPS.',
        pt: 'No `cdn.tf`, escreva a distribuição. A `origin` dela é o bucket, pelo `bucket_regional_domain_name`. `default_root_object = "index.html"` responde o endereço puro com a sua página, e no `default_cache_behavior`, `viewer_protocol_policy = "redirect-to-https"` manda todo visitante em HTTP comum para o HTTPS.',
      },
      {
        en: 'Now the key. An *origin access control* makes CloudFront sign every request it sends to S3. The bucket policy then lets in the CloudFront service on one condition: `AWS:SourceArn` must be *your* distribution\'s ARN. Any other distribution, even one in another account, gets nothing.',
        pt: 'Agora, a chave. Um *origin access control* faz o CloudFront assinar cada requisição que envia ao S3. A política do bucket então deixa entrar o serviço CloudFront com uma condição: `AWS:SourceArn` precisa ser o ARN da *sua* distribuição. Qualquer outra distribuição, mesmo de outra conta, não recebe nada.',
      },
      {
        en: 'Plan it and look for `<= data "aws_iam_policy_document"`: the policy is read *during* the apply, because it needs an ARN that doesn\'t exist yet. That is level 4, inside a real architecture. Apply and be patient: a distribution takes minutes to reach every edge location, and the terminal waits as Terraform does. Then the `site_url` output prints your site\'s address. The bucket is still private, and the security panel still says A.',
        pt: 'Rode o plan e procure `<= data "aws_iam_policy_document"`: a política é lida *durante* o apply, porque precisa de um ARN que ainda não existe. É o nível 4, dentro de uma arquitetura real. Aplique e tenha paciência: uma distribuição leva minutos para chegar a todos os pontos de presença, e o terminal espera como o Terraform espera. Depois, o output `site_url` mostra o endereço do seu site. O bucket continua privado, e o painel de segurança continua dando A.',
      },
    ],
    asides: [
      {
        title: { en: 'What is a CDN?', pt: 'O que é uma CDN?' },
        body: [
          {
            en: 'A content delivery network copies your files to servers spread around the world, so a visitor in São Paulo is served from São Paulo instead of Virginia. Pages load faster, and your origin answers a small share of the requests.',
            pt: 'Uma rede de distribuição de conteúdo copia seus arquivos para servidores espalhados pelo mundo, então um visitante em São Paulo é atendido a partir de São Paulo em vez da Virgínia. As páginas carregam mais rápido, e a sua origem responde uma pequena parte das requisições.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'What is that long cache policy id?', pt: 'Que id comprido de política de cache é esse?' },
        body: [
          {
            en: 'A cache policy says what CloudFront keeps and for how long. AWS ships ready ones, and `658327ea-f89d-4fab-a63d-7e88639e58f6` is *CachingOptimized*, the usual pick for static files. Its id is the same in every account.',
            pt: 'Uma política de cache diz o que o CloudFront guarda e por quanto tempo. A AWS oferece algumas prontas, e `658327ea-f89d-4fab-a63d-7e88639e58f6` é a *CachingOptimized*, a escolha comum para arquivos estáticos. O id dela é o mesmo em todas as contas.',
          },
        ],
      },
      {
        title: { en: 'And the bill?', pt: 'E a conta?' },
        body: [
          {
            en: 'Open the cost estimate: CloudFront and S3 are billed by use, per GB and per request, so the estimate shows their rates instead of a monthly number. A small site with few visitors costs cents.',
            pt: 'Abra a estimativa de custo: CloudFront e S3 são cobrados por uso, por GB e por requisição, então a estimativa mostra as tarifas deles em vez de um número mensal. Um site pequeno com poucos visitantes custa centavos.',
          },
        ],
      },
    ],
    start: SITE_BUCKET,
    solution: SITE_CDN,
    goals: [
      {
        id: 'origin',
        text: { en: 'A distribution that reads the bucket through an origin access control', pt: 'Uma distribuição que lê o bucket por meio de um origin access control' },
        hint: {
          en: 'An `aws_cloudfront_origin_access_control` with `origin_access_control_origin_type = "s3"`, `signing_behavior = "always"` and `signing_protocol = "sigv4"`. In the distribution\'s `origin` block: `origin_id = "site"`, `domain_name = aws_s3_bucket.site.bucket_regional_domain_name` and `origin_access_control_id = aws_cloudfront_origin_access_control.site.id`.',
          pt: 'Um `aws_cloudfront_origin_access_control` com `origin_access_control_origin_type = "s3"`, `signing_behavior = "always"` e `signing_protocol = "sigv4"`. No bloco `origin` da distribuição: `origin_id = "site"`, `domain_name = aws_s3_bucket.site.bucket_regional_domain_name` e `origin_access_control_id = aws_cloudfront_origin_access_control.site.id`.',
        },
        test: all(
          argRefs('aws_cloudfront_distribution', 'origin.domain_name', 'aws_s3_bucket'),
          argRefs('aws_cloudfront_distribution', 'origin.origin_access_control_id', 'aws_cloudfront_origin_access_control'),
        ),
      },
      {
        id: 'root',
        text: { en: 'The bare address serves `index.html`', pt: 'O endereço puro serve o `index.html`' },
        hint: {
          en: '`default_root_object = "index.html"` in the distribution. Without it, the address alone answers with an error.',
          pt: '`default_root_object = "index.html"` na distribuição. Sem isso, o endereço sozinho responde com um erro.',
        },
        test: argIs('aws_cloudfront_distribution', 'default_root_object', 'index.html'),
      },
      {
        id: 'https',
        text: { en: 'Plain HTTP visitors are sent to HTTPS', pt: 'Visitantes em HTTP comum vão para o HTTPS' },
        hint: {
          en: 'In `default_cache_behavior`: `viewer_protocol_policy = "redirect-to-https"`, with `target_origin_id = "site"`, `allowed_methods` and `cached_methods` set to `["GET", "HEAD"]`, and the `cache_policy_id`. The distribution also needs a `restrictions` block and a `viewer_certificate` with `cloudfront_default_certificate = true`.',
          pt: 'No `default_cache_behavior`: `viewer_protocol_policy = "redirect-to-https"`, com `target_origin_id = "site"`, `allowed_methods` e `cached_methods` iguais a `["GET", "HEAD"]` e o `cache_policy_id`. A distribuição também precisa de um bloco `restrictions` e de um `viewer_certificate` com `cloudfront_default_certificate = true`.',
        },
        test: argIs('aws_cloudfront_distribution', 'default_cache_behavior.viewer_protocol_policy', /^(redirect-to-https|https-only)$/),
      },
      {
        id: 'policy',
        text: { en: 'A bucket policy that lets in your distribution only', pt: 'Uma política de bucket que deixa entrar só a sua distribuição' },
        hint: {
          en: 'A `data "aws_iam_policy_document"` with a `statement`: `s3:GetObject` on `"${aws_s3_bucket.site.arn}/*"`, a `principals` block of type `Service` for `cloudfront.amazonaws.com`, and a `condition` on `AWS:SourceArn` with `values = [aws_cloudfront_distribution.site.arn]`. Then an `aws_s3_bucket_policy` with `policy = data.aws_iam_policy_document.site.json`.',
          pt: 'Um `data "aws_iam_policy_document"` com um `statement`: `s3:GetObject` em `"${aws_s3_bucket.site.arn}/*"`, um bloco `principals` do tipo `Service` para `cloudfront.amazonaws.com` e uma `condition` em `AWS:SourceArn` com `values = [aws_cloudfront_distribution.site.arn]`. Depois um `aws_s3_bucket_policy` com `policy = data.aws_iam_policy_document.site.json`.',
        },
        test: all(bucketPolicyFor('cloudfront.amazonaws.com', 'aws_cloudfront_distribution'), bucketPrivate),
      },
      {
        id: 'apply',
        text: { en: 'Apply it, with an output for the site\'s address', pt: 'Aplique, com um output para o endereço do site' },
        hint: {
          en: '`output "site_url" {` with `value = "https://${aws_cloudfront_distribution.site.domain_name}"`, then `apply`.',
          pt: '`output "site_url" {` com `value = "https://${aws_cloudfront_distribution.site.domain_name}"`, depois `apply`.',
        },
        test: all(output(undefined, 'aws_cloudfront_distribution'), applied('aws_cloudfront_distribution'), applied('aws_s3_bucket_policy')),
      },
    ],
    teaches: ['aws_cloudfront_distribution', 'aws_cloudfront_origin_access_control', 'aws_s3_bucket_policy', 'data.aws_iam_policy_document'],
  },

  /* ------------------------------------------------------------ 7.3 */
  {
    slug: 'site-dns-https',
    code: '7.3',
    kind: 'lesson',
    mode: 'code',
    minutes: 14,
    xp: 110,
    title: { en: 'Your domain, over HTTPS', pt: 'Seu domínio, com HTTPS' },
    summary: {
      en: 'A certificate validated through DNS, and your own name pointing at the site.',
      pt: 'Um certificado validado por DNS e o seu próprio nome apontando para o site.',
    },
    body: [
      {
        en: 'A `cloudfront.net` address works, but nobody remembers it. This step gives the site a name of your own, like `example.com`, with a certificate every browser trusts. Everything goes in `dns.tf`, plus a few lines in the distribution.',
        pt: 'Um endereço `cloudfront.net` funciona, mas ninguém o memoriza. Esta etapa dá ao site um nome só seu, como `example.com`, com um certificado em que todo navegador confia. Tudo vai no `dns.tf`, mais algumas linhas na distribuição.',
      },
      {
        en: 'Start with a `domain_name` variable and a Route 53 hosted zone for it. Then ask ACM for a certificate with `validation_method = "DNS"`. ACM answers with a record to publish: put it in your zone and ACM knows the domain is yours. The certificate\'s `domain_validation_options` holds that record, and `aws_acm_certificate_validation` waits until ACM has seen it.',
        pt: 'Comece com uma variável `domain_name` e uma zona hospedada do Route 53 para ela. Depois peça ao ACM um certificado com `validation_method = "DNS"`. O ACM responde com um registro para publicar: coloque-o na sua zona e o ACM sabe que o domínio é seu. O `domain_validation_options` do certificado guarda esse registro, e o `aws_acm_certificate_validation` espera até o ACM enxergá-lo.',
      },
      {
        en: 'One rule catches everyone once: CloudFront only reads certificates from `us-east-1`, wherever the rest of your project lives. This provider is already there. In another region, you would add a second `provider "aws"` with an `alias` and set `provider = aws.<alias>` on the certificate.',
        pt: 'Uma regra pega todo mundo uma vez: o CloudFront só lê certificados de `us-east-1`, onde quer que o resto do projeto esteja. Este provider já está lá. Em outra região, você adicionaria um segundo `provider "aws"` com um `alias` e definiria `provider = aws.<alias>` no certificado.',
      },
      {
        en: 'Then wire it up. In the distribution: `aliases = [var.domain_name]` and a `viewer_certificate` with the validated certificate. In the zone: an `A` record whose `alias` block points the name at the distribution. Apply and read the order in the terminal: zone and certificate, the validation record, the validation, the distribution, and your name last.',
        pt: 'Depois, ligue tudo. Na distribuição: `aliases = [var.domain_name]` e um `viewer_certificate` com o certificado validado. Na zona: um registro `A` cujo bloco `alias` aponta o nome para a distribuição. Aplique e leia a ordem no terminal: zona e certificado, o registro de validação, a validação, a distribuição e, por último, o seu nome.',
      },
      {
        en: 'Now the cost estimate: the hosted zone is the first fixed line of the project, 50 cents a month. The certificate shows as not estimated, and costs nothing: public ACM certificates are free and renew themselves. A whole website, worldwide, over HTTPS, for the price of a few coffees a year, plus traffic.',
        pt: 'Agora, a estimativa de custo: a zona hospedada é a primeira linha fixa do projeto, 50 centavos por mês. O certificado aparece sem estimativa, e não custa nada: certificados públicos do ACM são gratuitos e se renovam sozinhos. Um site inteiro, no mundo todo, com HTTPS, pelo preço de alguns cafés por ano mais o tráfego.',
      },
    ],
    asides: [
      {
        title: { en: 'What are Route 53 and ACM?', pt: 'O que são o Route 53 e o ACM?' },
        body: [
          {
            en: '*Route 53* is the DNS of AWS: a hosted zone holds the records of one domain, the answers to "where is `example.com`?". *ACM* (AWS Certificate Manager) issues the TLS certificates that put the padlock in the browser, and renews them before they expire.',
            pt: 'O *Route 53* é o DNS da AWS: uma zona hospedada guarda os registros de um domínio, as respostas para "onde fica `example.com`?". O *ACM* (AWS Certificate Manager) emite os certificados TLS que colocam o cadeado no navegador e os renova antes de expirarem.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'Why an alias record, not a CNAME?', pt: 'Por que um registro alias, e não um CNAME?' },
        body: [
          {
            en: 'A CNAME can\'t sit at the root of a domain (`example.com`), only on names below it (`www.example.com`). An alias record can: Route 53 answers with the distribution\'s current addresses, and charges nothing for those queries.',
            pt: 'Um CNAME não pode ficar na raiz de um domínio (`example.com`), só em nomes abaixo dela (`www.example.com`). Um registro alias pode: o Route 53 responde com os endereços atuais da distribuição e não cobra por essas consultas.',
          },
        ],
      },
      {
        title: { en: 'With a real domain', pt: 'Com um domínio de verdade' },
        body: [
          {
            en: 'A new hosted zone gets four name servers (its `name_servers` attribute). Set them at the registrar where you bought the domain, or the validation waits forever. If the zone exists already, look it up with `data "aws_route53_zone"` instead of creating a second one.',
            pt: 'Uma zona hospedada nova recebe quatro servidores de nomes (o atributo `name_servers`). Configure-os no registrador onde você comprou o domínio, ou a validação espera para sempre. Se a zona já existe, busque-a com `data "aws_route53_zone"` em vez de criar uma segunda.',
          },
        ],
      },
    ],
    start: SITE_CDN,
    solution: SITE_DNS_HTTPS,
    goals: [
      {
        id: 'zone',
        text: { en: 'A hosted zone for a domain that comes from a variable', pt: 'Uma zona hospedada para um domínio que vem de uma variável' },
        hint: {
          en: '`variable "domain_name" {` with `type = string` and `default = "example.com"`, then `resource "aws_route53_zone" "site"` with `name = var.domain_name`.',
          pt: '`variable "domain_name" {` com `type = string` e `default = "example.com"`, depois `resource "aws_route53_zone" "site"` com `name = var.domain_name`.',
        },
        test: argRefs('aws_route53_zone', 'name', 'var'),
      },
      {
        id: 'cert',
        text: { en: 'A certificate in `us-east-1`, validated through DNS', pt: 'Um certificado em `us-east-1`, validado por DNS' },
        hint: {
          en: '`resource "aws_acm_certificate" "site"` with `domain_name = var.domain_name` and `validation_method = "DNS"`. The provider of this project is in `us-east-1` already.',
          pt: '`resource "aws_acm_certificate" "site"` com `domain_name = var.domain_name` e `validation_method = "DNS"`. O provider deste projeto já está em `us-east-1`.',
        },
        test: certificateIn('us-east-1'),
      },
      {
        id: 'validated',
        text: { en: 'The validation record in your zone, and a validation that waits for it', pt: 'O registro de validação na sua zona e uma validação que espera por ele' },
        hint: {
          en: 'A local, `validation = tolist(aws_acm_certificate.site.domain_validation_options)[0]`. An `aws_route53_record` in your zone with its `resource_record_name`, `resource_record_type` and `resource_record_value` and a `ttl`. Then `aws_acm_certificate_validation` with `certificate_arn = aws_acm_certificate.site.arn` and `validation_record_fqdns = [aws_route53_record.validation.fqdn]`.',
          pt: 'Um local, `validation = tolist(aws_acm_certificate.site.domain_validation_options)[0]`. Um `aws_route53_record` na sua zona com os `resource_record_name`, `resource_record_type` e `resource_record_value` dele e um `ttl`. Depois `aws_acm_certificate_validation` com `certificate_arn = aws_acm_certificate.site.arn` e `validation_record_fqdns = [aws_route53_record.validation.fqdn]`.',
        },
        test: certificateValidated,
      },
      {
        id: 'tls',
        text: { en: 'The distribution answers to your domain with that certificate', pt: 'A distribuição responde pelo seu domínio com esse certificado' },
        hint: {
          en: 'In the distribution, `aliases = [var.domain_name]`, and in `viewer_certificate`, in place of the default certificate: `acm_certificate_arn = aws_acm_certificate_validation.site.certificate_arn`, `ssl_support_method = "sni-only"` and `minimum_protocol_version = "TLSv1.2_2021"`.',
          pt: 'Na distribuição, `aliases = [var.domain_name]`, e no `viewer_certificate`, no lugar do certificado padrão: `acm_certificate_arn = aws_acm_certificate_validation.site.certificate_arn`, `ssl_support_method = "sni-only"` e `minimum_protocol_version = "TLSv1.2_2021"`.',
        },
        test: distributionUsesCertificate,
      },
      {
        id: 'alias',
        text: { en: 'Your domain points at the distribution', pt: 'Seu domínio aponta para a distribuição' },
        hint: {
          en: 'An `aws_route53_record` with `zone_id = aws_route53_zone.site.zone_id`, `name = var.domain_name`, `type = "A"` and an `alias` block: `name = aws_cloudfront_distribution.site.domain_name`, `zone_id = aws_cloudfront_distribution.site.hosted_zone_id` and `evaluate_target_health = false`.',
          pt: 'Um `aws_route53_record` com `zone_id = aws_route53_zone.site.zone_id`, `name = var.domain_name`, `type = "A"` e um bloco `alias`: `name = aws_cloudfront_distribution.site.domain_name`, `zone_id = aws_cloudfront_distribution.site.hosted_zone_id` e `evaluate_target_health = false`.',
        },
        test: aliasToDistribution,
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `plan`, then `apply`. If the plan stops on a reference, the editor marks the line: check the names on both ends.',
          pt: 'No terminal: `plan`, depois `apply`. Se o plano parar numa referência, o editor marca a linha: confira os nomes nas duas pontas.',
        },
        test: all(applied('aws_acm_certificate_validation'), applied('aws_route53_record')),
      },
    ],
    teaches: ['aws_route53_zone', 'aws_route53_record', 'aws_acm_certificate', 'aws_acm_certificate_validation'],
  },

  /* ------------------------------------------------------------ 7.4 */
  {
    slug: 'api-table',
    code: '7.4',
    kind: 'lesson',
    mode: 'code',
    minutes: 10,
    xp: 80,
    title: { en: 'A table for the data', pt: 'Uma tabela para os dados' },
    summary: {
      en: 'Project B begins: a DynamoDB table that costs nothing while nobody uses it.',
      pt: 'Começa o projeto B: uma tabela do DynamoDB que não custa nada enquanto ninguém a usa.',
    },
    body: [
      {
        en: 'Project B is a serverless API: no server to patch, nothing running while nobody calls. A DynamoDB table holds the data (here), a Lambda function runs the code (7.5), and API Gateway puts it on the internet (7.6). The tabs are ready: `function.tf` already holds the app team\'s code, and `api.tf` waits for its turn.',
        pt: 'O projeto B é uma API sem servidor: nenhum servidor para atualizar, nada rodando enquanto ninguém chama. Uma tabela do DynamoDB guarda os dados (aqui), uma função Lambda roda o código (7.5) e o API Gateway coloca tudo na internet (7.6). As abas estão prontas: o `function.tf` já guarda o código do time da aplicação, e o `api.tf` espera a vez dele.',
      },
      {
        en: 'A DynamoDB table needs surprisingly little: a `name`, and a *partition key*, `hash_key = "id"`, the attribute every item is found by. Declare that key in an `attribute` block with its type, `S` for string. Only keys are declared; every other field is free, item by item.',
        pt: 'Uma tabela do DynamoDB pede surpreendentemente pouco: um `name` e uma *chave de partição*, `hash_key = "id"`, o atributo pelo qual cada item é encontrado. Declare essa chave num bloco `attribute` com o tipo dela, `S` para texto. Só as chaves são declaradas; os outros campos são livres, item a item.',
      },
      {
        en: 'Then the bill. `billing_mode = "PAY_PER_REQUEST"` is on demand: you pay per read and per write, and nothing for an idle table besides storage. Open the cost estimate once you type it: no monthly number, just the rates. For a new API that may get ten calls a day, that is exactly right.',
        pt: 'Depois, a conta. `billing_mode = "PAY_PER_REQUEST"` é o modo sob demanda: você paga por leitura e por escrita, e nada por uma tabela parada além do armazenamento. Abra a estimativa de custo assim que digitar: nenhum número mensal, só as tarifas. Para uma API nova, que talvez receba dez chamadas por dia, é exatamente o certo.',
      },
      {
        en: 'Finish with `point_in_time_recovery`, so a bad deploy that scrambles the data can be undone to any second of the last 35 days, and an output with the table\'s name: the function will need it. Apply, and the terminal spends a few seconds on the table, as AWS does.',
        pt: 'Termine com `point_in_time_recovery`, para que um deploy ruim que bagunce os dados possa ser desfeito até qualquer segundo dos últimos 35 dias, e um output com o nome da tabela: a função vai precisar dele. Aplique, e o terminal leva alguns segundos na tabela, como a AWS.',
      },
    ],
    asides: [
      {
        title: { en: 'What is DynamoDB?', pt: 'O que é o DynamoDB?' },
        body: [
          {
            en: 'A key value and document database that AWS runs for you: no instance to size, no disk to grow, reads in a few milliseconds at any scale. You trade SQL joins for speed and simplicity, so you design the keys around how you will read the data.',
            pt: 'Um banco de dados de chave e valor e de documentos que a AWS opera para você: nenhuma instância para dimensionar, nenhum disco para aumentar, leituras em poucos milissegundos em qualquer escala. Você troca os joins do SQL por velocidade e simplicidade, então desenha as chaves em torno de como vai ler os dados.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'On demand or provisioned?', pt: 'Sob demanda ou provisionado?' },
        body: [
          {
            en: 'Provisioned mode reserves reads and writes per second at a fixed hourly price, cheaper when traffic is steady and known. On demand costs more per request and nothing when idle. Start on demand, and switch when the graphs tell you to. The estimate can\'t price provisioned capacity, by the way: it lists it as not estimated.',
            pt: 'O modo provisionado reserva leituras e escritas por segundo a um preço fixo por hora, mais barato quando o tráfego é estável e conhecido. O sob demanda custa mais por requisição e nada quando parado. Comece sob demanda e mude quando os gráficos mandarem. A estimativa, aliás, não consegue precificar capacidade provisionada: ela aparece sem estimativa.',
          },
        ],
      },
    ],
    start: { 'main.tf': API_MAIN_START, 'function.tf': FUNCTION_PLAN, 'api.tf': API_PLAN },
    solution: API_TABLE,
    goals: [
      {
        id: 'table',
        text: { en: 'A DynamoDB table with a partition key', pt: 'Uma tabela do DynamoDB com uma chave de partição' },
        hint: {
          en: '`resource "aws_dynamodb_table" "items"` with `name = "learn-items"`, `hash_key = "id"` and an `attribute` block with `name = "id"` and `type = "S"`.',
          pt: '`resource "aws_dynamodb_table" "items"` com `name = "learn-items"`, `hash_key = "id"` e um bloco `attribute` com `name = "id"` e `type = "S"`.',
        },
        test: keyDeclared,
      },
      {
        id: 'on-demand',
        text: { en: 'Billed on demand', pt: 'Cobrada sob demanda' },
        hint: {
          en: '`billing_mode = "PAY_PER_REQUEST"`. Without it the table is provisioned, and asks for `read_capacity` and `write_capacity`.',
          pt: '`billing_mode = "PAY_PER_REQUEST"`. Sem isso a tabela é provisionada e pede `read_capacity` e `write_capacity`.',
        },
        test: argIs('aws_dynamodb_table', 'billing_mode', 'PAY_PER_REQUEST'),
      },
      {
        id: 'recovery',
        text: { en: 'It can be restored to any second of the last 35 days', pt: 'Ela pode ser restaurada para qualquer segundo dos últimos 35 dias' },
        hint: {
          en: 'A `point_in_time_recovery` block in the table, with `enabled = true`.',
          pt: 'Um bloco `point_in_time_recovery` na tabela, com `enabled = true`.',
        },
        test: argIs('aws_dynamodb_table', 'point_in_time_recovery.enabled', true),
      },
      {
        id: 'output',
        text: { en: 'An output with the table\'s name', pt: 'Um output com o nome da tabela' },
        hint: {
          en: '`output "table_name" {` with `value = aws_dynamodb_table.items.name`.',
          pt: '`output "table_name" {` com `value = aws_dynamodb_table.items.name`.',
        },
        test: output(undefined, 'aws_dynamodb_table'),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init` (it installs the `archive` provider too, for the next step), `plan` and `apply`.',
          pt: 'No terminal: `init` (ele também instala o provider `archive`, para a próxima etapa), `plan` e `apply`.',
        },
        test: applied('aws_dynamodb_table'),
      },
    ],
    teaches: ['aws_dynamodb_table'],
  },

  /* ------------------------------------------------------------ 7.5 */
  {
    slug: 'api-function',
    code: '7.5',
    kind: 'lesson',
    mode: 'code',
    minutes: 14,
    xp: 110,
    title: { en: 'A function with just enough power', pt: 'Uma função com o poder na medida' },
    summary: {
      en: 'A Lambda function that reads the table, with a role scoped to it and logs that expire.',
      pt: 'Uma função Lambda que lê a tabela, com um perfil restrito a ela e logs que expiram.',
    },
    body: [
      {
        en: 'Now the code. A *Lambda function* is code AWS runs each time something calls it, billed by the millisecond. The app team already left theirs in `function.tf`: a small Node.js handler, zipped by the `archive_file` data source. Your job is everything around it.',
        pt: 'Agora, o código. Uma *função Lambda* é código que a AWS executa cada vez que algo a chama, cobrado por milissegundo. O time da aplicação já deixou o dele no `function.tf`: um pequeno handler em Node.js, compactado pela fonte de dados `archive_file`. A sua parte é tudo em volta dele.',
      },
      {
        en: 'The function runs as an IAM role, like the server in level 3, but trusted by `lambda.amazonaws.com`. Its permissions are the heart of this lesson: the handler uses one table, so the policy names that table\'s ARN and the few actions it needs. No `dynamodb:*`, no `"*"` resource. If the code is ever hijacked, the damage stops at one table.',
        pt: 'A função roda como um perfil do IAM, como o servidor do nível 3, mas com confiança em `lambda.amazonaws.com`. As permissões são o coração desta lição: o handler usa uma tabela, então a política cita o ARN dessa tabela e as poucas ações de que ele precisa. Nada de `dynamodb:*`, nada de recurso `"*"`. Se o código um dia for sequestrado, o estrago para numa tabela.',
      },
      {
        en: 'How does the code find the table? Not by a name pasted into the JavaScript: an `environment` block sets `TABLE_NAME = aws_dynamodb_table.items.name`, and the handler reads `process.env.TABLE_NAME`. Rename the table in Terraform and the function follows on the next apply.',
        pt: 'Como o código encontra a tabela? Não por um nome colado no JavaScript: um bloco `environment` define `TABLE_NAME = aws_dynamodb_table.items.name`, e o handler lê `process.env.TABLE_NAME`. Renomeie a tabela no Terraform e a função acompanha no próximo apply.',
      },
      {
        en: 'Last, the logs. Lambda writes to a CloudWatch log group, and a group it creates by itself keeps every line forever, billed forever. Create it yourself with `retention_in_days = 14` and point the function at it with `logging_config`. Then follow the lines out of the function on the canvas: the role, the table, the log group, the zip. Each one is a reference you typed.',
        pt: 'Por último, os logs. A Lambda escreve num log group do CloudWatch, e um grupo que ela cria sozinha guarda cada linha para sempre, cobrada para sempre. Crie o grupo você mesmo com `retention_in_days = 14` e aponte a função para ele com `logging_config`. Depois siga no canvas as linhas que saem da função: o perfil, a tabela, o log group, o zip. Cada uma é uma referência que você digitou.',
      },
    ],
    asides: [
      {
        title: { en: 'What is Lambda?', pt: 'O que é a Lambda?' },
        body: [
          {
            en: 'AWS Lambda runs a function when an event arrives (an HTTP request, a file in a bucket, a message in a queue) and stops it when it is done. No server to keep up, scaling from zero to thousands of copies on its own, and the first million requests of each month are free.',
            pt: 'A AWS Lambda executa uma função quando um evento chega (uma requisição HTTP, um arquivo num bucket, uma mensagem numa fila) e a encerra quando termina. Nenhum servidor para manter, escala de zero a milhares de cópias sozinha, e o primeiro milhão de requisições de cada mês é gratuito.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'Why not `AmazonDynamoDBFullAccess`?', pt: 'Por que não `AmazonDynamoDBFullAccess`?' },
        body: [
          {
            en: 'Attaching that managed policy works on the first try, which is why it is everywhere. It also lets the function delete every table in the account. Least privilege is a few more lines once, and a much smaller incident later.',
            pt: 'Anexar essa política gerenciada funciona de primeira, e é por isso que ela está em todo lugar. Ela também deixa a função excluir todas as tabelas da conta. O privilégio mínimo custa algumas linhas a mais uma vez, e um incidente bem menor depois.',
          },
        ],
      },
      {
        title: { en: 'Where does the zip go?', pt: 'Para onde vai o zip?' },
        body: [
          {
            en: 'On your machine, `archive_file` writes `build/api.zip` during the plan, and `source_code_hash` changes whenever the handler does, so Terraform knows to upload a new version.',
            pt: 'Na sua máquina, o `archive_file` escreve `build/api.zip` durante o plan, e o `source_code_hash` muda sempre que o handler muda, então o Terraform sabe que precisa enviar uma versão nova.',
          },
        ],
      },
    ],
    start: API_TABLE,
    solution: API_FUNCTION,
    goals: [
      {
        id: 'role',
        text: { en: 'A function that runs as a role Lambda may assume', pt: 'Uma função que roda como um perfil que a Lambda pode assumir' },
        hint: {
          en: '`resource "aws_iam_role" "api"` whose `assume_role_policy` trusts `lambda.amazonaws.com`, as in level 3 with `lambda` for `ec2`. Then `aws_lambda_function` with `function_name = "learn-api"`, `role = aws_iam_role.api.arn`, `runtime = "nodejs20.x"`, `handler = "index.handler"`, `filename = data.archive_file.api.output_path` and `source_code_hash = data.archive_file.api.output_base64sha256`.',
          pt: '`resource "aws_iam_role" "api"` cuja `assume_role_policy` confia em `lambda.amazonaws.com`, como no nível 3 com `lambda` no lugar de `ec2`. Depois `aws_lambda_function` com `function_name = "learn-api"`, `role = aws_iam_role.api.arn`, `runtime = "nodejs20.x"`, `handler = "index.handler"`, `filename = data.archive_file.api.output_path` e `source_code_hash = data.archive_file.api.output_base64sha256`.',
        },
        test: functionWithRole,
      },
      {
        id: 'scoped',
        text: { en: 'Its permissions name the table, and nothing wider', pt: 'As permissões dela citam a tabela, e nada mais amplo' },
        hint: {
          en: 'An `aws_iam_role_policy` with `role = aws_iam_role.api.id` and a statement that allows `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:DeleteItem` and `dynamodb:Scan` with `Resource = aws_dynamodb_table.items.arn`.',
          pt: 'Um `aws_iam_role_policy` com `role = aws_iam_role.api.id` e uma instrução que permite `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:DeleteItem` e `dynamodb:Scan` com `Resource = aws_dynamodb_table.items.arn`.',
        },
        test: scopedToTable,
      },
      {
        id: 'env',
        text: { en: 'The function finds the table through an environment variable', pt: 'A função encontra a tabela por uma variável de ambiente' },
        hint: {
          en: 'In the function, an `environment` block with `variables = { TABLE_NAME = aws_dynamodb_table.items.name }`.',
          pt: 'Na função, um bloco `environment` com `variables = { TABLE_NAME = aws_dynamodb_table.items.name }`.',
        },
        test: tableInEnvironment,
      },
      {
        id: 'logs',
        text: { en: 'Its logs go to a log group that forgets them in time', pt: 'Os logs dela vão para um log group que os esquece com o tempo' },
        hint: {
          en: '`resource "aws_cloudwatch_log_group" "api"` with `name = "/aws/lambda/learn-api"` and `retention_in_days = 14`. In the function, a `logging_config` block with `log_format = "Text"` and `log_group = aws_cloudwatch_log_group.api.name`. Let the role write there too: `logs:CreateLogStream` and `logs:PutLogEvents` on `"${aws_cloudwatch_log_group.api.arn}:*"`.',
          pt: '`resource "aws_cloudwatch_log_group" "api"` com `name = "/aws/lambda/learn-api"` e `retention_in_days = 14`. Na função, um bloco `logging_config` com `log_format = "Text"` e `log_group = aws_cloudwatch_log_group.api.name`. Deixe o perfil escrever lá também: `logs:CreateLogStream` e `logs:PutLogEvents` em `"${aws_cloudwatch_log_group.api.arn}:*"`.',
        },
        test: functionLogs,
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `plan`, then `apply`. The zip is read first, the role and the log group come before the function, and the policy waits for the table and the log group.',
          pt: 'No terminal: `plan`, depois `apply`. O zip é lido primeiro, o perfil e o log group vêm antes da função, e a política espera pela tabela e pelo log group.',
        },
        test: applied('aws_lambda_function'),
      },
    ],
    teaches: ['aws_lambda_function', 'aws_iam_role', 'aws_iam_role_policy', 'aws_cloudwatch_log_group'],
  },

  /* ------------------------------------------------------------ 7.6 */
  {
    slug: 'api-gateway',
    code: '7.6',
    kind: 'lesson',
    mode: 'code',
    minutes: 13,
    xp: 100,
    title: { en: 'An API on the internet', pt: 'Uma API na internet' },
    summary: {
      en: 'An HTTP API in front of the function: a route, a stage, a permission and a URL.',
      pt: 'Uma API HTTP na frente da função: uma rota, um estágio, uma permissão e uma URL.',
    },
    body: [
      {
        en: 'The function works, and nobody can call it. *API Gateway* is the front door: it takes HTTPS requests from the internet, matches each one to a route and hands it to the function. Its HTTP APIs are the lean kind, billed per million requests.',
        pt: 'A função funciona, e ninguém consegue chamá-la. O *API Gateway* é a porta de entrada: recebe requisições HTTPS da internet, associa cada uma a uma rota e a entrega à função. As APIs HTTP dele são o tipo enxuto, cobrado por milhão de requisições.',
      },
      {
        en: 'Four pieces, in `api.tf`. The `aws_apigatewayv2_api`, with `protocol_type = "HTTP"`. An *integration* of type `AWS_PROXY` whose `integration_uri` is the function\'s `invoke_arn`. A *route*, `GET /items`, whose `target` is the integration. And a *stage* named `$default` with `auto_deploy = true`, so every change goes live by itself.',
        pt: 'Quatro peças, no `api.tf`. O `aws_apigatewayv2_api`, com `protocol_type = "HTTP"`. Uma *integração* do tipo `AWS_PROXY` cujo `integration_uri` é o `invoke_arn` da função. Uma *rota*, `GET /items`, cujo `target` é a integração. E um *estágio* chamado `$default` com `auto_deploy = true`, para que cada mudança entre no ar sozinha.',
      },
      {
        en: 'The fifth piece is the one everybody forgets. A Lambda function refuses every caller it wasn\'t told about, so give it an `aws_lambda_permission` for `apigateway.amazonaws.com`, with a `source_arn` built from the API\'s `execution_arn`: this API may call it, not every API in the world.',
        pt: 'A quinta peça é a que todo mundo esquece. Uma função Lambda recusa todo chamador de que não foi avisada, então dê a ela um `aws_lambda_permission` para `apigateway.amazonaws.com`, com um `source_arn` montado a partir do `execution_arn` da API: esta API pode chamá-la, e não qualquer API do mundo.',
      },
      {
        en: 'Watch the canvas: the integration, the route and the stage land inside the API\'s box, and a line runs from the integration to the function and on to the table. Apply, and `api_url` sums up the project in one line. Then open the cost estimate: four lines billed by use and not one fixed dollar. An API nobody calls costs nothing.',
        pt: 'Olhe o canvas: a integração, a rota e o estágio caem dentro da caixa da API, e uma linha vai da integração até a função e dela até a tabela. Aplique, e o `api_url` resume o projeto numa linha. Depois abra a estimativa de custo: quatro linhas cobradas por uso e nenhum dólar fixo. Uma API que ninguém chama não custa nada.',
      },
    ],
    asides: [
      {
        title: { en: 'What is API Gateway?', pt: 'O que é o API Gateway?' },
        body: [
          {
            en: 'A managed front door for APIs: it terminates HTTPS, routes requests, can check tokens and limit request rates, and scales without you. *HTTP APIs* do the common case cheaply; *REST APIs* add features such as request validation and API keys, at a higher price.',
            pt: 'Uma porta de entrada gerenciada para APIs: ela cuida do HTTPS, roteia as requisições, pode verificar tokens e limitar a taxa de requisições, e escala sem você. As *HTTP APIs* fazem o caso comum por pouco; as *REST APIs* acrescentam recursos como validação de requisições e chaves de API, por um preço maior.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'What is `$default`?', pt: 'O que é `$default`?' },
        body: [
          {
            en: 'A stage is a published version of the API. The stage named `$default` is served at the root of the API\'s address, with no stage name in the path. Teams that want `/v1` and `/v2` side by side create named stages instead.',
            pt: 'Um estágio é uma versão publicada da API. O estágio chamado `$default` é servido na raiz do endereço da API, sem nome de estágio no caminho. Times que querem `/v1` e `/v2` lado a lado criam estágios com nome.',
          },
        ],
      },
      {
        title: { en: 'Calling it for real', pt: 'Chamando de verdade' },
        body: [
          {
            en: 'After a real apply, `curl` the `api_url` output and you get the items as JSON: `[]` for an empty table. Add an item in the DynamoDB console, call it again, and there it is.',
            pt: 'Depois de um apply de verdade, rode `curl` no output `api_url` e você recebe os itens em JSON: `[]` para uma tabela vazia. Adicione um item no console do DynamoDB, chame de novo, e lá está ele.',
          },
        ],
      },
    ],
    start: API_FUNCTION,
    solution: API_GATEWAY,
    goals: [
      {
        id: 'api',
        text: { en: 'An HTTP API with a stage that deploys itself', pt: 'Uma API HTTP com um estágio que se publica sozinho' },
        hint: {
          en: '`resource "aws_apigatewayv2_api" "api"` with `name` and `protocol_type = "HTTP"`. Then an `aws_apigatewayv2_stage` with `api_id = aws_apigatewayv2_api.api.id`, `name = "$default"` and `auto_deploy = true`.',
          pt: '`resource "aws_apigatewayv2_api" "api"` com `name` e `protocol_type = "HTTP"`. Depois um `aws_apigatewayv2_stage` com `api_id = aws_apigatewayv2_api.api.id`, `name = "$default"` e `auto_deploy = true`.',
        },
        test: httpApiLive,
      },
      {
        id: 'route',
        text: { en: 'A route that reaches the function', pt: 'Uma rota que chega à função' },
        hint: {
          en: 'An `aws_apigatewayv2_integration` with the `api_id`, `integration_type = "AWS_PROXY"`, `integration_uri = aws_lambda_function.api.invoke_arn` and `payload_format_version = "2.0"`. Then an `aws_apigatewayv2_route` with the `api_id`, `route_key = "GET /items"` and `target = "integrations/${aws_apigatewayv2_integration.items.id}"`.',
          pt: 'Um `aws_apigatewayv2_integration` com o `api_id`, `integration_type = "AWS_PROXY"`, `integration_uri = aws_lambda_function.api.invoke_arn` e `payload_format_version = "2.0"`. Depois um `aws_apigatewayv2_route` com o `api_id`, `route_key = "GET /items"` e `target = "integrations/${aws_apigatewayv2_integration.items.id}"`.',
        },
        test: routeToFunction,
      },
      {
        id: 'permission',
        text: { en: 'The function lets this API call it, and no other', pt: 'A função deixa esta API chamá-la, e nenhuma outra' },
        hint: {
          en: '`resource "aws_lambda_permission" "api"` with `action = "lambda:InvokeFunction"`, `function_name = aws_lambda_function.api.function_name`, `principal = "apigateway.amazonaws.com"` and `source_arn = "${aws_apigatewayv2_api.api.execution_arn}/*/*"`.',
          pt: '`resource "aws_lambda_permission" "api"` com `action = "lambda:InvokeFunction"`, `function_name = aws_lambda_function.api.function_name`, `principal = "apigateway.amazonaws.com"` e `source_arn = "${aws_apigatewayv2_api.api.execution_arn}/*/*"`.',
        },
        test: apiMayInvoke,
      },
      {
        id: 'url',
        text: { en: 'An output with the address to call', pt: 'Um output com o endereço para chamar' },
        hint: {
          en: '`output "api_url" {` with `value = "${aws_apigatewayv2_api.api.api_endpoint}/items"`.',
          pt: '`output "api_url" {` com `value = "${aws_apigatewayv2_api.api.api_endpoint}/items"`.',
        },
        test: any(output(undefined, 'aws_apigatewayv2_api'), output(undefined, 'aws_apigatewayv2_stage')),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `plan`, then `apply`. The route waits for the integration, which waits for the function.',
          pt: 'No terminal: `plan`, depois `apply`. A rota espera pela integração, que espera pela função.',
        },
        test: all(applied('aws_apigatewayv2_route'), applied('aws_lambda_permission')),
      },
    ],
    teaches: ['aws_apigatewayv2_api', 'aws_apigatewayv2_integration', 'aws_apigatewayv2_route', 'aws_apigatewayv2_stage', 'aws_lambda_permission'],
  },

  /* ------------------------------------------------------------ 7.7 */
  {
    slug: 'tier-network',
    code: '7.7',
    kind: 'lesson',
    mode: 'code',
    minutes: 13,
    xp: 100,
    title: { en: 'A network for three tiers', pt: 'Uma rede para três camadas' },
    summary: {
      en: 'Project C begins: public and private subnets in two zones, and a NAT gateway behind a switch.',
      pt: 'Começa o projeto C: sub-redes públicas e privadas em duas zonas, e um NAT gateway atrás de um interruptor.',
    },
    body: [
      {
        en: 'Project C is the architecture behind countless web apps: a load balancer facing the internet, app servers behind it, a database behind them. Three tiers, each reachable only from the one in front. Three files wait for them: `network.tf` (here), `app.tf` and `database.tf`.',
        pt: 'O projeto C é a arquitetura por trás de incontáveis aplicações web: um balanceador de carga voltado para a internet, servidores de aplicação atrás dele, um banco de dados atrás deles. Três camadas, cada uma acessível só pela que está na frente. Três arquivos esperam por elas: `network.tf` (aqui), `app.tf` e `database.tf`.',
      },
      {
        en: 'Everything here spans two availability zones, so losing one data center doesn\'t take the app down. The VPC and its internet gateway are in place. Add a public and a private subnet in each zone: `count = length(local.zones)` and `cidrsubnet` make all four from two short blocks. Public ones route `0.0.0.0/0` to the gateway; private ones get a route table of their own, without that route.',
        pt: 'Tudo aqui ocupa duas zonas de disponibilidade, para que a perda de um data center não derrube a aplicação. A VPC e o internet gateway já estão lá. Adicione uma sub-rede pública e uma privada em cada zona: `count = length(local.zones)` e `cidrsubnet` criam as quatro a partir de dois blocos curtos. As públicas roteiam `0.0.0.0/0` para o gateway; as privadas ganham uma tabela de rotas só delas, sem essa rota.',
      },
      {
        en: 'Private servers sometimes need to reach out, for updates or an outside API, without anyone reaching in. That is a NAT gateway, and it costs about $33 a month. Put it behind a `bool` variable, off by default, as in level 5: the Elastic IP, the gateway and the private route, each with `count = var.enable_nat ? 1 : 0`.',
        pt: 'Servidores privados às vezes precisam sair, para atualizações ou uma API externa, sem que ninguém entre. Isso é um NAT gateway, e ele custa cerca de US$ 33 por mês. Coloque-o atrás de uma variável `bool`, desligada por padrão, como no nível 5: o Elastic IP, o gateway e a rota privada, cada um com `count = var.enable_nat ? 1 : 0`.',
      },
      {
        en: 'Turn on the security lens: two subnets marked public, two private, two zones. Flip the default to `true` and `plan`: three resources appear. Flip it back: they vanish, and the cost estimate lists the NAT gateway as conditional. Next step, you will see the app doesn\'t even need it.',
        pt: 'Ligue a lente de segurança: duas sub-redes marcadas como públicas, duas como privadas, duas zonas. Mude o padrão para `true` e rode `plan`: três recursos aparecem. Volte: eles somem, e a estimativa de custo lista o NAT gateway como condicional. Na próxima etapa você vai ver que a aplicação nem precisa dele.',
      },
    ],
    asides: [
      {
        title: { en: 'Why `count.index + 10`?', pt: 'Por que `count.index + 10`?' },
        body: [
          {
            en: 'The public subnets take `10.0.0.0/24` and `10.0.1.0/24`. Starting the private ones at `10.0.10.0/24` leaves room for more zones without renumbering anything, and makes addresses easy to read: from `10.0.10.0` up, it is private.',
            pt: 'As sub-redes públicas ficam com `10.0.0.0/24` e `10.0.1.0/24`. Começar as privadas em `10.0.10.0/24` deixa espaço para mais zonas sem renumerar nada e deixa os endereços fáceis de ler: de `10.0.10.0` para cima, é privado.',
          },
        ],
      },
      {
        title: { en: 'One NAT gateway, or one per zone?', pt: 'Um NAT gateway, ou um por zona?' },
        body: [
          {
            en: 'Production networks often run one NAT gateway per zone, so losing a zone doesn\'t cut the other zone\'s way out. That doubles the bill. One gateway is a fair trade for a project like this, and the switch makes the choice visible in the code.',
            pt: 'Redes de produção muitas vezes têm um NAT gateway por zona, para que a perda de uma zona não corte a saída da outra. Isso dobra a conta. Um gateway só é uma troca justa para um projeto como este, e o interruptor deixa a escolha visível no código.',
          },
        ],
      },
    ],
    start: TIER_START,
    solution: TIER_NETWORK,
    goals: [
      {
        id: 'public',
        text: { en: 'Public subnets in two zones, routed to the internet gateway', pt: 'Sub-redes públicas em duas zonas, roteadas para o internet gateway' },
        hint: {
          en: '`resource "aws_subnet" "public"` with `count = length(local.zones)`, `vpc_id = aws_vpc.main.id`, `cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)`, `availability_zone = local.zones[count.index]` and `map_public_ip_on_launch = true`. Then a route table with `0.0.0.0/0` to the gateway, and an `aws_route_table_association` for each subnet (`count` again).',
          pt: '`resource "aws_subnet" "public"` com `count = length(local.zones)`, `vpc_id = aws_vpc.main.id`, `cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)`, `availability_zone = local.zones[count.index]` e `map_public_ip_on_launch = true`. Depois uma tabela de rotas com `0.0.0.0/0` para o gateway e um `aws_route_table_association` para cada sub-rede (`count` de novo).',
        },
        test: subnetsAcrossZones('public'),
      },
      {
        id: 'private',
        text: { en: 'Private subnets in two zones', pt: 'Sub-redes privadas em duas zonas' },
        hint: {
          en: 'The same with `aws_subnet "private"`, `count.index + 10` in `cidrsubnet` and no public IPs. Give them an `aws_route_table` of their own, with no `route` to the gateway, and associate each one.',
          pt: 'O mesmo com `aws_subnet "private"`, `count.index + 10` no `cidrsubnet` e sem IPs públicos. Dê a elas um `aws_route_table` só delas, sem `route` para o gateway, e associe cada uma.',
        },
        test: subnetsAcrossZones('private'),
      },
      {
        id: 'switch',
        text: { en: 'A NAT gateway behind a `bool` switch, off by default', pt: 'Um NAT gateway atrás de um interruptor `bool`, desligado por padrão' },
        hint: {
          en: '`variable "enable_nat" {` with `type = bool` and `default = false`. An `aws_eip` with `domain = "vpc"` and an `aws_nat_gateway` in `aws_subnet.public[0].id`, both with `count = var.enable_nat ? 1 : 0`; the gateway takes `allocation_id = aws_eip.nat[0].id`.',
          pt: '`variable "enable_nat" {` com `type = bool` e `default = false`. Um `aws_eip` com `domain = "vpc"` e um `aws_nat_gateway` em `aws_subnet.public[0].id`, os dois com `count = var.enable_nat ? 1 : 0`; o gateway recebe `allocation_id = aws_eip.nat[0].id`.',
        },
        test: all(variable(undefined, { type: 'bool' }), optional('aws_nat_gateway'), offByDefault('aws_nat_gateway')),
      },
      {
        id: 'route',
        text: { en: 'The private subnets\' way out goes through it', pt: 'A saída das sub-redes privadas passa por ele' },
        hint: {
          en: 'An `aws_route` on the private route table, with the same `count`, `destination_cidr_block = "0.0.0.0/0"` and `nat_gateway_id = aws_nat_gateway.main[0].id`.',
          pt: 'Um `aws_route` na tabela de rotas privada, com o mesmo `count`, `destination_cidr_block = "0.0.0.0/0"` e `nat_gateway_id = aws_nat_gateway.main[0].id`.',
        },
        test: natRouteForPrivate,
      },
      {
        id: 'apply',
        text: { en: 'Apply it, with the switch off', pt: 'Aplique, com o interruptor desligado' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. With `enable_nat` off, the plan creates the network and nothing that bills by the hour.',
          pt: 'No terminal: `init`, `plan`, `apply`. Com `enable_nat` desligado, o plano cria a rede e nada que seja cobrado por hora.',
        },
        test: all(applied('aws_subnet'), applied('aws_route_table_association')),
      },
    ],
    teaches: ['aws_subnet', 'aws_route_table', 'aws_route_table_association', 'aws_eip', 'aws_nat_gateway', 'aws_route'],
  },

  /* ------------------------------------------------------------ 7.8 */
  {
    slug: 'tier-app',
    code: '7.8',
    kind: 'lesson',
    mode: 'code',
    minutes: 15,
    xp: 120,
    title: { en: 'The app tier', pt: 'A camada de aplicação' },
    summary: {
      en: 'A load balancer in the public subnets, two servers in the private ones, and security groups chained between them.',
      pt: 'Um balanceador de carga nas sub-redes públicas, dois servidores nas privadas e grupos de segurança encadeados entre eles.',
    },
    body: [
      {
        en: 'Now the app, in `app.tf`. Two servers in the private subnets, one per zone, so neither has a public address. In front of them, an *Application Load Balancer* in the public subnets: the only thing the internet can see. It spreads requests across the servers, and stops sending to one that fails its health check.',
        pt: 'Agora a aplicação, no `app.tf`. Dois servidores nas sub-redes privadas, um por zona, então nenhum tem endereço público. Na frente deles, um *Application Load Balancer* nas sub-redes públicas: a única coisa que a internet enxerga. Ele distribui as requisições entre os servidores e para de mandar para um que falha na verificação de saúde.',
      },
      {
        en: 'The servers: `count = length(local.zones)`, `subnet_id = aws_subnet.private[count.index].id`, the Amazon Linux image from a `data "aws_ami"` lookup, IMDSv2 required. Their `user_data` writes a page and serves it with the web server built into Python, on port 80. It needs nothing from the internet, so the NAT switch stays off and the bill stays small.',
        pt: 'Os servidores: `count = length(local.zones)`, `subnet_id = aws_subnet.private[count.index].id`, a imagem do Amazon Linux numa consulta `data "aws_ami"`, IMDSv2 obrigatório. O `user_data` deles escreve uma página e a serve com o servidor web que vem no Python, na porta 80. Ele não precisa de nada da internet, então o interruptor do NAT fica desligado e a conta fica pequena.',
      },
      {
        en: 'The load balancer needs three companions: a *target group* that lists the servers and checks `/` on each one, an `aws_lb_target_group_attachment` per server, and a *listener* on port 80 that forwards to the group. Then an output with its `dns_name`: your app\'s address.',
        pt: 'O balanceador precisa de três companheiros: um *grupo de destino* que lista os servidores e verifica `/` em cada um, um `aws_lb_target_group_attachment` por servidor e um *listener* na porta 80 que encaminha para o grupo. Depois, um output com o `dns_name` dele: o endereço da sua aplicação.',
      },
      {
        en: 'Now what makes it secure: chained security groups. The load balancer\'s group lets port 80 in from `0.0.0.0/0`. The servers\' group lets port 80 in from *the load balancer\'s group*, `security_groups = [aws_security_group.alb.id]`, not from a range of addresses. Turn on the security lens: the load balancer is public on 80, the servers are private, and the only way in runs through the front door.',
        pt: 'Agora, o que deixa tudo seguro: grupos de segurança encadeados. O grupo do balanceador deixa a porta 80 entrar vinda de `0.0.0.0/0`. O grupo dos servidores deixa a porta 80 entrar vinda *do grupo do balanceador*, `security_groups = [aws_security_group.alb.id]`, e não de um intervalo de endereços. Ligue a lente de segurança: o balanceador é público na 80, os servidores são privados, e o único caminho de entrada passa pela porta da frente.',
      },
      {
        en: 'Apply and read the terminal: the load balancer takes about three minutes of `Still creating...`, as AWS does. The security panel gives an A, with one low finding: the load balancer speaks plain HTTP. Keep it in mind, the challenge fixes it.',
        pt: 'Aplique e leia o terminal: o balanceador leva uns três minutos de `Still creating...`, como na AWS. O painel de segurança dá A, com um achado de severidade baixa: o balanceador fala HTTP sem criptografia. Guarde isso, o desafio corrige.',
      },
    ],
    asides: [
      {
        title: { en: 'What is a load balancer?', pt: 'O que é um balanceador de carga?' },
        body: [
          {
            en: 'One address in front of many servers. It receives every request and passes each one to a healthy server, so you can add, replace or lose a server without visitors noticing. An *Application* Load Balancer understands HTTP: it can route by path or host name, and redirect.',
            pt: 'Um endereço na frente de vários servidores. Ele recebe cada requisição e a passa para um servidor saudável, então você pode adicionar, trocar ou perder um servidor sem que os visitantes percebam. Um *Application* Load Balancer entende HTTP: ele roteia por caminho ou por nome de host, e redireciona.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'Why does the load balancer need an egress rule?', pt: 'Por que o balanceador precisa de uma regra de saída?' },
        body: [
          {
            en: 'A security group made by Terraform starts with no outbound rule at all, unlike one made in the console. The load balancer has to reach the servers, so its group lets port 80 out to the VPC\'s range.',
            pt: 'Um grupo de segurança criado pelo Terraform começa sem nenhuma regra de saída, ao contrário de um criado no console. O balanceador precisa alcançar os servidores, então o grupo dele deixa a porta 80 sair para o intervalo da VPC.',
          },
        ],
      },
      {
        title: { en: 'Two instances, or an auto scaling group?', pt: 'Duas instâncias, ou um grupo de auto scaling?' },
        body: [
          {
            en: 'Production apps usually run an *auto scaling group* from a *launch template*: the template describes one server (image, type, `user_data`, security group), and the group keeps `min_size` of them alive across `vpc_zone_identifier`, replacing one that dies and adding more under load. Its `target_group_arns` registers each new server with the load balancer by itself.',
            pt: 'Aplicações de produção costumam rodar um *grupo de auto scaling* a partir de um *launch template*: o template descreve um servidor (imagem, tipo, `user_data`, grupo de segurança), e o grupo mantém `min_size` deles vivos nas `vpc_zone_identifier`, substituindo o que morre e adicionando mais sob carga. O `target_group_arns` dele registra cada servidor novo no balanceador sozinho.',
          },
          {
            en: 'This project keeps two plain instances, so every server is a box you can point at on the canvas. Prefer the group? The goals accept it, with `min_size = 2` in the private subnets, and the cost estimate prices its fleet.',
            pt: 'Este projeto fica com duas instâncias simples, para que cada servidor seja uma caixa que você aponta no canvas. Prefere o grupo? Os objetivos aceitam, com `min_size = 2` nas sub-redes privadas, e a estimativa de custo precifica a frota dele.',
          },
        ],
      },
    ],
    start: TIER_NETWORK,
    solution: TIER_APP,
    goals: [
      {
        id: 'alb',
        text: { en: 'A load balancer in the public subnets of both zones', pt: 'Um balanceador de carga nas sub-redes públicas das duas zonas' },
        hint: {
          en: '`resource "aws_lb" "app"` with `load_balancer_type = "application"`, `subnets = aws_subnet.public[*].id` and `security_groups = [aws_security_group.alb.id]`.',
          pt: '`resource "aws_lb" "app"` com `load_balancer_type = "application"`, `subnets = aws_subnet.public[*].id` e `security_groups = [aws_security_group.alb.id]`.',
        },
        test: loadBalancerPublic,
      },
      {
        id: 'servers',
        text: { en: 'Two servers in the private subnets, one per zone', pt: 'Dois servidores nas sub-redes privadas, um por zona' },
        hint: {
          en: 'A `data "aws_ami" "al2023"` lookup as in level 3, then `resource "aws_instance" "app"` with `count = length(local.zones)`, `ami = data.aws_ami.al2023.id`, `instance_type = "t3.micro"`, `subnet_id = aws_subnet.private[count.index].id` and `metadata_options { http_tokens = "required" }`.',
          pt: 'Uma consulta `data "aws_ami" "al2023"` como no nível 3, depois `resource "aws_instance" "app"` com `count = length(local.zones)`, `ami = data.aws_ami.al2023.id`, `instance_type = "t3.micro"`, `subnet_id = aws_subnet.private[count.index].id` e `metadata_options { http_tokens = "required" }`.',
        },
        test: appServersIn('private'),
      },
      {
        id: 'health',
        text: { en: 'A target group that checks the servers\' health, with both registered', pt: 'Um grupo de destino que verifica a saúde dos servidores, com os dois registrados' },
        hint: {
          en: 'An `aws_lb_target_group` with `port = 80`, `protocol = "HTTP"`, `vpc_id = aws_vpc.main.id` and a `health_check` block with `path = "/"`. Then an `aws_lb_target_group_attachment` with `count = length(local.zones)`, `target_group_arn = aws_lb_target_group.app.arn` and `target_id = aws_instance.app[count.index].id`.',
          pt: 'Um `aws_lb_target_group` com `port = 80`, `protocol = "HTTP"`, `vpc_id = aws_vpc.main.id` e um bloco `health_check` com `path = "/"`. Depois um `aws_lb_target_group_attachment` com `count = length(local.zones)`, `target_group_arn = aws_lb_target_group.app.arn` e `target_id = aws_instance.app[count.index].id`.',
        },
        test: healthChecked,
      },
      {
        id: 'listener',
        text: { en: 'A listener on port 80 that forwards to the group', pt: 'Um listener na porta 80 que encaminha para o grupo' },
        hint: {
          en: 'An `aws_lb_listener` with `load_balancer_arn = aws_lb.app.arn`, `port = 80`, `protocol = "HTTP"` and a `default_action` block with `type = "forward"` and `target_group_arn = aws_lb_target_group.app.arn`.',
          pt: 'Um `aws_lb_listener` com `load_balancer_arn = aws_lb.app.arn`, `port = 80`, `protocol = "HTTP"` e um bloco `default_action` com `type = "forward"` e `target_group_arn = aws_lb_target_group.app.arn`.',
        },
        test: forwards('HTTP'),
      },
      {
        id: 'chain',
        text: { en: 'The servers take traffic from the load balancer only', pt: 'Os servidores só recebem tráfego do balanceador' },
        hint: {
          en: 'The load balancer\'s group: `ingress` on 80 from `cidr_blocks = ["0.0.0.0/0"]`, `egress` on 80 to `[aws_vpc.main.cidr_block]`. The servers\' group: `ingress` on 80 with `security_groups = [aws_security_group.alb.id]` and no `cidr_blocks`, and `vpc_security_group_ids = [aws_security_group.app.id]` on the instances.',
          pt: 'O grupo do balanceador: `ingress` na 80 vindo de `cidr_blocks = ["0.0.0.0/0"]`, `egress` na 80 para `[aws_vpc.main.cidr_block]`. O grupo dos servidores: `ingress` na 80 com `security_groups = [aws_security_group.alb.id]` e sem `cidr_blocks`, e `vpc_security_group_ids = [aws_security_group.app.id]` nas instâncias.',
        },
        test: all(onlyFrom(APP_TYPES, ['aws_lb']), reachableOn('aws_lb', [80])),
      },
      {
        id: 'apply',
        text: { en: 'Apply it, with an output for the app\'s address', pt: 'Aplique, com um output para o endereço da aplicação' },
        hint: {
          en: '`output "app_url" {` with `value = "http://${aws_lb.app.dns_name}"`, then `apply`, and give the load balancer its three minutes.',
          pt: '`output "app_url" {` com `value = "http://${aws_lb.app.dns_name}"`, depois `apply`, e dê ao balanceador os três minutos dele.',
        },
        test: all(output(undefined, 'aws_lb'), applied('aws_lb'), applied('aws_instance')),
      },
    ],
    teaches: ['aws_lb', 'aws_lb_target_group', 'aws_lb_listener', 'aws_lb_target_group_attachment', 'aws_security_group', 'aws_instance', 'aws_launch_template', 'aws_autoscaling_group', 'data.aws_ami'],
  },

  /* ------------------------------------------------------------ 7.9 */
  {
    slug: 'tier-database',
    code: '7.9',
    kind: 'lesson',
    mode: 'code',
    minutes: 12,
    xp: 110,
    title: { en: 'The data tier', pt: 'A camada de dados' },
    summary: {
      en: 'PostgreSQL in the private subnets: encrypted, reachable from the app alone, with no password in the code.',
      pt: 'PostgreSQL nas sub-redes privadas: criptografado, acessível só pela aplicação, sem senha no código.',
    },
    body: [
      {
        en: 'The last tier, in `database.tf`: PostgreSQL on RDS, the managed databases of AWS. AWS patches it, backs it up and swaps the disk when it fails; you choose where it lives and who may talk to it. Here: the private subnets, and the app servers, nobody else.',
        pt: 'A última camada, no `database.tf`: PostgreSQL no RDS, os bancos de dados gerenciados da AWS. A AWS atualiza, faz backup e troca o disco quando ele falha; você escolhe onde ele mora e quem pode falar com ele. Aqui: as sub-redes privadas e os servidores da aplicação, mais ninguém.',
      },
      {
        en: 'An RDS database is placed through a *DB subnet group*: list the private subnets of both zones in an `aws_db_subnet_group` and set `db_subnet_group_name`. Its security group takes port 5432 from the app servers\' group only: the same chaining as the last step, one tier further back.',
        pt: 'Um banco do RDS é posicionado por um *grupo de sub-redes do banco* (DB subnet group): liste as sub-redes privadas das duas zonas num `aws_db_subnet_group` e defina `db_subnet_group_name`. O grupo de segurança dele aceita a porta 5432 só do grupo dos servidores da aplicação: o mesmo encadeamento da etapa anterior, uma camada mais para trás.',
      },
      {
        en: 'Then the safe settings that aren\'t the defaults: `storage_encrypted = true`, `publicly_accessible = false`, backups kept for 7 days. And no password in the code, ever: with `manage_master_user_password = true`, RDS creates the password and keeps it in Secrets Manager, so it never touches your files or your state.',
        pt: 'Depois, as opções seguras que não vêm por padrão: `storage_encrypted = true`, `publicly_accessible = false`, backups guardados por 7 dias. E nenhuma senha no código, nunca: com `manage_master_user_password = true`, o RDS cria a senha e a guarda no Secrets Manager, então ela nunca passa pelos seus arquivos nem pelo seu estado.',
      },
      {
        en: 'Apply and be patient: a database takes about four minutes of `Still creating...`, as long as the CloudFront distribution of project A. Then look at the security lens: only the load balancer faces the internet, and the database answers the app servers alone. Last, the cost estimate: the database is now the biggest line on the bill. Remember that for the challenge.',
        pt: 'Aplique e tenha paciência: um banco leva uns quatro minutos de `Still creating...`, tanto quanto a distribuição do CloudFront do projeto A. Depois olhe a lente de segurança: só o balanceador fica de frente para a internet, e o banco só responde aos servidores da aplicação. Por fim, a estimativa de custo: o banco agora é a maior linha da conta. Lembre-se disso no desafio.',
      },
    ],
    asides: [
      {
        title: { en: 'What is RDS?', pt: 'O que é o RDS?' },
        body: [
          {
            en: 'Amazon RDS runs relational databases (PostgreSQL, MySQL, MariaDB and others) for you: installation, patches, backups, a standby in another zone if you ask for one. You pay by the hour for the instance class and by the GB for the storage.',
            pt: 'O Amazon RDS opera bancos de dados relacionais (PostgreSQL, MySQL, MariaDB e outros) para você: instalação, atualizações, backups, uma cópia reserva em outra zona se você pedir. Você paga por hora pela classe da instância e por GB pelo armazenamento.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'Why `manage_master_user_password`?', pt: 'Por que `manage_master_user_password`?' },
        body: [
          {
            en: 'A password written in the code ends up in Git. A variable marked `sensitive` keeps it out of the plan\'s output, but Terraform still stores it as plain text in the state. Letting RDS manage it keeps it out of both, and your app reads it from Secrets Manager. The goal accepts a `sensitive` variable too.',
            pt: 'Uma senha escrita no código acaba no Git. Uma variável marcada como `sensitive` a esconde da saída do plan, mas o Terraform ainda a guarda em texto puro no estado. Deixar o RDS gerenciá-la a mantém fora dos dois, e a sua aplicação a lê do Secrets Manager. O objetivo também aceita uma variável `sensitive`.',
          },
        ],
      },
      {
        title: { en: 'And `skip_final_snapshot`?', pt: 'E o `skip_final_snapshot`?' },
        body: [
          {
            en: 'When a database is destroyed, RDS takes a last snapshot unless told not to, and wants a name for it. `skip_final_snapshot = true` keeps `destroy` simple in a course. In production, leave it `false` and set `final_snapshot_identifier`.',
            pt: 'Quando um banco é destruído, o RDS tira um último snapshot, a menos que você diga o contrário, e quer um nome para ele. `skip_final_snapshot = true` mantém o `destroy` simples num curso. Em produção, deixe `false` e defina `final_snapshot_identifier`.',
          },
        ],
      },
    ],
    start: TIER_APP,
    solution: TIER_DATABASE,
    goals: [
      {
        id: 'subnets',
        text: { en: 'The database in the private subnets of both zones', pt: 'O banco nas sub-redes privadas das duas zonas' },
        hint: {
          en: '`resource "aws_db_subnet_group" "main"` with `subnet_ids = aws_subnet.private[*].id`. Then `aws_db_instance` with `engine = "postgres"`, `instance_class = "db.t3.small"`, `allocated_storage = 20`, `db_name`, `username` and `db_subnet_group_name = aws_db_subnet_group.main.name`.',
          pt: '`resource "aws_db_subnet_group" "main"` com `subnet_ids = aws_subnet.private[*].id`. Depois `aws_db_instance` com `engine = "postgres"`, `instance_class = "db.t3.small"`, `allocated_storage = 20`, `db_name`, `username` e `db_subnet_group_name = aws_db_subnet_group.main.name`.',
        },
        test: databaseInPrivateSubnets,
      },
      {
        id: 'only-app',
        text: { en: 'Port 5432 open to the app servers\' group only', pt: 'A porta 5432 aberta só para o grupo dos servidores da aplicação' },
        hint: {
          en: 'An `aws_security_group` with an `ingress` on 5432, `protocol = "tcp"` and `security_groups = [aws_security_group.app.id]`, and `vpc_security_group_ids` pointing at it in the database.',
          pt: 'Um `aws_security_group` com um `ingress` na 5432, `protocol = "tcp"` e `security_groups = [aws_security_group.app.id]`, e `vpc_security_group_ids` apontando para ele no banco.',
        },
        test: onlyFrom(['aws_db_instance'], APP_TYPES),
      },
      {
        id: 'safe',
        text: { en: 'Encrypted, and never public', pt: 'Criptografado, e nunca público' },
        hint: {
          en: '`storage_encrypted = true` and `publicly_accessible = false`. Add `backup_retention_period = 7`, and `skip_final_snapshot = true` so `destroy` works in this course.',
          pt: '`storage_encrypted = true` e `publicly_accessible = false`. Adicione `backup_retention_period = 7`, e `skip_final_snapshot = true` para o `destroy` funcionar neste curso.',
        },
        test: all(argIs('aws_db_instance', 'storage_encrypted', true), noFinding(/publicly accessible/)),
      },
      {
        id: 'password',
        text: { en: 'No password in the code', pt: 'Nenhuma senha no código' },
        hint: {
          en: '`manage_master_user_password = true`, with no `password` argument. Or a `variable "db_password"` with `sensitive = true`, passed as `password = var.db_password`.',
          pt: '`manage_master_user_password = true`, sem o argumento `password`. Ou uma `variable "db_password"` com `sensitive = true`, passada como `password = var.db_password`.',
        },
        test: passwordKeptSecret,
      },
      {
        id: 'apply',
        text: { en: 'Apply it, and wait for the database', pt: 'Aplique, e espere pelo banco' },
        hint: {
          en: 'In the terminal: `plan`, then `apply`. The subnet group and the security group come first; the database takes about four minutes.',
          pt: 'No terminal: `plan`, depois `apply`. O grupo de sub-redes e o grupo de segurança vêm primeiro; o banco leva uns quatro minutos.',
        },
        test: applied('aws_db_instance'),
      },
    ],
    teaches: ['aws_db_instance', 'aws_db_subnet_group'],
  },

  /* ------------------------------------------------------------ C7 */
  {
    slug: 'challenge-secure-three-tier',
    code: 'C7',
    kind: 'challenge',
    mode: 'code',
    minutes: 25,
    xp: 300,
    title: { en: 'Challenge: ready for production', pt: 'Desafio: pronto para produção' },
    summary: {
      en: `Harden the three tiers: HTTPS, a database that survives a zone, an A, and a bill of $${BUDGET} a month at most.`,
      pt: `Reforce as três camadas: HTTPS, um banco que sobrevive à perda de uma zona, nota A e uma conta de no máximo US$ ${BUDGET} por mês.`,
    },
    body: [
      {
        en: 'Your three tiers work. Now comes the launch review, and it has a checklist. Traffic is encrypted: the load balancer serves HTTPS on 443 with a certificate whose ARN comes from a variable, and plain HTTP on 80 answers with a redirect to it.',
        pt: 'Suas três camadas funcionam. Agora vem a revisão de lançamento, e ela tem uma lista. O tráfego é criptografado: o balanceador atende HTTPS na 443 com um certificado cujo ARN vem de uma variável, e o HTTP comum na 80 responde com um redirecionamento para ele.',
      },
      {
        en: 'The database survives the loss of a zone, and is still reachable from the app servers alone. The security audit stays at A.',
        pt: 'O banco sobrevive à perda de uma zona e continua acessível só pelos servidores da aplicação. A auditoria de segurança continua dando A.',
      },
      {
        en: `And the finance team has a number: the cost estimate stays at $${BUDGET} a month or less, with the load balancer, the database and both servers still priced in it. Reliability costs money, so read the estimate line by line and decide where the money goes.`,
        pt: `E o financeiro tem um número: a estimativa de custo fica em US$ ${BUDGET} por mês ou menos, com o balanceador, o banco e os dois servidores ainda precificados nela. Confiabilidade custa dinheiro, então leia a estimativa linha por linha e decida para onde o dinheiro vai.`,
      },
      {
        en: 'How you get there is yours to decide. One practical note: this terminal takes no `-var`, so give the certificate variable a placeholder `default`. Nothing here reaches AWS.',
        pt: 'Como chegar lá fica por sua conta. Um detalhe prático: este terminal não aceita `-var`, então dê à variável do certificado um `default` provisório. Nada aqui chega à AWS.',
      },
    ],
    start: TIER_DATABASE,
    solution: SECURE_THREE_TIER,
    goals: [
      {
        id: 'https',
        text: { en: 'HTTPS on 443, and HTTP redirected to it', pt: 'HTTPS na 443, e o HTTP redirecionado para ele' },
        hint: {
          en: 'A `variable "certificate_arn"`, then a second listener with `port = 443`, `protocol = "HTTPS"`, `ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"`, `certificate_arn = var.certificate_arn` and the `forward` action. The port 80 listener\'s `default_action` becomes `type = "redirect"` with a `redirect` block: `protocol = "HTTPS"`, `port = "443"`, `status_code = "HTTP_301"`. And open 443 in the load balancer\'s group.',
          pt: 'Uma `variable "certificate_arn"`, depois um segundo listener com `port = 443`, `protocol = "HTTPS"`, `ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"`, `certificate_arn = var.certificate_arn` e a ação `forward`. O `default_action` do listener da porta 80 vira `type = "redirect"` com um bloco `redirect`: `protocol = "HTTPS"`, `port = "443"`, `status_code = "HTTP_301"`. E abra a 443 no grupo do balanceador.',
        },
        test: all(httpsListener, redirectsToHttps, reachableOn('aws_lb', [443])),
      },
      {
        id: 'zones',
        text: { en: 'The database survives the loss of a zone', pt: 'O banco sobrevive à perda de uma zona' },
        hint: {
          en: '`multi_az = true` on the database: RDS keeps a standby copy in the other zone, and promotes it in a minute or two if the first one fails.',
          pt: '`multi_az = true` no banco: o RDS mantém uma cópia reserva na outra zona e a promove em um ou dois minutos se a primeira falhar.',
        },
        test: argIs('aws_db_instance', 'multi_az', true),
      },
      {
        id: 'only-app',
        text: { en: 'The database is still reachable from the app servers alone', pt: 'O banco continua acessível só pelos servidores da aplicação' },
        hint: {
          en: 'Its group takes 5432 from `aws_security_group.app.id` and nothing else, it stays in the private subnets, and `publicly_accessible` stays `false`.',
          pt: 'O grupo dele aceita a 5432 vinda de `aws_security_group.app.id` e de mais nada, ele fica nas sub-redes privadas, e `publicly_accessible` continua `false`.',
        },
        test: all(onlyFrom(['aws_db_instance'], APP_TYPES), databaseInPrivateSubnets, noFinding(/publicly accessible/)),
      },
      {
        id: 'grade',
        text: { en: 'The security audit grades it A', pt: 'A auditoria de segurança dá nota A' },
        hint: {
          en: 'Open the security panel and work from the top: each finding says what to change.',
          pt: 'Abra o painel de segurança e trabalhe de cima para baixo: cada achado diz o que mudar.',
        },
        test: grade('A'),
      },
      {
        id: 'budget',
        text: { en: `The cost estimate stays at $${BUDGET} a month or less`, pt: `A estimativa de custo fica em US$ ${BUDGET} por mês ou menos` },
        hint: {
          en: 'Read the estimate\'s lines. A Multi-AZ database bills two copies, and `db.t3.micro` costs half as much as `db.t3.small`: plenty for this app. Leaving pieces out doesn\'t count: the load balancer, the database and two servers (or an auto scaling group of two) must stay priced.',
          pt: 'Leia as linhas da estimativa. Um banco Multi-AZ cobra duas cópias, e `db.t3.micro` custa metade de `db.t3.small`: mais que suficiente para esta aplicação. Deixar peças de fora não vale: o balanceador, o banco e os dois servidores (ou um grupo de auto scaling com dois) precisam continuar precificados.',
        },
        test: withinBudget(BUDGET),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `plan` and read what changes in place and what is replaced, then `apply`.',
          pt: 'No terminal: rode `plan` e leia o que muda no lugar e o que é substituído, depois `apply`.',
        },
        test: appliedWith('aws_lb_listener', 'protocol', 'HTTPS'),
      },
    ],
  },
];
