/**
 * What the simulated providers know about resource types: the id an apply
 * gives an instance (`vpc-0a1b…`, a bucket's name), the attributes AWS
 * computes (ARNs, endpoints, IPs), the arguments whose change forces a
 * replacement, and how long a create takes. Everything is derived from the
 * address and its generation, so the same history gives the same ids.
 *
 * ponytail: a curated table of the types lessons use (plus the data sources
 * they read). Other types get a hex id and, for AWS, an ARN, and only
 * `name` forces their replacement; read the provider schema's `ForceNew`
 * if lessons outgrow it.
 */
import { formatAddress, parseCidrBlock } from '@/resources/cidr';
import { isObject, type Val } from './eval';

export const ACCOUNT = '123456789012';
const SUBSCRIPTION = '00000000-0000-0000-0000-000000000000';

/** FNV-1a: a stable 32-bit hash */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hexOf(seed: string, n: number): string {
  let out = '';
  for (let i = 0; out.length < n; i++) out += hash(`${seed}#${i}`).toString(16).padStart(8, '0');
  return out.slice(0, n);
}

const digitsOf = (seed: string, n: number) =>
  [...hexOf(seed, n)].map((c) => String(parseInt(c, 16) % 10)).join('');

/** what a fake value is made from */
export interface Fake {
  type: string;
  name: string;
  /** a seed unique to the address and the apply that created it */
  seed: string;
  /** the instance's evaluated arguments */
  config: Record<string, Val>;
  region: string;
  /** the id, once made */
  id: string;
  /** another instance by its id (an instance's subnet) */
  byId(id: string): Record<string, Val> | undefined;
}

type Make = (f: Fake) => Val;

interface TypeSpec {
  /** an id prefix (`vpc` → `vpc-0a1b2c…`) or how the id is made */
  id?: string | Make;
  computed?: Record<string, Make>;
  /** arguments whose change forces a replacement (`*`: any of them) */
  forceNew?: string[] | '*';
  /** seconds a create takes */
  seconds?: number;
}

const str = (v: Val | undefined): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const hex = (f: Fake, n: number, salt = '') => hexOf(f.seed + salt, n);
const awsId = (prefix: string) => (f: Fake) => `${prefix}-0${hex(f, 16, prefix)}`;
const upper = (f: Fake, n: number, salt: string) => hex(f, n, salt).toUpperCase().replace(/[0-9]/g, (d) => 'ABCDEFGHJK'[Number(d)]);
const ec2Arn = (kind: string) => (f: Fake) => `arn:aws:ec2:${f.region}:${ACCOUNT}:${kind}/${f.id}`;
const named = (prefix = 'terraform') => (f: Fake) => str(f.config.name) ?? `${prefix}-${digitsOf(f.seed, 26)}`;
const owner = () => ACCOUNT;

/** an address inside a CIDR block, picked by the seed (the 4th and up: AWS keeps the first ones) */
function hostIn(cidr: string | undefined, f: Fake): string {
  const parsed = cidr ? parseCidrBlock(cidr) : undefined;
  if (!parsed?.ok || parsed.block.family !== 'ipv4') return `10.0.${hash(f.seed + 'n') % 250}.${4 + (hash(f.seed + 'h') % 250)}`;
  const size = Number(parsed.block.end - parsed.block.start);
  return formatAddress(parsed.block.start + BigInt(4 + (hash(f.seed + 'h') % Math.max(1, size - 5))), 'ipv4');
}

const publicIp = (f: Fake) => `${[3, 18, 34, 44, 52, 54][hash(f.seed + 'p') % 6]}.${hash(f.seed + 'a') % 256}.${hash(f.seed + 'b') % 256}.${1 + (hash(f.seed + 'c') % 254)}`;

/** an instance's subnet, when its `subnet_id` names one this state holds */
const subnetOf = (f: Fake) => (str(f.config.subnet_id) ? f.byId(str(f.config.subnet_id)!) : undefined);

