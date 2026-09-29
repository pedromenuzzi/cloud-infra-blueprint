/** Google Cloud pricing rules, one per resource type (rates: book.gcp, us-central1). Words: ./messages.ts. */
import type { Expression } from '@/ir/types';
import { blockBodies, blockBody, referenced, resolveNumber, resolveString } from '../resolve';
import type { CostLine } from '../types';
import { fixed, free, unknown, usage, type Rule, type RuleContext } from './common';
import type { ServiceMessages } from './messages';

/** a zone ends in "-a"; anything else (us-central1) is a region: a regional cluster spreads its nodes over 3 zones */
const isZone = (location: string) => /-[a-z]$/.test(location);

function nodeZones(location: string | undefined, from: Record<string, Expression>): number {
  const pinned = from.node_locations;
  if (pinned?.kind === 'list' && pinned.items.length) return pinned.items.length;
  return location && !isZone(location) ? 3 : 1;
}

/** the machines and boot disks of `nodes` GKE nodes, or why they can't be priced */
function nodeLines(ctx: RuleContext, config: Record<string, Expression> | undefined, nodes: number): CostLine[] | { unpriced: string } {
  const { gcp } = ctx.book;
  const machine = (config ? ctx.str('machine_type', config) : undefined) ?? 'e2-medium';
  const hourRate = gcp.machine[machine];
  if (hourRate === undefined) return { unpriced: machine };
  const gb = (config ? ctx.num('disk_size_gb', config) : undefined) ?? 100;
  const type = (config ? ctx.str('disk_type', config) : undefined) ?? 'pd-balanced';
  const lines = [ctx.hourly(machine, ctx.at(hourRate), nodes)];
  const perGb = gcp.disk[type];
  if (perGb !== undefined) lines.push(ctx.perGbMonth(ctx.m.nodesGb(nodes, gb, type), nodes * gb, ctx.at(perGb)));
  return lines;
}

const instance: Rule = (ctx) => {
  const { gcp } = ctx.book;
  const { m } = ctx;
  const machine = ctx.str('machine_type');
  const hourRate = machine ? gcp.machine[machine] : undefined;
  if (!machine || hourRate === undefined) return ctx.unpriced('machine_type', machine);
  const scheduling = ctx.block('scheduling');
  if (scheduling && (ctx.bool('preemptible', scheduling) || ctx.str('provisioning_model', scheduling) === 'SPOT')) {
    return unknown(m.priceChanges('preemptible'));
  }
  const lines = [ctx.hourly(machine, ctx.at(hourRate))];
  const assumptions: string[] = [];
  const init = blockBody(ctx.block('boot_disk')?.initialize_params);
  const size = init ? ctx.num('size', init) : undefined;
  const type = (init ? ctx.str('type', init) : undefined) ?? 'pd-standard';
  const gb = size ?? 10;
  const perGb = gcp.disk[type];
  if (perGb !== undefined) lines.push(ctx.perGbMonth(m.gb(gb, type), gb, ctx.at(perGb)));
  if (size === undefined) assumptions.push(m.gcp.bootDiskDefault(gb));
  if (blockBodies(ctx.r.args.network_interface).some((nic) => nic.access_config)) {
    lines.push(ctx.hourly(m.gcp.externalIpv4, ctx.at(gcp.externalIpHour)));
  }
  if (/^(n1|n2|n2d)-/.test(machine)) assumptions.push(m.gcp.sustainedUse);
  if (machine === 'e2-micro') assumptions.push(m.gcp.e2MicroFree);
  return fixed(lines, assumptions);
};

