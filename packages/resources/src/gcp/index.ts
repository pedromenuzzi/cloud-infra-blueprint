import { defineResource } from '@blueprint/ir';
import { z } from 'zod';

export const googleComputeNetwork = defineResource({
  provider: 'gcp',
  type: 'google_compute_network',
  category: 'Network',
  displayName: 'VPC Network',
  icon: '/icons/gcp/vpc.svg',
  schema: z.object({
    name: z.string(),
    auto_create_subnetworks: z.boolean().optional(),
    routing_mode: z.enum(['REGIONAL', 'GLOBAL']).optional(),
  }),
  defaults: { auto_create_subnetworks: false, routing_mode: 'REGIONAL' },
  ports: { in: [], out: [{ kind: 'network', label: 'subnetworks' }] },
  emit(res, ctx) {
    return ctx.block('resource', ['google_compute_network', res.name], res.args);
  },
});

export const googleComputeSubnetwork = defineResource({
  provider: 'gcp',
  type: 'google_compute_subnetwork',
  category: 'Network',
  displayName: 'Subnetwork',
  icon: '/icons/gcp/subnet.svg',
  schema: z.object({
    name: z.string(),
    network: z.string(),
    region: z.string(),
    ip_cidr_range: z.string(),
    private_ip_google_access: z.boolean().optional(),
  }),
  defaults: { ip_cidr_range: '10.10.0.0/16' },
  ports: {
    in: [{ kind: 'network', label: 'in network' }],
    out: [{ kind: 'network', label: 'hosts' }],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['google_compute_subnetwork', res.name], res.args);
  },
});

export const googleComputeInstance = defineResource({
  provider: 'gcp',
  type: 'google_compute_instance',
  category: 'Compute',
  displayName: 'Compute Instance',
  icon: '/icons/gcp/compute.svg',
  schema: z.object({
    name: z.string(),
    machine_type: z.enum(['e2-micro', 'e2-small', 'e2-medium', 'n2-standard-2']),
    zone: z.string(),
    tags: z.array(z.string()).optional(),
  }),
  defaults: { machine_type: 'e2-micro' },
  ports: { in: [{ kind: 'network', label: 'network' }], out: [] },
  emit(res, ctx) {
    return ctx.block('resource', ['google_compute_instance', res.name], res.args);
  },
});

export const googleStorageBucket = defineResource({
  provider: 'gcp',
  type: 'google_storage_bucket',
  category: 'Storage',
  displayName: 'Cloud Storage Bucket',
  icon: '/icons/gcp/storage.svg',
  schema: z.object({
    name: z.string(),
    location: z.string(),
    force_destroy: z.boolean().optional(),
    storage_class: z.enum(['STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE']).optional(),
    uniform_bucket_level_access: z.boolean().optional(),
  }),
  defaults: { storage_class: 'STANDARD', uniform_bucket_level_access: true },
  ports: { in: [], out: [] },
  emit(res, ctx) {
    return ctx.block('resource', ['google_storage_bucket', res.name], res.args);
  },
});

export const googleSqlDatabaseInstance = defineResource({
  provider: 'gcp',
  type: 'google_sql_database_instance',
  category: 'Database',
  displayName: 'Cloud SQL',
  icon: '/icons/gcp/sql.svg',
  schema: z.object({
    name: z.string(),
    database_version: z.enum(['POSTGRES_15', 'POSTGRES_16', 'MYSQL_8_0']),
    region: z.string(),
    deletion_protection: z.boolean().optional(),
  }),
  defaults: { database_version: 'POSTGRES_16', deletion_protection: false },
  ports: { in: [{ kind: 'network', label: 'connections' }], out: [] },
  emit(res, ctx) {
    return ctx.block('resource', ['google_sql_database_instance', res.name], res.args);
  },
});

export const googleServiceAccount = defineResource({
  provider: 'gcp',
  type: 'google_service_account',
  category: 'Identity',
  displayName: 'Service Account',
  icon: '/icons/gcp/iam.svg',
  schema: z.object({
    account_id: z.string(),
    display_name: z.string().optional(),
  }),
  defaults: {},
  ports: { in: [], out: [{ kind: 'iam', label: 'used by' }] },
  emit(res, ctx) {
    return ctx.block('resource', ['google_service_account', res.name], res.args);
  },
});

export const gcpCatalog = [
  googleComputeNetwork,
  googleComputeSubnetwork,
  googleComputeInstance,
  googleStorageBucket,
  googleSqlDatabaseInstance,
  googleServiceAccount,
];
