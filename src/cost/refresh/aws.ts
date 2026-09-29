/**
 * AWS prices for us-east-1 from the public Price List (no credentials):
 *
 * - the bulk regional offer files (…/offers/v1.0/aws/<Service>/current/us-east-1/index.json);
 * - for EC2, whose offer file is ~480 MB, the same Price List data as the
 *   aws.amazon.com pricing pages publish it (b0.p.awsstatic.com; every
 *   `rateCode` there is a bulk-file SKU): instances per region, EBS, NAT.
 *
 * Tiered prices take the first paid tier (after any free tier).
 */
import type { AwsPrices } from '../types';
import { fail, fetchJson, log, multipliers, num, ordered, shift, today } from './shared';

const REGION = 'us-east-1';
const OFFERS = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws';
const PAGES = 'https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current';

export const EC2_TYPES = [
  't3.nano', 't3.micro', 't3.small', 't3.medium', 't3.large', 't3.xlarge', 't3.2xlarge',
  't3a.micro', 't3a.small', 't3a.medium',
  't4g.nano', 't4g.micro', 't4g.small', 't4g.medium', 't4g.large',
  't2.micro',
  'm5.large', 'm5.xlarge', 'm6i.large', 'm6i.xlarge', 'm7i.large', 'm7g.large',
  'c5.large', 'c5.xlarge', 'c6i.large', 'c7g.large',
  'r5.large', 'r6i.large', 'r7g.large',
];

export const RDS_CLASSES = [
  'db.t3.micro', 'db.t3.small', 'db.t3.medium', 'db.t3.large',
  'db.t4g.micro', 'db.t4g.small', 'db.t4g.medium', 'db.t4g.large',
  'db.m5.large', 'db.m6g.large', 'db.m6i.large', 'db.m7g.large',
  'db.r5.large', 'db.r6g.large',
];

/** Terraform `engine` → Price List `databaseEngine` */
const RDS_ENGINES: Record<string, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB' };

/** class/engine pairs AWS doesn't sell in us-east-1 (checked 2026-09-29: none) */
const RDS_NOT_SOLD = new Set<string>();

/** Terraform `storage_type` → Price List `volumeType` */
const RDS_STORAGE: Record<string, string> = {
  gp2: 'General Purpose',
  gp3: 'General Purpose-GP3',
  io1: 'Provisioned IOPS',
  standard: 'Magnetic',
};

export const CACHE_NODES = [
  'cache.t3.micro', 'cache.t3.small', 'cache.t3.medium',
  'cache.t4g.micro', 'cache.t4g.small', 'cache.t4g.medium',
  'cache.m6g.large', 'cache.m7g.large', 'cache.r6g.large', 'cache.r7g.large',
];

/** Terraform `engine` → Price List `cacheEngine` */
const CACHE_ENGINES: Record<string, string> = { redis: 'Redis', memcached: 'Memcached', valkey: 'Valkey' };

/** EBS volume type → the name the EC2 pricing page gives its GB-month rate */
const EBS_KEYS: Record<string, string> = {
  gp3: 'Storage General Purpose gp3 GB Mo',
  gp2: 'Storage General Purpose gp2 GB Mo',
  io1: 'Storage Provisioned IOPS io1 GB Mo',
  io2: 'Storage Provisioned IOPS io2 GB month',
  st1: 'Storage Throughput Optimized HDD st1 GB Mo',
  sc1: 'Storage Cold HDD sc1 GB Mo',
  standard: 'Storage Magnetic standard GB Mo',
};

/** region code → the location name the pricing pages use */
export const AWS_REGIONS: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'ca-central-1': 'Canada (Central)',
  'sa-east-1': 'South America (Sao Paulo)',
  'eu-west-1': 'EU (Ireland)',
  'eu-west-2': 'EU (London)',
  'eu-west-3': 'EU (Paris)',
  'eu-central-1': 'EU (Frankfurt)',
  'eu-north-1': 'EU (Stockholm)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
};

// ------------------------------------------------------------------ bulk offers

interface Dimension {
  unit: string;
  pricePerUnit: { USD?: string };
  beginRange?: string;
  endRange?: string;
  description: string;
}

