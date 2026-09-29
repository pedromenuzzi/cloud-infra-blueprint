/** AWS pricing rules, one per resource type (rates: book.aws, us-east-1). Words: ./messages.ts. */
import { blockBodies, blockBody, referenced, referencing, resolveBool, resolveNumber, resolveString } from '../resolve';
import type { CostLine } from '../types';
import { fixed, free, unknown, usage, type Rule, type RuleContext } from './common';
import type { ServiceMessages } from './messages';

const ENGINE_LABEL: Record<string, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB' };

function ebsLine(ctx: RuleContext, gb: number, type: string): CostLine | undefined {
  const perGb = ctx.book.aws.ebs[type];
  return perGb === undefined ? undefined : ctx.perGbMonth(ctx.m.gb(gb, type), gb, ctx.at(perGb));
}

const instance: Rule = (ctx) => {
  const { aws } = ctx.book;
  const { m } = ctx;
  const type = ctx.str('instance_type');
  if (!type && ctx.r.args.launch_template) return unknown(m.aws.fromLaunchTemplate);
  const hourRate = type ? aws.ec2[type] : undefined;
  if (!type || hourRate === undefined) return ctx.unpriced('instance_type', type);
  const tenancy = ctx.str('tenancy');
  if (tenancy && tenancy !== 'default') return unknown(m.aws.tenancy(tenancy));
  if (ctx.r.args.instance_market_options) return unknown(m.priceChanges('spot-instances'));

  const lines = [ctx.hourly(type, ctx.at(hourRate))];
  const assumptions = [m.aws.linuxShared];

  const root = ctx.block('root_block_device');
  const size = root ? ctx.num('volume_size', root) : undefined;
  const volume = (root ? ctx.str('volume_type', root) : undefined) ?? 'gp3';
  const gb = size ?? 8;
  const rootLine = ebsLine(ctx, gb, volume);
  if (rootLine) lines.push(rootLine);
  else assumptions.push(m.notIncludedType(m.aws.rootVolumeType, volume));
  if (size === undefined) assumptions.push(m.aws.rootVolumeDefault(gb, volume));

  for (const disk of blockBodies(ctx.r.args.ebs_block_device)) {
    const diskGb = resolveNumber(disk.volume_size, ctx.ir);
    const diskType = resolveString(disk.volume_type, ctx.ir) ?? 'gp3';
    const line = diskGb === undefined ? undefined : ebsLine(ctx, diskGb, diskType);
    if (line) lines.push(line);
    else assumptions.push(m.aws.extraVolume);
  }

  // an instance with a public IPv4 pays for it by the hour — unless it's an Elastic IP, priced there
  const subnet = referenced(ctx.r, 'subnet_id', ctx.ir);
  const associate = ctx.bool('associate_public_ip_address');
  const fromSubnet = subnet ? resolveBool(subnet.args.map_public_ip_on_launch, ctx.ir) === true : false;
  if (associate ?? fromSubnet) {
    if (referencing(ctx.r, 'aws_eip', 'instance', ctx.ir).length) {
      assumptions.push(m.aws.eipPriced);
    } else {
      lines.push(ctx.hourly(m.aws.publicIpv4, ctx.at(aws.publicIpv4Hour)));
      assumptions.push(associate ? m.aws.associatePublicIp : m.aws.subnetPublicIp(subnet!.name));
    }
  }
  return fixed(lines, assumptions);
};

