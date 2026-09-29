# Cost estimate: price data

The monthly estimate is computed in the browser from three static price tables.
The app never fetches prices at runtime.

| File | Default region | What it holds |
| --- | --- | --- |
| [`prices/aws.json`](prices/aws.json) | `us-east-1` | EC2, EBS, RDS, ElastiCache, EKS, Fargate, ALB/NLB, public IPv4, NAT gateway, Route 53, KMS, Secrets Manager, plus headline usage rates |
| [`prices/azure.json`](prices/azure.json) | `eastus` | Linux VMs, managed disks, App Service plans, SQL Database (DTU), PostgreSQL flexible server, public IP, Azure Cache for Redis, Container Registry, Service Bus, AKS, plus usage rates |
| [`prices/gcp.json`](prices/gcp.json) | `us-central1` | machine types, persistent disks, external IP, Cloud SQL, GKE, Memorystore, forwarding rules, Cloud DNS, Cloud NAT, plus usage rates |

The shapes are typed by `AwsPrices`, `AzurePrices` and `GcpPrices` in [`types.ts`](types.ts),
so a table that doesn't match fails `pnpm typecheck`.

**What the numbers are:** on-demand (pay-as-you-go) list prices in USD, for the default
region, retrieved **2026-09-29** (`meta.retrieved` in each file). They exclude tax, data
transfer, support plans, discounts (reserved, savings plans, committed use) and free tiers
unless a note says so. Monthly figures use **730 hours per month**.

Units are in the key names: `…Hour` is per hour, `…Month` per month, `…GbMonth` per
GB-month (GiB-month for Google Cloud), `…PerMillion` / `…Per10k` per million / ten thousand
requests. Maps without a unit in the name are documented in `types.ts` (`ec2` and `vm` are
$/hour, `ebs` and `disk.*` per GB-month / per month, `sqlDatabase` and `containerRegistry` per month).

Only the SKUs the catalog offers (`src/resources/*.ts`) plus the most common neighbours
are listed. Anything else is priced as "unknown" by the estimator, never guessed.

## Sources

Every URL the refresh reads is also listed in the file's `meta.sources`.

**AWS** — the public [AWS Price List](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html), no credentials:

- Bulk regional offer files, `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<Service>/current/us-east-1/index.json`
  for `AmazonRDS`, `AmazonElastiCache`, `AmazonEKS`, `AmazonECS` (Fargate), `AWSELB`, `AmazonVPC`,
  `awskms`, `AWSSecretsManager`, `AWSLambda`, `AmazonS3`, `AmazonDynamoDB`, `AWSQueueService`,
  `AmazonSNS`, `AmazonApiGateway`, `AmazonECR`; the global files (`…/<Service>/current/index.json`)
  for `AmazonRoute53` and `AmazonCloudFront`. Prices are the `terms.OnDemand` dimensions.
