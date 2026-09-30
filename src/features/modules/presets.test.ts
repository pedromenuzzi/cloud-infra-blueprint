import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { applyOpsWithPatches } from '@/hcl/patch';
import { lit, list, ref } from '@/ir/expr';
import { moduleInputs, moduleSource, moduleVersion } from '@/ir/modules';
import { emptyIR } from '@/ir/types';
import { createProject } from '@/lib/storage';
import { useEditor } from '@/features/editor/store';
import { freeModuleSpot } from './AddModuleDialog';
import { commitLiteral, parseInputText, placeholderFor } from './inputValue';
import { buildModuleNode, MODULE_PRESETS, previewModule, uniqueModuleName } from './presets';

describe('Add module presets', () => {
  it('every preset writes a module block that parses clean, source and version first', () => {
    for (const p of MODULE_PRESETS) {
      const text = previewModule({ name: p.name, source: p.source, version: p.version, inputs: p.inputs(emptyIR()) });
      const { ir, diagnostics } = parseProject({ 'main.tf': text });
      expect(diagnostics, p.id).toEqual([]);
      const [m] = ir.modules;
      expect(m.name).toBe(p.name);
      expect(moduleSource(m)).toBe(p.source);
      expect(moduleVersion(m)).toBe(p.version);
      expect(Object.keys(m.args).slice(0, 2)).toEqual(['source', 'version']);
      expect(moduleInputs(m).length, p.id).toBeGreaterThan(1);
    }
  });

  it('covers the popular Registry modules, AWS, Azure and Google', () => {
    expect(MODULE_PRESETS.map((p) => p.source)).toEqual([
      'terraform-aws-modules/vpc/aws',
      'terraform-aws-modules/eks/aws',
      'terraform-aws-modules/s3-bucket/aws',
      'terraform-aws-modules/rds/aws',
      'terraform-aws-modules/security-group/aws',
      'Azure/vnet/azurerm',
      'terraform-google-modules/network/google',
    ]);
  });

  it('wires EKS and security groups to the network the project has', () => {
    const eks = MODULE_PRESETS.find((p) => p.id === 'aws-eks')!;
    const sg = MODULE_PRESETS.find((p) => p.id === 'aws-sg')!;
    const withVpcModule = parseProject({ 'main.tf': 'module "net" {\n  source = "terraform-aws-modules/vpc/aws"\n}\n' }).ir;
    expect(Object.fromEntries(eks.inputs(withVpcModule))).toMatchObject({
      vpc_id: ref('module.net.vpc_id'),
      subnet_ids: ref('module.net.private_subnets'),
    });
    const withVpc = parseProject({
      'main.tf':
        'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n\nresource "aws_subnet" "a" {\n  vpc_id = aws_vpc.main.id\n}\n',
    }).ir;
    expect(Object.fromEntries(sg.inputs(withVpc)).vpc_id).toEqual(ref('aws_vpc.main.id'));
    expect(Object.fromEntries(eks.inputs(withVpc)).subnet_ids).toEqual(list([ref('aws_subnet.a.id')]));
    expect(eks.inputs(emptyIR()).map(([k]) => k)).not.toContain('vpc_id');
  });

  it('names a new call so it never clashes', () => {
    const ir = parseProject({ 'main.tf': 'module "vpc" {\n  source = "./a"\n}\n\nmodule "vpc_2" {\n  source = "./b"\n}\n' }).ir;
    expect(uniqueModuleName(ir, 'vpc')).toBe('vpc_3');
    expect(uniqueModuleName(ir, 'Web App')).toBe('web_app');
  });

  it('a custom source without a version writes just the source', () => {
    const node = buildModuleNode({ name: 'net', source: ' ./modules/net ', version: '  ' }, { x: 10.4, y: 20.6 });
    expect(node.args).toEqual({ source: lit('./modules/net') });
    expect(node.position).toEqual({ x: 10, y: 21 });
  });

  it('lands right of everything on the canvas, never on another module', () => {
    const { ir } = parseProject({
      'main.tf':
        '# @blueprint:pos=0,0\nresource "aws_sqs_queue" "q" {}\n\n# @blueprint:pos=272,0\nmodule "a" {\n  source = "./a"\n}\n',
    });
    const spot = freeModuleSpot(ir);
    expect(spot.x).toBe(272 + 208 + 64);
    const again = freeModuleSpot({ ...ir, modules: [...ir.modules, buildModuleNode({ name: 'b', source: './b' }, spot)] });
    expect(again.x).toBe(spot.x + 208 + 64);
    expect(freeModuleSpot(emptyIR())).toEqual({ x: 40, y: 40 });
  });
});

