/**
 * GCP prices for us-central1, read off the public pricing pages (Google has
 * no key-free price API). The pages are server-rendered for Iowa
 * (us-central1) — checked on every regional page — and embed the tables of
 * every other region, each followed by its region label; the machine-type
 * tables of those are what the region multipliers are computed from.
 *
 * Rates the pages give per hour or per GiB-hour are converted to per month
 * with ×730 (GCP's own monthly figures use 730 h) and rounded to 6 decimals.
 * Tiered prices take the first paid tier (after any free tier).
 */
import type { GcpPrices } from '../types';
import { fail, fetchText, log, monthly, multipliers, num, ordered, today } from './shared';

const REGION = 'us-central1';
const DEFAULT_LABEL = 'Iowa (us-central1)';

const PAGE = {
  compute: 'https://cloud.google.com/products/compute/pricing/general-purpose',
  disks: 'https://cloud.google.com/compute/disks-image-pricing',
  network: 'https://cloud.google.com/vpc/network-pricing',
  sql: 'https://cloud.google.com/sql/pricing',
  gke: 'https://cloud.google.com/kubernetes-engine/pricing',
  memorystore: 'https://cloud.google.com/memorystore/docs/redis/pricing',
  redisTiers: 'https://cloud.google.com/memorystore/docs/redis/redis-tiers',
  dns: 'https://cloud.google.com/dns/pricing',
  nat: 'https://cloud.google.com/nat/pricing',
  run: 'https://cloud.google.com/run/pricing',
  storage: 'https://cloud.google.com/storage/pricing',
  pubsub: 'https://cloud.google.com/pubsub/pricing',
  bigquery: 'https://cloud.google.com/bigquery/pricing',
  artifact: 'https://cloud.google.com/artifact-registry/pricing',
  secret: 'https://cloud.google.com/secret-manager/pricing',
} as const;

/** pages whose tables depend on the region picker (must render us-central1) */
const REGIONAL: Array<keyof typeof PAGE> = ['compute', 'disks', 'network', 'sql', 'memorystore', 'run', 'storage'];

export const MACHINE_TYPES = [
  'e2-micro', 'e2-small', 'e2-medium', 'e2-standard-2', 'e2-standard-4', 'e2-standard-8',
  'n1-standard-1', 'n1-standard-2', 'n2-standard-2', 'n2-standard-4', 'n2-standard-8',
  'n2d-standard-2', 'c3-standard-4', 't2d-standard-1',
];

export const GCP_REGIONS = [
  'us-central1', 'us-east1', 'us-east4', 'us-west1', 'us-west2', 'northamerica-northeast1',
  'southamerica-east1', 'europe-west1', 'europe-west2', 'europe-west3', 'europe-west4',
  'asia-east1', 'asia-northeast1', 'asia-southeast1', 'asia-south1', 'australia-southeast1',
];

// ------------------------------------------------------------------ html

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
      if (ENTITIES[e]) return ENTITIES[e];
      if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith('#')) return String.fromCodePoint(Number(e.slice(1)));
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** every rendered table of a page, as rows of cell texts */
function tables(html: string): string[][][] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((t) =>
    [...t[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1]))),
  );
}

/** the dollar amounts of a cell, in order */
function dollars(cell: string, what: string): number[] {
  const found = [...cell.matchAll(/\$([0-9][0-9,]*(?:\.[0-9]+)?)/g)].map((m) => num(m[1].replace(/,/g, ''), what));
  if (!found.length) fail(`GCP ${what}: no price in "${cell}"`);
  return found;
}

/** the first non-zero amount of a (possibly tiered) cell */
function firstPaid(cell: string, what: string): number {
  const paid = dollars(cell, what).find((d) => d > 0);
  if (paid === undefined) fail(`GCP ${what}: only free tiers in "${cell}"`);
  return paid;
}

/** the row (of any table) whose first cell passes `label`; the first such table wins unless `pickTable` says otherwise */
function row(page: string, what: string, label: (first: string) => boolean, pickTable?: (table: string[][]) => boolean): string[] {
  for (const table of tables(page)) {
    if (pickTable && !pickTable(table)) continue;
    const r = table.find((cells) => cells[0] !== undefined && label(cells[0]));
    if (r) return r;
  }
  return fail(`GCP ${what}: row not found`);
}

const is = (s: string) => (first: string) => first === s;
const hasRow = (s: string) => (table: string[][]) => table.some((r) => r[0] === s);

// ------------------------------------------------------------------ compute

