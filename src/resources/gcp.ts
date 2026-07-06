import { lit, literalString } from '@/ir/expr';
import { defineResource } from './types';

const litStr = literalString;

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
      { name: 'region', type: 'select', options: ['us-central1', 'us-east1', 'europe-west1', 'southamerica-east1'] },
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
      { name: 'region', type: 'select', options: ['us-central1', 'us-east1', 'europe-west1', 'southamerica-east1'] },
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
];
