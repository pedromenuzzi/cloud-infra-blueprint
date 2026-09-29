/** Azure pricing rules, one per resource type (rates: book.azure, eastus). */
import { rate } from '../format';
import type { AzurePrices, CostLine } from '../types';
import { fixed, free, hourly, monthlyFee, perGbMonth, plural, unknown, unpriced, usage, type Rule } from './common';

/** the smallest disk tier that holds `gb` */
function diskTier(prices: AzurePrices, type: string, gb: number) {
  return prices.disk[type]?.find((t) => t.gb >= gb);
}

const functionsNote = (ctx: Parameters<Rule>[0]) => {
  const u = ctx.book.azure.usage;
  return `Consumption plan: ${rate(ctx.at(u.functionsPerMillion))} per million executions and ${rate(ctx.at(u.functionsGbSecond))} per GB-second. Free grant: 1 million executions and 400,000 GB-s a month.`;
};

const linuxVm: Rule = (ctx) => {
  const { azure } = ctx.book;
  const size = ctx.str('size');
  const hourRate = size ? azure.vm[size] : undefined;
  if (!size || hourRate === undefined) return unpriced('size', size);
  if (ctx.str('priority') === 'Spot') return unknown('Spot VMs: the price changes with demand');
  const lines = [hourly(size, ctx.at(hourRate))];
  const assumptions = ['Linux, pay as you go'];
  const os = ctx.block('os_disk');
  const type = os ? ctx.str('storage_account_type', os) : undefined;
  const sizeGb = os ? ctx.num('disk_size_gb', os) : undefined;
  const gb = sizeGb ?? 30;
  const tier = type ? diskTier(azure, type, gb) : undefined;
  if (tier) {
    lines.push(monthlyFee(`${gb} GB OS disk (${tier.tier})`, ctx.at(tier.month)));
    if (sizeGb === undefined) assumptions.push('OS disk: the image size, 30 GB assumed');
    if (type === 'Standard_LRS') assumptions.push('Standard HDD disks also bill per transaction');
  } else {
    assumptions.push(`OS disk ${type ?? '(no storage_account_type)'} isn't in the price table — not included`);
  }
  return fixed(lines, assumptions);
};

const servicePlan: Rule = (ctx) => {
  const { appService } = ctx.book.azure;
  const sku = ctx.str('sku_name');
  if (sku === 'Y1') return usage(functionsNote(ctx));
  if (sku?.startsWith('FC')) return usage('Flex Consumption: billed per execution and GB-second, with a smaller free grant.');
  const os = ctx.str('os_type') ?? 'Linux';
  const table = os === 'Windows' ? appService.windows : os === 'Linux' ? appService.linux : undefined;
  if (!table) return unpriced('os_type', os);
  const hourRate = sku ? table[sku] : undefined;
  if (!sku || hourRate === undefined) return unpriced('sku_name', sku);
  if (hourRate === 0) return free(`${sku} is the free App Service tier`);
  const workers = ctx.num('worker_count') ?? 1;
  return fixed([hourly(`${sku} ${os}`, ctx.at(hourRate), workers)], [`${plural(workers, 'instance')} (worker_count; autoscale changes this)`]);
};

const sqlDatabase: Rule = (ctx) => {
  if (ctx.r.args.elastic_pool_id) return free('Billed through its elastic pool');
  const sku = ctx.str('sku_name');
  if (!sku) return unknown("sku_name isn't set — Azure picks a vCore tier, which isn't in the price table");
  if (/^GP_S_/.test(sku)) return usage('Serverless: billed per vCore-second used, plus storage.');
  const month = ctx.book.azure.sqlDatabase[sku];
  if (month === undefined) return unpriced('sku_name', sku);
  return fixed([monthlyFee(`SQL Database ${sku}`, ctx.at(month))], [
    'DTU model; the storage included in the tier (more storage and long-term backups are extra)',
  ]);
};

const postgres: Rule = (ctx) => {
  const { postgresFlexible } = ctx.book.azure;
  const sku = ctx.str('sku_name');
  const hourRate = sku ? postgresFlexible.compute[sku] : undefined;
  if (!sku || hourRate === undefined) return unpriced('sku_name', sku);
  const ha = ctx.block('high_availability');
  const mode = ha ? ctx.str('mode', ha) : undefined;
  const copies = mode ? 2 : 1;
  const mb = ctx.num('storage_mb');
  const gb = (mb ?? 32768) / 1024;
  return fixed(
    [
      hourly(sku, ctx.at(hourRate), copies),
      perGbMonth(`${copies === 2 ? `2 × ${gb}` : gb} GB storage`, gb * copies, ctx.at(postgresFlexible.storageGbMonth)),
    ],
    [
      mode ? `High availability (${mode}): the standby is billed like the primary` : 'No high availability',
      ...(mb === undefined ? ['storage_mb not set: 32 GB'] : []),
    ],
  );
};

const publicIp: Rule = (ctx) => {
  const sku = ctx.str('sku') ?? 'Standard';
  if (sku !== 'Standard') return unknown(`${sku} public IPs were retired on Sep 30, 2025 — not in the price table`);
  return fixed([hourly('Standard public IPv4', ctx.at(ctx.book.azure.publicIp.standardHour))]);
};

const redis: Rule = (ctx) => {
  const sku = ctx.str('sku_name');
  const family = ctx.str('family');
  const capacity = ctx.num('capacity');
  const key = sku && family && capacity !== undefined ? `${sku}_${family}${capacity}` : undefined;
  const hourRate = key ? ctx.book.azure.redis[key] : undefined;
  if (!key || hourRate === undefined) return unpriced('sku_name / family / capacity', key);
  return fixed([hourly(`${sku} ${family}${capacity}`, ctx.at(hourRate))]);
};