/** us-central1 machine prices from the rendered tables ("Default" = on-demand column) */
function renderedMachines(page: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of tables(page)) {
    const col = table[0]?.findIndex((h) => /^Default\b/.test(h)) ?? -1;
    if (col < 1) continue;
    for (const cells of table.slice(1)) {
      const type = cells[0];
      if (!MACHINE_TYPES.includes(type)) continue;
      if (!/\/ 1 hour$/.test(cells[col] ?? '')) fail(`GCP ${type}: unexpected price cell "${cells[col]}"`);
      const [p] = dollars(cells[col], type);
      if (out[type] !== undefined && out[type] !== p) fail(`GCP ${type}: two us-central1 prices`);
      out[type] = p;
    }
  }
  for (const type of MACHINE_TYPES) if (out[type] === undefined) fail(`GCP ${type}: not on ${PAGE.compute}`);
  return out;
}

/** hourly machine prices of every region, from the tables embedded in the page's data */
function embeddedMachines(page: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const label = /\]\]\]\],"[^"]*?\(([a-z]+-[a-z]+\d+)\)",\[/g;
  for (const type of MACHINE_TYPES) {
    const name = new RegExp(`\\\\u003cp\\\\u003e${type.replace(/[.-]/g, '\\$&')}\\\\u003c/p\\\\u003e`, 'g');
    for (const m of page.matchAll(name)) {
      const after = page.slice(m.index! + m[0].length, m.index! + m[0].length + 600);
      const p = /"\$([0-9.]+) \/ 1 (hour|month)"/.exec(after);
      if (!p || p[2] !== 'hour') continue;
      label.lastIndex = m.index!;
      const region = label.exec(page)?.[1];
      if (!region) continue;
      const price = num(p[1], `${type} in ${region}`);
      const byType = (out[region] ??= {});
      if (byType[type] !== undefined && byType[type] !== price) fail(`GCP ${type} in ${region}: two embedded prices`);
      byType[type] = price;
    }
  }
  return out;
}

// ------------------------------------------------------------------ assemble

