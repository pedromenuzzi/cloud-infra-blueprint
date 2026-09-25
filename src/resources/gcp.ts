import { block, lit, literalString } from '@/ir/expr';
import { defineResource } from './types';

const litStr = literalString;

const GCP_REGIONS = ['us-central1', 'us-east1', 'europe-west1', 'southamerica-east1'];

export const GCP_RESOURCES = [
  defineResource({
    type: 'google_compute_network',
    provider: 'gcp',
    category: 'network',
    displayName: 'VPC Network',
    shortName: 'VPC Network',
    description: 'Global virtual network',
    container: true,
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'auto_create_subnetworks', type: 'boolean' },
    ],
    defaults: { auto_create_subnetworks: lit(false) },
    subtitle: () => 'VPC network',
  }),

  defineResource({
    type: 'google_compute_subnetwork',
    provider: 'gcp',
    category: 'network',
    displayName: 'Subnetwork',
    shortName: 'Subnet',
    description: 'Regional subnet',
    container: true,
    containment: [{ arg: 'network', parentTypes: ['google_compute_network'] }],
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'ip_cidr_range', type: 'string', required: true, placeholder: '10.0.1.0/24' },
      { name: 'region', type: 'select', options: GCP_REGIONS },
      { name: 'network', type: 'string', refTo: ['google_compute_network'], required: true },
    ],
    connections: [
      { targetTypes: ['google_compute_network'], arg: 'network', attr: 'id', mode: 'set' },
    ],
    subtitle: (args) => litStr(args.ip_cidr_range),
  }),

  defineResource({
    type: 'google_compute_firewall',
    provider: 'gcp',
    category: 'network',
    displayName: 'Firewall Rule',
    shortName: 'Firewall',
    description: 'Network firewall rule',
    containment: [{ arg: 'network', parentTypes: ['google_compute_network'] }],
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'network', type: 'string', refTo: ['google_compute_network'], required: true },
      { name: 'direction', type: 'select', options: ['INGRESS', 'EGRESS'] },
      { name: 'source_ranges', type: 'list' },
    ],
    connections: [
      { targetTypes: ['google_compute_network'], arg: 'network', attr: 'id', mode: 'set' },
    ],
    subtitle: (args) => litStr(args.direction) ?? 'firewall',
  }),

  defineResource({
    type: 'google_compute_instance',
    provider: 'gcp',
    category: 'compute',
    displayName: 'Compute Instance',
    shortName: 'Compute',
    description: 'Virtual machine',
    containment: [
      { arg: 'network_interface', parentTypes: ['google_compute_subnetwork', 'google_compute_network'] },
    ],
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'machine_type',
        type: 'select',
        required: true,
        options: ['e2-micro', 'e2-small', 'e2-medium', 'n2-standard-2', 'n2-standard-4'],
      },
      { name: 'zone', type: 'string', placeholder: 'us-central1-a' },
    ],
    defaults: { machine_type: lit('e2-micro') },
    subtitle: (args) => litStr(args.machine_type),
  }),

  defineResource({
    type: 'google_storage_bucket',
    provider: 'gcp',
    category: 'storage',
    displayName: 'Cloud Storage Bucket',
    shortName: 'Cloud Storage',
    description: 'Object storage bucket',
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'location',
        type: 'select',
        required: true,
        options: ['US', 'EU', 'ASIA', 'us-central1', 'southamerica-east1'],
      },
      {
        name: 'storage_class',
        type: 'select',
        options: ['STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE'],
      },
      { name: 'uniform_bucket_level_access', type: 'boolean' },
    ],
    defaults: { location: lit('US'), storage_class: lit('STANDARD') },
    subtitle: (args) => litStr(args.location),
  }),

  defineResource({
    type: 'google_sql_database_instance',
    provider: 'gcp',
    category: 'database',
    displayName: 'Cloud SQL Instance',
    shortName: 'Cloud SQL',
    description: 'Managed relational database',
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'database_version',
        type: 'select',
        required: true,
        options: ['POSTGRES_15', 'POSTGRES_16', 'MYSQL_8_0', 'SQLSERVER_2019_STANDARD'],
      },
      { name: 'region', type: 'select', options: GCP_REGIONS },
      { name: 'deletion_protection', type: 'boolean' },
    ],
    defaults: { database_version: lit('POSTGRES_16') },
    subtitle: (args) => litStr(args.database_version),
  }),

  defineResource({
    type: 'google_compute_backend_bucket',
    provider: 'gcp',
    category: 'edge',
    displayName: 'Backend Bucket',
    shortName: 'Backend Bucket',
    description: 'Serves a storage bucket through the LB',
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'bucket_name',
        type: 'string',
        refTo: ['google_storage_bucket'],
        refAttr: 'name',
        required: true,
      },
      { name: 'enable_cdn', type: 'boolean' },
    ],
    defaults: { enable_cdn: lit(true) },
    connections: [
      { targetTypes: ['google_storage_bucket'], arg: 'bucket_name', attr: 'name', mode: 'set' },
    ],
    subtitle: () => 'CDN backend',
  }),

  defineResource({
    type: 'google_compute_url_map',
    provider: 'gcp',
    category: 'edge',
    displayName: 'URL Map',
    shortName: 'URL Map',
    description: 'Routes requests to backends',
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'default_service',
        type: 'string',
        refTo: ['google_compute_backend_bucket'],
        required: true,
      },
    ],
    connections: [
      {
        targetTypes: ['google_compute_backend_bucket'],
        arg: 'default_service',
        attr: 'id',
        mode: 'set',
      },
    ],
    subtitle: () => 'HTTP routing',
  }),

  defineResource({
    type: 'google_compute_target_http_proxy',
    provider: 'gcp',
    category: 'edge',
    displayName: 'HTTP Proxy',
    shortName: 'HTTP Proxy',
    description: 'Terminates HTTP for the load balancer',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'url_map', type: 'string', refTo: ['google_compute_url_map'], required: true },
    ],
    connections: [
      { targetTypes: ['google_compute_url_map'], arg: 'url_map', attr: 'id', mode: 'set' },
    ],
    subtitle: () => 'LB frontend',
  }),

  defineResource({
    type: 'google_compute_global_forwarding_rule',
    provider: 'gcp',
    category: 'edge',
    displayName: 'Forwarding Rule',
    shortName: 'Forwarding Rule',
    description: 'Global anycast entry point',
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'target',
        type: 'string',
        refTo: ['google_compute_target_http_proxy'],
        required: true,
      },
      { name: 'port_range', type: 'select', options: ['80', '443'] },
    ],
    defaults: { port_range: lit('80') },
    connections: [
      {
        targetTypes: ['google_compute_target_http_proxy'],
        arg: 'target',
        attr: 'id',
        mode: 'set',
      },
    ],
    subtitle: (args) => {
      const port = litStr(args.port_range);
      return port ? `:${port}` : undefined;
    },
  }),

  defineResource({
    type: 'google_artifact_registry_repository',
    provider: 'gcp',
    category: 'containers',
    displayName: 'Artifact Registry',
    shortName: 'Artifact Registry',
    description: 'Container image and package registry',
    fields: [
      { name: 'repository_id', type: 'string', required: true },
      { name: 'format', type: 'select', options: ['DOCKER', 'NPM', 'MAVEN'], required: true },
      { name: 'location', type: 'select', options: GCP_REGIONS },
    ],
    defaults: { format: lit('DOCKER') },
    subtitle: (args) => litStr(args.format) ?? 'registry',
  }),

  defineResource({
    type: 'google_cloud_run_v2_service',
    provider: 'gcp',
    category: 'containers',
    displayName: 'Cloud Run Service',
    shortName: 'Cloud Run',
    description: 'Serverless containers',
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'location',
        type: 'select',
        options: GCP_REGIONS,
        required: true,
      },
      {
        name: 'ingress',
        type: 'select',
        options: ['INGRESS_TRAFFIC_ALL', 'INGRESS_TRAFFIC_INTERNAL_ONLY'],
      },
    ],
    defaults: { location: lit('us-central1'), ingress: lit('INGRESS_TRAFFIC_ALL') },
    subtitle: (args) => litStr(args.location),
  }),

  defineResource({
    type: 'google_dns_managed_zone',
    provider: 'gcp',
    category: 'edge',
    displayName: 'Cloud DNS Zone',
    shortName: 'Cloud DNS',
    description: 'Managed DNS zone',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'dns_name', type: 'string', required: true, placeholder: 'example.com.' },
    ],
    subtitle: (args) => litStr(args.dns_name),
  }),

  defineResource({
    type: 'google_dns_record_set',
    provider: 'gcp',
    category: 'edge',
    displayName: 'DNS Record Set',
    shortName: 'DNS Record',
    description: 'DNS record in a managed zone',
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'managed_zone',
        type: 'string',
        refTo: ['google_dns_managed_zone'],
        refAttr: 'name',
        required: true,
      },
      { name: 'type', type: 'select', options: ['A', 'AAAA', 'CNAME', 'TXT', 'MX'], required: true },
      { name: 'ttl', type: 'number' },
      { name: 'rrdatas', type: 'list' },
    ],
    defaults: { type: lit('A'), ttl: lit(300) },
    connections: [
      { targetTypes: ['google_dns_managed_zone'], arg: 'managed_zone', attr: 'name', mode: 'set' },
    ],
    subtitle: (args) => litStr(args.type),
  }),

  defineResource({
    type: 'google_compute_router',
    provider: 'gcp',
    category: 'network',
    displayName: 'Cloud Router',
    shortName: 'Router',
    description: 'Regional router (needed for Cloud NAT)',
    containment: [{ arg: 'network', parentTypes: ['google_compute_network'] }],
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'network', type: 'string', required: true, refTo: ['google_compute_network'] },
      { name: 'region', type: 'select', options: GCP_REGIONS },
    ],
    connections: [
      { targetTypes: ['google_compute_network'], arg: 'network', attr: 'id', mode: 'set' },
    ],
    subtitle: (args) => litStr(args.region) ?? 'router',
  }),

  defineResource({
    type: 'google_compute_router_nat',
    provider: 'gcp',
    category: 'network',
    displayName: 'Cloud NAT',
    shortName: 'Cloud NAT',
    description: 'Outbound internet for private instances',
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'router',
        type: 'string',
        required: true,
        refTo: ['google_compute_router'],
        refAttr: 'name',
      },
      { name: 'region', type: 'select', options: GCP_REGIONS },
      {
        name: 'nat_ip_allocate_option',
        type: 'select',
        options: ['AUTO_ONLY', 'MANUAL_ONLY'],
        required: true,
      },
      {
        name: 'source_subnetwork_ip_ranges_to_nat',
        type: 'select',
        options: [
          'ALL_SUBNETWORKS_ALL_IP_RANGES',
          'ALL_SUBNETWORKS_ALL_PRIMARY_IP_RANGES',
          'LIST_OF_SUBNETWORKS',
        ],
        required: true,
      },
    ],
    defaults: {
      nat_ip_allocate_option: lit('AUTO_ONLY'),
      source_subnetwork_ip_ranges_to_nat: lit('ALL_SUBNETWORKS_ALL_IP_RANGES'),
    },
    connections: [
      { targetTypes: ['google_compute_router'], arg: 'router', attr: 'name', mode: 'set' },
    ],
    subtitle: () => 'egress NAT',
  }),

  defineResource({
    type: 'google_cloudfunctions2_function',
    provider: 'gcp',
    category: 'compute',
    displayName: 'Cloud Function',
    shortName: 'Function',
    description: 'Serverless function (2nd gen)',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'location', type: 'select', options: GCP_REGIONS, required: true },
      { name: 'description', type: 'string' },
    ],
    defaults: {
      location: lit('us-central1'),
      build_config: block({ runtime: lit('nodejs22'), entry_point: lit('handler') }),
      service_config: block({
        max_instance_count: lit(1),
        available_memory: lit('256M'),
        timeout_seconds: lit(60),
      }),
    },
    subtitle: (args) =>
      args.build_config?.kind === 'block' ? litStr(args.build_config.body.runtime) : undefined,
  }),

  defineResource({
    type: 'google_container_cluster',
    provider: 'gcp',
    category: 'containers',
    displayName: 'GKE Cluster',
    shortName: 'GKE',
    description: 'Managed Kubernetes',
    container: true,
    containment: [
      { arg: 'subnetwork', parentTypes: ['google_compute_subnetwork'] },
      { arg: 'network', parentTypes: ['google_compute_network'] },
    ],
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'location', type: 'select', options: GCP_REGIONS, doc: 'A region (or a zone for a zonal cluster)' },
      { name: 'network', type: 'string', refTo: ['google_compute_network'], refAttr: 'name' },
      { name: 'subnetwork', type: 'string', refTo: ['google_compute_subnetwork'], refAttr: 'name' },
      { name: 'initial_node_count', type: 'number' },
      { name: 'remove_default_node_pool', type: 'boolean', doc: 'Manage nodes with separate node pools' },
      { name: 'deletion_protection', type: 'boolean' },
    ],
    defaults: { location: lit('us-central1'), initial_node_count: lit(1) },
    connections: [
      { targetTypes: ['google_compute_network'], arg: 'network', attr: 'name', mode: 'set' },
      { targetTypes: ['google_compute_subnetwork'], arg: 'subnetwork', attr: 'name', mode: 'set' },
    ],
    subtitle: (args) => litStr(args.location),
  }),

  defineResource({
    type: 'google_container_node_pool',
    provider: 'gcp',
    category: 'containers',
    displayName: 'GKE Node Pool',
    shortName: 'Node Pool',
    description: 'Group of worker nodes for a GKE cluster',
    containment: [{ arg: 'cluster', parentTypes: ['google_container_cluster'] }],
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'cluster', type: 'string', required: true, refTo: ['google_container_cluster'] },
      { name: 'node_count', type: 'number' },
    ],
    defaults: { node_count: lit(1), node_config: block({ machine_type: lit('e2-medium') }) },
    connections: [
      { targetTypes: ['google_container_cluster'], arg: 'cluster', attr: 'id', mode: 'set' },
    ],
    subtitle: (args) =>
      args.node_config?.kind === 'block' ? litStr(args.node_config.body.machine_type) : undefined,
  }),

  defineResource({
    type: 'google_pubsub_topic',
    provider: 'gcp',
    category: 'integration',
    displayName: 'Pub/Sub Topic',
    shortName: 'Pub/Sub',
    description: 'Asynchronous messaging topic',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'message_retention_duration', type: 'string', placeholder: '86400s' },
    ],
    subtitle: () => 'topic',
  }),

  defineResource({
    type: 'google_pubsub_subscription',
    provider: 'gcp',
    category: 'integration',
    displayName: 'Pub/Sub Subscription',
    shortName: 'Subscription',
    description: 'Pull or push delivery from a topic',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'topic', type: 'string', required: true, refTo: ['google_pubsub_topic'] },
      { name: 'ack_deadline_seconds', type: 'number' },
      { name: 'message_retention_duration', type: 'string', placeholder: '604800s' },
    ],
    defaults: { ack_deadline_seconds: lit(20) },
    connections: [{ targetTypes: ['google_pubsub_topic'], arg: 'topic', attr: 'id', mode: 'set' }],
    subtitle: () => 'subscription',
  }),

  defineResource({
    type: 'google_redis_instance',
    provider: 'gcp',
    category: 'database',
    displayName: 'Memorystore for Redis',
    shortName: 'Memorystore',
    description: 'Managed Redis',
    containment: [{ arg: 'authorized_network', parentTypes: ['google_compute_network'] }],
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'memory_size_gb', type: 'number', required: true },
      { name: 'tier', type: 'select', options: ['BASIC', 'STANDARD_HA'] },
      { name: 'region', type: 'select', options: GCP_REGIONS },
      { name: 'authorized_network', type: 'string', refTo: ['google_compute_network'] },
    ],
    defaults: { memory_size_gb: lit(1), tier: lit('BASIC') },
    connections: [
      { targetTypes: ['google_compute_network'], arg: 'authorized_network', attr: 'id', mode: 'set' },
    ],
    subtitle: (args) => {
      const gb = args.memory_size_gb?.kind === 'literal' ? args.memory_size_gb.value : undefined;
      return gb !== undefined ? `${gb} GB` : 'Redis';
    },
  }),

  defineResource({
    type: 'google_bigquery_dataset',
    provider: 'gcp',
    category: 'database',
    displayName: 'BigQuery Dataset',
    shortName: 'BigQuery',
    description: 'Analytics data warehouse dataset',
    nameArg: 'dataset_id',
    fields: [
      { name: 'dataset_id', type: 'string', required: true, doc: 'Letters, numbers and underscores' },
      { name: 'location', type: 'select', options: ['US', 'EU', ...GCP_REGIONS] },
      { name: 'description', type: 'string' },
    ],
    defaults: { location: lit('US') },
    subtitle: (args) => litStr(args.location),
  }),

  defineResource({
    type: 'google_service_account',
    provider: 'gcp',
    category: 'identity',
    displayName: 'Service Account',
    shortName: 'Service Account',
    description: 'Identity for workloads',
    nameArg: 'account_id',
    fields: [
      { name: 'account_id', type: 'string', required: true, doc: '6–30 lowercase letters, digits, hyphens' },
      { name: 'display_name', type: 'string' },
    ],
    subtitle: () => 'service account',
  }),

  defineResource({
    type: 'google_secret_manager_secret',
    provider: 'gcp',
    category: 'identity',
    displayName: 'Secret Manager Secret',
    shortName: 'Secret',
    description: 'Stores API keys, passwords and certificates',
    nameArg: 'secret_id',
    fields: [{ name: 'secret_id', type: 'string', required: true }],
    defaults: { replication: block({ auto: block({}) }) },
    subtitle: () => 'secret',
  }),
];