const cloudSql: Rule = (ctx) => {
  const { sql } = ctx.book.gcp;
  const { m } = ctx;
  const version = ctx.str('database_version') ?? '';
  if (version.startsWith('SQLSERVER')) return unknown(m.gcp.sqlServer);
  const settings = ctx.block('settings');
  const tier = settings ? ctx.str('tier', settings) : undefined;
  if (settings && ctx.str('edition', settings) === 'ENTERPRISE_PLUS') return unknown(m.gcp.enterprisePlus);
  const custom = tier ? /^db-custom-(\d+)-(\d+)$/.exec(tier) : null;
  const hourRate = tier ? (sql.shared[tier] ?? (custom ? Number(custom[1]) * sql.vcpuHour + (Number(custom[2]) / 1024) * sql.gbHour : undefined)) : undefined;
  if (!tier || hourRate === undefined) return ctx.unpriced('settings.tier', tier);
  const ha = settings ? ctx.str('availability_type', settings) === 'REGIONAL' : false;
  const copies = ha ? 2 : 1;
  const gb = (settings ? ctx.num('disk_size', settings) : undefined) ?? 10;
  const disk = (settings ? ctx.str('disk_type', settings) : undefined) === 'PD_HDD' ? 'HDD' : 'SSD';
  const lines = [ctx.hourly(tier, ctx.at(hourRate), copies)];
  const perGb = sql.storage[disk];
  if (perGb !== undefined) lines.push(ctx.perGbMonth(m.gcp.sqlStorage(copies, gb, disk), gb * copies, ctx.at(perGb)));
  return fixed(lines, [
    m.gcp.sqlHa(ha),
    ...(custom ? [m.gcp.sqlCustom(custom[1], ctx.rate(ctx.at(sql.vcpuHour)), Number(custom[2]) / 1024, ctx.rate(ctx.at(sql.gbHour)))] : []),
    ...(settings?.disk_size ? [] : [m.gcp.diskDefault]),
  ]);
};

const gkeCluster: Rule = (ctx) => {
  const { gcp } = ctx.book;
  const { m } = ctx;
  const lines = [ctx.hourly(m.gcp.gkeFee, ctx.at(gcp.gke.clusterHour))];
  const assumptions = [m.gcp.gkeFree];
  if (ctx.bool('enable_autopilot')) {
    assumptions.push(m.gcp.autopilot);
    return fixed(lines, assumptions);
  }
  if (ctx.bool('remove_default_node_pool')) return fixed(lines, [...assumptions, m.gcp.poolNodes]);
  const location = ctx.str('location');
  const zones = nodeZones(location, ctx.r.args);
  const perZone = ctx.num('initial_node_count') ?? 1;
  const nodes = perZone * zones;
  const pool = nodeLines(ctx, ctx.block('node_config'), nodes);
  if (!Array.isArray(pool)) return ctx.unpriced('machine_type', pool.unpriced);
  assumptions.push(m.gcp.defaultPool(nodes, perZone, zones));
  return fixed([...lines, ...pool], assumptions);
};

const nodePool: Rule = (ctx) => {
  const cluster = referenced(ctx.r, 'cluster', ctx.ir);
  const location = ctx.str('location') ?? (cluster ? resolveString(cluster.args.location, ctx.ir) : undefined);
  const zones = nodeZones(location, ctx.r.args);
  const scaling = ctx.block('autoscaling');
  const perZone = ctx.num('node_count') ?? ctx.num('initial_node_count') ?? (scaling ? resolveNumber(scaling.min_node_count, ctx.ir) : undefined) ?? 1;
  const nodes = perZone * zones;
  const lines = nodeLines(ctx, ctx.block('node_config'), nodes);
  if (!Array.isArray(lines)) return ctx.unpriced('machine_type', lines.unpriced);
  return fixed(lines, [ctx.m.gcp.pool(nodes, perZone, zones, !!scaling)]);
};

const memorystore: Rule = (ctx) => {
  const { memorystore: tiers } = ctx.book.gcp;
  const tier = ctx.str('tier') ?? 'BASIC';
  const gb = ctx.num('memory_size_gb');
  if (gb === undefined) return ctx.unpriced('memory_size_gb', undefined);
  const table = tier === 'STANDARD_HA' ? tiers.standard : tier === 'BASIC' ? tiers.basic : undefined;
  if (!table) return ctx.unpriced('tier', tier);
  const band = table.find((t) => gb <= t.maxGb) ?? table[table.length - 1];
  return fixed(
    [ctx.hourly(ctx.m.gcp.memorystore(gb, tier === 'STANDARD_HA'), ctx.at(band.gbHour), gb)],
    [ctx.m.gcp.perGbHour(ctx.rate(ctx.at(band.gbHour)))],
  );
};

