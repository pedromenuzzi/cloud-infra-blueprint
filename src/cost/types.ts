/**
 * Cost estimate types: the static price tables (./prices/*.json, written by
 * ./refresh/refresh-prices.ts) and what the estimator derives from them.
 *
 * Every rate is an on-demand list price in USD for the table's default region,
 * excluding tax. Units are in the key names: `…Hour` is per hour, `…Month` per
 * month, `…GbMonth` per GB-month, `…PerMillion` per million requests.
 */
import type { Provider } from '@/ir/types';
import type { Category } from '@/resources/types';

export type CloudProvider = Exclude<Provider, 'other'>;

export interface PriceMeta {
  /** the region every rate in the table is for */
  region: string;
  /** always "USD" */
  currency: string;
  /** ISO date (YYYY-MM-DD) the prices were read from the sources */
  retrieved: string;
  /** where the numbers come from (price list files, APIs, pricing pages) */
  sources: string[];
}

/** region → price multiplier vs `meta.region` (1 for the default region) */
export type RegionMultipliers = Record<string, number>;

/** hourly rates of a database class, single instance vs multi-AZ / high availability */
export interface DeploymentRates {
  single: number;
  multi: number;
}

export interface AwsPrices {
  meta: PriceMeta;
  regions: RegionMultipliers;
  /** EC2 instance type → $/hour (Linux, shared tenancy) */
  ec2: Record<string, number>;
  /** EBS volume type (gp3, gp2, io1, io2, st1, sc1, standard) → $/GB-month */
  ebs: Record<string, number>;
  rds: {
    /** DB instance class → engine (postgres, mysql, mariadb) → $/hour */
    instance: Record<string, Record<string, DeploymentRates>>;
    /** storage type (gp2, gp3, io1, standard) → $/GB-month */
    storage: Record<string, DeploymentRates>;
  };
  /** ElastiCache node type → engine (redis, memcached, valkey) → $/hour */
  elasticache: Record<string, Record<string, number>>;
  eks: { clusterHour: number };
  /** Fargate on Linux, per vCPU-hour and GB-hour */
  fargate: { vcpuHour: number; gbHour: number; armVcpuHour: number; armGbHour: number };
  elb: { albHour: number; albLcuHour: number; nlbHour: number; nlbLcuHour: number };
  /** a public IPv4 address in use (EIP, auto-assigned instance IP), $/hour */
  publicIpv4Hour: number;
  nat: { hour: number; gb: number };
  route53: { zoneMonth: number; queriesPerMillion: number };
  kms: { keyMonth: number; requestsPer10k: number };
  secretsManager: { secretMonth: number; apiPer10k: number };
  /** headline rates quoted in the notes of usage-based services */
  usage: {
    lambdaRequestsPerMillion: number;
    lambdaGbSecond: number;
    s3StandardGbMonth: number;
    cloudfrontGb: number;
    cloudfrontHttpsPer10k: number;
    dynamodbWritePerMillion: number;
    dynamodbReadPerMillion: number;
    dynamodbGbMonth: number;
    sqsPerMillion: number;
    snsPerMillion: number;
    apiGatewayHttpPerMillion: number;
    ecrGbMonth: number;
    /** Aurora Standard: storage per GB-month and I/O per million requests; I/O-Optimized: storage only */
    auroraGbMonth: number;
    auroraIoPerMillion: number;
    auroraIoOptimizedGbMonth: number;
  };
}

export interface AzurePrices {
  meta: PriceMeta;
  regions: RegionMultipliers;
  /** VM size → $/hour (Linux, pay as you go) */
  vm: Record<string, number>;
  /** managed disk type (Standard_LRS, StandardSSD_LRS, Premium_LRS) → size tiers, smallest first */
  disk: Record<string, Array<{ tier: string; gb: number; month: number }>>;
  /** App Service plan SKU → $/hour, per OS */
  appService: { linux: Record<string, number>; windows: Record<string, number> };
  /** Azure SQL Database (DTU model) SKU → $/month */
  sqlDatabase: Record<string, number>;
  postgresFlexible: {
    /** sku_name as Terraform spells it (B_Standard_B1ms…) → $/hour */
    compute: Record<string, number>;
    storageGbMonth: number;
  };
  publicIp: { standardHour: number };
  /** `<sku>_<family><capacity>` (Basic_C0, Standard_C1, Premium_P1…) → $/hour */
  redis: Record<string, number>;
  /** Container Registry SKU → $/month */
  containerRegistry: Record<string, number>;
  serviceBus: { standardBaseHour: number; premiumUnitHour: number };
  aks: { standardClusterHour: number; premiumClusterHour: number };
  usage: {
    blobHotLrsGbMonth: number;
    keyVaultPer10k: number;
    functionsPerMillion: number;
    functionsGbSecond: number;
  };
}