const dbInstance: Rule = (ctx) => {
  const { rds } = ctx.book.aws;
  const { m } = ctx;
  const cls = ctx.str('instance_class');
  const engine = ctx.str('engine');
  const rates = cls ? rds.instance[cls] : undefined;
  if (!cls || !rates) return ctx.unpriced('instance_class', cls);
  if (!engine) return ctx.unpriced('engine', undefined);
  if (engine.startsWith('aurora')) return unknown(m.aws.aurora);
  const deploy = rates[engine];
  if (!deploy) return ctx.unpriced('engine', engine);
  const multi = ctx.bool('multi_az') === true;
  const lines = [ctx.hourly(cls, ctx.at(multi ? deploy.multi : deploy.single))];
  const assumptions = [m.aws.deployment(ENGINE_LABEL[engine] ?? engine, multi)];

  const gb = ctx.num('allocated_storage');
  const storageType = ctx.str('storage_type') ?? (ctx.r.args.iops ? 'io1' : 'gp2');
  const storage = rds.storage[storageType];
  if (gb === undefined) assumptions.push(m.aws.noStorage);
  else if (!storage) assumptions.push(m.notIncludedType(m.aws.storageType, storageType));
  else lines.push(ctx.perGbMonth(m.gb(gb, storageType), gb, ctx.at(multi ? storage.multi : storage.single)));
  if (!ctx.r.args.storage_type) assumptions.push(m.aws.storageDefault(storageType));
  if (storageType === 'io1' || storageType === 'io2') assumptions.push(m.aws.iops);
  assumptions.push(m.aws.backups);
  return fixed(lines, assumptions);
};

const cacheCluster: Rule = (ctx) => {
  if (ctx.r.args.replication_group_id) return free(ctx.m.aws.replicationGroup);
  const node = ctx.str('node_type');
  const engine = ctx.str('engine') ?? 'redis';
  const rates = node ? ctx.book.aws.elasticache[node] : undefined;
  if (!node || !rates) return ctx.unpriced('node_type', node);
  const hourRate = rates[engine];
  if (hourRate === undefined) return ctx.unpriced('engine', engine);
  const nodes = ctx.num('num_cache_nodes') ?? 1;
  return fixed([ctx.hourly(node, ctx.at(hourRate), nodes)], [ctx.m.aws.cacheNodes(nodes, engine === 'redis' ? 'Redis OSS' : engine)]);
};

const ecsService: Rule = (ctx) => {
  const { fargate } = ctx.book.aws;
  const { m } = ctx;
  const providers = blockBodies(ctx.r.args.capacity_provider_strategy).map((b) => resolveString(b.capacity_provider, ctx.ir) ?? '');
  const launch = ctx.str('launch_type') ?? (providers.some((p) => p.startsWith('FARGATE')) ? 'FARGATE' : providers.length ? 'CAPACITY' : 'EC2');
  if (providers.includes('FARGATE_SPOT')) return unknown(m.priceChanges('fargate-spot'));
  if (launch === 'EC2' || launch === 'CAPACITY') return free(m.aws.clusterEc2);
  if (launch !== 'FARGATE') return ctx.unpriced('launch_type', launch);

  const task = referenced(ctx.r, 'task_definition', ctx.ir);
  if (!task) return unknown(m.aws.noTaskDefinition);
  const cpu = resolveNumber(task.args.cpu, ctx.ir);
  const memory = resolveNumber(task.args.memory, ctx.ir);
  if (!cpu || !memory) return unknown(m.aws.taskNoCpu(task.name));
  const arm = resolveString(blockBody(task.args.runtime_platform)?.cpu_architecture, ctx.ir) === 'ARM64';
  const vcpu = cpu / 1024;
  const gb = memory / 1024;
  const vcpuRate = ctx.at(arm ? fargate.armVcpuHour : fargate.vcpuHour);
  const gbRate = ctx.at(arm ? fargate.armGbHour : fargate.gbHour);
  const tasks = ctx.num('desired_count');
  const n = tasks ?? 0;
  return fixed(
    [ctx.hourly(m.aws.tasks(n, vcpu, gb), vcpu * vcpuRate + gb * gbRate, n)],
    [m.aws.fargateRate(arm, vcpu, ctx.rate(vcpuRate), gb, ctx.rate(gbRate)), tasks === undefined ? m.aws.noDesiredCount : m.aws.tasksAllMonth(n)],
  );
};

