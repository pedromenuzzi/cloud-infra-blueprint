/** Google Cloud pricing rules, one per resource type (rates: book.gcp, us-central1). */
import type { Expression } from '@/ir/types';
import { rate } from '../format';
import { blockBodies, blockBody, referenced, resolveNumber, resolveString } from '../resolve';
import type { CostLine } from '../types';
import { fixed, free, hourly, monthlyFee, perGbMonth, plural, unknown, unpriced, usage, type Rule, type RuleContext } from './common';

/** a zone ends in "-a"; anything else (us-central1) is a region: a regional cluster spreads its nodes over 3 zones */
const isZone = (location: string) => /-[a-z]$/.test(location);

function nodeZones(location: string | undefined, from: Record<string, Expression>): number {
  const pinned = from.node_locations;
  if (pinned?.kind === 'list' && pinned.items.length) return pinned.items.length;
  return location && !isZone(location) ? 3 : 1;
}

/** the machines and boot disks of `nodes` GKE nodes */
function nodeLines(ctx: RuleContext, config: Record<string, Expression> | undefined, nodes: number): CostLine[] | string {
  const { gcp } = ctx.book;
  const machine = (config ? ctx.str('machine_type', config) : undefined) ?? 'e2-medium';
  const hourRate = gcp.machine[machine];
  if (hourRate === undefined) return `machine_type "${machine}" isn't in the price table`;
  const gb = (config ? ctx.num('disk_size_gb', config) : undefined) ?? 100;
  const type = (config ? ctx.str('disk_type', config) : undefined) ?? 'pd-balanced';
  const lines = [hourly(machine, ctx.at(hourRate), nodes)];
  const perGb = gcp.disk[type];
  if (perGb !== undefined) lines.push(perGbMonth(`${nodes} × ${gb} GB ${type}`, nodes * gb, ctx.at(perGb)));
  return lines;
}

const instance: Rule = (ctx) => {
  const { gcp } = ctx.book;
  const machine = ctx.str('machine_type');
  const hourRate = machine ? gcp.machine[machine] : undefined;
  if (!machine || hourRate === undefined) return unpriced('machine_type', machine);
  const scheduling = ctx.block('scheduling');
  if (scheduling && (ctx.bool('preemptible', scheduling) || ctx.str('provisioning_model', scheduling) === 'SPOT')) {
    return unknown('Spot / preemptible VMs: the price changes with demand');
  }
  const lines = [hourly(machine, ctx.at(hourRate))];
  const assumptions: string[] = [];
  const init = blockBody(ctx.block('boot_disk')?.initialize_params);
  const size = init ? ctx.num('size', init) : undefined;
  const type = (init ? ctx.str('type', init) : undefined) ?? 'pd-standard';
  const gb = size ?? 10;
  const perGb = gcp.disk[type];
  if (perGb !== undefined) lines.push(perGbMonth(`${gb} GB ${type}`, gb, ctx.at(perGb)));
  if (size === undefined) assumptions.push(`Boot disk: the image size, ${gb} GB assumed`);
  if (blockBodies(ctx.r.args.network_interface).some((nic) => nic.access_config)) {
    lines.push(hourly('External IPv4', ctx.at(gcp.externalIpHour)));
  }
  if (/^(n1|n2|n2d)-/.test(machine)) assumptions.push('Sustained-use discounts (automatic for N1 / N2 / N2D) are not applied — the bill can be lower');
  if (machine === 'e2-micro') assumptions.push('The free tier covers one e2-micro a month in us-west1, us-central1 or us-east1 — not subtracted');
  return fixed(lines, assumptions);
};