export interface GcpPrices {
  meta: PriceMeta;
  regions: RegionMultipliers;
  /** Compute Engine machine type → $/hour */
  machine: Record<string, number>;
  /** persistent disk type (pd-standard, pd-balanced, pd-ssd) → $/GB-month */
  disk: Record<string, number>;
  /** an external IPv4 address in use by a standard VM, $/hour */
  externalIpHour: number;
  sql: {
    /** shared-core tiers (db-f1-micro, db-g1-small) → $/hour */
    shared: Record<string, number>;
    /** Enterprise edition custom machines (db-custom-<vCPUs>-<MiB>) */
    vcpuHour: number;
    gbHour: number;
    /** storage type (SSD, HDD) → $/GB-month */
    storage: Record<string, number>;
  };
  gke: { clusterHour: number };
  /** Memorystore for Redis, $/GB-hour by capacity tier (up to `maxGb`, smallest first) */
  memorystore: { basic: Array<{ maxGb: number; gbHour: number }>; standard: Array<{ maxGb: number; gbHour: number }> };
  lb: { forwardingRuleHour: number };
  dns: { zoneMonth: number };
  nat: { vmHour: number; maxHour: number; gb: number };
  usage: {
    cloudRunVcpuSecond: number;
    cloudRunGibSecond: number;
    cloudRunPerMillion: number;
    storageStandardGbMonth: number;
    pubsubTib: number;
    bigqueryTibScanned: number;
    artifactGbMonth: number;
    secretVersionMonth: number;
  };
}

export interface PriceBook {
  aws: AwsPrices;
  azure: AzurePrices;
  gcp: GcpPrices;
}

// ------------------------------------------------------------------ results

/**
 * fixed    a monthly amount from list prices (it may have a usage part on top, see assumptions)
 * usage    billed only by usage (requests, GB…) — no number is invented
 * free     nothing is billed for the resource itself
 * unknown  can't be priced: an unlisted SKU, an expression, `for_each`…
 */
export type CostKind = 'fixed' | 'usage' | 'unknown' | 'free';

export interface CostLine {
  /** what is billed, e.g. "t3.micro" or "8 GB gp3" */
  label: string;
  /** how, e.g. "730 h × $0.0104" */
  detail?: string;
  monthly: number;
}

export interface ResourceCost {
  /** resource address */
  id: string;
  type: string;
  name: string;
  provider: Provider;
  category: Category | 'other';
  kind: CostKind;
  /** per month, `count` included; null unless `fixed` or `free` */
  monthly: number | null;
  /** for one instance, before `count` */
  breakdown: CostLine[];
  /** what the number takes for granted (and what it leaves out) */
  assumptions: string[];
  /** usage-based: how it is billed; unknown: why it can't be priced */
  note?: string;
  /** instances priced: a known `count` or `for_each` size (1 when absent) */
  count: number;
  /** what `count` comes from when the resource repeats */
  repeat?: 'count' | 'for_each';
  /** the region priced, and the multiplier applied to the default region's rates */
  region?: string;
  multiplier: number;
}

export interface CostGroup<K extends string> {
  key: K;
  monthly: number;
  /** resources in the group, and how many of them have a fixed price */
  resources: number;
  priced: number;
}

export interface ProjectCost {
  items: ResourceCost[];
  /** sum of every `fixed` item */
  total: number;
  counts: Record<CostKind, number>;
  byCategory: Array<CostGroup<Category | 'other'>>;
  byProvider: Array<CostGroup<Provider> & { region?: string; retrieved?: string }>;
  /** the rules every number follows */
  assumptions: string[];
  /**
   * The project's calls to local modules, each with what's inside it (the
   * totals above count them, × the call's instances). Absent: none, or an
   * estimate of one module's own resources.
   */
  modules?: ModuleCost[];
}

/** What one call to a local module costs (./modules.ts). */
export interface ModuleCost {
  /** `module.network` */
  id: string;
  /** `module.service › module.ecr` */
  label: string;
  /** the calls from the root module that lead to it: folder and name of each */
  steps: Array<{ dir: string; name: string }>;
  dir: string;
  /** instances of the call; null when its `count` / `for_each` is decided at plan time */
  count: number | null;
  repeat?: 'count' | 'for_each';
  /** the module's own resources, for one instance of the call */
  items: ResourceCost[];
  /** one instance of the call, the modules it calls included (fixed amounts only) */
  perCall: number;
  /** every instance; null when the instances aren't known */
  monthly: number | null;
  /** priced / usage-based / not estimated resources inside (nested modules included) */
  counts: Record<CostKind, number>;
  nested: ModuleCost[];
}