const nodeGroup: Rule = (ctx) => {
  const { aws } = ctx.book;
  const { m } = ctx;
  const types = ctx.r.args.instance_types;
  const listed = types?.kind === 'list' && types.items[0] ? resolveString(types.items[0], ctx.ir) : undefined;
  if (types && !listed) return ctx.unpriced('instance_types', undefined);
  const type = listed ?? 't3.medium';
  if (ctx.str('capacity_type') === 'SPOT') return unknown(m.priceChanges('spot-capacity'));
  const scaling = ctx.block('scaling_config');
  const nodes = scaling ? ctx.num('desired_size', scaling) : undefined;
  if (nodes === undefined) return unknown(m.aws.desiredSize);
  const hourRate = aws.ec2[type];
  if (hourRate === undefined) return ctx.unpriced('instance_types', type);
  const disk = ctx.num('disk_size') ?? 20;
  const lines = [ctx.hourly(type, ctx.at(hourRate), nodes)];
  const gp2 = aws.ebs.gp2;
  if (gp2 !== undefined) lines.push(ctx.perGbMonth(m.nodesGb(nodes, disk, 'gp2'), nodes * disk, ctx.at(gp2)));
  return fixed(lines, [m.aws.nodeGroupNodes(nodes, !listed), m.aws.nodeGroupDisk(disk)]);
};

const loadBalancer: Rule = (ctx) => {
  const { elb } = ctx.book.aws;
  const type = ctx.str('load_balancer_type') ?? 'application';
  if (type === 'application') {
    return fixed([ctx.hourly('Application Load Balancer', ctx.at(elb.albHour))], [ctx.m.aws.albLcu(ctx.rate(ctx.at(elb.albLcuHour)))]);
  }
  if (type === 'network') {
    return fixed([ctx.hourly('Network Load Balancer', ctx.at(elb.nlbHour))], [ctx.m.aws.nlbLcu(ctx.rate(ctx.at(elb.nlbLcuHour)))]);
  }
  return ctx.unpriced('load_balancer_type', type);
};

const natGateway: Rule = (ctx) => {
  const { nat } = ctx.book.aws;
  return fixed([ctx.hourly(ctx.m.aws.natGateway, ctx.at(nat.hour))], [ctx.m.aws.perGbProcessed(ctx.rate(ctx.at(nat.gb)))]);
};

const eip: Rule = (ctx) => fixed([ctx.hourly(ctx.m.aws.publicIpv4, ctx.at(ctx.book.aws.publicIpv4Hour))], [ctx.m.aws.eipBilled]);

// Route 53 is a global service: no regional multiplier
const hostedZone: Rule = (ctx) => {
  const { route53 } = ctx.book.aws;
  return fixed([ctx.monthlyFee(ctx.m.aws.hostedZone, route53.zoneMonth)], [ctx.m.aws.queries(ctx.rate(route53.queriesPerMillion))]);
};

const kmsKey: Rule = (ctx) => {
  const { kms } = ctx.book.aws;
  return fixed([ctx.monthlyFee(ctx.m.aws.kmsKey, ctx.at(kms.keyMonth))], [ctx.m.aws.kmsRequests(ctx.rate(ctx.at(kms.requestsPer10k)))]);
};

const secret: Rule = (ctx) => {
  const { secretsManager } = ctx.book.aws;
  return fixed(
    [ctx.monthlyFee(ctx.m.aws.secret, ctx.at(secretsManager.secretMonth))],
    [ctx.m.aws.secretCalls(ctx.rate(ctx.at(secretsManager.apiPer10k)))],
  );
};

const eksCluster: Rule = (ctx) =>
  fixed([ctx.hourly(ctx.m.aws.eksControlPlane, ctx.at(ctx.book.aws.eks.clusterHour))], [ctx.m.aws.eksSupport, ctx.m.aws.eksNodes]);

const ebsVolume: Rule = (ctx) => {
  const gb = ctx.num('size');
  const type = ctx.str('type') ?? 'gp3';
  if (gb === undefined) return unknown(ctx.m.aws.ebsSize);
  const line = ebsLine(ctx, gb, type);
  return line ? fixed([line], ctx.r.args.type ? [] : [ctx.m.aws.ebsType]) : ctx.unpriced('type', type);
};

