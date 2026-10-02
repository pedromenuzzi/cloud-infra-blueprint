import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { useLocale } from '@/i18n/locale';
import { validateProject } from '@/ir/validate';
import { getDef } from '@/resources/registry';
import { loadDataSchema, loadSchema } from './store';
import { SCHEMA_PROVIDERS } from './types';
import { dataSchemaIssues } from './validate';

beforeAll(async () => {
  await Promise.all(SCHEMA_PROVIDERS.flatMap((p) => [loadSchema(p), loadDataSchema(p)]));
});

function project(hcl: string, extra: Record<string, string> = {}) {
  const { ir, diagnostics } = parseProject({ 'main.tf': hcl, ...extra });
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return { ir, warnings: validateProject(ir, getDef) };
}

const messages = (hcl: string) => project(hcl).warnings.map((w) => w.message);

describe('data blocks against the provider schema', () => {
  it('no false positives on the common lookups, meta-arguments included', () => {
    const { ir, warnings } = project(`
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

data "aws_vpc" "main" {
  count    = 1
  provider = aws.west
  default  = true

  lifecycle {
    postcondition {
      condition     = self.enable_dns_support
      error_message = "DNS support is off."
    }
  }
}

data "aws_subnets" "private" {
  depends_on = [data.aws_vpc.main]
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main[0].id]
  }
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "azurerm_client_config" "current" {}

data "google_client_config" "current" {}

data "google_compute_zones" "available" {
  region = "us-central1"
}

data "terraform_remote_state" "net" {
  backend = "s3"
  config = {
    bucket = "state"
  }
}

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "src"
  output_path = "lambda.zip"
}

resource "aws_instance" "web" {
  ami               = data.aws_ami.ubuntu.id
  instance_type     = "t3.micro"
  availability_zone = data.aws_availability_zones.available.names[0]
  subnet_id         = data.aws_subnets.private.ids[0]
  tags = {
    Account = data.aws_caller_identity.current.account_id
    Region  = data.aws_region.current.region
    Vpc     = data.terraform_remote_state.net.outputs.vpc_id
    Zip     = data.archive_file.lambda.output_path
  }
}

resource "aws_iam_role" "fn" {
  name               = "fn"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

locals {
  arn    = "arn:\${data.aws_partition.current.partition}:s3:::x"
  tenant = data.azurerm_client_config.current.tenant_id
}

output "zones" {
  value = data.google_compute_zones.available.names
}
`);
    expect(warnings.map((w) => w.message)).toEqual([]);
    for (const d of ir.data) expect(dataSchemaIssues(d), d.id).toEqual([]);
  });

  it('an unknown argument, with a did you mean', () => {
    const { warnings } = project('data "aws_ami" "u" {\n  most_recnt = true\n  owners     = ["self"]\n}\n');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      nodeId: 'data.aws_ami.u',
      severity: 'warning',
      start: { line: 2, col: 3 },
      end: { line: 2, col: 13 },
    });
    expect(warnings[0].message).toBe('data.aws_ami.u: unknown argument "most_recnt". Did you mean "most_recent"?');
  });

  it('missing required arguments and nested ones, read-only attributes, type problems', () => {
    expect(messages('data "aws_ssm_parameter" "p" {}\n')).toEqual(['data.aws_ssm_parameter.p: required argument "name" is missing']);
    expect(messages('data "aws_ami" "u" {\n  filter {\n    name = "x"\n  }\n}\n')).toEqual([
      'data.aws_ami.u: required argument "values" in filter is missing',
    ]);
    expect(messages('data "aws_ami" "u" {\n  image_id = "ami-1"\n}\n')).toEqual([
      'data.aws_ami.u: "image_id" is read-only: the provider computes it',
    ]);
    expect(messages('data "aws_ami" "u" {\n  most_recent = "yes"\n}\n')).toEqual([
      'data.aws_ami.u: "most_recent" expects a bool, got "yes"',
    ]);
  });

  it('provisioners are not meta-arguments of a data block', () => {
    expect(messages('data "aws_region" "r" {\n  provisioner "local-exec" {\n    command = "x"\n  }\n}\n')).toEqual([
      'data.aws_region.r: unknown block type "provisioner"',
    ]);
  });

  it('an unknown data source type, with a did you mean', () => {
    expect(messages('data "aws_amis_nope_at_all" "u" {}\n')).toEqual([
      'data.aws_amis_nope_at_all.u: data source "aws_amis_nope_at_all" is not in the aws provider 6.66.0',
    ]);
    expect(messages('data "aws_availabilty_zones" "z" {}\n')).toEqual([
      'data.aws_availabilty_zones.z: data source "aws_availabilty_zones" is not in the aws provider 6.66.0. Did you mean "aws_availability_zones"?',
    ]);
  });

  it('nothing when the project pins a provider version the schema does not describe', () => {
    const versions = 'terraform {\n  required_providers {\n    aws = {\n      source  = "hashicorp/aws"\n      version = "~> 5.0"\n    }\n  }\n}\n';
    const { warnings } = project('data "aws_ami" "u" {\n  most_recnt = true\n}\n\noutput "x" {\n  value = data.aws_ami.u.idd\n}\n', {
      'versions.tf': versions,
    });
    expect(warnings).toEqual([]);
  });

  it('speaks Portuguese', () => {
    useLocale.getState().setLocale('pt-BR');
    try {
      expect(messages('data "aws_availabilty_zones" "z" {}\n')).toEqual([
        'data.aws_availabilty_zones.z: a fonte de dados "aws_availabilty_zones" não existe no provider aws 6.66.0. Você quis dizer "aws_availability_zones"?',
      ]);
      expect(messages('resource "aws_instance" "w" {\n  ami           = data.aws_ami.x.id\n  instance_type = "t3.micro"\n}\n')).toEqual([
        'aws_instance.w: "ami" lê a fonte de dados data.aws_ami.x, que não está declarada neste projeto',
      ]);
    } finally {
      useLocale.getState().setLocale('en');
    }
  });
});