const S3_SUB: TypeSpec = { id: (f) => str(f.config.bucket) ?? hex(f, 12), forceNew: ['bucket', 'expected_bucket_owner'] };

const AWS: Record<string, TypeSpec> = {
  aws_vpc: {
    id: 'vpc',
    computed: {
      arn: ec2Arn('vpc'),
      default_security_group_id: awsId('sg'),
      default_route_table_id: awsId('rtb'),
      main_route_table_id: awsId('rtb'),
      owner_id: owner,
    },
    forceNew: ['cidr_block', 'ipv4_ipam_pool_id'],
    seconds: 2,
  },
  aws_subnet: {
    id: 'subnet',
    computed: {
      arn: ec2Arn('subnet'),
      availability_zone: (f) => `${f.region}${'abc'[hash(f.seed + 'z') % 3]}`,
      owner_id: owner,
    },
    forceNew: ['vpc_id', 'cidr_block', 'availability_zone', 'availability_zone_id'],
  },
  aws_internet_gateway: { id: 'igw', computed: { arn: ec2Arn('internet-gateway'), owner_id: owner } },
  aws_eip: { id: 'eipalloc', computed: { public_ip: publicIp, allocation_id: (f) => f.id, arn: ec2Arn('elastic-ip') }, forceNew: ['domain'] },
  aws_nat_gateway: {
    id: 'nat',
    computed: { public_ip: publicIp, private_ip: (f) => hostIn(str(subnetOf(f)?.cidr_block), f), network_interface_id: awsId('eni') },
    forceNew: ['allocation_id', 'subnet_id', 'connectivity_type'],
    seconds: 95,
  },
  aws_route_table: { id: 'rtb', computed: { arn: ec2Arn('route-table'), owner_id: owner }, forceNew: ['vpc_id'] },
  aws_route_table_association: { id: 'rtbassoc', forceNew: ['subnet_id', 'gateway_id'] },
  aws_route: {
    id: (f) => `r-${str(f.config.route_table_id) ?? 'rtb'}${digitsOf(f.seed, 10)}`,
    forceNew: ['route_table_id', 'destination_cidr_block', 'destination_ipv6_cidr_block'],
  },
  aws_security_group: { id: 'sg', computed: { arn: ec2Arn('security-group'), owner_id: owner }, forceNew: ['name', 'name_prefix', 'description', 'vpc_id'], seconds: 2 },
  aws_vpc_security_group_ingress_rule: { id: 'sgr', computed: { arn: ec2Arn('security-group-rule'), security_group_rule_id: (f) => f.id }, forceNew: ['security_group_id'] },
  aws_vpc_security_group_egress_rule: { id: 'sgr', computed: { arn: ec2Arn('security-group-rule'), security_group_rule_id: (f) => f.id }, forceNew: ['security_group_id'] },
  aws_security_group_rule: { id: (f) => `sgrule-${digitsOf(f.seed, 10)}`, forceNew: '*' },
  aws_network_acl: { id: 'acl', computed: { arn: ec2Arn('network-acl'), owner_id: owner }, forceNew: ['vpc_id'] },
  aws_instance: {
    id: 'i',
    computed: {
      arn: ec2Arn('instance'),
      private_ip: (f) => hostIn(str(subnetOf(f)?.cidr_block), f),
      // a public address unless it's turned off, or the subnet doesn't give one
      public_ip: (f) => (f.config.associate_public_ip_address === false || subnetOf(f)?.map_public_ip_on_launch === 'false' ? '' : publicIp(f)),
      public_dns: (f) => {
        const ip = AWS.aws_instance.computed!.public_ip(f);
        return ip ? `ec2-${String(ip).replace(/\./g, '-')}.compute-1.amazonaws.com` : '';
      },
      availability_zone: (f) => str(subnetOf(f)?.availability_zone) ?? `${f.region}a`,
      instance_state: () => 'running',
      primary_network_interface_id: awsId('eni'),
    },
    forceNew: ['ami', 'availability_zone', 'subnet_id', 'key_name', 'private_ip', 'associate_public_ip_address', 'tenancy'],
    seconds: 13,
  },
  aws_ebs_volume: { id: 'vol', computed: { arn: ec2Arn('volume') }, forceNew: ['availability_zone', 'encrypted', 'snapshot_id', 'kms_key_id'], seconds: 11 },
  aws_key_pair: {
    id: (f) => str(f.config.key_name) ?? `terraform-${digitsOf(f.seed, 26)}`,
    computed: { arn: (f) => `arn:aws:ec2:${f.region}:${ACCOUNT}:key-pair/${f.id}`, key_pair_id: awsId('key'), fingerprint: (f) => hex(f, 32, 'fp').replace(/(..)(?!$)/g, '$1:') },
    forceNew: ['key_name', 'key_name_prefix', 'public_key'],
  },
  aws_s3_bucket: {
    id: (f) => str(f.config.bucket) ?? `terraform-${digitsOf(f.seed, 26)}`,
    computed: {
      arn: (f) => `arn:aws:s3:::${f.id}`,
      bucket: (f) => f.id,
      bucket_domain_name: (f) => `${f.id}.s3.amazonaws.com`,
      bucket_regional_domain_name: (f) => `${f.id}.s3.${f.region}.amazonaws.com`,
      region: (f) => f.region,
    },
    forceNew: ['bucket', 'bucket_prefix', 'object_lock_enabled'],
  },
  aws_s3_bucket_versioning: S3_SUB,
  aws_s3_bucket_public_access_block: S3_SUB,
  aws_s3_bucket_server_side_encryption_configuration: S3_SUB,
  aws_s3_bucket_policy: S3_SUB,
  aws_s3_bucket_ownership_controls: S3_SUB,
  aws_s3_bucket_lifecycle_configuration: S3_SUB,
  aws_s3_bucket_acl: S3_SUB,
  aws_s3_bucket_cors_configuration: S3_SUB,
  aws_s3_bucket_logging: S3_SUB,
  aws_s3_bucket_website_configuration: {
    ...S3_SUB,
    computed: {
      website_endpoint: (f) => `${f.id}.s3-website-${f.region}.amazonaws.com`,
      website_domain: (f) => `s3-website-${f.region}.amazonaws.com`,
    },
  },
  aws_s3_object: { id: (f) => str(f.config.key) ?? hex(f, 8), computed: { etag: (f) => hex(f, 32, 'etag') }, forceNew: ['bucket', 'key'] },
  aws_iam_role: {
    id: named(),
    computed: {
      arn: (f) => `arn:aws:iam::${ACCOUNT}:role${str(f.config.path) ?? '/'}${f.id}`,
      name: (f) => f.id,
      unique_id: (f) => `AROA${upper(f, 17, 'u')}`,
      create_date: () => '2026-10-15T12:00:00Z',
    },
    forceNew: ['name', 'name_prefix', 'path'],
  },
  aws_iam_policy: {
    id: (f) => `arn:aws:iam::${ACCOUNT}:policy${str(f.config.path) ?? '/'}${named()(f)}`,
    computed: { arn: (f) => f.id, name: named(), policy_id: (f) => `ANPA${upper(f, 17, 'p')}` },
    forceNew: ['name', 'name_prefix', 'path', 'description'],
  },
  aws_iam_role_policy_attachment: { id: (f) => `${str(f.config.role) ?? 'role'}-${digitsOf(f.seed, 20)}`, forceNew: ['role', 'policy_arn'] },
  aws_iam_role_policy: { id: (f) => `${str(f.config.role) ?? 'role'}:${named()(f)}`, forceNew: ['role', 'name', 'name_prefix'] },
  aws_iam_instance_profile: {
    id: named(),
    computed: { arn: (f) => `arn:aws:iam::${ACCOUNT}:instance-profile/${f.id}`, unique_id: (f) => `AIPA${upper(f, 17, 'u')}` },
    forceNew: ['name', 'name_prefix', 'path'],
  },
  aws_iam_user: { id: named(), computed: { arn: (f) => `arn:aws:iam::${ACCOUNT}:user/${f.id}`, unique_id: (f) => `AIDA${upper(f, 17, 'u')}` } },
  aws_iam_group: { id: named(), computed: { arn: (f) => `arn:aws:iam::${ACCOUNT}:group/${f.id}`, unique_id: (f) => `AGPA${upper(f, 17, 'u')}` } },
  aws_db_subnet_group: {
    id: named(),
    computed: { arn: (f) => `arn:aws:rds:${f.region}:${ACCOUNT}:subgrp:${f.id}` },
    forceNew: ['name', 'name_prefix'],
  },
  aws_db_instance: {
    id: (f) => `db-${upper(f, 26, 'db')}`,
    computed: {
      identifier: (f) => str(f.config.identifier) ?? `terraform-${digitsOf(f.seed, 26)}`,
      arn: (f) => `arn:aws:rds:${f.region}:${ACCOUNT}:db:${String(AWS.aws_db_instance.computed!.identifier(f))}`,
      address: (f) => `${String(AWS.aws_db_instance.computed!.identifier(f))}.c${hex(f, 11, 'h')}.${f.region}.rds.amazonaws.com`,
      endpoint: (f) => `${String(AWS.aws_db_instance.computed!.address(f))}:${String(f.config.port ?? (String(f.config.engine).includes('mysql') || f.config.engine === 'mariadb' ? 3306 : 5432))}`,
      resource_id: (f) => f.id,
      status: () => 'available',
    },
    forceNew: ['identifier', 'identifier_prefix', 'engine', 'db_name', 'username', 'availability_zone', 'storage_encrypted', 'kms_key_id', 'snapshot_identifier'],
    seconds: 245,
  },
  aws_lb: {
    id: (f) => AWS.aws_lb.computed!.arn(f) as string,
    computed: {
      arn: (f) => `arn:aws:elasticloadbalancing:${f.region}:${ACCOUNT}:loadbalancer/${f.config.load_balancer_type === 'network' ? 'net' : 'app'}/${named('tf-lb')(f)}/${hex(f, 16, 'lb')}`,
      dns_name: (f) => `${named('tf-lb')(f)}-${digitsOf(f.seed, 10)}.${f.region}.elb.amazonaws.com`,
      zone_id: () => 'Z35SXDOTRQ7X7K',
    },
    forceNew: ['name', 'name_prefix', 'internal', 'load_balancer_type'],
    seconds: 183,
  },
  aws_lb_target_group: {
    id: (f) => `arn:aws:elasticloadbalancing:${f.region}:${ACCOUNT}:targetgroup/${named('tf-tg')(f)}/${hex(f, 16, 'tg')}`,
    computed: { arn: (f) => f.id },
    forceNew: ['name', 'name_prefix', 'port', 'protocol', 'vpc_id', 'target_type'],
  },
  aws_lb_listener: {
    id: (f) => `arn:aws:elasticloadbalancing:${f.region}:${ACCOUNT}:listener/app/lb/${hex(f, 16, 'a')}/${hex(f, 16, 'b')}`,
    computed: { arn: (f) => f.id },
    forceNew: ['load_balancer_arn'],
  },
  aws_lambda_function: {
    id: (f) => str(f.config.function_name) ?? hex(f, 12),
    computed: {
      arn: (f) => `arn:aws:lambda:${f.region}:${ACCOUNT}:function:${f.id}`,
      invoke_arn: (f) => `arn:aws:apigateway:${f.region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${f.region}:${ACCOUNT}:function:${f.id}/invocations`,
      qualified_arn: (f) => `arn:aws:lambda:${f.region}:${ACCOUNT}:function:${f.id}:$LATEST`,
      version: () => '$LATEST',
    },
    forceNew: ['function_name'],
    seconds: 6,
  },
  aws_dynamodb_table: { id: named(), computed: { arn: (f) => `arn:aws:dynamodb:${f.region}:${ACCOUNT}:table/${f.id}` }, forceNew: ['name', 'hash_key', 'range_key'], seconds: 7 },
  aws_cloudwatch_log_group: { id: named(), computed: { arn: (f) => `arn:aws:logs:${f.region}:${ACCOUNT}:log-group:${f.id}` }, forceNew: ['name', 'name_prefix'] },
  aws_sqs_queue: {
    id: (f) => `https://sqs.${f.region}.amazonaws.com/${ACCOUNT}/${named()(f)}`,
    computed: { arn: (f) => `arn:aws:sqs:${f.region}:${ACCOUNT}:${named()(f)}`, url: (f) => f.id },
    forceNew: ['name', 'name_prefix', 'fifo_queue'],
  },
  aws_sns_topic: {
    id: (f) => `arn:aws:sns:${f.region}:${ACCOUNT}:${named()(f)}`,
    computed: { arn: (f) => f.id },
    forceNew: ['name', 'name_prefix', 'fifo_topic'],
  },
  aws_ecr_repository: {
    id: named(),
    computed: { arn: (f) => `arn:aws:ecr:${f.region}:${ACCOUNT}:repository/${f.id}`, repository_url: (f) => `${ACCOUNT}.dkr.ecr.${f.region}.amazonaws.com/${f.id}`, registry_id: owner },
    forceNew: ['name'],
  },
  aws_kms_key: {
    id: (f) => [8, 4, 4, 4, 12].map((n, i) => hex(f, n, `k${i}`)).join('-'),
    computed: { arn: (f) => `arn:aws:kms:${f.region}:${ACCOUNT}:key/${f.id}`, key_id: (f) => f.id },
  },
  random_id: {
    id: (f) => btoa(hex(f, Number(f.config.byte_length ?? 8) * 2)).slice(0, 11),
    computed: { hex: (f) => hex(f, Number(f.config.byte_length ?? 8) * 2), dec: (f) => String(parseInt(hex(f, 12), 16)), b64_url: (f) => f.id, b64_std: (f) => f.id },
    forceNew: '*',
  },
  random_string: { id: (f) => hex(f, Number(f.config.length ?? 16)), computed: { result: (f) => f.id }, forceNew: '*' },
  random_password: { id: () => 'none', computed: { result: (f) => hex(f, Number(f.config.length ?? 16), 'pw') }, forceNew: '*' },
  random_integer: {
    id: (f) => String(Number(f.config.min ?? 0) + (hash(f.seed) % (Number(f.config.max ?? 100) - Number(f.config.min ?? 0) + 1))),
    computed: { result: (f) => Number(f.id) },
    forceNew: '*',
  },
  random_pet: {
    id: (f) => {
      const words = [['brave', 'clever', 'quiet', 'sunny', 'lucky', 'gentle'], ['otter', 'falcon', 'panda', 'lynx', 'heron', 'koala']];
      return words.map((w, i) => w[hash(f.seed + i) % w.length]).join(str(f.config.separator) ?? '-');
    },
    forceNew: '*',
  },
};

