/**
 * Popular Registry modules to start from ("Add module…"), with the inputs
 * most calls pass. A preset that needs a network (EKS, a security group)
 * is wired to the project's own when there is one: a VPC module's outputs,
 * else an `aws_vpc` and its subnets.
 */
import { list, lit, obj, ref } from '@/ir/expr';
import { emitModule } from '@/hcl/emitter';
import { moduleAddress, moduleSource } from '@/ir/modules';
import type { Expression, IR, ModuleNode, Provider } from '@/ir/types';
import { tfName } from '@/lib/utils';

export type PresetId = 'aws-vpc' | 'aws-eks' | 'aws-s3' | 'aws-rds' | 'aws-sg' | 'azure-vnet' | 'gcp-network';

export interface ModulePreset {
  id: PresetId;
  provider: Exclude<Provider, 'other'>;
  /** the module call's default name */
  name: string;
  source: string;
  version: string;
  inputs(ir: IR): Array<[string, Expression]>;
}

const AWS_VPC = 'terraform-aws-modules/vpc/aws';

/** How the project's network is referenced: a VPC module's outputs, else an aws_vpc (and its subnets). */
function network(ir: IR): { vpcId: Expression; subnets?: Expression } | null {
  const vpcModule = ir.modules.find((m) => moduleSource(m) === AWS_VPC);
  if (vpcModule) {
    return { vpcId: ref(`${vpcModule.id}.vpc_id`), subnets: ref(`${vpcModule.id}.private_subnets`) };
  }
  const vpc = ir.resources.find((r) => r.type === 'aws_vpc');
  if (!vpc) return null;
  const subnets = ir.resources.filter(
    (r) => r.type === 'aws_subnet' && r.args.vpc_id?.kind === 'ref' && r.args.vpc_id.path.startsWith(`${vpc.id}.`),
  );
  return {
    vpcId: ref(`${vpc.id}.id`),
    subnets: subnets.length > 0 ? list(subnets.map((s) => ref(`${s.id}.id`))) : undefined,
  };
}

export const MODULE_PRESETS: ModulePreset[] = [
  {
    id: 'aws-vpc',
    provider: 'aws',
    name: 'vpc',
    source: AWS_VPC,
    version: '~> 5.0',
    inputs: () => [
      ['name', lit('main')],
      ['cidr', lit('10.0.0.0/16')],
      ['azs', list([lit('us-east-1a'), lit('us-east-1b')])],
      ['private_subnets', list([lit('10.0.1.0/24'), lit('10.0.2.0/24')])],
      ['public_subnets', list([lit('10.0.101.0/24'), lit('10.0.102.0/24')])],
      ['enable_nat_gateway', lit(true)],
      ['single_nat_gateway', lit(true)],
    ],
  },
  {
    id: 'aws-eks',
    provider: 'aws',
    name: 'eks',
    source: 'terraform-aws-modules/eks/aws',
    version: '~> 20.0',
    inputs: (ir) => {
      const net = network(ir);
      return [
        ['cluster_name', lit('main')],
        ['cluster_version', lit('1.30')],
        ...(net ? ([['vpc_id', net.vpcId]] as Array<[string, Expression]>) : []),
        ...(net?.subnets ? ([['subnet_ids', net.subnets]] as Array<[string, Expression]>) : []),
        ['cluster_endpoint_public_access', lit(true)],
        [
          'eks_managed_node_groups',
          obj({ default: obj({ instance_types: list([lit('t3.medium')]), min_size: lit(1), max_size: lit(3), desired_size: lit(2) }) }),
        ],
      ];
    },
  },
  {
    id: 'aws-s3',
    provider: 'aws',
    name: 's3_bucket',
    source: 'terraform-aws-modules/s3-bucket/aws',
    version: '~> 4.0',
    inputs: () => [
      ['bucket', lit('app-assets')],
      ['versioning', obj({ enabled: lit(true) })],
      ['block_public_acls', lit(true)],
      ['block_public_policy', lit(true)],
    ],
  },
  {
    id: 'aws-rds',
    provider: 'aws',
    name: 'db',
    source: 'terraform-aws-modules/rds/aws',
    version: '~> 6.0',
    inputs: () => [
      ['identifier', lit('app-db')],
      ['engine', lit('postgres')],
      ['engine_version', lit('16')],
      ['family', lit('postgres16')],
      ['major_engine_version', lit('16')],
      ['instance_class', lit('db.t4g.micro')],
      ['allocated_storage', lit(20)],
      ['db_name', lit('app')],
      ['username', lit('app')],
    ],
  },
  {
    id: 'aws-sg',
    provider: 'aws',
    name: 'web_sg',
    source: 'terraform-aws-modules/security-group/aws',
    version: '~> 5.0',
    inputs: (ir) => {
      const net = network(ir);
      return [
        ['name', lit('web')],
        ['description', lit('HTTPS from anywhere')],
        ...(net ? ([['vpc_id', net.vpcId]] as Array<[string, Expression]>) : []),
        ['ingress_cidr_blocks', list([lit('0.0.0.0/0')])],
        ['ingress_rules', list([lit('https-443-tcp')])],
      ];
    },
  },
  {
    id: 'azure-vnet',
    provider: 'azure',
    name: 'vnet',
    source: 'Azure/vnet/azurerm',
    version: '~> 4.0',
    inputs: () => [
      ['resource_group_name', lit('rg-main')],
      ['vnet_location', lit('eastus')],
      ['vnet_name', lit('vnet-main')],
      ['address_space', list([lit('10.0.0.0/16')])],
      ['subnet_prefixes', list([lit('10.0.1.0/24'), lit('10.0.2.0/24')])],
      ['subnet_names', list([lit('app'), lit('data')])],
      ['use_for_each', lit(true)],
    ],
  },
  {
    id: 'gcp-network',
    provider: 'gcp',
    name: 'network',
    source: 'terraform-google-modules/network/google',
    version: '~> 9.0',
    inputs: () => [
      ['project_id', lit('my-project')],
      ['network_name', lit('main')],
      [
        'subnets',
        list([obj({ subnet_name: lit('app'), subnet_ip: lit('10.10.10.0/24'), subnet_region: lit('us-central1') })]),
      ],
    ],
  },
];

/** `name`, or `name_2`, `name_3`… — the first module name the project doesn't use. */
export function uniqueModuleName(ir: IR, name: string): string {
  const base = tfName(name);
  const taken = new Set(ir.modules.map((m) => m.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export interface NewModule {
  name: string;
  source: string;
  version?: string;
  inputs?: Array<[string, Expression]>;
}

/** The module call "Add module" writes: `source`, `version`, then the inputs, in that order. */
export function buildModuleNode(input: NewModule, position?: { x: number; y: number }): ModuleNode {
  const args: Record<string, Expression> = { source: lit(input.source.trim()) };
  if (input.version?.trim()) args.version = lit(input.version.trim());
  for (const [k, v] of input.inputs ?? []) args[k] = v;
  return {
    id: moduleAddress(input.name),
    name: input.name,
    args,
    position: position && { x: Math.round(position.x), y: Math.round(position.y) },
    trivia: { leadingComments: [] },
  };
}

/** The block as it will be written (the dialog's preview). */
export function previewModule(input: NewModule): string {
  return emitModule(buildModuleNode(input));
}
