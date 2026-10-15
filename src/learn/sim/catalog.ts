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
import { isObject, UNKNOWN, type Val } from './eval';

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
  /** computed attributes the provider already knows in the plan, partly (`UNKNOWN` where it doesn't) */
  planned?: Record<string, Make>;
  /** computed numbers each update raises by one (a launch template's `latest_version`) */
  versioned?: string[];
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
/** `name`, else `name_prefix` and the digits the provider adds (`web-2026…`), else a generated name */
const named = (prefix = 'terraform') => (f: Fake) => str(f.config.name) ?? (str(f.config.name_prefix) ? `${str(f.config.name_prefix)}${digitsOf(f.seed, 26)}` : `${prefix}-${digitsOf(f.seed, 26)}`);
const owner = () => ACCOUNT;
/** `E2QWRUHAPOMQZL`: CloudFront's ids */
const cfId = (f: Fake, salt: string) => `E${upper(f, 13, salt)}`;
const lowerAlnum = (f: Fake, n: number, salt: string) => hex(f, n, salt).replace(/[0-9]/g, (d) => 'ghjkmnpqrs'[Number(d)]);
const uuid = (f: Fake, salt: string) => [8, 4, 4, 4, 12].map((n, i) => hex(f, n, `${salt}${i}`)).join('-');
/** an ACM certificate's DNS validation records: the domain names are known in the plan (the provider works them out), the records aren't */
const validations = (f: Fake, known: boolean): Val => {
  const sans = Array.isArray(f.config.subject_alternative_names) ? f.config.subject_alternative_names : [];
  const names = [f.config.domain_name, ...sans].filter((d): d is string => typeof d === 'string' && d !== '');
  return [...new Set(names)].sort().map((d) => ({
    domain_name: d,
    resource_record_name: known ? `_${hexOf(`${f.seed}${d}`, 32)}.${d.replace(/^\*\./, '')}.` : UNKNOWN,
    resource_record_type: 'CNAME',
    resource_record_value: known ? `_${hexOf(`${f.seed}${d}v`, 32)}.xlfgrmvvlj.acm-validations.aws.` : UNKNOWN,
  }));
};
const nameServers = (f: Fake) =>
  ['com', 'net', 'org', 'co.uk'].map((tld, i) => `ns-${hash(`${f.seed}ns${i}`) % 2048}.awsdns-${String(hash(`${f.seed}d${i}`) % 64).padStart(2, '0')}.${tld}`);
const zoneId = (f: Fake) => `Z0${upper(f, 19, 'zone')}`;
/** a Secrets Manager ARN: the name and the 6 random characters AWS adds */
const secretArn = (f: Fake, name: string) => `arn:aws:secretsmanager:${f.region}:${ACCOUNT}:secret:${name}-${hex(f, 6, 'sec')}`;
const ssmArn = (f: Fake, name: string) => `arn:aws:ssm:${f.region}:${ACCOUNT}:parameter${name.startsWith('/') ? '' : '/'}${name}`;