/** Azure resource ids: `/subscriptions/…/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet` */
const AZURE_KINDS: Record<string, string> = {
  azurerm_virtual_network: 'Microsoft.Network/virtualNetworks',
  azurerm_network_security_group: 'Microsoft.Network/networkSecurityGroups',
  azurerm_public_ip: 'Microsoft.Network/publicIPAddresses',
  azurerm_network_interface: 'Microsoft.Network/networkInterfaces',
  azurerm_storage_account: 'Microsoft.Storage/storageAccounts',
  azurerm_linux_virtual_machine: 'Microsoft.Compute/virtualMachines',
  azurerm_windows_virtual_machine: 'Microsoft.Compute/virtualMachines',
};

function azureId(f: Fake): string {
  const name = str(f.config.name) ?? f.name;
  const group = `/subscriptions/${SUBSCRIPTION}/resourceGroups/${str(f.config.resource_group_name) ?? name}`;
  if (f.type === 'azurerm_resource_group') return `/subscriptions/${SUBSCRIPTION}/resourceGroups/${name}`;
  if (f.type === 'azurerm_subnet') return `${group}/providers/Microsoft.Network/virtualNetworks/${str(f.config.virtual_network_name) ?? 'vnet'}/subnets/${name}`;
  return `${group}/providers/${AZURE_KINDS[f.type] ?? `Microsoft.Resources/${f.type.slice('azurerm_'.length)}`}/${name}`;
}

