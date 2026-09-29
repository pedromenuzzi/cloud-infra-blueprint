/** AWS pricing rules, one per resource type (rates: book.aws, us-east-1). */
import { rate } from '../format';
import { blockBodies, blockBody, referenced, referencing, resolveBool, resolveNumber, resolveString } from '../resolve';
import type { CostLine } from '../types';
import {
  fixed,
  free,
  hourly,
  monthlyFee,
  perGbMonth,
  plural,
  unknown,
  unpriced,
  usage,
  type Rule,
  type RuleContext,
} from './common';

const ENGINE_LABEL: Record<string, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB' };

function ebsLine(ctx: RuleContext, gb: number, type: string): CostLine | undefined {
  const perGb = ctx.book.aws.ebs[type];
  return perGb === undefined ? undefined : perGbMonth(`${gb} GB ${type}`, gb, ctx.at(perGb));
}

const instance: Rule = (ctx) => {
  const { aws } = ctx.book;
  const type = ctx.str('instance_type');
  if (!type && ctx.r.args.launch_template) return unknown('The instance type comes from its launch template');
  const hourRate = type ? aws.ec2[type] : undefined;
  if (!type || hourRate === undefined) return unpriced('instance_type', type);
  const tenancy = ctx.str('tenancy');
  if (tenancy && tenancy !== 'default') return unknown(`${tenancy} tenancy isn't in the price table`);
  if (ctx.r.args.instance_market_options) return unknown('Spot instances: the price changes with demand');

  const lines = [hourly(type, ctx.at(hourRate))];
  const assumptions = ['Linux, shared tenancy (a Windows or licensed AMI costs more)'];

  const root = ctx.block('root_block_device');
  const size = root ? ctx.num('volume_size', root) : undefined;
  const volume = (root ? ctx.str('volume_type', root) : undefined) ?? 'gp3';
  const gb = size ?? 8;
  const rootLine = ebsLine(ctx, gb, volume);
  if (rootLine) lines.push(rootLine);
  else assumptions.push(`Root volume type ${volume} isn't in the price table — not included`);
  if (size === undefined) assumptions.push(`Root volume: ${gb} GB ${volume}, a typical AMI default (set root_block_device to change it)`);

  for (const disk of blockBodies(ctx.r.args.ebs_block_device)) {
    const diskGb = resolveNumber(disk.volume_size, ctx.ir);
    const diskType = resolveString(disk.volume_type, ctx.ir) ?? 'gp3';
    const line = diskGb === undefined ? undefined : ebsLine(ctx, diskGb, diskType);
    if (line) lines.push(line);
    else assumptions.push('An extra EBS volume without a literal size or a listed type is not included');
  }

  // an instance with a public IPv4 pays for it by the hour — unless it's an Elastic IP, priced there
  const subnet = referenced(ctx.r, 'subnet_id', ctx.ir);
  const associate = ctx.bool('associate_public_ip_address');
  const fromSubnet = subnet ? resolveBool(subnet.args.map_public_ip_on_launch, ctx.ir) === true : false;
  if (associate ?? fromSubnet) {
    if (referencing(ctx.r, 'aws_eip', 'instance', ctx.ir).length) {
      assumptions.push('Its public IP is an Elastic IP, priced on the aws_eip');
    } else {
      lines.push(hourly('Public IPv4', ctx.at(aws.publicIpv4Hour)));
      assumptions.push(
        associate
          ? 'associate_public_ip_address gives it a public IPv4'
          : `Subnet ${subnet!.name} gives it a public IPv4 (map_public_ip_on_launch)`,
      );
    }
  }
  return fixed(lines, assumptions);
};