export async function refreshGcp(): Promise<GcpPrices> {
  const pages: Record<string, string> = {};
  for (const [key, url] of Object.entries(PAGE)) {
    log(`  ${url}`);
    pages[key] = await fetchText(url);
  }
  for (const key of REGIONAL) {
    if (!pages[key].includes(`aria-selected="true" data-value="${DEFAULT_LABEL}"`)) fail(`GCP ${PAGE[key]} is no longer rendered for ${DEFAULT_LABEL}`);
  }

  log('GCP: machine types');
  const machine = ordered(MACHINE_TYPES, renderedMachines(pages.compute));
  const byRegion = embeddedMachines(pages.compute);
  for (const type of MACHINE_TYPES) {
    if (byRegion[REGION]?.[type] !== machine[type]) fail(`GCP ${type}: embedded us-central1 price ≠ rendered table`);
  }

  log('GCP: disks, IPs, Cloud SQL, GKE, Memorystore, LB, DNS, NAT, usage rates');
  const perGiBHour = (page: string, label: string) => monthly(firstPaid(row(page, label, is(label))[1], label));
  const disk = {
    'pd-standard': perGiBHour(pages.disks, 'Standard provisioned space'),
    'pd-balanced': perGiBHour(pages.disks, 'Balanced provisioned space'),
    'pd-ssd': perGiBHour(pages.disks, 'SSD provisioned space'),
  };
  const externalIpHour = firstPaid(row(pages.network, 'external IP', (c) => c.startsWith('Static and ephemeral IP addresses in use on standard VM instances'))[1], 'external IP');

  // Enterprise edition: the vCPU / memory table without the Enterprise Plus data cache
  const enterprise = (t: string[][]) => hasRow('vCPUs')(t) && hasRow('Memory')(t) && !hasRow('Data Cache Storage')(t);
  const shared: Record<string, number> = {};
  for (const tier of ['db-f1-micro', 'db-g1-small']) {
    const cells = row(pages.sql, tier, (c) => c.replace(/\*$/, '') === tier, (t) => t[0]?.[0] === 'Shared-Core Machine Type');
    shared[tier] = firstPaid(cells[cells.length - 1], tier);
  }
  const nonHaStorage = (t: string[][]) => hasRow('SSD storage capacity')(t) && hasRow('HDD storage capacity')(t) && !t.some((r) => /\bHA\b/.test(r[0] ?? ''));
  const sql = {
    shared,
    vcpuHour: firstPaid(row(pages.sql, 'Cloud SQL vCPU', is('vCPUs'), enterprise)[1], 'Cloud SQL vCPU'),
    gbHour: firstPaid(row(pages.sql, 'Cloud SQL memory', is('Memory'), enterprise)[1], 'Cloud SQL memory'),
    storage: {
      SSD: monthly(firstPaid(row(pages.sql, 'Cloud SQL SSD', is('SSD storage capacity'), nonHaStorage)[1], 'Cloud SQL SSD')),
      HDD: monthly(firstPaid(row(pages.sql, 'Cloud SQL HDD', is('HDD storage capacity'), nonHaStorage)[1], 'Cloud SQL HDD')),
    },
  };

  const gkeFee = /US\$([0-9.]+)\/hour per cluster/.exec(text(pages.gke));
  if (!gkeFee) fail(`GCP GKE cluster fee: not on ${PAGE.gke}`);
  const gke = { clusterHour: num(gkeFee[1], 'GKE cluster fee') };

  const maxSize = /Max Redis primary size (\d+) GB/.exec(text(pages.redisTiers));
  if (!maxSize) fail(`GCP Memorystore max size: not on ${PAGE.redisTiers}`);
  const memorystore: GcpPrices['memorystore'] = { basic: [], standard: [] };
  const redisTable = tables(pages.memorystore).find((t) => t[0]?.[0] === 'Service tier');
  if (!redisTable) fail('GCP Memorystore: pricing table not found');
  let tier: 'basic' | 'standard' | undefined;
  for (const cells of redisTable.slice(1)) {
    const offset = cells[0] === 'Basic' || cells[0] === 'Standard' ? 1 : 0;
    if (offset) tier = cells[0].toLowerCase() as 'basic' | 'standard';
    const capacity = cells[offset] ?? '';
    const range = /^M\d \((?:\d+ to (\d+) GiB|> (\d+) GiB)\)/.exec(capacity);
    if (!tier || !range) fail(`GCP Memorystore: unexpected row ${JSON.stringify(cells)}`);
    const maxGb = range[1] ? Number(range[1]) : Number(maxSize[1]);
    memorystore[tier].push({ maxGb, gbHour: firstPaid(cells[offset + 2], `Memorystore ${tier} ${capacity}`) });
  }
  if (memorystore.basic.length !== 5 || memorystore.standard.length !== 5) fail('GCP Memorystore: expected tiers M1–M5 for Basic and Standard');

  const lb = { forwardingRuleHour: firstPaid(row(pages.network, 'forwarding rules', is('First 5 forwarding rules'))[1], 'forwarding rules') };
  const dns = { zoneMonth: monthly(firstPaid(row(pages.dns, 'managed zones', is('Managed zones'))[1], 'managed zones')) };

  const natTable = (t: string[][]) => t[0]?.[0] === 'Number of assigned VM instances';
  const upTo32 = row(pages.nat, 'Cloud NAT', is('Up to 32 VM instances'), natTable);
  const over32 = row(pages.nat, 'Cloud NAT', is('More than 32 VM instances'), natTable);
  const nat = { vmHour: dollars(upTo32[1], 'NAT per VM')[0], maxHour: dollars(over32[1], 'NAT max')[0], gb: dollars(upTo32[2], 'NAT GB')[0] };

  // request-based billing (the Cloud Run default): the table with a request charge
  const requestBased = hasRow('Requests (per 1,000,000)');
  const runCpu = row(pages.run, 'Cloud Run CPU', is('CPU (per vCPU-second)'), requestBased);
  const runMem = row(pages.run, 'Cloud Run memory', is('Memory (per GiB-second)'), requestBased);
  const runReq = row(pages.run, 'Cloud Run requests', is('Requests (per 1,000,000)'), requestBased);
  if (runCpu[1] !== 'Active time' || runMem[1] !== 'Active time') fail('GCP Cloud Run: expected the active-time rows');

  const standardStorage = tables(pages.storage).find((t) => t[0]?.[0] === 'Standard storage');
  if (!standardStorage) fail('GCP Cloud Storage: standard storage table not found');
  const pubsub = /Message Delivery Basic SKU[^$]*?the price is \$([0-9.]+) per TiB/.exec(text(pages.pubsub));
  if (!pubsub) fail(`GCP Pub/Sub throughput: not on ${PAGE.pubsub}`);

  const usage = {
    cloudRunVcpuSecond: firstPaid(runCpu[2], 'Cloud Run CPU'),
    cloudRunGibSecond: firstPaid(runMem[2], 'Cloud Run memory'),
    cloudRunPerMillion: firstPaid(runReq[2], 'Cloud Run requests'),
    storageStandardGbMonth: monthly(firstPaid(standardStorage[1][0], 'Cloud Storage standard')),
    pubsubTib: num(pubsub[1], 'Pub/Sub throughput'),
    bigqueryTibScanned: firstPaid(row(pages.bigquery, 'BigQuery on-demand', is('Queries (on-demand)'))[1], 'BigQuery on-demand'),
    artifactGbMonth: perGiBHour(pages.artifact, 'Artifact Registry Storage'),
    secretVersionMonth: monthly(firstPaid(row(pages.secret, 'Secret Manager', is('Active secret versions'))[1], 'Secret Manager')),
  };

  return {
    meta: { region: REGION, currency: 'USD', retrieved: today(), sources: Object.values(PAGE) },
    regions: multipliers(machine, byRegion, GCP_REGIONS, REGION),
    machine,
    disk,
    externalIpHour,
    sql,
    gke,
    memorystore,
    lb,
    dns,
    nat,
    usage,
  };
}
