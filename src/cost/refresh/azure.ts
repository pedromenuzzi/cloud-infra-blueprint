/**
 * Azure prices for eastus from the public Azure Retail Prices API (no
 * credentials): https://prices.azure.com/api/retail/prices, pay-as-you-go
 * ("Consumption") meters only. Managed-disk tier sizes come from the managed
 * disks pricing page. Tiered meters take the first paid tier.
 */
import type { AzurePrices } from '../types';
import { fail, fetchJson, fetchText, log, monthlyFromDaily, multipliers, ordered, shift, today } from './shared';

const REGION = 'eastus';
const API = 'https://prices.azure.com/api/retail/prices';
const DISKS_PAGE = 'https://azure.microsoft.com/en-us/pricing/details/managed-disks/';

export const VM_SIZES = [
  'Standard_B1s', 'Standard_B1ms', 'Standard_B2s', 'Standard_B2ms', 'Standard_B4ms',
  'Standard_B2s_v2', 'Standard_B2ats_v2',
  'Standard_D2s_v3', 'Standard_D4s_v3', 'Standard_D2s_v5', 'Standard_D4s_v5', 'Standard_D2as_v5',
  'Standard_E2s_v5', 'Standard_F2s_v2', 'Standard_DS2_v2',
];

export const AZURE_REGIONS = [
  'eastus', 'eastus2', 'centralus', 'westus2', 'westus3', 'canadacentral', 'brazilsouth',
  'northeurope', 'westeurope', 'uksouth', 'francecentral', 'germanywestcentral',
  'southeastasia', 'australiaeast', 'japaneast', 'centralindia',
];

/** managed disk type → the pricing product and its tiers */
const DISKS: Record<string, { product: string; letter: string }> = {
  Standard_LRS: { product: 'Standard HDD Managed Disks', letter: 'S' },
  StandardSSD_LRS: { product: 'Standard SSD Managed Disks', letter: 'E' },
  Premium_LRS: { product: 'Premium SSD Managed Disks', letter: 'P' },
};
const DISK_TIERS = [4, 6, 10, 15, 20];

const APP_SERVICE_PLANS: Record<string, string> = {
  F1: 'Free',
  B1: 'Basic',
  B2: 'Basic',
  B3: 'Basic',
  S1: 'Standard',
  S2: 'Standard',
  S3: 'Standard',
  P0v3: 'Premium v3',
  P1v3: 'Premium v3',
  P2v3: 'Premium v3',
  P3v3: 'Premium v3',
};

/** DTU single databases: output key → [product tier, API skuName] */
const SQL_DTU: Record<string, [string, string]> = {
  Basic: ['Basic', 'B'],
  S0: ['Standard', 'S0'],
  S1: ['Standard', 'S1'],
  S2: ['Standard', 'S2'],
  S3: ['Standard', 'S3'],
  P1: ['Premium', 'P1'],
  P2: ['Premium', 'P2'],
};

/**
 * PostgreSQL flexible server sku_name → how the API prices it: burstable
 * sizes have their own meter; the D/E series are priced per vCore.
 */
const PG_SKUS: Record<string, { product: string; sku?: string; vcores?: number }> = {
  B_Standard_B1ms: { product: 'Burstable BS Series Compute', sku: 'B1ms' },
  B_Standard_B2s: { product: 'Burstable BS Series Compute', sku: 'B2s' },
  B_Standard_B2ms: { product: 'Burstable BS Series Compute', sku: 'B2ms' },
  GP_Standard_D2s_v3: { product: 'General Purpose Dsv3 Series Compute', vcores: 2 },
  GP_Standard_D4s_v3: { product: 'General Purpose Dsv3 Series Compute', vcores: 4 },
  GP_Standard_D2ds_v5: { product: 'General Purpose Ddsv5 Series Compute', vcores: 2 },
  GP_Standard_D4ds_v5: { product: 'General Purpose Ddsv5 Series Compute', vcores: 4 },
  MO_Standard_E2ds_v5: { product: 'Memory Optimized Edsv5 Series Compute', vcores: 2 },
  MO_Standard_E4s_v3: { product: 'Memory Optimized Esv3 Series Compute', vcores: 4 },
};