const dbInstance: Rule = (ctx) => {
  const { rds } = ctx.book.aws;
  const cls = ctx.str('instance_class');
  const engine = ctx.str('engine');
  const rates = cls ? rds.instance[cls] : undefined;
  if (!cls || !rates) return unpriced('instance_class', cls);
  if (!engine) return unknown("engine isn't set to a literal value");
  if (engine.startsWith('aurora')) return unknown('Aurora is billed per cluster instance and I/O — not in the price table');
  const deploy = rates[engine];
  if (!deploy) return unpriced('engine', engine);
  const multi = ctx.bool('multi_az') === true;
  const lines = [hourly(cls, ctx.at(multi ? deploy.multi : deploy.single))];
  const assumptions = [`${ENGINE_LABEL[engine] ?? engine}, ${multi ? 'Multi-AZ (a standby in a second zone)' : 'Single-AZ'}`];

  const gb = ctx.num('allocated_storage');
  const storageType = ctx.str('storage_type') ?? (ctx.r.args.iops ? 'io1' : 'gp2');
  const storage = rds.storage[storageType];
  if (gb === undefined) assumptions.push('No literal allocated_storage — storage not included');
  else if (!storage) assumptions.push(`Storage type ${storageType} isn't in the price table — not included`);
  else lines.push(perGbMonth(`${gb} GB ${storageType}`, gb, ctx.at(multi ? storage.multi : storage.single)));
  if (!ctx.r.args.storage_type) assumptions.push(`storage_type not set: ${storageType}, the AWS default`);
  if (storageType === 'io1' || storageType === 'io2') assumptions.push('Provisioned IOPS are billed on top');
  assumptions.push('Backups beyond the free allowance and snapshots are extra');
  return fixed(lines, assumptions);
};

const cacheCluster: Rule = (ctx) => {
  if (ctx.r.args.replication_group_id) return free('Its nodes are billed through the replication group');
  const node = ctx.str('node_type');
  const engine = ctx.str('engine') ?? 'redis';
  const rates = node ? ctx.book.aws.elasticache[node] : undefined;
  if (!node || !rates) return unpriced('node_type', node);
  const hourRate = rates[engine];
  if (hourRate === undefined) return unpriced('engine', engine);
  const nodes = ctx.num('num_cache_nodes') ?? 1;
  return fixed([hourly(node, ctx.at(hourRate), nodes)], [`${plural(nodes, 'node')}, ${engine === 'redis' ? 'Redis OSS' : engine}`]);
};

const ecsService: Rule = (ctx) => {
  const { fargate } = ctx.book.aws;
  const providers = blockBodies(ctx.r.args.capacity_provider_strategy).map((b) => resolveString(b.capacity_provider, ctx.ir) ?? '');
  const launch = ctx.str('launch_type') ?? (providers.some((p) => p.startsWith('FARGATE')) ? 'FARGATE' : providers.length ? 'CAPACITY' : 'EC2');
  if (providers.includes('FARGATE_SPOT')) return unknown('Fargate Spot: the price changes with demand');
  if (launch === 'EC2' || launch === 'CAPACITY') return free("Runs on the cluster's EC2 instances — those are billed, not the service");
  if (launch !== 'FARGATE') return unpriced('launch_type', launch);

  const task = referenced(ctx.r, 'task_definition', ctx.ir);
  if (!task) return unknown("The task definition isn't in this project, so its CPU and memory are unknown");
  const cpu = resolveNumber(task.args.cpu, ctx.ir);
  const memory = resolveNumber(task.args.memory, ctx.ir);
  if (!cpu || !memory) return unknown(`Task definition ${task.name} has no literal cpu and memory`);
  const arm = resolveString(blockBody(task.args.runtime_platform)?.cpu_architecture, ctx.ir) === 'ARM64';
  const vcpu = cpu / 1024;
  const gb = memory / 1024;
  const vcpuRate = ctx.at(arm ? fargate.armVcpuHour : fargate.vcpuHour);
  const gbRate = ctx.at(arm ? fargate.armGbHour : fargate.gbHour);
  const tasks = ctx.num('desired_count');
  const n = tasks ?? 0;
  return fixed(
    [hourly(`${plural(n, 'task')} (${vcpu} vCPU, ${gb} GB)`, vcpu * vcpuRate + gb * gbRate, n)],
    [
      `Fargate ${arm ? 'ARM' : 'Linux/x86'}: ${vcpu} vCPU × ${rate(vcpuRate)} + ${gb} GB × ${rate(gbRate)} per task-hour`,
      tasks === undefined ? 'desired_count not set: Terraform starts 0 tasks' : `${plural(n, 'task')} running all month (autoscaling changes this)`,
    ],
  );
};

