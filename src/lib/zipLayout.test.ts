import { describe, expect, it } from 'vitest';
import { assembleProject, pickRootDir } from './importTf';
import { zipLayout } from './zipLayout';

/** what importing the zip's .tf files gives back */
function reimport(entries: Record<string, string>) {
  const sources = Object.entries(entries).map(([path, text]) => ({ path, text }));
  const rootDir = pickRootDir(sources);
  return { rootDir, files: assembleProject(sources, rootDir).files };
}

/** a project as an import of `envs/prod` + `modules/…` stores it */
const PROJECT = {
  'main.tf': 'module "net" {\n  source = "../../modules/net"\n}\n\nmodule "app" {\n  source = "../../modules/app"\n}\n',
  'modules/net/main.tf': 'resource "aws_vpc" "this" {}\n',
  'modules/app/main.tf': 'module "db" {\n  source = "../db"\n}\n',
  'modules/db/main.tf': 'resource "aws_db_instance" "this" {}\n',
};

describe('the Terraform zip layout', () => {
  it('puts the root back where it came from when its module sources climb out of it', () => {
    const layout = zipLayout(PROJECT, { rootPath: 'envs/prod', name: 'shop' });
    expect(layout.root).toBe('envs/prod');
    expect(Object.keys(layout.entries).sort()).toEqual(['envs/prod/main.tf', 'modules/app/main.tf', 'modules/db/main.tf', 'modules/net/main.tf']);
    // importing it again: the same project, the root found where it was
    const back = reimport(layout.entries);
    expect(back.rootDir).toBe('envs/prod');
    expect(back.files).toEqual(PROJECT);
  });

  it('makes up a folder deep enough when it doesn’t know where the root was', () => {
    const layout = zipLayout(PROJECT, { name: 'My Shop' });
    expect(layout.root).toBe('envs/my-shop');
    expect(reimport(layout.entries).files).toEqual(PROJECT);
  });

  it('reaches the folders the calls really reach (a source one level up from a nested root)', () => {
    const files = { 'main.tf': 'module "x" {\n  source = "../modules/x"\n}\n', 'modules/x/main.tf': 'resource "aws_s3_bucket" "b" {}\n' };
    const layout = zipLayout(files, { rootPath: 'envs/prod' });
    expect(Object.keys(layout.entries).sort()).toEqual(['envs/modules/x/main.tf', 'envs/prod/main.tf']);
    expect(reimport(layout.entries).files).toEqual(files);
  });

  it('stays flat when nothing climbs, as it always was', () => {
    const files = { 'main.tf': 'module "x" {\n  source = "./modules/x"\n}\n', 'modules/x/main.tf': '', 'variables.tf': '' };
    expect(zipLayout(files, { rootPath: 'envs/prod' })).toEqual({ entries: files, root: '' });
    expect(zipLayout({ 'main.tf': 'resource "aws_vpc" "x" {}\n' })).toEqual({ entries: { 'main.tf': 'resource "aws_vpc" "x" {}\n' }, root: '' });
  });
});