function spec(type: string): TypeSpec {
  const known = AWS[type];
  if (known) return known;
  if (type.startsWith('azurerm_')) {
    return {
      id: azureId,
      forceNew: ['name', 'location', 'resource_group_name', 'virtual_network_name', 'account_tier', 'account_replication_type'].filter(
        // a storage account's tier and replication change in place
        (a) => type !== 'azurerm_storage_account' || (a !== 'account_tier' && a !== 'account_replication_type'),
      ),
    };
  }
  if (type.startsWith('aws_')) {
    const kind = type.slice(4).replace(/_/g, '-');
    return {
      id: (f) => `${kind.split('-')[0].slice(0, 6)}-0${hex(f, 16)}`,
      computed: { arn: (f) => `arn:aws:${type.split('_')[1]}:${f.region}:${ACCOUNT}:${kind}/${f.id}` },
      forceNew: ['name'],
    };
  }
  return { forceNew: ['name'] };
}

/** the attributes the provider fills in for a type (besides `id`) */
export const computedOf = (type: string): string[] => Object.keys(spec(type).computed ?? {});

/** changing `attr` replaces the resource */
export function forcesNew(type: string, attr: string): boolean {
  const list = spec(type).forceNew ?? [];
  return list === '*' ? true : list.includes(attr);
}

