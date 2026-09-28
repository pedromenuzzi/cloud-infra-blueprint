import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  importNote,
  isTerraformPath,
  pickRootDir,
  readDroppedTerraform,
  readTerraformFiles,
} from './importTf';

const tf = (text: string, name: string) => new File([text], name, { type: 'text/plain' });

/** A live FileList stand-in: emptied (like `input.value = ''` does) right after it's handed over. */
function liveList(files: File[]): ArrayLike<File> & Iterable<File> {
  const list: File[] & { item?: unknown } = [...files];
  queueMicrotask(() => list.splice(0));
  return list;
}

describe('readTerraformFiles', () => {
  it('imports loose .tf files and ignores everything else', async () => {
    const result = await readTerraformFiles([
      tf('resource "aws_vpc" "main" {}\n', 'main.tf'),
      tf('variable "region" {}\n', 'variables.tf'),
      tf('# notes', 'README.md'),
    ]);
    expect(result?.name).toBe('imported-terraform');
    expect(Object.keys(result!.files).sort()).toEqual(['main.tf', 'variables.tf']);
    expect(result!.skipped).toBe(0);
    expect(importNote(result!)).toBeNull();
  });

  it('keeps every file of a multi-file pick even when the list empties after the first await', async () => {
    const result = await readTerraformFiles(
      liveList([
        tf('resource "aws_vpc" "main" {}\n', 'main.tf'),
        tf('variable "region" {}\n', 'variables.tf'),
        tf('output "vpc" { value = aws_vpc.main.id }\n', 'outputs.tf'),
      ]),
    );
    expect(Object.keys(result!.files).sort()).toEqual(['main.tf', 'outputs.tf', 'variables.tf']);
  });

  it('terminates on name collisions with an upper-case extension', async () => {
    const result = await readTerraformFiles([tf('a', 'MAIN.TF'), tf('b', 'MAIN.TF'), tf('c', 'main.tf')]);
    expect(result!.files).toEqual({ 'MAIN.tf': 'a', 'MAIN_2.tf': 'b', 'main_3.tf': 'c' });
  });

  it('keeps non-ASCII letters in file names', async () => {
    const result = await readTerraformFiles([tf('x', 'ü.tf'), tf('y', 'réseau prod.tf')]);
    expect(Object.keys(result!.files).sort()).toEqual(['réseau-prod.tf', 'ü.tf']);
  });

  it('imports only the root module of a zip and reports the skipped module files', async () => {
    const zip = zipSync({
      'infra/main.tf': strToU8(
        'module "a" {\n  source = "./modules/a"\n}\n\nmodule "b" {\n  source = "./modules/b"\n}\n',
      ),
      'infra/variables.tf': strToU8('variable "region" {}\n'),
      'infra/modules/a/main.tf': strToU8('resource "aws_s3_bucket" "this" {}\n'),
      'infra/modules/b/main.tf': strToU8('resource "aws_s3_bucket" "this" {}\n'),
      'infra/.terraform/providers/x.tf': strToU8('ignored'),
      'infra/README.md': strToU8('# hi'),
    });
    const result = await readTerraformFiles([new File([zip], 'my-stack.zip', { type: 'application/zip' })]);
    expect(result?.name).toBe('my-stack');
    expect(result!.rootDir).toBe('infra');
    expect(Object.keys(result!.files).sort()).toEqual(['main.tf', 'variables.tf']);
    expect(result!.skipped).toBe(2);
    expect(importNote(result!)).toBe(
      "Imported the root module (infra/); 2 files in modules/ were skipped (modules aren't supported yet).",
    );
  });

  it('matches .tf case-insensitively inside zips and never inflates skipped entries', async () => {
    // 8 MB of zeros deflates to a few KB — a provider binary in a real repo is ~300 MB
    const huge = new Uint8Array(8 * 1024 * 1024);
    const zip = zipSync({
      'MAIN.TF': strToU8('resource "aws_vpc" "a" {}\n'),
      '.terraform/providers/registry/aws/terraform-provider-aws': huge,
      'terraform.tfstate': strToU8('{"secrets":"no"}'),
      'terraform.tfstate.backup': strToU8('{}'),
      '.terraform.lock.hcl': strToU8('provider {}'),
      '__MACOSX/._MAIN.TF': strToU8('junk'),
    });
    const result = await readTerraformFiles([new File([zip], 'repo.zip')]);
    expect(Object.keys(result!.files)).toEqual(['MAIN.tf']);
  });

  it('caps what a zip may inflate', async () => {
    const big = strToU8(`# ${'x'.repeat(3 * 1024 * 1024)}\n`);
    const zip = zipSync({ 'main.tf': strToU8('resource "aws_vpc" "a" {}\n'), 'huge.tf': big });
    const result = await readTerraformFiles([new File([zip], 'repo.zip')]);
    expect(Object.keys(result!.files)).toEqual(['main.tf']);
    expect(result!.oversized).toBe(1);
    expect(importNote(result!)).toBe('1 file was too large to import.');
  });

  it('returns null when there is no Terraform (or the zip is unreadable)', async () => {
    expect(await readTerraformFiles([tf('x', 'notes.txt')])).toBeNull();
    expect(await readTerraformFiles([new File(['not a zip'], 'broken.zip')])).toBeNull();
  });
});