describe('writing a new module', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEditor.getState().load(createProject({ name: 'add', files: { 'main.tf': 'resource "aws_sqs_queue" "q" {}\n' } }));
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('is one undo step, and the new call is selected', () => {
    const p = MODULE_PRESETS[0];
    const node = buildModuleNode({ name: 'vpc', source: p.source, version: p.version, inputs: p.inputs(emptyIR()) }, { x: 300, y: 40 });
    useEditor.getState().applyCanvasOps([{ kind: 'add_module', node }], node.id);
    const { files, selection, past } = useEditor.getState();
    expect(selection).toBe('module.vpc');
    expect(past).toHaveLength(1);
    expect(files['main.tf']).toContain('# @blueprint:pos=300,40\nmodule "vpc" {\n  source  = "terraform-aws-modules/vpc/aws"\n  version = "~> 5.0"\n');
    useEditor.getState().undo();
    expect(useEditor.getState().files['main.tf']).toBe('resource "aws_sqs_queue" "q" {}\n');
  });

  it('the patch appends and leaves the rest of the file alone', () => {
    const files = { 'main.tf': '# my queue\nresource "aws_sqs_queue" "q" {} # trailing\n' };
    const { ir } = parseProject(files);
    const out = applyOpsWithPatches(files, ir, [{ kind: 'add_module', node: buildModuleNode({ name: 'x', source: './x' }) }]);
    expect(out.files['main.tf']).toBe(`${files['main.tf']}\nmodule "x" {\n  source = "./x"\n}\n`);
  });
});

describe('typed input values', () => {
  const ir = parseProject({ 'main.tf': 'resource "aws_subnet" "a" {}\n' }).ir;

  it('free text → the expression it means', () => {
    expect(parseInputText('true', ir)).toEqual(lit(true));
    expect(parseInputText(' 3 ', ir)).toEqual(lit(3));
    expect(parseInputText('007', ir)).toEqual(lit('007'));
    expect(parseInputText('10.0.0.0/16', ir)).toEqual(lit('10.0.0.0/16'));
    expect(parseInputText('"quoted"', ir)).toEqual(lit('quoted'));
    expect(parseInputText('["a", "b"]', ir)).toEqual(list([lit('a'), lit('b')]));
    expect(parseInputText('var.region', ir)).toEqual(ref('var.region'));
    expect(parseInputText('module.vpc.private_subnets[0]', ir)).toEqual(ref('module.vpc.private_subnets[0]'));
    expect(parseInputText('aws_subnet.a.id', ir)).toEqual(ref('aws_subnet.a.id'));
    expect(parseInputText('handler.main', ir)).toEqual(lit('handler.main'));
  });

  it('an edited literal keeps its type', () => {
    expect(commitLiteral(lit(2), '5', ir)).toEqual(lit(5));
    expect(commitLiteral(lit(2), '2', ir)).toBeNull();
    expect(commitLiteral(lit('a'), 'var.x', ir)).toEqual(ref('var.x'));
    expect(commitLiteral(lit('a'), 'a', ir)).toBeNull();
    expect(commitLiteral(lit(true), 'false', ir)).toEqual(lit(false));
  });

  it('a required input starts from its type', () => {
    expect(placeholderFor('number')).toEqual(lit(0));
    expect(placeholderFor('list(string)')).toEqual(list([]));
    expect(placeholderFor('map(string)')).toEqual({ kind: 'object', fields: {} });
    expect(placeholderFor(undefined)).toEqual(lit(''));
  });
});