const REDIS: Array<[tier: string, skus: string[]]> = [
  ['Basic', ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6']],
  ['Standard', ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6']],
  ['Premium', ['P1', 'P2', 'P3', 'P4', 'P5']],
];

interface Item {
  armRegionName: string;
  armSkuName: string;
  skuName: string;
  productName: string;
  meterName: string;
  serviceName: string;
  unitOfMeasure: string;
  retailPrice: number;
  tierMinimumUnits: number;
  type: string;
}

async function query(filter: string): Promise<Item[]> {
  const full = `${filter} and priceType eq 'Consumption'`;
  let url: string | null = `${API}?$filter=${encodeURIComponent(full)}`;
  const items: Item[] = [];
  while (url) {
    const page: { Items: Item[]; NextPageLink: string | null } = await fetchJson(url);
    items.push(...page.Items);
    url = page.NextPageLink;
  }
  return items;
}

/** the price of the one item that matches (identical duplicates allowed) */
function pick(items: Item[], what: string, match: (i: Item) => boolean, firstPaid = false): number {
  let found = items.filter(match);
  if (firstPaid) {
    const paid = found.filter((i) => i.retailPrice > 0).sort((a, b) => a.tierMinimumUnits - b.tierMinimumUnits);
    found = paid.length ? paid.filter((i) => i.tierMinimumUnits === paid[0].tierMinimumUnits) : found;
  } else {
    found = found.filter((i) => i.tierMinimumUnits === 0);
  }
  if (!found.length) fail(`Azure ${what}: no price found`);
  if (new Set(found.map((i) => i.retailPrice)).size > 1) fail(`Azure ${what}: ${found.length} different prices match`);
  return found[0].retailPrice;
}

const noSpaces = (s: string) => s.replace(/\s+/g, '');
const or = (field: string, values: string[]) => `(${values.map((v) => `${field} eq '${v}'`).join(' or ')})`;

/** Linux pay-as-you-go VM prices for `sizes` in `region` */
async function vmPrices(region: string, sizes: string[], required: boolean): Promise<Record<string, number>> {
  const items = await query(`serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and ${or('armSkuName', sizes)}`);
  const out: Record<string, number> = {};
  for (const size of sizes) {
    const match = (i: Item) =>
      i.armSkuName === size &&
      i.productName.startsWith('Virtual Machines ') &&
      !i.productName.endsWith(' Windows') &&
      !/Spot|Low Priority/.test(i.skuName) &&
      i.unitOfMeasure === '1 Hour';
    if (!items.some(match)) {
      if (required) fail(`Azure VM ${size} in ${region}: no Linux price`);
      continue;
    }
    out[size] = pick(items, `VM ${size} in ${region}`, match);
  }
  return out;
}

export async function refreshAzure(): Promise<AzurePrices> {
  log('Azure: virtual machines (every region)');
  const byRegion: Record<string, Record<string, number>> = {};
  for (const region of AZURE_REGIONS) byRegion[region] = await vmPrices(region, VM_SIZES, region === REGION);
  const vm = ordered(VM_SIZES, byRegion[REGION]);

  log('Azure: managed disks');
  const page = await fetchText(DISKS_PAGE);
  const text = page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const diskItems = await query(
    `serviceName eq 'Storage' and armRegionName eq '${REGION}' and ${or('productName', Object.values(DISKS).map((d) => d.product))}`,
  );
  const disk: AzurePrices['disk'] = {};
  for (const [type, { product, letter }] of Object.entries(DISKS)) {
    disk[type] = DISK_TIERS.map((n) => {
      const tier = `${letter}${n}`;
      const sizes = new Set([...text.matchAll(new RegExp(`\\b${tier} (\\d+) GiB`, 'g'))].map((m) => Number(m[1])));
      if (sizes.size !== 1) fail(`Azure disk ${tier}: size not found on ${DISKS_PAGE}`);
      const month = pick(diskItems, `disk ${tier}`, (i) => i.productName === product && i.meterName === `${tier} LRS Disk` && i.unitOfMeasure === '1/Month');
      return { tier, gb: [...sizes][0], month };
    });
  }

  log('Azure: App Service, SQL Database, PostgreSQL, IPs, Redis, registries, Service Bus, AKS');
  const plans = await query(`serviceName eq 'Azure App Service' and armRegionName eq '${REGION}'`);
  const appService: AzurePrices['appService'] = { linux: {}, windows: {} };
  for (const [os, suffix] of [['linux', ' - Linux'], ['windows', '']] as const) {
    for (const [sku, plan] of Object.entries(APP_SERVICE_PLANS)) {
      const product = `Azure App Service ${plan} Plan${suffix}`;
      appService[os][sku] = pick(plans, `App Service ${sku} ${os}`, (i) => i.productName === product && noSpaces(i.skuName) === sku && i.unitOfMeasure === '1 Hour');
    }
  }

  const sqlItems = await query(`serviceName eq 'SQL Database' and armRegionName eq '${REGION}' and contains(productName, 'SQL Database Single ')`);
  const sqlDatabase: Record<string, number> = {};
  for (const [key, [tier, sku]] of Object.entries(SQL_DTU)) {
    const daily = pick(sqlItems, `SQL Database ${key}`, (i) => i.productName === `SQL Database Single ${tier}` && i.skuName === sku && i.unitOfMeasure === '1/Day' && /DTU/.test(i.meterName));
    sqlDatabase[key] = monthlyFromDaily(daily);
  }

  const pgItems = await query(`serviceName eq 'Azure Database for PostgreSQL' and armRegionName eq '${REGION}' and contains(productName, 'Flex')`);
  const compute: Record<string, number> = {};
  for (const [sku, spec] of Object.entries(PG_SKUS)) {
    const product = `Azure Database for PostgreSQL Flexible Server ${spec.product}`;
    if (spec.sku) {
      compute[sku] = pick(pgItems, `PostgreSQL ${sku}`, (i) => i.productName === product && i.skuName.toLowerCase() === spec.sku!.toLowerCase() && i.unitOfMeasure === '1 Hour');
    } else {
      // the per-vCore meter ("1 vCore", or a bare "vCore" on older series)
      const perVcore = (i: Item) => i.productName === product && /^(?:1 )?vCore$/.test(i.skuName) && i.unitOfMeasure === '1 Hour';
      const rate = pick(pgItems, `PostgreSQL ${sku} per vCore`, perVcore);
      // where the API also lists the exact size, it must agree
      const exact = pgItems.find((i) => i.productName === product && i.skuName === `${spec.vcores} vCore` && i.tierMinimumUnits === 0);
      const total = Number((rate * spec.vcores!).toFixed(6));
      if (exact && Math.abs(exact.retailPrice - total) > 1e-9) fail(`PostgreSQL ${sku}: ${spec.vcores} × ${rate} ≠ ${exact.retailPrice}`);
      compute[sku] = total;
    }
  }
  const storageGbMonth = pick(pgItems, 'PostgreSQL storage', (i) => i.productName === 'Azure Database for PostgreSQL Flex Server Storage' && i.meterName === 'Storage Data Stored');

  const ipItems = await query(`serviceName eq 'Virtual Network' and armRegionName eq '${REGION}' and productName eq 'IP Addresses'`);
  const publicIp = { standardHour: pick(ipItems, 'Standard public IP', (i) => i.meterName === 'Standard IPv4 Static Public IP' && i.unitOfMeasure === '1 Hour') };

  const redisItems = await query(`serviceName eq 'Redis Cache' and armRegionName eq '${REGION}' and contains(productName, 'Azure Redis Cache ')`);
  const redis: Record<string, number> = {};
  for (const [tier, skus] of REDIS) {
    for (const sku of skus) {
      redis[`${tier}_${sku}`] = pick(redisItems, `Redis ${tier} ${sku}`, (i) => i.productName === `Azure Redis Cache ${tier}` && i.meterName === `${sku} Cache` && i.unitOfMeasure === '1 Hour');
    }
  }

  const acrItems = await query(`serviceName eq 'Container Registry' and armRegionName eq '${REGION}'`);
  const containerRegistry: Record<string, number> = {};
  for (const sku of ['Basic', 'Standard', 'Premium']) {
    containerRegistry[sku] = monthlyFromDaily(pick(acrItems, `Container Registry ${sku}`, (i) => i.meterName === `${sku} Registry Unit` && i.unitOfMeasure === '1/Day'));
  }

  const busItems = await query(`serviceName eq 'Service Bus' and armRegionName eq '${REGION}'`);
  const serviceBus = {
    standardBaseHour: pick(busItems, 'Service Bus Standard base', (i) => i.meterName === 'Standard Base Unit' && i.unitOfMeasure === '1/Hour'),
    premiumUnitHour: pick(busItems, 'Service Bus Premium unit', (i) => i.meterName === 'Premium Messaging Unit' && i.unitOfMeasure === '1/Hour'),
  };

  const aksItems = await query(`serviceName eq 'Azure Kubernetes Service' and armRegionName eq '${REGION}' and productName eq 'Azure Kubernetes Service'`);
  const aks = {
    // the Standard tier's uptime SLA; the Premium tier is billed as Standard + Long Term Support
    standardClusterHour: pick(aksItems, 'AKS Standard tier', (i) => i.meterName === 'Standard Uptime SLA' && i.unitOfMeasure === '1 Hour'),
    premiumClusterHour: pick(aksItems, 'AKS Premium tier', (i) => i.meterName === 'Standard Long Term Support' && i.unitOfMeasure === '1 Hour'),
  };

  const blob = await query(`serviceName eq 'Storage' and armRegionName eq '${REGION}' and productName eq 'Blob Storage' and skuName eq 'Hot LRS'`);
  const vault = await query(`serviceName eq 'Key Vault' and armRegionName eq '${REGION}' and productName eq 'Key Vault'`);
  const functions = await query(`serviceName eq 'Functions' and armRegionName eq '${REGION}' and productName eq 'Functions'`);
  const usage = {
    blobHotLrsGbMonth: pick(blob, 'Blob hot LRS', (i) => i.meterName === 'Hot LRS Data Stored'),
    keyVaultPer10k: pick(vault, 'Key Vault operations', (i) => i.skuName === 'Standard' && i.meterName === 'Operations' && i.unitOfMeasure === '10K'),
    // billed per 10 executions after the monthly free grant
    functionsPerMillion: shift(pick(functions, 'Functions executions', (i) => i.meterName === 'Standard Total Executions' && i.unitOfMeasure === '10', true), 5),
    functionsGbSecond: pick(functions, 'Functions GB-s', (i) => i.meterName === 'Standard Execution Time' && i.unitOfMeasure === '1 GB Second', true),
  };

  return {
    meta: {
      region: REGION,
      currency: 'USD',
      retrieved: today(),
      sources: [API, DISKS_PAGE],
    },
    regions: multipliers(vm, byRegion, AZURE_REGIONS, REGION),
    vm,
    disk,
    appService,
    sqlDatabase,
    postgresFlexible: { compute, storageGbMonth },
    publicIp,
    redis,
    containerRegistry,
    serviceBus,
    aks,
    usage,
  };
}