/** ids of the AWS managed CloudFront policies (the same in every account) */
const MANAGED_POLICIES: Record<string, string> = {
  'Managed-CachingOptimized': '658327ea-f89d-4fab-a63d-7e88639e58f6',
  'Managed-CachingDisabled': '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
  'Managed-CORS-S3Origin': '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf',
  'Managed-AllViewer': '216adef6-5c7f-47e4-b989-5492eafa07d3',
  'Managed-AllViewerExceptHostHeader': 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
  'Managed-SecurityHeadersPolicy': '67f7725c-6f97-4210-82d7-5512b31e9d03',
};

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
      port: (f) => (String(f.config.engine).includes('mysql') || f.config.engine === 'mariadb' ? 3306 : 5432),
      hosted_zone_id: () => 'Z2R2ITUGPM61AM',
      // the password RDS keeps in Secrets Manager, with `manage_master_user_password = true`
      master_user_secret: (f) =>
        f.config.manage_master_user_password === true
          ? [{ kms_key_id: `arn:aws:kms:${f.region}:${ACCOUNT}:key/${uuid(f, 'kms')}`, secret_arn: secretArn(f, `rds!db-${uuid(f, 'rds')}`), secret_status: 'active' }]
          : [],
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
      arn_suffix: (f) => String(AWS.aws_lb.computed!.arn(f)).replace(/^.*?:loadbalancer\//, ''),
      dns_name: (f) => `${named('tf-lb')(f)}-${digitsOf(f.seed, 10)}.${f.region}.elb.amazonaws.com`,
      name: named('tf-lb'),
      zone_id: () => 'Z35SXDOTRQ7X7K',
    },
    forceNew: ['name', 'name_prefix', 'internal', 'load_balancer_type'],
    seconds: 183,
  },
  aws_lb_target_group: {
    id: (f) => `arn:aws:elasticloadbalancing:${f.region}:${ACCOUNT}:targetgroup/${named('tf-tg')(f)}/${hex(f, 16, 'tg')}`,
    computed: { arn: (f) => f.id, arn_suffix: (f) => f.id.replace(/^.*?:targetgroup\//, 'targetgroup/'), name: named('tf-tg') },
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
      qualified_invoke_arn: (f) =>
        `arn:aws:apigateway:${f.region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${f.region}:${ACCOUNT}:function:${f.id}:$LATEST/invocations`,
      function_name: (f) => f.id,
      version: () => '$LATEST',
      last_modified: () => '2026-10-15T12:00:00.000+0000',
      source_code_size: (f) => 300 + (hash(f.seed) % 4000),
    },
    forceNew: ['function_name'],
    seconds: 6,
  },
  aws_dynamodb_table: {
    id: named(),
    computed: {
      arn: (f) => `arn:aws:dynamodb:${f.region}:${ACCOUNT}:table/${f.id}`,
      // a stream only when it's turned on, like the provider
      stream_arn: (f) => (f.config.stream_enabled === true ? `arn:aws:dynamodb:${f.region}:${ACCOUNT}:table/${f.id}/stream/2026-10-15T12:00:00.000` : ''),
      stream_label: (f) => (f.config.stream_enabled === true ? '2026-10-15T12:00:00.000' : ''),
    },
    forceNew: ['name', 'hash_key', 'range_key'],
    seconds: 7,
  },
  aws_lambda_permission: { id: (f) => str(f.config.statement_id) ?? `terraform-${digitsOf(f.seed, 26)}`, forceNew: '*' },
  aws_lambda_function_url: {
    id: (f) => str(f.config.function_name) ?? hex(f, 12),
    computed: { function_url: (f) => `https://${lowerAlnum(f, 32, 'url')}.lambda-url.${f.region}.on.aws/`, url_id: (f) => lowerAlnum(f, 32, 'url') },
    forceNew: ['function_name', 'qualifier'],
  },
  aws_apigatewayv2_api: {
    id: (f) => lowerAlnum(f, 10, 'api'),
    computed: {
      api_endpoint: (f) => `https://${f.id}.execute-api.${f.region}.amazonaws.com`,
      arn: (f) => `arn:aws:apigateway:${f.region}::/apis/${f.id}`,
      execution_arn: (f) => `arn:aws:execute-api:${f.region}:${ACCOUNT}:${f.id}`,
    },
    forceNew: ['protocol_type'],
    seconds: 2,
  },
  aws_apigatewayv2_stage: {
    id: (f) => str(f.config.name) ?? '$default',
    computed: {
      arn: (f) => `arn:aws:apigateway:${f.region}::/apis/${str(f.config.api_id) ?? 'api'}/stages/${f.id}`,
      execution_arn: (f) => `arn:aws:execute-api:${f.region}:${ACCOUNT}:${str(f.config.api_id) ?? 'api'}/${f.id}`,
      // the $default stage is served at the API's root
      invoke_url: (f) => `https://${str(f.config.api_id) ?? 'api'}.execute-api.${f.region}.amazonaws.com/${f.id === '$default' ? '' : f.id}`,
    },
    forceNew: ['api_id', 'name'],
  },
  aws_apigatewayv2_integration: { id: (f) => lowerAlnum(f, 7, 'int'), forceNew: ['api_id', 'integration_type'] },
  aws_apigatewayv2_route: { id: (f) => lowerAlnum(f, 7, 'rt'), forceNew: ['api_id'] },
  aws_cloudfront_distribution: {
    id: (f) => cfId(f, 'cf'),
    computed: {
      arn: (f) => `arn:aws:cloudfront::${ACCOUNT}:distribution/${f.id}`,
      domain_name: (f) => `d${lowerAlnum(f, 13, 'cfd')}.cloudfront.net`,
      hosted_zone_id: () => 'Z2FDTNDATAQYW2',
      etag: (f) => cfId(f, 'etag'),
      status: () => 'Deployed',
      caller_reference: (f) => `terraform-${digitsOf(f.seed, 26)}`,
    },
    forceNew: [],
    seconds: 274,
  },
  aws_cloudfront_origin_access_control: { id: (f) => cfId(f, 'oac'), computed: { etag: (f) => cfId(f, 'etag') }, forceNew: [] },
  aws_cloudfront_origin_access_identity: {
    id: (f) => cfId(f, 'oai'),
    computed: {
      iam_arn: (f) => `arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ${f.id}`,
      cloudfront_access_identity_path: (f) => `origin-access-identity/cloudfront/${f.id}`,
      etag: (f) => cfId(f, 'etag'),
    },
    forceNew: [],
  },
  aws_acm_certificate: {
    id: (f) => `arn:aws:acm:${f.region}:${ACCOUNT}:certificate/${uuid(f, 'acm')}`,
    computed: { arn: (f) => f.id, domain_validation_options: (f) => validations(f, true), status: () => 'PENDING_VALIDATION' },
    planned: { domain_validation_options: (f) => validations(f, false) },
    forceNew: ['domain_name', 'subject_alternative_names', 'validation_method', 'key_algorithm'],
  },
  aws_acm_certificate_validation: { id: () => '2026-10-15 12:00:00.000 +0000 UTC', forceNew: '*', seconds: 32 },
  aws_route53_zone: {
    id: zoneId,
    computed: { zone_id: (f) => f.id, arn: (f) => `arn:aws:route53:::hostedzone/${f.id}`, name_servers: nameServers, primary_name_server: (f) => nameServers(f)[0] },
    forceNew: ['name', 'delegation_set_id'],
    seconds: 41,
  },
  aws_route53_record: {
    id: (f) => `${str(f.config.zone_id) ?? 'Z0'}_${str(f.config.name) ?? f.name}_${str(f.config.type) ?? 'A'}`,
    computed: { fqdn: (f) => (str(f.config.name) ?? f.name).replace(/\.$/, '').toLowerCase() },
    forceNew: ['name', 'type', 'zone_id', 'set_identifier'],
    seconds: 37,
  },
  aws_launch_template: {
    id: awsId('lt'),
    computed: { arn: (f) => `arn:aws:ec2:${f.region}:${ACCOUNT}:launch-template/${f.id}`, latest_version: () => 1, default_version: () => 1, name: named() },
    versioned: ['latest_version'],
    forceNew: ['name', 'name_prefix'],
  },
  aws_autoscaling_group: {
    id: named(),
    computed: {
      arn: (f) => `arn:aws:autoscaling:${f.region}:${ACCOUNT}:autoScalingGroup:${uuid(f, 'asg')}:autoScalingGroupName/${f.id}`,
      name: (f) => f.id,
    },
    forceNew: ['name', 'name_prefix'],
    seconds: 52,
  },
  aws_secretsmanager_secret: { id: (f) => secretArn(f, named()(f)), computed: { arn: (f) => f.id, name: named() }, forceNew: ['name', 'name_prefix'] },
  aws_secretsmanager_secret_version: {
    id: (f) => `${str(f.config.secret_id) ?? 'secret'}|${uuid(f, 'ver')}`,
    computed: { arn: (f) => str(f.config.secret_id) ?? '', version_id: (f) => uuid(f, 'ver'), version_stages: () => ['AWSCURRENT'] },
    forceNew: ['secret_id', 'secret_string', 'secret_binary'],
  },
  aws_ssm_parameter: { id: (f) => str(f.config.name) ?? f.name, computed: { arn: (f) => ssmArn(f, f.id), version: () => 1, tier: () => 'Standard' }, forceNew: ['name'] },
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

/**
 * Computed attributes that are numbers: the state keeps strings, so they're read back as numbers
 * (a template's `latest_version` inside the block that names it compares equal again).
 *
 * ponytail: by name; keep the state's types if lessons need more.
 */
const NUMBERS = new Set(['latest_version', 'default_version', 'port', 'source_code_size', 'output_size']);
export const isNumberAttr = (attr: string): boolean => NUMBERS.has(attr);

/** a computed number an update raises (`latest_version`): unknown in the plan, one up after the apply */
export const versioned = (type: string, attr: string): boolean => spec(type).versioned?.includes(attr) === true;

/** what the plan already knows of a computed attribute (undefined: nothing yet, `(known after apply)`) */
export const plannedAttr = (attr: string, f: Omit<Fake, 'id'>): Val | undefined => spec(f.type).planned?.[attr]?.({ ...f, id: '' });

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

/** the first value of the `filter { name = … }` block of that name */
const filterValue = (f: Fake, name: string): string | undefined => {
  const filters: Val[] = Array.isArray(f.config.filter) ? f.config.filter : isObject(f.config.filter ?? null) ? [f.config.filter!] : [];
  const found = filters.filter(isObject).find((x) => x.name === name);
  return Array.isArray(found?.values) ? str(found.values[0]) : undefined;
};

const REGION_NAMES: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'sa-east-1': 'South America (Sao Paulo)',
  'eu-west-1': 'Europe (Ireland)',
  'eu-central-1': 'Europe (Frankfurt)',
};