const nodeGroup: Rule = (ctx) => {
  const { aws } = ctx.book;
  const types = ctx.r.args.instance_types;
  const listed = types?.kind === 'list' && types.items[0] ? resolveString(types.items[0], ctx.ir) : undefined;
  if (types && !listed) return unpriced('instance_types', undefined);
  const type = listed ?? 't3.medium';
  if (ctx.str('capacity_type') === 'SPOT') return unknown('Spot capacity: the price changes with demand');
  const scaling = ctx.block('scaling_config');
  const nodes = scaling ? ctx.num('desired_size', scaling) : undefined;
  if (nodes === undefined) return unknown("scaling_config.desired_size isn't a literal number");
  const hourRate = aws.ec2[type];
  if (hourRate === undefined) return unpriced('instance_types', type);
  const disk = ctx.num('disk_size') ?? 20;
  const lines = [hourly(type, ctx.at(hourRate), nodes)];
  const gp2 = aws.ebs.gp2;
  if (gp2 !== undefined) lines.push(perGbMonth(`${nodes} × ${disk} GB gp2`, nodes * disk, ctx.at(gp2)));
  return fixed(lines, [
    `${plural(nodes, 'node')} (desired_size; autoscaling changes this)${listed ? '' : ', t3.medium — the default instance type'}`,
    `${disk} GB gp2 root disk per node (the EKS default)`,
  ]);
};

const loadBalancer: Rule = (ctx) => {
  const { elb } = ctx.book.aws;
  const type = ctx.str('load_balancer_type') ?? 'application';
  if (type === 'application') {
    return fixed([hourly('Application Load Balancer', ctx.at(elb.albHour))], [`Plus ${rate(ctx.at(elb.albLcuHour))} per LCU-hour, by usage (connections, traffic, rule evaluations)`]);
  }
  if (type === 'network') {
    return fixed([hourly('Network Load Balancer', ctx.at(elb.nlbHour))], [`Plus ${rate(ctx.at(elb.nlbLcuHour))} per NLCU-hour, by usage`]);
  }
  return unpriced('load_balancer_type', type);
};

const natGateway: Rule = (ctx) => {
  const { nat } = ctx.book.aws;
  return fixed([hourly('NAT gateway', ctx.at(nat.hour))], [`Plus ${rate(ctx.at(nat.gb))} per GB processed`]);
};

const eip: Rule = (ctx) =>
  fixed([hourly('Public IPv4', ctx.at(ctx.book.aws.publicIpv4Hour))], ['Public IPv4 addresses are billed whether attached or not']);

// Route 53 is a global service: no regional multiplier
const hostedZone: Rule = (ctx) => {
  const { route53 } = ctx.book.aws;
  return fixed([monthlyFee('Hosted zone', route53.zoneMonth)], [`Plus ${rate(route53.queriesPerMillion)} per million standard queries`]);
};

const kmsKey: Rule = (ctx) => {
  const { kms } = ctx.book.aws;
  return fixed([monthlyFee('Customer managed key', ctx.at(kms.keyMonth))], [`Plus ${rate(ctx.at(kms.requestsPer10k))} per 10,000 requests`]);
};

const secret: Rule = (ctx) => {
  const { secretsManager } = ctx.book.aws;
  return fixed([monthlyFee('Secret', ctx.at(secretsManager.secretMonth))], [`Plus ${rate(ctx.at(secretsManager.apiPer10k))} per 10,000 API calls`]);
};

const eksCluster: Rule = (ctx) =>
  fixed(
    [hourly('EKS control plane', ctx.at(ctx.book.aws.eks.clusterHour))],
    ['Standard Kubernetes version support (extended support costs more)', 'Worker nodes are priced on their node groups'],
  );

const ebsVolume: Rule = (ctx) => {
  const gb = ctx.num('size');
  const type = ctx.str('type') ?? 'gp3';
  if (gb === undefined) return unknown("size isn't a literal number (a volume from a snapshot takes the snapshot's size)");
  const line = ebsLine(ctx, gb, type);
  return line ? fixed([line], ctx.r.args.type ? [] : ['type not set: gp3']) : unpriced('type', type);
};

const s3: Rule = (ctx) =>
  usage(`Billed by use: ${rate(ctx.at(ctx.book.aws.usage.s3StandardGbMonth))} per GB-month in S3 Standard, plus requests and data transfer out.`);

const lambda: Rule = (ctx) => {
  const u = ctx.book.aws.usage;
  return usage(
    `Billed per request (${rate(ctx.at(u.lambdaRequestsPerMillion))} per million) and compute time (${rate(ctx.at(u.lambdaGbSecond))} per GB-second). Free tier: 1 million requests and 400,000 GB-seconds a month.`,
  );
};