const cloudSql: Rule = (ctx) => {
  const { sql } = ctx.book.gcp;
  const version = ctx.str('database_version') ?? '';
  if (version.startsWith('SQLSERVER')) return unknown('SQL Server licenses are not in the price table');
  const settings = ctx.block('settings');
  const tier = settings ? ctx.str('tier', settings) : undefined;
  if (settings && ctx.str('edition', settings) === 'ENTERPRISE_PLUS') return unknown("Enterprise Plus edition isn't in the price table");
  const custom = tier ? /^db-custom-(\d+)-(\d+)$/.exec(tier) : null;
  const hourRate = tier ? (sql.shared[tier] ?? (custom ? Number(custom[1]) * sql.vcpuHour + (Number(custom[2]) / 1024) * sql.gbHour : undefined)) : undefined;
  if (!tier || hourRate === undefined) return unpriced('settings.tier', tier);
  const ha = settings ? ctx.str('availability_type', settings) === 'REGIONAL' : false;
  const copies = ha ? 2 : 1;
  const gb = (settings ? ctx.num('disk_size', settings) : undefined) ?? 10;
  const disk = (settings ? ctx.str('disk_type', settings) : undefined) === 'PD_HDD' ? 'HDD' : 'SSD';
  const lines = [hourly(tier, ctx.at(hourRate), copies)];
  const perGb = sql.storage[disk];
  if (perGb !== undefined) lines.push(perGbMonth(`${copies === 2 ? `2 × ${gb}` : gb} GB ${disk}`, gb * copies, ctx.at(perGb)));
  return fixed(lines, [
    ha ? 'High availability (REGIONAL): compute and storage are billed twice' : 'Single zone (no high availability)',
    ...(custom ? [`${custom[1]} vCPU × ${rate(ctx.at(sql.vcpuHour))} + ${Number(custom[2]) / 1024} GB × ${rate(ctx.at(sql.gbHour))} per hour`] : []),
    ...(settings?.disk_size ? [] : ['disk_size not set: 10 GB']),
  ]);
};

const gkeCluster: Rule = (ctx) => {
  const { gcp } = ctx.book;
  const lines = [hourly('GKE cluster fee', ctx.at(gcp.gke.clusterHour))];
  const assumptions = ['The free tier covers the fee of one zonal or Autopilot cluster a month — not subtracted'];
  if (ctx.bool('enable_autopilot')) {
    assumptions.push('Autopilot: pods are billed by the CPU and memory they request, by usage');
    return fixed(lines, assumptions);
  }
  if (ctx.bool('remove_default_node_pool')) return fixed(lines, [...assumptions, 'Nodes are priced on their node pools']);
  const location = ctx.str('location');
  const zones = nodeZones(location, ctx.r.args);
  const perZone = ctx.num('initial_node_count') ?? 1;
  const nodes = perZone * zones;
  const pool = nodeLines(ctx, ctx.block('node_config'), nodes);
  if (typeof pool === 'string') return unknown(pool);
  assumptions.push(
    `Default node pool: ${plural(nodes, 'node')}${zones > 1 ? ` (${perZone} in each of ${zones} zones)` : ''}, each with a 100 GB pd-balanced boot disk unless node_config says otherwise`,
  );
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
  if (typeof lines === 'string') return unknown(lines);
  return fixed(lines, [
    `${plural(nodes, 'node')}${zones > 1 ? ` (${perZone} in each of ${zones} zones)` : ''}${scaling ? ', autoscaling changes this' : ''}`,
  ]);
};

const memorystore: Rule = (ctx) => {
  const { memorystore: tiers } = ctx.book.gcp;
  const tier = ctx.str('tier') ?? 'BASIC';
  const gb = ctx.num('memory_size_gb');
  if (gb === undefined) return unpriced('memory_size_gb', undefined);
  const table = tier === 'STANDARD_HA' ? tiers.standard : tier === 'BASIC' ? tiers.basic : undefined;
  if (!table) return unpriced('tier', tier);
  const band = table.find((t) => gb <= t.maxGb) ?? table[table.length - 1];
  return fixed([hourly(`${gb} GB ${tier === 'STANDARD_HA' ? 'Standard (HA)' : 'Basic'}`, ctx.at(band.gbHour), gb)], [`${rate(ctx.at(band.gbHour))} per GB-hour for this capacity tier`]);
};

