/** A small, fixed price book for unit tests: the estimator's math, independent of the refreshed tables. */
import type { PriceBook } from './types';

const meta = (region: string) => ({ region, currency: 'USD', retrieved: '2026-09-29', sources: ['https://example.test/prices'] });

export const TEST_BOOK: PriceBook = {
  aws: {
    meta: meta('us-east-1'),
    regions: { 'us-east-1': 1, 'sa-east-1': 1.5, 'eu-west-1': 1.1 },
    ec2: { 't3.micro': 0.0104, 't3.small': 0.0208, 't3.medium': 0.0416, 'm5.large': 0.096 },
    ebs: { gp3: 0.08, gp2: 0.1, io1: 0.125 },
    rds: {
      instance: {
        'db.t3.micro': { postgres: { single: 0.018, multi: 0.036 }, mysql: { single: 0.017, multi: 0.034 } },
      },
      storage: { gp2: { single: 0.115, multi: 0.23 }, gp3: { single: 0.115, multi: 0.23 } },
    },
    elasticache: { 'cache.t4g.micro': { redis: 0.016, memcached: 0.016 } },
    eks: { clusterHour: 0.1 },
    fargate: { vcpuHour: 0.04048, gbHour: 0.004445, armVcpuHour: 0.03238, armGbHour: 0.00356 },
    elb: { albHour: 0.0225, albLcuHour: 0.008, nlbHour: 0.0225, nlbLcuHour: 0.006 },
    publicIpv4Hour: 0.005,
    nat: { hour: 0.045, gb: 0.045 },
    route53: { zoneMonth: 0.5, queriesPerMillion: 0.4 },
    kms: { keyMonth: 1, requestsPer10k: 0.03 },
    secretsManager: { secretMonth: 0.4, apiPer10k: 0.05 },
    usage: {
      lambdaRequestsPerMillion: 0.2,
      lambdaGbSecond: 0.0000166667,
      s3StandardGbMonth: 0.023,
      cloudfrontGb: 0.085,
      cloudfrontHttpsPer10k: 0.01,
      dynamodbWritePerMillion: 0.625,
      dynamodbReadPerMillion: 0.125,
      dynamodbGbMonth: 0.25,
      sqsPerMillion: 0.4,
      snsPerMillion: 0.5,
      apiGatewayHttpPerMillion: 1,
      ecrGbMonth: 0.1,
    },
  },
  azure: {
    meta: meta('eastus'),
    regions: { eastus: 1, brazilsouth: 1.6 },
    vm: { Standard_B1s: 0.0104, Standard_B2s: 0.0416 },
    disk: {
      Standard_LRS: [
        { tier: 'S4', gb: 32, month: 1.54 },
        { tier: 'S6', gb: 64, month: 3.01 },
      ],
      StandardSSD_LRS: [{ tier: 'E10', gb: 128, month: 9.6 }],
      Premium_LRS: [{ tier: 'P10', gb: 128, month: 19.71 }],
    },
    appService: { linux: { F1: 0, B1: 0.018 }, windows: { B1: 0.075 } },
    sqlDatabase: { Basic: 4.9, S0: 14.72 },
    postgresFlexible: { compute: { B_Standard_B1ms: 0.0207 }, storageGbMonth: 0.115 },
    publicIp: { standardHour: 0.005 },
    redis: { Basic_C0: 0.022 },
    containerRegistry: { Basic: 5 },
    serviceBus: { standardBaseHour: 0.0135, premiumUnitHour: 0.928 },
    aks: { standardClusterHour: 0.1, premiumClusterHour: 0.6 },
    usage: { blobHotLrsGbMonth: 0.0184, keyVaultPer10k: 0.03, functionsPerMillion: 0.2, functionsGbSecond: 0.000016 },
  },
  gcp: {
    meta: meta('us-central1'),
    regions: { 'us-central1': 1, 'southamerica-east1': 1.5 },
    machine: { 'e2-micro': 0.008376428, 'e2-medium': 0.033505712, 'n2-standard-2': 0.097118 },
    disk: { 'pd-standard': 0.04, 'pd-balanced': 0.1, 'pd-ssd': 0.17 },
    externalIpHour: 0.005,
    sql: { shared: { 'db-f1-micro': 0.0105, 'db-g1-small': 0.035 }, vcpuHour: 0.0413, gbHour: 0.007, storage: { SSD: 0.17, HDD: 0.09 } },
    gke: { clusterHour: 0.1 },
    memorystore: {
      basic: [
        { maxGb: 4, gbHour: 0.049 },
        { maxGb: 300, gbHour: 0.023 },
      ],
      standard: [
        { maxGb: 4, gbHour: 0.064 },
        { maxGb: 300, gbHour: 0.03 },
      ],
    },
    lb: { forwardingRuleHour: 0.025 },
    dns: { zoneMonth: 0.2 },
    nat: { vmHour: 0.0014, maxHour: 0.044, gb: 0.045 },
    usage: {
      cloudRunVcpuSecond: 0.000024,
      cloudRunGibSecond: 0.0000025,
      cloudRunPerMillion: 0.4,
      storageStandardGbMonth: 0.02,
      pubsubTib: 40,
      bigqueryTibScanned: 6.25,
      artifactGbMonth: 0.1,
      secretVersionMonth: 0.06,
    },
  },
};
