import { afterEach, describe, expect, it } from 'vitest';
import { useLocale } from '@/i18n/locale';
import { lit } from '@/ir/expr';
import { parseProject } from './parser';
import { applyOpsWithPatches } from './patch';

afterEach(() => useLocale.getState().setLocale('en'));

const errors = (main: string) =>
  parseProject({ 'main.tf': main })
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message);

describe('parse errors and refused edits in Portuguese', () => {
  it('reports a parse error in the language in effect', () => {
    const broken = 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n';
    expect(errors(broken)).toEqual(['Missing "}" to close this "resource" block']);
    useLocale.getState().setLocale('pt-BR');
    expect(errors(broken)).toEqual(['Falta "}" para fechar este bloco "resource"']);
    expect(errors('resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16", tags = {}\n}\n')).toEqual([
      '"," inesperada depois de "cidr_block": os argumentos de um bloco ficam em linhas separadas',
    ]);
    expect(errors('resource "aws_vpc" "main" {\n  a = 1\n  a = 2\n}\n')).toEqual([
      'Argumento duplicado "a": cada argumento só pode ser definido uma vez',
    ]);
  });

  it('reports a duplicate address', () => {
    const twice = 'resource "aws_vpc" "main" {\n}\nresource "aws_vpc" "main" {\n}\n';
    useLocale.getState().setLocale('pt-BR');
    expect(errors(twice)).toEqual([
      'Recurso duplicado "aws_vpc.main" (já declarado em main.tf:1): o Terraform exige endereços únicos — renomeie um deles',
    ]);
  });

  it('says why a canvas edit was refused', () => {
    const files = { 'main.tf': 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n' };
    const { ir } = parseProject(files);
    // the text changed after the parse: the edit must not splice into it
    const edited = { 'main.tf': `${files['main.tf']}# a comment\nlocals {\n}\n` };
    useLocale.getState().setLocale('pt-BR');
    const outcome = applyOpsWithPatches(edited, ir, [{ kind: 'set_arg', nodeId: 'aws_vpc.main', field: 'enable_dns_support', value: lit(true) }]);
    expect(outcome.refused?.message).toBe(
      'Edição do canvas não aplicada: main.tf mudou desde a última análise (o texto depois do último bloco mudou). Corrija primeiro os erros do código.',
    );
  });
});