interface Offer {
  publicationDate: string;
  products: Record<string, { sku: string; productFamily?: string; attributes: Record<string, string> }>;
  terms: { OnDemand: Record<string, Record<string, { priceDimensions: Record<string, Dimension> }>> };
}

type Match = (attributes: Record<string, string>, family: string | undefined) => boolean;

class Offers {
  readonly sources: string[] = [];
  private cache = new Map<string, Promise<Offer>>();

  get(service: string, global = false): Promise<Offer> {
    const url = `${OFFERS}/${service}/current/${global ? '' : `${REGION}/`}index.json`;
    let offer = this.cache.get(url);
    if (!offer) {
      log(`  ${url}`);
      this.sources.push(url);
      offer = fetchJson<Offer>(url);
      this.cache.set(url, offer);
    }
    return offer;
  }
}

/** the on-demand price dimensions of the one product that matches (identical duplicates allowed) */
function dimensions(offer: Offer, what: string, match: Match): Dimension[] {
  const found: Dimension[][] = [];
  for (const [sku, product] of Object.entries(offer.products)) {
    if (!match(product.attributes, product.productFamily)) continue;
    const terms = offer.terms.OnDemand[sku];
    if (!terms) continue;
    const dims = Object.values(terms).flatMap((t) => Object.values(t.priceDimensions));
    dims.sort((a, b) => Number(a.beginRange ?? 0) - Number(b.beginRange ?? 0));
    found.push(dims);
  }
  if (!found.length) fail(`AWS ${what}: no on-demand price found`);
  const key = (d: Dimension[]) => d.map((x) => `${x.beginRange}:${x.pricePerUnit.USD}`).join('|');
  if (new Set(found.map(key)).size > 1) fail(`AWS ${what}: ${found.length} different prices match`);
  return found[0];
}

/** the first paid tier of the one matching product */
function price(offer: Offer, what: string, match: Match): number {
  const dims = dimensions(offer, what, match);
  const paid = dims.find((d) => num(d.pricePerUnit.USD, what) > 0) ?? dims[0];
  return num(paid.pricePerUnit.USD, what);
}

const usage = (type: string, family?: string): Match => (a, f) => a.usagetype === type && (family === undefined || f === family);

// ------------------------------------------------------------------ pricing-page files

interface PageFile {
  regions: Record<string, Record<string, { price: string; rateCode: string; 'Instance Type'?: string }>>;
}

async function pageFile(sources: string[], path: string): Promise<PageFile> {
  const url = `${PAGES}/${path}`;
  log(`  ${url}`);
  sources.push(url);
  return fetchJson<PageFile>(url);
}

async function ec2Prices(sources: string[], region: string): Promise<Record<string, number>> {
  const name = AWS_REGIONS[region];
  const file = await pageFile(sources, `ec2-ondemand-without-sec-sel/${encodeURIComponent(name)}/Linux/index.json`);
  const rows = file.regions[name];
  if (!rows) fail(`AWS EC2 ${region}: no "${name}" in the pricing file`);
  const out: Record<string, number> = {};
  for (const row of Object.values(rows)) {
    const type = row['Instance Type'];
    if (!type || !EC2_TYPES.includes(type)) continue;
    const p = num(row.price, `EC2 ${type} in ${region}`);
    if (out[type] !== undefined && out[type] !== p) fail(`AWS EC2 ${type} in ${region}: two prices`);
    out[type] = p;
  }
  return out;
}

function pageRate(file: PageFile, key: string, what: string): number {
  const row = file.regions[AWS_REGIONS[REGION]]?.[key];
  if (!row) fail(`AWS ${what}: "${key}" missing from the pricing file`);
  return num(row.price, what);
}

// ------------------------------------------------------------------ assemble