/** the account's default VPC: one per region, whatever the data block is called */
const defaultVpc = (f: Fake) => awsId('vpc')({ ...f, seed: `default-vpc@${f.region}` });
const vpcOf = (f: Fake) => str(f.config.id) ?? (f.config.default === true ? defaultVpc(f) : awsId('vpc')(f));

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
  aws_region: { id: (f) => f.region, name: (f) => f.region, region: (f) => f.region, description: (f) => REGION_NAMES[f.region] ?? f.region, endpoint: (f) => `ec2.${f.region}.amazonaws.com` },
  aws_caller_identity: { id: owner, account_id: owner, arn: () => `arn:aws:iam::${ACCOUNT}:user/learner`, user_id: (f) => `AIDA${upper(f, 17, 'u')}` },
  aws_partition: { id: () => 'aws', partition: () => 'aws', dns_suffix: () => 'amazonaws.com' },
  aws_ami: {
    id: awsId('ami'),
    image_id: (f) => DATA.aws_ami.id(f),
    arn: (f) => `arn:aws:ec2:${f.region}::image/${String(DATA.aws_ami.id(f))}`,
    architecture: (f) => filterValue(f, 'architecture') ?? (/arm64|aarch64/.test(filterValue(f, 'name') ?? '') ? 'arm64' : 'x86_64'),
    name: (f) => (filterValue(f, 'name') ?? 'al2023-ami-2023.6.20260901.0-kernel-6.1-x86_64').replace(/\*/g, '20260901'),
    owner_id: (f) => (Array.isArray(f.config.owners) ? str(f.config.owners[0]) : undefined) ?? '137112412989',
    root_device_type: () => 'ebs',
    virtualization_type: () => 'hvm',
  },
  aws_vpc: {
    id: vpcOf,
    cidr_block: (f) => str(f.config.cidr_block) ?? '172.31.0.0/16',
    arn: (f) => `arn:aws:ec2:${f.region}:${ACCOUNT}:vpc/${f.id}`,
    default: (f) => f.config.default === true,
    owner_id: owner,
  },
  aws_subnets: { id: (f) => f.region, ids: (f) => [0, 1, 2].map((i) => awsId('subnet')({ ...f, seed: `${f.seed}${i}` })) },
  // a default subnet: a /20 of the default VPC, one per zone
  aws_subnet: {
    id: (f) => str(f.config.id) ?? awsId('subnet')(f),
    availability_zone: (f) => str(f.config.availability_zone) ?? filterValue(f, 'availability-zone') ?? `${f.region}a`,
    cidr_block: (f) => str(f.config.cidr_block) ?? `172.31.${16 * Math.max(0, 'abcdef'.indexOf(String(DATA.aws_subnet.availability_zone(f)).slice(-1)))}.0/20`,
    vpc_id: (f) => str(f.config.vpc_id) ?? filterValue(f, 'vpc-id') ?? defaultVpc(f),
    arn: (f) => `arn:aws:ec2:${f.region}:${ACCOUNT}:subnet/${f.id}`,
    map_public_ip_on_launch: (f) => f.config.default_for_az === true,
    owner_id: owner,
  },
  aws_iam_policy_document: { id: (f) => String(hash(policyJson(f))), json: policyJson, minified_json: (f) => JSON.stringify(JSON.parse(policyJson(f))) },
  aws_secretsmanager_secret: {
    id: (f) => str(f.config.arn) ?? secretArn(f, str(f.config.name) ?? 'secret'),
    arn: (f) => DATA.aws_secretsmanager_secret.id(f),
    name: (f) => str(f.config.name) ?? 'secret',
  },
  aws_secretsmanager_secret_version: {
    id: (f) => `${str(f.config.secret_id) ?? 'secret'}|${str(f.config.version_stage) ?? 'AWSCURRENT'}`,
    arn: (f) => (str(f.config.secret_id)?.startsWith('arn:') ? str(f.config.secret_id)! : secretArn(f, str(f.config.secret_id) ?? 'secret')),
    // what lessons keep in a secret: a database login
    secret_string: (f) => JSON.stringify({ username: 'app', password: hex(f, 24, 'pw') }),
    version_id: (f) => uuid(f, 'ver'),
    version_stages: () => ['AWSCURRENT'],
  },
  aws_ssm_parameter: {
    id: (f) => str(f.config.name) ?? 'parameter',
    arn: (f) => ssmArn(f, str(f.config.name) ?? 'parameter'),
    // a public AMI parameter (`/aws/service/ami-amazon-linux-latest/…`) holds an AMI id
    value: (f) => (/ami/.test(str(f.config.name) ?? '') ? awsId('ami')(f) : `value-${hex(f, 12, 'v')}`),
    insecure_value: (f) => DATA.aws_ssm_parameter.value(f),
    type: () => 'String',
    version: () => 1,
  },
  aws_route53_zone: {
    id: zoneId,
    zone_id: zoneId,
    name: (f) => (str(f.config.name) ?? 'example.com').replace(/\.$/, ''),
    arn: (f) => `arn:aws:route53:::hostedzone/${zoneId(f)}`,
    name_servers: nameServers,
  },
  aws_acm_certificate: {
    id: (f) => `arn:aws:acm:${f.region}:${ACCOUNT}:certificate/${uuid(f, 'acm')}`,
    arn: (f) => DATA.aws_acm_certificate.id(f),
    domain: (f) => str(f.config.domain) ?? 'example.com',
    status: () => 'ISSUED',
  },
  aws_cloudfront_cache_policy: { id: (f) => MANAGED_POLICIES[str(f.config.name) ?? ''] ?? uuid(f, 'cp'), etag: (f) => cfId(f, 'etag') },
  aws_cloudfront_origin_request_policy: { id: (f) => MANAGED_POLICIES[str(f.config.name) ?? ''] ?? uuid(f, 'orp'), etag: (f) => cfId(f, 'etag') },
  aws_cloudfront_response_headers_policy: { id: (f) => MANAGED_POLICIES[str(f.config.name) ?? ''] ?? uuid(f, 'rhp'), etag: (f) => cfId(f, 'etag') },
  // the archive provider's zip of a folder or a file (a Lambda's code)
  archive_file: {
    id: (f) => hexOf(`${f.seed}sha1`, 40),
    output_path: (f) => str(f.config.output_path) ?? `${f.name}.zip`,
    output_base64sha256: (f) => `${btoa(hexOf(`${f.seed}sha`, 32)).slice(0, 43)}=`,
    output_md5: (f) => hexOf(`${f.seed}md5`, 32),
    output_sha: (f) => hexOf(`${f.seed}sha1`, 40),
    output_size: (f) => 300 + (hash(f.seed) % 4000),
  },
};

/** attributes the provider's schema marks sensitive: the plan prints `(sensitive value)` for them, and for what's made from them */
const SENSITIVE: Record<string, string[]> = {
  aws_db_instance: ['password'],
  aws_rds_cluster: ['master_password'],
  aws_secretsmanager_secret_version: ['secret_string', 'secret_binary'],
  aws_ssm_parameter: ['value'],
  aws_iam_access_key: ['secret'],
  random_password: ['result', 'bcrypt_hash'],
  tls_private_key: ['private_key_pem', 'private_key_openssh'],
};

export const sensitiveAttrs = (type: string): readonly string[] => SENSITIVE[type] ?? [];

/**
 * The simulated providers know what this data source returns. Other types
 * are read during apply (their values unknown in the plan): nothing here
 * could say what a real read returns.
 *
 * ponytail: an unknown type stays unknown in every plan, so what reads it
 * plans a change each time; add the type to DATA when a lesson uses one.
 */
export const knowsData = (type: string): boolean => Object.hasOwn(DATA, type);

/** the attributes a data source returns, besides `id` */
export const dataAttrs = (type: string): string[] => Object.keys(DATA[type] ?? {}).filter((k) => k !== 'id');

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