describe('root module detection', () => {
  const at = (path: string, text = '') => ({ path, text });

  it('prefers the shallowest directory, and the one that calls modules', () => {
    expect(pickRootDir([at('main.tf'), at('modules/net/main.tf')])).toBe('');
    expect(
      pickRootDir([
        at('live/prod/main.tf', 'module "vpc" { source = "../../modules/vpc" }'),
        at('modules/vpc/main.tf'),
      ]),
    ).toBe('live/prod');
  });

  it('skips state, lock files and provider caches', () => {
    expect(isTerraformPath('infra/main.tf')).toBe(true);
    expect(isTerraformPath('infra/MAIN.TF')).toBe(true);
    expect(isTerraformPath('terraform.tfstate')).toBe(false);
    expect(isTerraformPath('.terraform.lock.hcl')).toBe(false);
    expect(isTerraformPath('infra/.terraform/modules/x/main.tf')).toBe(false);
  });
});

/* a dropped folder, as Chrome exposes it through webkitGetAsEntry */
type FakeEntry = {
  name: string;
  fullPath: string;
  isFile: boolean;
  isDirectory: boolean;
  file?(ok: (f: File) => void): void;
  createReader?(): { readEntries(ok: (entries: FakeEntry[]) => void): void };
};

function fileEntry(fullPath: string, text: string): FakeEntry {
  const name = fullPath.split('/').pop()!;
  return { name, fullPath, isFile: true, isDirectory: false, file: (ok) => ok(tf(text, name)) };
}

function dirEntry(fullPath: string, children: FakeEntry[]): FakeEntry {
  return {
    name: fullPath.split('/').pop()!,
    fullPath,
    isFile: false,
    isDirectory: true,
    createReader() {
      // hand the children out in two batches, then an empty one (like Chrome's 100-entry batches)
      const batches = [children.slice(0, 1), children.slice(1), []];
      return { readEntries: (ok) => ok(batches.shift() ?? []) };
    },
  };
}

function dropped(entries: FakeEntry[]): DataTransfer {
  return {
    files: entries.map((e) => tf('', e.name)),
    items: entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })),
  } as unknown as DataTransfer;
}

describe('readDroppedTerraform', () => {
  it('walks a dropped folder, keeping paths so modules are left out', async () => {
    const folder = dirEntry('/infra', [
      fileEntry('/infra/main.tf', 'module "net" {\n  source = "./modules/net"\n}\n'),
      fileEntry('/infra/outputs.tf', 'output "x" { value = 1 }\n'),
      dirEntry('/infra/modules', [
        dirEntry('/infra/modules/net', [fileEntry('/infra/modules/net/main.tf', 'resource "aws_vpc" "this" {}\n')]),
      ]),
      dirEntry('/infra/.terraform', [fileEntry('/infra/.terraform/x.tf', 'never read')]),
      fileEntry('/infra/terraform.tfstate', '{}'),
    ]);
    const result = await readDroppedTerraform(dropped([folder]));
    expect(result?.name).toBe('infra');
    expect(result!.rootDir).toBe('infra');
    expect(Object.keys(result!.files).sort()).toEqual(['main.tf', 'outputs.tf']);
    expect(result!.skipped).toBe(1);
  });

  it('falls back to plain files when nothing dropped is a folder', async () => {
    const transfer = {
      files: [tf('resource "aws_vpc" "a" {}\n', 'main.tf'), tf('variable "x" {}\n', 'variables.tf')],
      items: [],
    } as unknown as DataTransfer;
    const result = await readDroppedTerraform(transfer);
    expect(Object.keys(result!.files).sort()).toEqual(['main.tf', 'variables.tf']);
  });
});