const forwardingRule: Rule = (ctx) =>
  fixed([ctx.hourly(ctx.m.gcp.forwardingRule, ctx.at(ctx.book.gcp.lb.forwardingRuleHour))], [ctx.m.gcp.lbData]);

// Cloud DNS is global: no regional multiplier
const dnsZone: Rule = (ctx) => fixed([ctx.monthlyFee(ctx.m.gcp.managedZone, ctx.book.gcp.dns.zoneMonth)], [ctx.m.gcp.queries]);

const cloudNat: Rule = (ctx) => {
  const { nat } = ctx.book.gcp;
  return usage(ctx.m.gcp.nat(ctx.rate(ctx.at(nat.vmHour)), ctx.rate(ctx.at(nat.maxHour)), ctx.rate(ctx.at(nat.gb))));
};

const cloudRun: Rule = (ctx) => {
  const u = ctx.book.gcp.usage;
  const scaling = blockBody(ctx.block('template')?.scaling);
  const minimum = scaling ? resolveNumber(scaling.min_instance_count, ctx.ir) : undefined;
  return usage(
    ctx.m.gcp.cloudRun(ctx.rate(ctx.at(u.cloudRunVcpuSecond)), ctx.rate(ctx.at(u.cloudRunGibSecond)), ctx.rate(ctx.at(u.cloudRunPerMillion))),
    minimum ? [ctx.m.gcp.minInstances(minimum)] : undefined,
  );
};

/** free types, and what to say about them (in the rule's language) */
const FREE: Record<string, ((m: ServiceMessages) => string) | undefined> = {
  google_compute_network: undefined,
  google_compute_subnetwork: undefined,
  google_compute_firewall: undefined,
  google_compute_router: undefined,
  google_service_account: undefined,
  google_compute_url_map: (m) => m.gcp.free.lbPart,
  google_compute_target_http_proxy: (m) => m.gcp.free.lbPart,
  google_dns_record_set: (m) => m.gcp.free.record,
};

export const GCP_RULES: Record<string, Rule> = {
  google_compute_instance: instance,
  google_sql_database_instance: cloudSql,
  google_container_cluster: gkeCluster,
  google_container_node_pool: nodePool,
  google_redis_instance: memorystore,
  google_compute_global_forwarding_rule: forwardingRule,
  google_dns_managed_zone: dnsZone,
  google_compute_router_nat: cloudNat,
  google_cloud_run_v2_service: cloudRun,
  google_cloudfunctions2_function: (ctx) => usage(ctx.m.gcp.functions),
  google_storage_bucket: (ctx) => usage(ctx.m.gcp.storage(ctx.rate(ctx.at(ctx.book.gcp.usage.storageStandardGbMonth)))),
  google_bigquery_dataset: (ctx) => usage(ctx.m.gcp.bigquery(ctx.rate(ctx.book.gcp.usage.bigqueryTibScanned))),
  google_pubsub_topic: (ctx) => usage(ctx.m.gcp.pubsub(ctx.rate(ctx.book.gcp.usage.pubsubTib))),
  google_pubsub_subscription: (ctx) => usage(ctx.m.gcp.subscription),
  google_artifact_registry_repository: (ctx) => usage(ctx.m.gcp.artifacts(ctx.rate(ctx.at(ctx.book.gcp.usage.artifactGbMonth)))),
  google_secret_manager_secret: (ctx) => usage(ctx.m.gcp.secrets(ctx.rate(ctx.book.gcp.usage.secretVersionMonth))),
  google_compute_backend_bucket: (ctx) => (ctx.bool('enable_cdn') ? usage(ctx.m.gcp.cdn) : free(ctx.m.gcp.viaLb)),
  ...Object.fromEntries(Object.entries(FREE).map(([type, note]): [string, Rule] => [type, (ctx) => free(note?.(ctx.m))])),
};

export const GCP_FREE_PREFIXES = [/^google_project_iam_/, /^google_.*_iam_(member|binding|policy)$/];