export const createSeconds = (type: string): number => spec(type).seconds ?? 1;

/** a stand-in for an attribute nothing above describes, by what its name says it is */
function guess(attr: string, f: Fake): Val {
  if (attr === 'arn' || attr.endsWith('_arn')) return `arn:aws:${f.type.split('_')[1] ?? 'svc'}:${f.region}:${ACCOUNT}:${attr.replace(/_?arn$/, '') || f.type}/${f.id}`;
  if (attr === 'owner_id' || attr === 'account_id') return ACCOUNT;
  const stem = attr.replace(/_ids?$/, '');
  const prefix: Record<string, string> = { route_table: 'rtb', default_route_table: 'rtb', main_route_table: 'rtb', security_group: 'sg', default_security_group: 'sg', network_interface: 'eni', subnet: 'subnet', vpc: 'vpc', internet_gateway: 'igw', network_acl: 'acl', default_network_acl: 'acl' };
  if (attr.endsWith('_id')) return `${prefix[stem] ?? stem.split('_')[0]}-0${hex(f, 16, attr)}`;
  if (attr.endsWith('_ip')) return publicIp({ ...f, seed: f.seed + attr });
  if (/dns|endpoint|domain|url|host/.test(attr)) return `${f.name}-${hex(f, 8, attr)}.${f.region}.amazonaws.com`;
  return `${attr}-${hex(f, 8, attr)}`;
}