const forwardingRule: Rule = (ctx) =>
  fixed([hourly('Forwarding rule', ctx.at(ctx.book.gcp.lb.forwardingRuleHour))], ['Plus data processed by the load balancer, by usage']);

// Cloud DNS is global: no regional multiplier
const dnsZone: Rule = (ctx) => fixed([monthlyFee('Managed zone', ctx.book.gcp.dns.zoneMonth)], ['Plus queries, by usage']);

const cloudNat: Rule = (ctx) => {
  const { nat } = ctx.book.gcp;
  return usage(
    `${rate(ctx.at(nat.vmHour))} per VM-hour using it (at most ${rate(ctx.at(nat.maxHour))} an hour per gateway) plus ${rate(ctx.at(nat.gb))} per GB processed.`,
  );
};

const cloudRun: Rule = (ctx) => {
  const u = ctx.book.gcp.usage;
  const scaling = blockBody(ctx.block('template')?.scaling);
  const minimum = scaling ? resolveNumber(scaling.min_instance_count, ctx.ir) : undefined;
  return usage(
    `Billed per vCPU-second (${rate(ctx.at(u.cloudRunVcpuSecond))}) and GiB-second (${rate(ctx.at(u.cloudRunGibSecond))}) while serving, plus ${rate(ctx.at(u.cloudRunPerMillion))} per million requests. Free tier: 2 million requests, 180,000 vCPU-seconds and 360,000 GiB-seconds a month.`,
    minimum ? [`min_instance_count = ${minimum}: those instances are billed while idle too`] : undefined,
  );
};

const FREE: Record<string, string | undefined> = {
  google_compute_network: undefined,
  google_compute_subnetwork: undefined,
  google_compute_firewall: undefined,
  google_compute_router: undefined,
  google_service_account: undefined,
  google_compute_url_map: 'Part of the load balancer — billed on its forwarding rule',
  google_compute_target_http_proxy: 'Part of the load balancer — billed on its forwarding rule',
  google_dns_record_set: 'Included in the managed zone; queries are billed there',
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
  google_cloudfunctions2_function: () => usage('Billed per invocation and compute time (Cloud Run functions). Free tier: 2 million invocations a month.'),
  google_storage_bucket: (ctx) =>
    usage(`${rate(ctx.at(ctx.book.gcp.usage.storageStandardGbMonth))} per GB-month (Standard), plus operations and data transfer. Free tier: 5 GB-months in US regions.`),
  google_bigquery_dataset: (ctx) =>
    usage(`${rate(ctx.book.gcp.usage.bigqueryTibScanned)} per TiB scanned on demand, plus storage. Free tier: 1 TiB of queries and 10 GiB of storage a month.`),
  google_pubsub_topic: (ctx) => usage(`${rate(ctx.book.gcp.usage.pubsubTib)} per TiB of messages. Free tier: 10 GiB a month.`),
  google_pubsub_subscription: () => usage('Delivered messages count toward Pub/Sub throughput, billed by usage.'),
  google_artifact_registry_repository: (ctx) => usage(`${rate(ctx.at(ctx.book.gcp.usage.artifactGbMonth))} per GB-month stored; the first 0.5 GB is free.`),
  google_secret_manager_secret: (ctx) =>
    usage(`${rate(ctx.book.gcp.usage.secretVersionMonth)} per active secret version a month, plus access operations. Free tier: 6 versions and 10,000 accesses a month.`),
  google_compute_backend_bucket: (ctx) =>
    ctx.bool('enable_cdn') ? usage('Cloud CDN: billed per GB served and per cache fill.') : free('Served through the load balancer — billed on its forwarding rule'),
  ...Object.fromEntries(Object.entries(FREE).map(([type, note]) => [type, () => free(note)])),
};

export const GCP_FREE_PREFIXES = [/^google_project_iam_/, /^google_.*_iam_(member|binding|policy)$/];
