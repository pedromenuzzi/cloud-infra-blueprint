import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { estimateProject, estimateResource } from './estimate';
import { estimateWithModules, flatModuleCosts, projectCostWithModules } from './modules';
import { TEST_BOOK } from './testing';

const book = TEST_BOOK;
const close = (value: number | null | undefined, expected: number) => expect(value).toBeCloseTo(expected, 6);

const APP = {
  'modules/app/main.tf': `resource "aws_instance" "this" {
  ami           = "ami-1"
  instance_type = var.size
}

module "cache" {
  source = "../cache"
  nodes  = var.cache_nodes
}
`,
  'modules/app/variables.tf': `variable "size" {
  default = "t3.micro"
}

variable "cache_nodes" {
  default = 1
}
`,
  'modules/cache/main.tf': `resource "aws_instance" "node" {
  count         = var.nodes
  ami           = "ami-1"
  instance_type = "t3.micro"
}

variable "nodes" {}
`,
};

function project(main: string) {
  const files = { 'main.tf': main, ...APP };
  return { files, ir: parseProject(files).ir };
}

/** what one t3.micro / m5.large costs a month in the test tables, read through the plain estimator */
function price(type: string) {
  const { ir } = project(`provider "aws" {\n  region = "us-east-1"\n}\n\nresource "aws_instance" "x" {\n  ami = "ami-1"\n  instance_type = "${type}"\n}\n`);
  return estimateResource(ir.resources[0], ir, book).monthly!;
}

describe('the cost of local modules', () => {
  it('estimates each call with its own inputs, × its instances, nested calls included', () => {
    const { files, ir } = project(`provider "aws" {
  region = "us-east-1"
}

module "web" {
  source      = "./modules/app"
  size        = "m5.large"
  cache_nodes = 2
}

module "workers" {
  source = "./modules/app"
  count  = 3
}
`);
    const cost = estimateWithModules(ir, files, book);
    const [web, workers] = cost.modules!;
    expect(web.label).toBe('module.web');
    expect(web.items.map((i) => [i.id, i.count])).toEqual([['aws_instance.this', 1]]);
    close(web.items[0].monthly, price('m5.large'));
    // the nested call: its `count = var.nodes` follows the input the outer call gives
    expect(web.nested[0].label).toBe('module.web › module.cache');
    close(web.nested[0].items[0].monthly, price('t3.micro') * 2);
    close(web.perCall, price('m5.large') + price('t3.micro') * 2);
    expect(workers.count).toBe(3);
    close(workers.monthly, (price('t3.micro') + price('t3.micro')) * 3);
    close(cost.total, web.perCall + workers.perCall * 3);
    // every resource counts once in the counts; the root has none of its own
    expect(cost.items).toEqual([]);
    expect(cost.counts.fixed).toBe(4);
    expect(flatModuleCosts(cost.modules).map((m) => m.label)).toEqual([
      'module.web',
      'module.web › module.cache',
      'module.workers',
      'module.workers › module.cache',
    ]);
    // the region comes from the root's provider
    expect(web.items[0].region).toBe('us-east-1');
  });

  it('leaves out the calls whose instances are decided at plan time, and says so', () => {
    const { files, ir } = project(`variable "n" {}

module "fleet" {
  source = "./modules/app"
  count  = var.n
}
`);
    const cost = estimateWithModules(ir, files, book);
    expect(cost.modules![0].count).toBeNull();
    expect(cost.modules![0].monthly).toBeNull();
    expect(cost.total).toBe(0);
    expect(cost.counts.unknown).toBe(2);
  });

  it('is the plain estimate without local modules, and memoized', () => {
    const { files, ir } = project(`resource "aws_instance" "x" {\n  ami = "ami-1"\n  instance_type = "t3.micro"\n}\n`);
    const cost = projectCostWithModules(ir, files, book);
    expect(cost.modules).toBeUndefined();
    expect(cost.total).toBe(estimateProject(ir, book).total);
    expect(projectCostWithModules(ir, files, book)).toBe(cost);
    expect(projectCostWithModules(ir, { ...files }, book)).not.toBe(cost);
  });

  it('says an input given as an expression is not priced', () => {
    const { files, ir } = project(`module "web" {
  source = "./modules/app"
  size   = local.size
}

locals {
  size = "m5.large"
}
`);
    const [web] = estimateWithModules(ir, files, book).modules!;
    expect(web.items[0].kind).toBe('unknown');
  });
});
