import { afterEach, describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { useLocale } from '@/i18n/locale';
import { validateProject } from '@/ir/validate';
import { getDef } from '@/resources/registry';

afterEach(() => useLocale.getState().setLocale('en'));

const warnings = (main: string) => {
  const { ir, diagnostics } = parseProject({ 'main.tf': main, 'providers.tf': 'provider "aws" {\n  region = "us-east-1"\n}\n' });
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return validateProject(ir, getDef).map((d) => d.message);
};

const VPC = 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n';
const SUBNETS = `${VPC}resource "aws_subnet" "private" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = element(["us-east-1a", "us-east-1b", "us-east-1c"], count.index)
}
`;

describe('references and repetition', () => {
  it('no warnings for per-instance, splat and whole-resource references', () => {
    expect(
      warnings(`${SUBNETS}resource "aws_instance" "a" {
  ami       = "ami-1"
  subnet_id = aws_subnet.private[0].id
}
resource "aws_instance" "b" {
  count     = 3
  ami       = "ami-1"
  subnet_id = aws_subnet.private[count.index].id
}
resource "aws_lb" "web" {
  subnets    = aws_subnet.private[*].id
  depends_on = [aws_subnet.private]
}
`),
    ).toEqual([]);
  });

  it('warns about attribute access without an instance key', () => {
    expect(warnings(`${SUBNETS}resource "aws_instance" "a" {\n  ami       = "ami-1"\n  subnet_id = aws_subnet.private.id\n}\n`)).toEqual([
      'aws_instance.a: subnet_id reads aws_subnet.private.id, but aws_subnet.private has count set — use one instance (aws_subnet.private[0].id) or all of them (aws_subnet.private[*].id)',
    ]);
    useLocale.getState().setLocale('pt-BR');
    expect(warnings(`${SUBNETS}resource "aws_instance" "a" {\n  ami       = "ami-1"\n  subnet_id = aws_subnet.private.id\n}\n`)[0]).toContain(
      'mas aws_subnet.private tem count — use uma instância (aws_subnet.private[0].id) ou todas (aws_subnet.private[*].id)',
    );
  });

  it('warns about an instance key on a single resource', () => {
    expect(warnings(`${VPC}resource "aws_subnet" "a" {\n  vpc_id     = aws_vpc.main[0].id\n  cidr_block = "10.0.1.0/24"\n}\n`)).toEqual([
      'aws_subnet.a: vpc_id reads aws_vpc.main[0].id, but aws_vpc.main has no count or for_each — drop the instance key (aws_vpc.main.id)',
    ]);
  });

  it('cidrsubnet(…, count.index) and for_each ranges raise no overlap', () => {
    const each = `resource "aws_subnet" "keyed" {
  for_each   = { a = "10.0.100.0/24", b = "10.0.101.0/24" }
  vpc_id     = aws_vpc.main.id
  cidr_block = each.value
}
resource "aws_subnet" "fixed" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.0.0/24"
}
`;
    expect(warnings(SUBNETS + each)).toEqual([]);
  });
});
