import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readTerraformFiles } from './importTf';

const tf = (text: string, name: string) => new File([text], name, { type: 'text/plain' });

describe('readTerraformFiles', () => {
  it('imports loose .tf files and ignores everything else', async () => {
    const result = await readTerraformFiles([
      tf('resource "aws_vpc" "main" {}\n', 'main.tf'),
      tf('variable "region" {}\n', 'variables.tf'),
      tf('# notes', 'README.md'),
    ]);
    expect(result?.name).toBe('imported-terraform');
    expect(Object.keys(result!.files).sort()).toEqual(['main.tf', 'variables.tf']);
  });

  it('flattens a zip, skipping .terraform and prefixing clashing names', async () => {
    const zip = zipSync({
      'infra/main.tf': strToU8('resource "aws_vpc" "a" {}\n'),
      'infra/modules/net/main.tf': strToU8('resource "aws_subnet" "b" {}\n'),
      'infra/.terraform/providers/x.tf': strToU8('ignored'),
      'infra/README.md': strToU8('# hi'),
    });
    const file = new File([zip], 'my-stack.zip', { type: 'application/zip' });
    const result = await readTerraformFiles([file]);
    expect(result?.name).toBe('my-stack');
    expect(result!.files['main.tf']).toContain('aws_vpc');
    expect(result!.files['infra_modules_net_main.tf']).toContain('aws_subnet');
    expect(Object.keys(result!.files)).toHaveLength(2);
  });

  it('returns null when there is no Terraform', async () => {
    expect(await readTerraformFiles([tf('x', 'notes.txt')])).toBeNull();
  });
});