/** the id an apply gives this instance */
export function makeId(f: Omit<Fake, 'id'>): string {
  const how = spec(f.type).id;
  if (typeof how === 'function') return String(how({ ...f, id: '' }));
  if (typeof how === 'string') return awsId(how)({ ...f, id: '' });
  return hexOf(f.seed, 16);
}

/** a computed attribute's value after apply */
export function makeAttr(attr: string, f: Fake): Val {
  const make = spec(f.type).computed?.[attr];
  return make ? make(f) : guess(attr, f);
}

/* ------------------------------------------------------------------ data sources */

const policyJson = (f: Fake): string => {
  const statements: Val[] = Array.isArray(f.config.statement) ? f.config.statement : isObject(f.config.statement ?? null) ? [f.config.statement!] : [];
  const one = (v: Val | undefined) => (Array.isArray(v) && v.length === 1 ? v[0] : v);
  const doc = {
    Version: str(f.config.version) ?? '2012-10-17',
    Statement: statements.filter(isObject).map((s) => {
      const out: Record<string, unknown> = {};
      if (str(s.sid)) out.Sid = s.sid;
      out.Effect = str(s.effect) ?? 'Allow';
      if (s.actions !== undefined) out.Action = one(s.actions);
      if (s.resources !== undefined) out.Resource = one(s.resources);
      const principals: Val[] = Array.isArray(s.principals) ? s.principals : isObject(s.principals ?? null) ? [s.principals!] : [];
      if (principals.length > 0) {
        out.Principal = Object.fromEntries(principals.filter(isObject).map((p) => [String(p.type), one(p.identifiers)]));
      }
      return out;
    }),
  };
  return JSON.stringify(doc, null, 2);
};

