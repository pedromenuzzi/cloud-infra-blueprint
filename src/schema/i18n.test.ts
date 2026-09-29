import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { useLocale } from '@/i18n/locale';
import { validateProject } from '@/ir/validate';
import { getDef } from '@/resources/registry';
import { entryDetail, entryMarkdown } from './completion';
import { parseType } from './lookup';
import { schemaTypeHover } from './monaco';
import { loadSchema, resourceSchema } from './store';
import { literalTypeProblem } from './validate';

beforeAll(async () => {
  await loadSchema('aws');
});
afterEach(() => useLocale.getState().setLocale('en'));

const warnings = (hcl: string) => validateProject(parseProject({ 'main.tf': hcl }).ir, getDef).map((d) => d.message);
const lit = (value: string | number | boolean | null) => ({ kind: 'literal' as const, value });

describe('schema text in Portuguese', () => {
  it('"did you mean" for an unknown argument, block and resource type', () => {
    const bucket = 'resource "aws_s3_bucket" "logs" {\n  bucket        = "logs"\n  force_destory = true\n}\n';
    expect(warnings(bucket)).toEqual(['aws_s3_bucket.logs: unknown argument "force_destory" — did you mean "force_destroy"?']);
    useLocale.getState().setLocale('pt-BR');
    expect(warnings(bucket)).toEqual([
      'aws_s3_bucket.logs: argumento desconhecido "force_destory" — você quis dizer "force_destroy"?',
    ]);
    const nested = 'resource "aws_instance" "web" {\n  ami           = "ami-1"\n  instance_type = "t3.micro"\n  root_block_device {\n    volum_type = "gp3"\n  }\n}\n';
    expect(warnings(nested)).toEqual([
      'aws_instance.web: argumento desconhecido "volum_type" em root_block_device — você quis dizer "volume_type"?',
    ]);
    expect(warnings('resource "aws_s3_buckett" "x" {\n}\n')[0]).toMatch(
      /^aws_s3_buckett\.x: o tipo de recurso "aws_s3_buckett" não existe no provider aws [\d.]+ — você quis dizer "aws_s3_bucket"\?$/,
    );
  });

  it('type findings, nested ones included', () => {
    useLocale.getState().setLocale('pt-BR');
    expect(literalTypeProblem(lit('yes'), parseType('bool'))).toBe('espera um booleano, mas recebeu "yes"');
    expect(literalTypeProblem(lit('abc'), parseType('number'))).toBe('espera um número, mas recebeu "abc"');
    expect(literalTypeProblem({ kind: 'list', items: [lit(1), lit('x')] }, parseType('list(number)'))).toBe(
      'espera list(number): um item deveria ser um número, mas recebeu "x"',
    );
    expect(literalTypeProblem({ kind: 'object', fields: { a: lit('x') } }, parseType('map(number)'))).toBe(
      'espera map(number): "a" deveria ser um número, mas recebeu "x"',
    );
    useLocale.getState().setLocale('en');
    expect(literalTypeProblem({ kind: 'object', fields: { a: lit('x') } }, parseType('map(number)'))).toBe(
      'expects map(number): "a" should be a number, got "x"',
    );
    expect(literalTypeProblem({ kind: 'list', items: [{ kind: 'list', items: [lit('x')] }] }, parseType('list(list(number))'))).toBe(
      'expects list(list(number)): an item should be list(number): an item should be a number, got "x"',
    );
  });

  it('entry details and hovers we generate around the provider’s own text', () => {
    const block = resourceSchema('aws_instance')!;
    const ami = block.attributes.ami;
    const root = block.blocks.root_block_device;
    expect(entryDetail(ami)).toBe('string · optional · computed');
    expect(entryDetail(root)).toBe('block · optional');
    useLocale.getState().setLocale('pt-BR');
    expect(entryDetail(ami)).toBe('string · opcional · calculado');
    expect(entryDetail(root)).toBe('bloco · opcional');
    // the provider's description is upstream English and stays
    const described = Object.values(block.attributes).find((a) => a.description)!;
    expect(entryMarkdown(described)).toContain(described.description!);
    const hover = schemaTypeHover('aws_instance')!.map((c) => c.value);
    expect(hover[0]).toMatch(/^\*\*aws_instance\*\* · provider AWS [\d.]+$/);
    expect(hover[1]).toMatch(/^\d+ argumentos e blocos — digite dentro do bloco para vê-los$/);
  });
});
