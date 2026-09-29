/** Azure pricing rules, one per resource type (rates: book.azure, eastus). Words: ./messages.ts. */
import type { AzurePrices, CostLine } from '../types';
import { fixed, free, unknown, usage, type Rule, type RuleContext } from './common';
import type { ServiceMessages } from './messages';

/** the smallest disk tier that holds `gb` */
function diskTier(prices: AzurePrices, type: string, gb: number) {
  return prices.disk[type]?.find((t) => t.gb >= gb);
}

const functionsNote = (ctx: RuleContext) => {
  const u = ctx.book.azure.usage;
  return ctx.m.azure.functions(ctx.rate(ctx.at(u.functionsPerMillion)), ctx.rate(ctx.at(u.functionsGbSecond)));
};

const linuxVm: Rule = (ctx) => {
  const { azure } = ctx.book;
  const { m } = ctx;
  const size = ctx.str('size');
  const hourRate = size ? azure.vm[size] : undefined;
  if (!size || hourRate === undefined) return ctx.unpriced('size', size);
  if (ctx.str('priority') === 'Spot') return unknown(m.priceChanges('spot-vms'));
  const lines = [ctx.hourly(size, ctx.at(hourRate))];
  const assumptions = [m.azure.linuxPayg];
  const os = ctx.block('os_disk');
  const type = os ? ctx.str('storage_account_type', os) : undefined;
  const sizeGb = os ? ctx.num('disk_size_gb', os) : undefined;
  const gb = sizeGb ?? 30;
  const tier = type ? diskTier(azure, type, gb) : undefined;
  if (tier) {
    lines.push(ctx.monthlyFee(m.azure.osDisk(gb, tier.tier), ctx.at(tier.month)));
    if (sizeGb === undefined) assumptions.push(m.azure.osDiskDefault);
    if (type === 'Standard_LRS') assumptions.push(m.azure.hddTransactions);
  } else {
    assumptions.push(m.azure.osDiskMissing(type));
  }
  return fixed(lines, assumptions);
};

const servicePlan: Rule = (ctx) => {
  const { appService } = ctx.book.azure;
  const sku = ctx.str('sku_name');
  if (sku === 'Y1') return usage(functionsNote(ctx));
  if (sku?.startsWith('FC')) return usage(ctx.m.azure.flexConsumption);
  const os = ctx.str('os_type') ?? 'Linux';
  const table = os === 'Windows' ? appService.windows : os === 'Linux' ? appService.linux : undefined;
  if (!table) return ctx.unpriced('os_type', os);
  const hourRate = sku ? table[sku] : undefined;
  if (!sku || hourRate === undefined) return ctx.unpriced('sku_name', sku);
  if (hourRate === 0) return free(ctx.m.azure.freeTier(sku));
  const workers = ctx.num('worker_count') ?? 1;
  return fixed([ctx.hourly(`${sku} ${os}`, ctx.at(hourRate), workers)], [ctx.m.azure.workers(workers)]);
};

const sqlDatabase: Rule = (ctx) => {
  if (ctx.r.args.elastic_pool_id) return free(ctx.m.azure.elasticPool);
  const sku = ctx.str('sku_name');
  if (!sku) return unknown(ctx.m.azure.noSku);
  if (/^GP_S_/.test(sku)) return usage(ctx.m.azure.serverless);
  const month = ctx.book.azure.sqlDatabase[sku];
  if (month === undefined) return ctx.unpriced('sku_name', sku);
  return fixed([ctx.monthlyFee(`SQL Database ${sku}`, ctx.at(month))], [ctx.m.azure.dtu]);
};

const postgres: Rule = (ctx) => {
  const { postgresFlexible } = ctx.book.azure;
  const sku = ctx.str('sku_name');
  const hourRate = sku ? postgresFlexible.compute[sku] : undefined;
  if (!sku || hourRate === undefined) return ctx.unpriced('sku_name', sku);
  const ha = ctx.block('high_availability');
  const mode = ha ? ctx.str('mode', ha) : undefined;
  const copies = mode ? 2 : 1;
  const mb = ctx.num('storage_mb');
  const gb = (mb ?? 32768) / 1024;
  return fixed(
    [ctx.hourly(sku, ctx.at(hourRate), copies), ctx.perGbMonth(ctx.m.azure.storage(copies, gb), gb * copies, ctx.at(postgresFlexible.storageGbMonth))],
    [ctx.m.azure.ha(mode), ...(mb === undefined ? [ctx.m.azure.storageDefault] : [])],
  );
};

const publicIp: Rule = (ctx) => {
  const sku = ctx.str('sku') ?? 'Standard';
  if (sku !== 'Standard') return unknown(ctx.m.azure.retiredIp(sku));
  return fixed([ctx.hourly(ctx.m.azure.standardIpv4, ctx.at(ctx.book.azure.publicIp.standardHour))]);
};

const redis: Rule = (ctx) => {
  const sku = ctx.str('sku_name');
  const family = ctx.str('family');
  const capacity = ctx.num('capacity');
  const key = sku && family && capacity !== undefined ? `${sku}_${family}${capacity}` : undefined;
  const hourRate = key ? ctx.book.azure.redis[key] : undefined;
  if (!key || hourRate === undefined) return ctx.unpriced('sku_name / family / capacity', key);
  return fixed([ctx.hourly(`${sku} ${family}${capacity}`, ctx.at(hourRate))]);
};