- EC2's bulk file is ~480 MB, so instances, EBS and NAT gateway come from the same Price List
  data as the [EC2 pricing page](https://aws.amazon.com/ec2/pricing/on-demand/) publishes it
  (every `rateCode` there is a bulk-file SKU):
  `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/<Region name>/Linux/index.json`,
  `…/ec2/USD/current/ebs.json` and `…/ec2/USD/current/natgateway.json`.

**Azure** — the public [Azure Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices),
`https://prices.azure.com/api/retail/prices`, `priceType eq 'Consumption'`, `armRegionName eq 'eastus'`.
VMs exclude Windows, Spot and Low Priority meters. Managed-disk tier sizes (S4 = 32 GiB …) are read
from the [managed disks pricing page](https://azure.microsoft.com/en-us/pricing/details/managed-disks/).

**Google Cloud** — Google has no key-free price API, so the refresh reads the public pricing
pages, which are server-rendered for Iowa (`us-central1`; the script checks the region picker)
and embed every other region's tables:
[compute (general purpose)](https://cloud.google.com/products/compute/pricing/general-purpose),
[disks](https://cloud.google.com/compute/disks-image-pricing),
[network: external IPs, forwarding rules](https://cloud.google.com/vpc/network-pricing),
[Cloud SQL](https://cloud.google.com/sql/pricing),
[GKE](https://cloud.google.com/kubernetes-engine/pricing),
[Memorystore](https://cloud.google.com/memorystore/docs/redis/pricing) (largest size from
[Redis tiers](https://cloud.google.com/memorystore/docs/redis/redis-tiers)),
[Cloud DNS](https://cloud.google.com/dns/pricing),
[Cloud NAT](https://cloud.google.com/nat/pricing),
[Cloud Run](https://cloud.google.com/run/pricing),
[Cloud Storage](https://cloud.google.com/storage/pricing),
[Pub/Sub](https://cloud.google.com/pubsub/pricing),
[BigQuery](https://cloud.google.com/bigquery/pricing),
[Artifact Registry](https://cloud.google.com/artifact-registry/pricing),
[Secret Manager](https://cloud.google.com/secret-manager/pricing).

### Conversions and choices

- **Tiered prices** take the first *paid* tier, after any free tier (e.g. SNS after the first
  1 M requests, DynamoDB storage after 25 GB, pd-standard after 30 GiB).
- **Per-request rates** are scaled exactly (decimal shift): `0.0000004` per query → `0.4` per million.
- **Per-day prices** (Azure SQL Database DTU, Container Registry) → per month × 730 / 24,
  rounded to 6 decimals. **Per-hour / per-GiB-hour prices** on Google's pages (disks, Cloud SQL
  storage, DNS zones, Cloud Storage, Artifact Registry, Secret Manager) → per month × 730, rounded
  to 6 decimals (Google's own monthly figures use 730 h).
- **RDS**: `single` = Single-AZ, `multi` = Multi-AZ with one standby (not the readable-standbys
  cluster), license "No license required". Storage is the same for PostgreSQL, MySQL and MariaDB
  (the script checks); `gp2` is Terraform's default `storage_type`.
- **ElastiCache**: node-based on-demand, `redis` (Redis OSS), `memcached`, `valkey`.
- **Azure PostgreSQL flexible server**: burstable sizes have their own meter; the D/E series are
  priced per vCore, so `GP_Standard_D2s_v3` = 2 × the Dsv3 vCore rate (checked against the
  API's exact-size meter where one exists).
- **Azure Cache for Redis** keys are `<sku>_<family><capacity>`: `Basic_C0`, `Standard_C1`,
  `Premium_P1`. A Standard cache's price already includes its replica.
- **Azure disks**: `disk.<type>` lists the tiers smallest first (`{ tier: "S4", gb: 32, month }`);
  a disk is billed at the smallest tier that fits it.
- **AKS**: `standardClusterHour` is the Standard tier (uptime SLA) meter; the Premium tier is
  billed through the "Standard Long Term Support" meter, `premiumClusterHour`.
- **Cloud SQL**: Enterprise edition rates (the table without the Enterprise Plus data cache);
  high availability doubles compute and storage on Google's page.
- **Cloud Run**: request-based billing (the default): active vCPU-second, GiB-second, requests.
- **Memorystore**: `$/GB-hour` by capacity tier M1–M5, `maxGb` 4 / 10 / 35 / 100 / 300
  (300 GB is the largest instance, from the Redis tiers page).

### Region multipliers

Each file's `regions` maps a region to a multiplier of the default region's prices: the
**median, over a compute basket, of regional price ÷ default-region price**, rounded to 3
decimals. The basket is every EC2 instance type (AWS), Linux VM size (Azure) or machine type
(Google Cloud) in the table that the region sells; the regional prices are read from the
same sources (the EC2 pricing-page file of each region, the Retail Prices API per region, the
per-region tables embedded in Google's compute page). The estimator applies it to every
service of that provider — an approximation, flagged as such, and a region that isn't in the
table is priced at the default region with a "prices may differ" note.

## Refreshing

```bash
pnpm exec vite-node src/cost/refresh/refresh-prices.ts            # all three providers
pnpm exec vite-node src/cost/refresh/refresh-prices.ts aws azure  # some of them
```

It downloads ~120 MB (the RDS offer file is 27 MB, Google's compute page 35 MB) and takes a
few minutes. Set `PRICES_CACHE_DIR=/some/dir` to keep the downloads and reuse them on the
next run while you work on the script (delete the directory to fetch fresh prices).

Each requested SKU must be found, and must match exactly one price (identical duplicates are
fine): anything missing or ambiguous fails the run **before any file is written**. If a
provider renames a meter or changes a page, the error names the SKU and the source to look at.

Then:

1. `git diff src/cost/prices` — read the changes. Price moves are normally small; a big jump
   or a sign change usually means a changed source, not a price change.
2. Spot-check a few against the providers' calculators or pricing pages (t3.micro, db.t3.micro,
   Standard_B1s, e2-micro).
3. `pnpm test` — the price-data integrity tests check that every option the catalog offers for a
   priced field has a price (or is explicitly listed as unpriced).

### Adding a SKU

Add it to the list in the provider's module — `EC2_TYPES`, `RDS_CLASSES`, `CACHE_NODES`
([`refresh/aws.ts`](refresh/aws.ts)), `VM_SIZES`, `APP_SERVICE_PLANS`, `SQL_DTU`, `PG_SKUS`, `REDIS`
([`refresh/azure.ts`](refresh/azure.ts)), `MACHINE_TYPES` ([`refresh/gcp.ts`](refresh/gcp.ts)) —
and run the refresh. Google machine types must appear on the general-purpose compute page (other
families live on other pages: add the page to `PAGE` and read it the same way).

### Nothing is manual today

Every value is read by the script. If a Google page stops being parseable, the fallback is
to read the number off the page listed in the error, put it in the JSON by hand, and note
the page and date in the commit message until the script is fixed.

## Estimator

[`estimate.ts`](estimate.ts) turns the IR into a `ProjectCost` (types in [`types.ts`](types.ts)); it is
pure and runs on every edit. Each resource type has a rule in [`services/`](services) that reads its
arguments ([`resolve.ts`](resolve.ts): literals, `var.x` defaults, arguments of other resources such
as `azurerm_resource_group.main.location`) and returns one of:

| Kind | Meaning | `monthly` |
| --- | --- | --- |
| `fixed` | billed lines, e.g. `t3.micro 730 h × $0.0104` + `8 GB gp3 × $0.08` (a usage part on top is named in the assumptions) | the sum × `count` |
| `usage` | billed only by use (Lambda, S3, Cloud Run…): a note with the headline rates and free tier | `null` |
| `free` | nothing billed for the resource itself (VPC, IAM, subnets…) | `0` |
| `unknown` | not in the table, an expression, Spot, `for_each`… — the note says why | `null` |

- **Region**: the provider block's `region` (AWS, alias-aware), the `location` (Azure), the resource's
  region / location / zone or the provider's (Google Cloud). Rates are scaled by `regions`; a region
  outside the table keeps default prices with a "may differ" note.
- **count**: a literal (or a variable default) multiplies the estimate; `for_each` or a computed
  `count` makes it `unknown`, with the price of one instance in the note.
- **Defaults** the provider applies are priced and stated (an 8 GB gp3 root volume, RDS `gp2`
  storage, 20 GB EKS node disks, the image size of a GCE boot disk…).
- **Coverage**: `prices.test.ts` fails if a catalog resource has no rule, or a catalog option of a
  priced field has no price and isn't listed in `UNPRICED_OPTIONS` ([`services/index.ts`](services/index.ts)).

The tables are one lazy chunk ([`load.ts`](load.ts)); the UI lives in `src/features/cost` (canvas
chip + breakdown, inspector line) and the PDF section in `src/features/export/archDoc.ts`.