export async function refreshAws(): Promise<AwsPrices> {
  const offers = new Offers();
  const pageSources: string[] = [];

  log('AWS: EC2 instances (pricing-page files, every region)');
  const byRegion: Record<string, Record<string, number>> = {};
  for (const region of Object.keys(AWS_REGIONS)) byRegion[region] = await ec2Prices(pageSources, region);
  const ec2 = byRegion[REGION];
  for (const type of EC2_TYPES) if (ec2[type] === undefined) fail(`AWS EC2 ${type}: no us-east-1 price`);

  log('AWS: EBS and NAT gateway (pricing-page files)');
  const ebsFile = await pageFile(pageSources, 'ebs.json');
  const ebs: Record<string, number> = {};
  for (const [type, key] of Object.entries(EBS_KEYS)) ebs[type] = pageRate(ebsFile, key, `EBS ${type}`);
  const natFile = await pageFile(pageSources, 'natgateway.json');
  const nat = {
    hour: pageRate(natFile, 'Hourly charge for NAT Gateways', 'NAT gateway hour'),
    gb: pageRate(natFile, 'Charge for per GB data processed by NatGateways', 'NAT gateway GB'),
  };

  log('AWS: bulk offer files');
  const rdsOffer = await offers.get('AmazonRDS');
  const instance: AwsPrices['rds']['instance'] = {};
  for (const cls of RDS_CLASSES) {
    const engines: Record<string, { single: number; multi: number }> = {};
    for (const [engine, name] of Object.entries(RDS_ENGINES)) {
      if (RDS_NOT_SOLD.has(`${cls}/${engine}`)) continue;
      const rate = (deployment: 'Single-AZ' | 'Multi-AZ') =>
        price(rdsOffer, `RDS ${cls} ${engine} ${deployment}`, (a, f) =>
          f === 'Database Instance' &&
          a.instanceType === cls &&
          a.databaseEngine === name &&
          a.deploymentOption === deployment &&
          a.licenseModel === 'No license required' &&
          /^(?:[A-Z0-9]+-)?(?:InstanceUsage|Multi-AZUsage):/.test(a.usagetype ?? ''),
        );
      engines[engine] = { single: rate('Single-AZ'), multi: rate('Multi-AZ') };
    }
    instance[cls] = engines;
  }
  const storage: AwsPrices['rds']['storage'] = {};
  for (const [type, volumeType] of Object.entries(RDS_STORAGE)) {
    const rate = (engine: string, deployment: string) =>
      price(rdsOffer, `RDS ${type} storage ${engine} ${deployment}`, (a, f) =>
        f === 'Database Storage' && a.volumeType === volumeType && a.databaseEngine === engine && a.deploymentOption === deployment,
      );
    const single = rate('PostgreSQL', 'Single-AZ');
    const multi = rate('PostgreSQL', 'Multi-AZ');
    // the table has one storage rate for every open-source engine: prove it
    for (const other of ['MySQL', 'MariaDB']) {
      if (rate(other, 'Single-AZ') !== single || rate(other, 'Multi-AZ') !== multi) fail(`RDS ${type} storage differs for ${other}`);
    }
    storage[type] = { single, multi };
  }

  const cacheOffer = await offers.get('AmazonElastiCache');
  const elasticache: AwsPrices['elasticache'] = {};
  for (const node of CACHE_NODES) {
    const engines: Record<string, number> = {};
    for (const [engine, name] of Object.entries(CACHE_ENGINES)) {
      engines[engine] = price(cacheOffer, `ElastiCache ${node} ${engine}`, (a, f) =>
        f === 'Cache Instance' && a.instanceType === node && a.cacheEngine === name && /^(?:[A-Z0-9]+-)?NodeUsage:/.test(a.usagetype ?? ''),
      );
    }
    elasticache[node] = engines;
  }

  const eks = await offers.get('AmazonEKS');
  const ecs = await offers.get('AmazonECS');
  const elb = await offers.get('AWSELB');
  const vpc = await offers.get('AmazonVPC');
  const route53 = await offers.get('AmazonRoute53', true);
  const kms = await offers.get('awskms');
  const secrets = await offers.get('AWSSecretsManager');
  const lambda = await offers.get('AWSLambda');
  const s3 = await offers.get('AmazonS3');
  const cloudfront = await offers.get('AmazonCloudFront', true);
  const dynamodb = await offers.get('AmazonDynamoDB');
  const sqs = await offers.get('AWSQueueService');
  const sns = await offers.get('AmazonSNS');
  const apigw = await offers.get('AmazonApiGateway');
  const ecr = await offers.get('AmazonECR');

  const perMillion = (p: number) => shift(p, 6);
  const per10k = (p: number) => shift(p, 4);

  return {
    meta: { region: REGION, currency: 'USD', retrieved: today(), sources: [...offers.sources, ...pageSources] },
    regions: multipliers(ec2, byRegion, Object.keys(AWS_REGIONS), REGION),
    ec2: ordered(EC2_TYPES, ec2),
    ebs,
    rds: { instance, storage },
    elasticache,
    eks: { clusterHour: price(eks, 'EKS cluster', usage('USE1-AmazonEKS-Hours:perCluster')) },
    fargate: {
      vcpuHour: price(ecs, 'Fargate vCPU', usage('USE1-Fargate-vCPU-Hours:perCPU')),
      gbHour: price(ecs, 'Fargate GB', usage('USE1-Fargate-GB-Hours')),
      armVcpuHour: price(ecs, 'Fargate ARM vCPU', usage('USE1-Fargate-ARM-vCPU-Hours:perCPU')),
      armGbHour: price(ecs, 'Fargate ARM GB', usage('USE1-Fargate-ARM-GB-Hours')),
    },
    elb: {
      albHour: price(elb, 'ALB hour', usage('LoadBalancerUsage', 'Load Balancer-Application')),
      albLcuHour: price(elb, 'ALB LCU', usage('LCUUsage', 'Load Balancer-Application')),
      nlbHour: price(elb, 'NLB hour', usage('LoadBalancerUsage', 'Load Balancer-Network')),
      nlbLcuHour: price(elb, 'NLB NLCU', usage('LCUUsage', 'Load Balancer-Network')),
    },
    publicIpv4Hour: price(vpc, 'public IPv4', usage('USE1-PublicIPv4:InUseAddress')),
    nat,
    route53: {
      zoneMonth: price(route53, 'Route 53 hosted zone', usage('HostedZone', 'DNS Zone')),
      queriesPerMillion: perMillion(price(route53, 'Route 53 queries', (a, f) => f === 'DNS Query' && a.usagetype === 'DNS-Queries' && a.routingType === 'Standard')),
    },
    kms: {
      keyMonth: price(kms, 'KMS key', usage('us-east-1-KMS-Keys')),
      requestsPer10k: per10k(price(kms, 'KMS requests', usage('us-east-1-KMS-Requests'))),
    },
    secretsManager: {
      secretMonth: price(secrets, 'Secrets Manager secret', usage('USE1-AWSSecretsManager-Secrets')),
      apiPer10k: per10k(price(secrets, 'Secrets Manager API', usage('USE1-AWSSecretsManagerAPIRequest'))),
    },
    usage: {
      lambdaRequestsPerMillion: perMillion(price(lambda, 'Lambda requests', usage('Request', 'Serverless'))),
      lambdaGbSecond: price(lambda, 'Lambda GB-second', usage('Lambda-GB-Second', 'Serverless')),
      s3StandardGbMonth: price(s3, 'S3 Standard storage', (a) => a.usagetype === 'TimedStorage-ByteHrs' && a.volumeType === 'Standard'),
      cloudfrontGb: price(cloudfront, 'CloudFront data out (US)', usage('US-DataTransfer-Out-Bytes')),
      cloudfrontHttpsPer10k: per10k(price(cloudfront, 'CloudFront HTTPS requests (US)', usage('US-Requests-Tier2-HTTPS'))),
      dynamodbWritePerMillion: perMillion(price(dynamodb, 'DynamoDB on-demand writes', usage('WriteRequestUnits'))),
      dynamodbReadPerMillion: perMillion(price(dynamodb, 'DynamoDB on-demand reads', usage('ReadRequestUnits'))),
      dynamodbGbMonth: price(dynamodb, 'DynamoDB storage', (a) => a.usagetype === 'TimedStorage-ByteHrs' && a.volumeType === 'Amazon DynamoDB - Indexed DataStore'),
      sqsPerMillion: perMillion(price(sqs, 'SQS standard requests', usage('Requests-RBP'))),
      snsPerMillion: perMillion(price(sns, 'SNS requests', usage('Requests-Tier1'))),
      apiGatewayHttpPerMillion: perMillion(price(apigw, 'API Gateway HTTP API', usage('USE1-ApiGatewayHttpRequest'))),
      ecrGbMonth: price(ecr, 'ECR storage', (a) => a.usagetype === 'TimedStorage-ByteHrs' && a.storageType === 'S3'),
    },
  };
}