describe('references to data sources', () => {
  it('to a data block the project does not declare', () => {
    const { warnings } = project('resource "aws_instance" "w" {\n  ami           = data.aws_ami.ubuntu.id\n  instance_type = "t3.micro"\n}\n');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ nodeId: 'aws_instance.w', start: { line: 2, col: 3 } });
    expect(warnings[0].message).toBe('aws_instance.w: "ami" reads data source data.aws_ami.ubuntu, which isn\'t declared in this project');
  });

  it('to an attribute the data source does not expose, with a did you mean', () => {
    const { warnings } = project(
      'data "aws_ami" "u" {\n  owners = ["self"]\n}\n\nresource "aws_instance" "w" {\n  ami           = data.aws_ami.u.image_idd\n  instance_type = "t3.micro"\n}\n',
    );
    expect(warnings.map((w) => w.message)).toEqual([
      'aws_instance.w: "ami" reads "image_idd", which data source data.aws_ami.u doesn\'t expose. Did you mean "image_id"?',
    ]);
  });

  it('from module calls, outputs, providers, other data blocks and locals', () => {
    const { warnings } = project(`
data "aws_vpc" "main" {
  default = true
}

data "aws_subnets" "all" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.idd]
  }
}

module "app" {
  source = "./app"
  vpc_id = data.aws_vpc.gone.id
}

provider "aws" {
  region = data.aws_region.nope.region
}

output "vpc" {
  value = data.aws_vpc.main.cidr
}

locals {
  account = data.aws_caller_identity.current.account_id
  note    = "data.aws_caller_identity.current is text here"
}
`);
    const summary = warnings.map((w) => `${w.nodeId ?? '-'} @${w.start?.line}:${w.start?.col} ${w.message}`);
    expect(summary).toEqual([
      'module.app @15:3 module.app: "vpc_id" reads data source data.aws_vpc.gone, which isn\'t declared in this project',
      'data.aws_subnets.all @7:3 data.aws_subnets.all: "filter" reads "idd", which data source data.aws_vpc.main doesn\'t expose. Did you mean "id"?',
      'output.vpc @23:3 output.vpc: "value" reads "cidr", which data source data.aws_vpc.main doesn\'t expose',
      'provider.aws.0 @19:3 provider.aws.0: "region" reads data source data.aws_region.nope, which isn\'t declared in this project',
      '- @27:13 locals: "account" reads data source data.aws_caller_identity.current, which isn\'t declared in this project',
    ]);
    const local = warnings[warnings.length - 1];
    expect(local.end).toEqual({ line: 27, col: 13 + 'data.aws_caller_identity.current.account_id'.length });
  });

  it('a remote state output is read through outputs', () => {
    expect(
      messages('data "terraform_remote_state" "net" {\n  backend = "local"\n}\n\noutput "v" {\n  value = data.terraform_remote_state.net.vpc_id\n}\n'),
    ).toEqual(['output.v: "value" reads "vpc_id", which data source data.terraform_remote_state.net doesn\'t expose. Did you mean "outputs.vpc_id"?']);
  });

  it('data sources of other providers: only whether they exist', () => {
    expect(messages('data "http" "ip" {\n  url = "https://ifconfig.me"\n}\n\noutput "ip" {\n  value = data.http.ip.response_body_nope\n}\n')).toEqual([]);
  });

  it('moved and check blocks are not readers', () => {
    expect(
      messages('check "health" {\n  data "http" "site" {\n    url = "https://x"\n  }\n  assert {\n    condition     = data.http.site.status_code == 200\n    error_message = "down"\n  }\n}\n'),
    ).toEqual([]);
  });
});
