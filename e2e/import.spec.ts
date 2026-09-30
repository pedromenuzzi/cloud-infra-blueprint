import { strToU8, zipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import { canvasStats, storedProjects, waitForMonaco } from './helpers';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

test('importing several .tf files at once keeps all of them', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByLabel('Import Terraform files').setInputFiles([
    file('main.tf', 'resource "aws_vpc" "core" {\n  cidr_block = var.cidr\n}\n'),
    file('variables.tf', 'variable "cidr" {\n  default = "10.1.0.0/16"\n}\n'),
    file('outputs.tf', 'output "vpc_id" {\n  value = aws_vpc.core.id\n}\n'),
  ]);
  await expect(page).toHaveURL(/\/editor\//);
  await waitForMonaco(page);
  await expect(canvasStats(page)).toHaveText(/^1 resource/);
  const imported = (await storedProjects(page)).find((p) => p.name === 'imported-terraform');
  expect(Object.keys(imported!.files).sort()).toEqual(['main.tf', 'outputs.tf', 'variables.tf']);
});

test('a zip with modules imports the root module with its child modules, and says so', async ({ page }) => {
  const zip = zipSync({
    'infra/main.tf': strToU8(
      'module "a" {\n  source = "./modules/a"\n}\n\nmodule "b" {\n  source = "./modules/b"\n}\n\nresource "aws_sqs_queue" "jobs" {\n  name = "jobs"\n}\n',
    ),
    'infra/modules/a/main.tf': strToU8('resource "aws_s3_bucket" "this" {}\n'),
    'infra/modules/b/main.tf': strToU8('resource "aws_s3_bucket" "this" {}\n'),
    'infra/.terraform/providers/huge.bin': new Uint8Array(4 * 1024 * 1024),
  });
  await page.goto('/dashboard');
  await page.getByLabel('Import Terraform files').setInputFiles([
    { name: 'stack.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) },
  ]);
  await expect(page).toHaveURL(/\/editor\//);
  await expect(page.getByText('Imported the root module (infra/) and kept 2 child modules.')).toBeVisible();
  const imported = (await storedProjects(page)).find((p) => p.name === 'stack');
  expect(Object.keys(imported!.files).sort()).toEqual(['main.tf', 'modules/a/main.tf', 'modules/b/main.tf']);
  // the child modules' buckets are not root resources
  await expect(canvasStats(page)).toHaveText(/^1 resource/);
});