const AZS = (f: Fake) => ['a', 'b', 'c'].map((z) => `${f.region}${z}`);

const DATA: Record<string, Record<string, Make>> = {
  aws_availability_zones: {
    id: (f) => f.region,
    names: AZS,
    // us-east-1 → use1-az1, use1-az2…
    zone_ids: (f) => {
      const [a, b, c] = f.region.split('-');
      return [1, 2, 3].map((n) => `${a}${b?.[0] ?? ''}${c ?? ''}-az${n}`);
    },
  },
  aws_region: { id: (f) => f.region, name: (f) => f.region, region: (f) => f.region, description: (f) => f.region },
  aws_caller_identity: { id: owner, account_id: owner, arn: () => `arn:aws:iam::${ACCOUNT}:user/learner`, user_id: (f) => `AIDA${upper(f, 17, 'u')}` },
  aws_partition: { id: () => 'aws', partition: () => 'aws', dns_suffix: () => 'amazonaws.com' },
  aws_ami: {
    id: awsId('ami'),
    image_id: (f) => DATA.aws_ami.id(f),
    arn: (f) => `arn:aws:ec2:${f.region}::image/${String(DATA.aws_ami.id(f))}`,
    architecture: () => 'x86_64',
    name: (f) => {
      const filters = Array.isArray(f.config.filter) ? f.config.filter.filter(isObject) : [];
      const byName = filters.find((x) => x.name === 'name');
      const pattern = Array.isArray(byName?.values) ? str(byName.values[0]) : undefined;
      return (pattern ?? 'al2023-ami-2023.6.20260901.0-kernel-6.1-x86_64').replace(/\*/g, '20260901');
    },
  },
  aws_vpc: { id: awsId('vpc'), cidr_block: (f) => str(f.config.cidr_block) ?? '172.31.0.0/16', arn: ec2Arn('vpc') },
  aws_subnets: { id: (f) => f.region, ids: (f) => [0, 1, 2].map((i) => awsId('subnet')({ ...f, seed: `${f.seed}${i}` })) },
  aws_iam_policy_document: { id: (f) => String(hash(policyJson(f))), json: policyJson, minified_json: (f) => JSON.stringify(JSON.parse(policyJson(f))) },
};

/** what a data source reads: its known attributes, plus a stand-in for each other one asked for */
export function readData(type: string, f: Omit<Fake, 'id'>, attrs: Iterable<string>): Record<string, Val> {
  const table = DATA[type] ?? {};
  const base: Fake = { ...f, id: '' };
  const id = table.id ? String(table.id(base)) : hexOf(f.seed, 16);
  const full: Fake = { ...f, id };
  const out: Record<string, Val> = { id };
  for (const [k, make] of Object.entries(table)) if (k !== 'id') out[k] = make(full);
  for (const a of attrs) if (!(a in out) && !(a in f.config)) out[a] = guess(a, full);
  return out;
}
