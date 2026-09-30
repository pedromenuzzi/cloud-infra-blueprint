import { afterEach, describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { useLocale } from '@/i18n/locale';
import { validateProject } from '@/ir/validate';
import { getDef } from '@/resources/registry';
import { nameProblem } from './names';

afterEach(() => useLocale.getState().setLocale('en'));

const AWS = 'provider "aws" {\n  region = "us-east-1"\n}\n';

/** every warning of a project, in the language in effect */
function warnings(main: string, providers = AWS): string[] {
  const { ir, diagnostics } = parseProject({ 'main.tf': main, 'providers.tf': providers });
  expect(diagnostics.filter((d) => d.severity === 'error'), 'the test HCL parses').toEqual([]);
  return validateProject(ir, getDef).map((d) => d.message);
}

const vpc = 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n';
const subnet = (name: string, cidr: string, extra = '') =>
  `resource "aws_subnet" "${name}" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "${cidr}"\n${extra}}\n`;

describe('validation warnings in Portuguese', () => {
  it('a CIDR overlap', () => {
    const main = vpc + subnet('a', '10.0.1.0/24') + subnet('b', '10.0.1.128/25');
    expect(warnings(main)).toEqual([
      'aws_subnet.b: cidr_block 10.0.1.128/25 overlaps aws_subnet.a (10.0.1.0/24) — subnets in one VPC need ranges of their own',
    ]);
    useLocale.getState().setLocale('pt-BR');
    expect(warnings(main)).toEqual([
      'aws_subnet.b: cidr_block 10.0.1.128/25 se sobrepõe a aws_subnet.a (10.0.1.0/24) — sub-redes de uma mesma VPC precisam de intervalos próprios',
    ]);
  });

  it('a subnet outside its VPC and an invalid range', () => {
    useLocale.getState().setLocale('pt-BR');
    expect(warnings(vpc + subnet('a', '10.1.0.0/24'))).toEqual([
      'aws_subnet.a: cidr_block 10.1.0.0/24 está fora do intervalo de aws_vpc.main (10.0.0.0/16)',
    ]);
    expect(warnings('resource "aws_vpc" "main" {\n  cidr_block = "10.0.0/16"\n}\n')).toEqual([
      'aws_vpc.main: cidr_block "10.0.0/16" não é um intervalo CIDR válido (esperado algo como 10.0.0.0/16)',
    ]);
  });

  it('an invalid cloud-side name, with the resource named in Portuguese', () => {
    const bucket = 'resource "aws_s3_bucket" "b" {\n  bucket = "My-Bucket"\n}\n';
    useLocale.getState().setLocale('pt-BR');
    expect(warnings(bucket)).toEqual([
      'aws_s3_bucket.b: bucket "My-Bucket" tem letras maiúsculas — nomes de bucket S3 precisam ser minúsculos',
    ]);
    const def = getDef('aws_lb')!;
    expect(nameProblem(def, 'a'.repeat(40))).toBe('tem 40 caracteres — nomes de Application Load Balancer podem ter no máximo 32');
    expect(nameProblem(def, 'web_lb')).toBe(
      'não é um nome válido de Application Load Balancer — use letras, dígitos e hifens, começando e terminando com letra ou dígito',
    );
    expect(nameProblem(getDef('aws_sqs_queue')!, 'jobs!')).toContain('não é um nome válido de Fila SQS');
    useLocale.getState().setLocale('en');
    expect(nameProblem(def, 'web_lb')).toBe(
      "isn't a valid Application Load Balancer name — use letters, digits and hyphens, starting and ending with a letter or digit",
    );
  });

  it('an availability zone outside the provider’s region', () => {
    const main = vpc + subnet('a', '10.0.1.0/24', '  availability_zone = "eu-west-1a"\n');
    useLocale.getState().setLocale('pt-BR');
    expect(warnings(main)).toEqual([
      'aws_subnet.a: availability_zone "eu-west-1a" fica em eu-west-1, mas o provider AWS implanta em us-east-1',
    ]);
    const variable = 'variable "region" {\n  default = "us-east-1"\n}\n';
    const viaVar = 'provider "aws" {\n  region = var.region\n}\n';
    expect(warnings(variable + main, viaVar)).toEqual([
      'aws_subnet.a: availability_zone "eu-west-1a" fica em eu-west-1, mas o provider AWS implanta em us-east-1 (de var.region)',
    ]);
  });

  it('a duplicate name, a missing required argument and an unknown reference', () => {
    const sg = (n: string) => `resource "aws_security_group" "${n}" {\n  name   = "web"\n  vpc_id = aws_vpc.main.id\n}\n`;
    useLocale.getState().setLocale('pt-BR');
    expect(warnings(vpc + sg('a') + sg('b'))).toEqual([
      'aws_security_group.b: name "web" já é usado por aws_security_group.a na mesma VPC — a AWS exige nomes de grupo de segurança únicos por VPC',
    ]);
    const lambda = 'resource "aws_lambda_function" "f" {\n  role = aws_iam_role.gone.arn\n}\n';
    expect(warnings(lambda)).toEqual([
      'aws_lambda_function.f: o argumento obrigatório "function_name" está faltando',
      'aws_lambda_function.f: "role" referencia o recurso desconhecido aws_iam_role.gone',
    ]);
  });

  it('produces them again in the other language when validation re-runs', () => {
    const main = vpc + subnet('a', '10.1.0.0/24');
    const { ir } = parseProject({ 'main.tf': main, 'providers.tf': AWS });
    const en = validateProject(ir, getDef).map((d) => d.message);
    useLocale.getState().setLocale('pt-BR');
    const pt = validateProject(ir, getDef).map((d) => d.message);
    expect(en).toEqual(["aws_subnet.a: cidr_block 10.1.0.0/24 is outside aws_vpc.main's range (10.0.0.0/16)"]);
    expect(pt).toEqual(['aws_subnet.a: cidr_block 10.1.0.0/24 está fora do intervalo de aws_vpc.main (10.0.0.0/16)']);
  });
});