const registry: Rule = (ctx) => {
  const sku = ctx.str('sku');
  const month = sku ? ctx.book.azure.containerRegistry[sku] : undefined;
  if (!sku || month === undefined) return ctx.unpriced('sku', sku);
  return fixed([ctx.monthlyFee(ctx.m.azure.registry(sku), ctx.at(month))], [ctx.m.azure.registryExtra]);
};

const serviceBus: Rule = (ctx) => {
  const { serviceBus: bus } = ctx.book.azure;
  const { m } = ctx;
  const sku = ctx.str('sku');
  if (sku === 'Basic') return usage(m.azure.busBasic);
  if (sku === 'Standard') return fixed([ctx.hourly(m.azure.busBase, ctx.at(bus.standardBaseHour))], [m.azure.busOperations]);
  if (sku === 'Premium') {
    const units = ctx.num('capacity') ?? 1;
    return fixed([ctx.hourly(m.azure.busUnit, ctx.at(bus.premiumUnitHour), units)], [m.azure.busUnits(units)]);
  }
  return ctx.unpriced('sku', sku);
};

const aks: Rule = (ctx) => {
  const { azure } = ctx.book;
  const { m } = ctx;
  const tier = ctx.str('sku_tier') ?? 'Free';
  const lines: CostLine[] = [];
  const assumptions: string[] = [];
  if (tier === 'Standard') lines.push(ctx.hourly(m.azure.aksTier('Standard'), ctx.at(azure.aks.standardClusterHour)));
  else if (tier === 'Premium') lines.push(ctx.hourly(m.azure.aksTier('Premium'), ctx.at(azure.aks.premiumClusterHour)));
  else assumptions.push(m.azure.aksFree);
  const pool = ctx.block('default_node_pool');
  const vmSize = pool ? ctx.str('vm_size', pool) : undefined;
  const hourRate = vmSize ? azure.vm[vmSize] : undefined;
  if (!vmSize || hourRate === undefined) return ctx.unpriced('default_node_pool.vm_size', vmSize);
  const nodes = (pool && (ctx.num('node_count', pool) ?? ctx.num('min_count', pool))) ?? 1;
  lines.push(ctx.hourly(vmSize, ctx.at(hourRate), nodes));
  assumptions.push(m.azure.aksNodes(nodes));
  if (pool && ctx.str('os_disk_type', pool) === 'Ephemeral') {
    assumptions.push(m.azure.ephemeral);
  } else {
    const gb = (pool && ctx.num('os_disk_size_gb', pool)) ?? 128;
    // sizes with premium storage support carry an "s" (B2s, D2s_v5)
    const type = /\d+[a-z]*s[a-z]*(?:_v\d+)?$/.test(vmSize) ? 'Premium_LRS' : 'StandardSSD_LRS';
    const diskTierOf = diskTier(azure, type, gb);
    if (diskTierOf) {
      lines.push(ctx.monthlyFee(m.azure.aksDisk(nodes, gb, diskTierOf.tier), ctx.at(diskTierOf.month), nodes));
      assumptions.push(m.azure.aksDiskNote(gb, type === 'Premium_LRS'));
    }
  }
  return fixed(lines, assumptions);
};

const storageAccount: Rule = (ctx) => {
  const replication = ctx.str('account_replication_type') ?? 'LRS';
  const tier = ctx.str('account_tier') ?? 'Standard';
  return usage(
    ctx.m.azure.blob(
      ctx.rate(ctx.at(ctx.book.azure.usage.blobHotLrsGbMonth)),
      replication !== 'LRS' || tier !== 'Standard' ? `${tier} ${replication}` : undefined,
    ),
  );
};

const keyVault: Rule = (ctx) => usage(ctx.m.azure.keyVault(ctx.rate(ctx.at(ctx.book.azure.usage.keyVaultPer10k))));

/** free types, and what to say about them (in the rule's language) */
const FREE: Record<string, ((m: ServiceMessages) => string) | undefined> = {
  azurerm_resource_group: undefined,
  azurerm_virtual_network: (m) => m.azure.free.vnet,
  azurerm_subnet: undefined,
  azurerm_network_security_group: undefined,
  azurerm_network_interface: undefined,
  azurerm_subnet_network_security_group_association: undefined,
  azurerm_mssql_server: (m) => m.azure.free.sqlServer,
  azurerm_linux_web_app: (m) => m.azure.free.webApp,
  azurerm_linux_function_app: (m) => m.azure.free.functionApp,
  azurerm_servicebus_queue: (m) => m.azure.free.queue,
  azurerm_storage_account_static_website: (m) => m.azure.free.staticWebsite,
  azurerm_cdn_endpoint: (m) => m.azure.free.cdnEndpoint,
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
  azurerm_cdn_profile: (ctx) => usage(ctx.m.azure.cdn),
  ...Object.fromEntries(Object.entries(FREE).map(([type, note]): [string, Rule] => [type, (ctx) => free(note?.(ctx.m))])),
};

export const AZURE_FREE_PREFIXES = [/^azurerm_role_/, /_association$/];
