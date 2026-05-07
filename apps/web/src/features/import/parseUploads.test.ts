import { createNodeAdapter, type Hcl2JsonAdapter } from '@blueprint/hcl';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';

import { MAX_FILE_BYTES, parseUploads } from './parseUploads';

let adapter: Hcl2JsonAdapter;

beforeAll(async () => {
  adapter = await createNodeAdapter();
});

function makeFile(name: string, contents: string | Uint8Array): File {
  return new File([contents as BlobPart], name, { type: 'application/octet-stream' });
}

const SAMPLE_HCL = `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
`.trim();

const SAMPLE_TFSTATE = JSON.stringify({
  version: 4,
  terraform_version: '1.5.0',
  resources: [
    {
      mode: 'managed',
      type: 'aws_instance',
      name: 'web',
      instances: [{ attributes: { instance_type: 't3.micro', ami: 'ami-0123' } }],
    },
  ],
});

describe('parseUploads', () => {
  it('parses a single .tf file into IR resources with non-zero positions', async () => {
    const result = await parseUploads([makeFile('main.tf', SAMPLE_HCL)], adapter);
    expect(result.totals.resources).toBe(2);
    expect(result.totals.failed).toBe(0);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.error).toBeUndefined();
    const positions = result.ir.resources.map((r) => `${r.position.x},${r.position.y}`);
    expect(positions.every((p) => p !== '0,0')).toBe(true);
  });

  it('parses a tfstate file into IR resources', async () => {
    const result = await parseUploads([makeFile('terraform.tfstate', SAMPLE_TFSTATE)], adapter);
    expect(result.totals.resources).toBe(1);
    expect(result.totals.failed).toBe(0);
    expect(result.ir.resources[0]?.type).toBe('aws_instance');
  });

  it('rejects unsupported extensions with a friendly message', async () => {
    const result = await parseUploads([makeFile('readme.md', '# nothing')], adapter);
    expect(result.totals.failed).toBe(1);
    expect(result.totals.resources).toBe(0);
    expect(result.files[0]?.error).toMatch(/Unsupported/);
  });

  it('rejects files larger than the per-file ceiling', async () => {
    const huge = 'a'.repeat(MAX_FILE_BYTES + 1);
    const result = await parseUploads([makeFile('big.tf', huge)], adapter);
    expect(result.totals.failed).toBe(1);
    expect(result.files[0]?.error).toMatch(/exceeds/);
  });

  it('expands a zip and parses the .tf inside, skipping .terraform/', async () => {
    const zip = new JSZip();
    zip.file('main.tf', SAMPLE_HCL);
    zip.file('.terraform/cache.bin', 'irrelevant');
    zip.file('node_modules/something.tf', 'should be skipped');
    const buffer = await zip.generateAsync({ type: 'uint8array' });
    const result = await parseUploads([makeFile('project.zip', buffer)], adapter);
    expect(result.totals.resources).toBe(2);
    expect(result.files.find((f) => f.filename === 'main.tf')).toBeDefined();
    expect(result.files.find((f) => f.filename.includes('node_modules'))).toBeUndefined();
  });

  it('merges HCL + tfstate uploaded together', async () => {
    const result = await parseUploads(
      [makeFile('infra.tf', SAMPLE_HCL), makeFile('terraform.tfstate', SAMPLE_TFSTATE)],
      adapter,
    );
    expect(result.totals.resources).toBe(3);
  });
});