const cloudfront: Rule = (ctx) => {
  const u = ctx.book.aws.usage;
  return usage(
    `Pay-as-you-go: from ${rate(u.cloudfrontGb)} per GB served and ${rate(u.cloudfrontHttpsPer10k)} per 10,000 HTTPS requests. Flat-rate plans, including a free one, are an alternative.`,
  );
};

const dynamodb: Rule = (ctx) => {
  const mode = ctx.str('billing_mode') ?? 'PROVISIONED';
  if (mode !== 'PAY_PER_REQUEST') return unknown('Provisioned capacity (the Terraform default billing_mode) isn\'t in the price table');
  const u = ctx.book.aws.usage;
  return usage(
    `On-demand: ${rate(ctx.at(u.dynamodbWritePerMillion))} per million writes, ${rate(ctx.at(u.dynamodbReadPerMillion))} per million reads and ${rate(ctx.at(u.dynamodbGbMonth))} per GB-month stored.`,
  );
};

const sqs: Rule = (ctx) =>
  usage(`${rate(ctx.at(ctx.book.aws.usage.sqsPerMillion))} per million requests. Free tier: the first 1 million requests each month.`);

const sns: Rule = (ctx) =>
  usage(`${rate(ctx.at(ctx.book.aws.usage.snsPerMillion))} per million publishes, plus deliveries (priced per protocol).`);

const httpApi: Rule = (ctx) =>
  (ctx.str('protocol_type') ?? 'HTTP') === 'WEBSOCKET'
    ? usage('WebSocket APIs are billed per message and per connection-minute.')
    : usage(`${rate(ctx.at(ctx.book.aws.usage.apiGatewayHttpPerMillion))} per million HTTP API requests.`);

const ecr: Rule = (ctx) => usage(`${rate(ctx.at(ctx.book.aws.usage.ecrGbMonth))} per GB-month of stored images, plus data transfer out.`);

const logGroup: Rule = () => usage('Billed per GB ingested and stored.');

const FREE: Record<string, string | undefined> = {
  aws_vpc: undefined,
  aws_subnet: undefined,
  aws_security_group: undefined,
  aws_vpc_security_group_ingress_rule: undefined,
  aws_vpc_security_group_egress_rule: undefined,
  aws_security_group_rule: undefined,
  aws_network_acl: undefined,
  aws_route_table: undefined,
  aws_route_table_association: undefined,
  aws_internet_gateway: 'Data transfer through it is billed separately',
  aws_db_subnet_group: undefined,
  aws_lb_target_group: 'Billed through its load balancer',
  aws_lb_listener: 'Billed through its load balancer',
  aws_ecs_cluster: 'What runs in it is billed',
  aws_ecs_task_definition: 'Billed through the ECS service that runs it',
  aws_route53_record: 'Included in the hosted zone; queries are billed there',
  aws_apigatewayv2_integration: 'Billed through the API',
  aws_apigatewayv2_route: 'Billed through the API',
  aws_apigatewayv2_stage: 'Billed through the API',
  aws_lambda_permission: undefined,
  aws_sns_topic_subscription: 'Deliveries are billed on the topic',
  aws_s3_bucket_public_access_block: undefined,
  aws_launch_template: 'The instances launched from it are billed',
};

export const AWS_RULES: Record<string, Rule> = {
  aws_instance: instance,
  aws_db_instance: dbInstance,
  aws_elasticache_cluster: cacheCluster,
  aws_ecs_service: ecsService,
  aws_eks_cluster: eksCluster,
  aws_eks_node_group: nodeGroup,
  aws_lb: loadBalancer,
  aws_nat_gateway: natGateway,
  aws_eip: eip,
  aws_route53_zone: hostedZone,
  aws_kms_key: kmsKey,
  aws_secretsmanager_secret: secret,
  aws_ebs_volume: ebsVolume,
  aws_s3_bucket: s3,
  aws_lambda_function: lambda,
  aws_cloudfront_distribution: cloudfront,
  aws_dynamodb_table: dynamodb,
  aws_sqs_queue: sqs,
  aws_sns_topic: sns,
  aws_apigatewayv2_api: httpApi,
  aws_ecr_repository: ecr,
  aws_cloudwatch_log_group: logGroup,
  ...Object.fromEntries(Object.entries(FREE).map(([type, note]) => [type, () => free(note)])),
};

/** IAM and S3 bucket settings (policies, versioning, encryption…) cost nothing themselves */
export const AWS_FREE_PREFIXES = [/^aws_iam_/, /^aws_s3_bucket_/];