const s3: Rule = (ctx) => usage(ctx.m.aws.s3(ctx.rate(ctx.at(ctx.book.aws.usage.s3StandardGbMonth))));

const lambda: Rule = (ctx) => {
  const u = ctx.book.aws.usage;
  return usage(ctx.m.aws.lambda(ctx.rate(ctx.at(u.lambdaRequestsPerMillion)), ctx.rate(ctx.at(u.lambdaGbSecond))));
};

const cloudfront: Rule = (ctx) => {
  const u = ctx.book.aws.usage;
  return usage(ctx.m.aws.cloudfront(ctx.rate(u.cloudfrontGb), ctx.rate(u.cloudfrontHttpsPer10k)));
};

const dynamodb: Rule = (ctx) => {
  const mode = ctx.str('billing_mode') ?? 'PROVISIONED';
  if (mode !== 'PAY_PER_REQUEST') return unknown(ctx.m.aws.dynamoProvisioned);
  const u = ctx.book.aws.usage;
  return usage(
    ctx.m.aws.dynamoOnDemand(
      ctx.rate(ctx.at(u.dynamodbWritePerMillion)),
      ctx.rate(ctx.at(u.dynamodbReadPerMillion)),
      ctx.rate(ctx.at(u.dynamodbGbMonth)),
    ),
  );
};

const sqs: Rule = (ctx) => usage(ctx.m.aws.sqs(ctx.rate(ctx.at(ctx.book.aws.usage.sqsPerMillion))));

const sns: Rule = (ctx) => usage(ctx.m.aws.sns(ctx.rate(ctx.at(ctx.book.aws.usage.snsPerMillion))));

const httpApi: Rule = (ctx) =>
  (ctx.str('protocol_type') ?? 'HTTP') === 'WEBSOCKET'
    ? usage(ctx.m.aws.websocket)
    : usage(ctx.m.aws.httpApi(ctx.rate(ctx.at(ctx.book.aws.usage.apiGatewayHttpPerMillion))));

const ecr: Rule = (ctx) => usage(ctx.m.aws.ecr(ctx.rate(ctx.at(ctx.book.aws.usage.ecrGbMonth))));

const logGroup: Rule = (ctx) => usage(ctx.m.aws.logs);

/** free types, and what to say about them (in the rule's language) */
const FREE: Record<string, ((m: ServiceMessages) => string) | undefined> = {
  aws_vpc: undefined,
  aws_subnet: undefined,
  aws_security_group: undefined,
  aws_vpc_security_group_ingress_rule: undefined,
  aws_vpc_security_group_egress_rule: undefined,
  aws_security_group_rule: undefined,
  aws_network_acl: undefined,
  aws_route_table: undefined,
  aws_route_table_association: undefined,
  aws_internet_gateway: (m) => m.aws.free.igw,
  aws_db_subnet_group: undefined,
  aws_elasticache_subnet_group: undefined,
  aws_lb_target_group: (m) => m.aws.free.viaLoadBalancer,
  aws_lb_listener: (m) => m.aws.free.viaLoadBalancer,
  aws_ecs_cluster: (m) => m.aws.free.cluster,
  aws_ecs_task_definition: (m) => m.aws.free.taskDefinition,
  aws_route53_record: (m) => m.aws.free.record,
  aws_apigatewayv2_integration: (m) => m.aws.free.viaApi,
  aws_apigatewayv2_route: (m) => m.aws.free.viaApi,
  aws_apigatewayv2_stage: (m) => m.aws.free.viaApi,
  aws_lambda_permission: undefined,
  aws_sns_topic_subscription: (m) => m.aws.free.subscription,
  aws_s3_bucket_public_access_block: undefined,
  aws_launch_template: (m) => m.aws.free.launchTemplate,
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
  ...Object.fromEntries(Object.entries(FREE).map(([type, note]): [string, Rule] => [type, (ctx) => free(note?.(ctx.m))])),
};

/** IAM and S3 bucket settings (policies, versioning, encryption…) cost nothing themselves */
export const AWS_FREE_PREFIXES = [/^aws_iam_/, /^aws_s3_bucket_/];