const registry: Rule = (ctx) => {
  const sku = ctx.str('sku');
  const month = sku ? ctx.book.azure.containerRegistry[sku] : undefined;
  if (!sku || month === undefined) return unpriced('sku', sku);
  return fixed([monthlyFee(`${sku} registry`, ctx.at(month))], ['Plus storage beyond the included amount and data transfer']);
};

const serviceBus: Rule = (ctx) => {
  const { serviceBus: bus } = ctx.book.azure;
  const sku = ctx.str('sku');
  if (sku === 'Basic') return usage('Basic: billed per million messaging operations.');
  if (sku === 'Standard') return fixed([hourly('Standard base charge', ctx.at(bus.standardBaseHour))], ['Plus messaging operations, by usage']);
  if (sku === 'Premium') {
    const units = ctx.num('capacity') ?? 1;
    return fixed([hourly('Premium messaging unit', ctx.at(bus.premiumUnitHour), units)], [`${plural(units, 'messaging unit')} (capacity)`]);
  }
  return unpriced('sku', sku);
};

const aks: Rule = (ctx) => {
  const { azure } = ctx.book;
  const tier = ctx.str('sku_tier') ?? 'Free';
  const lines: CostLine[] = [];
  const assumptions: string[] = [];
  if (tier === 'Standard') lines.push(hourly('AKS Standard tier', ctx.at(azure.aks.standardClusterHour)));
  else if (tier === 'Premium') lines.push(hourly('AKS Premium tier', ctx.at(azure.aks.premiumClusterHour)));
  else assumptions.push('Free tier control plane (no uptime SLA)');
  const pool = ctx.block('default_node_pool');
  const vmSize = pool ? ctx.str('vm_size', pool) : undefined;
  const hourRate = vmSize ? azure.vm[vmSize] : undefined;
  if (!vmSize || hourRate === undefined) return unpriced('default_node_pool.vm_size', vmSize);
  const nodes = (pool && (ctx.num('node_count', pool) ?? ctx.num('min_count', pool))) ?? 1;
  lines.push(hourly(vmSize, ctx.at(hourRate), nodes));
  assumptions.push(`${plural(nodes, 'node')} in the default pool (autoscaling changes this)`);
  if (pool && ctx.str('os_disk_type', pool) === 'Ephemeral') {
    assumptions.push('Ephemeral OS disks: no disk charge');
  } else {
    const gb = (pool && ctx.num('os_disk_size_gb', pool)) ?? 128;
    // sizes with premium storage support carry an "s" (B2s, D2s_v5)
    const type = /\d+[a-z]*s[a-z]*(?:_v\d+)?$/.test(vmSize) ? 'Premium_LRS' : 'StandardSSD_LRS';
    const tier = diskTier(azure, type, gb);
    if (tier) {
      lines.push(monthlyFee(`${nodes} × ${gb} GB OS disk (${tier.tier})`, ctx.at(tier.month), nodes));
      assumptions.push(`${gb} GB managed OS disk per node (the AKS default), priced as ${type === 'Premium_LRS' ? 'Premium SSD' : 'Standard SSD'}`);
    }
  }
  return fixed(lines, assumptions);
};

const storageAccount: Rule = (ctx) => {
  const replication = ctx.str('account_replication_type') ?? 'LRS';
  const tier = ctx.str('account_tier') ?? 'Standard';
  return usage(
    `Billed by use: ${rate(ctx.at(ctx.book.azure.usage.blobHotLrsGbMonth))} per GB-month for Hot LRS blobs, plus operations and data transfer.${
      replication !== 'LRS' || tier !== 'Standard' ? ` ${tier} ${replication} costs more.` : ''
    }`,
  );
};

const keyVault: Rule = (ctx) => usage(`${rate(ctx.at(ctx.book.azure.usage.keyVaultPer10k))} per 10,000 operations.`);

const FREE: Record<string, string | undefined> = {
  azurerm_resource_group: undefined,
  azurerm_virtual_network: 'Peering and data transfer are billed separately',
  azurerm_subnet: undefined,
  azurerm_network_security_group: undefined,
  azurerm_network_interface: undefined,
  azurerm_subnet_network_security_group_association: undefined,
  azurerm_mssql_server: 'The server is free — each database is billed',
  azurerm_linux_web_app: 'Billed through its App Service plan',
  azurerm_linux_function_app: 'Billed through its App Service plan (Y1: per execution)',
  azurerm_servicebus_queue: 'Billed through its namespace',
  azurerm_storage_account_static_website: 'Served from the storage account, billed by usage there',
  azurerm_cdn_endpoint: 'Billed through its CDN profile, by usage',
};

export const AZURE_RULES: Record<string, Rule> = {
  azurerm_linux_virtual_machine: linuxVm,
  azurerm_service_plan: servicePlan,
  azurerm_mssql_database: sqlDatabase,
  azurerm_postgresql_flexible_server: postgres,
  azurerm_public_ip: publicIp,
  azurerm_redis_cache: redis,
  azurerm_container_registry: registry,
  azurerm_servicebus_namespace: serviceBus,
  azurerm_kubernetes_cluster: aks,
  azurerm_storage_account: storageAccount,
  azurerm_key_vault: keyVault,
  azurerm_cdn_profile: () => usage('Billed per GB delivered and per request.'),
  ...Object.fromEntries(Object.entries(FREE).map(([type, note]) => [type, () => free(note)])),
};

export const AZURE_FREE_PREFIXES = [/^azurerm_role_/, /_association$/];
