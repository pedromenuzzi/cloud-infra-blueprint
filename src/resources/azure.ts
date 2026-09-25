import { block, lit, literalString } from '@/ir/expr';
import { defineResource } from './types';

const litStr = literalString;

const AZURE_LOCATIONS = ['eastus', 'eastus2', 'westus2', 'westeurope', 'northeurope', 'brazilsouth'];

const rgField = {
  name: 'resource_group_name',
  type: 'string' as const,
  refTo: ['azurerm_resource_group'],
  refAttr: 'name',
  required: true,
};
const locationField = {
  name: 'location',
  type: 'select' as const,
  options: AZURE_LOCATIONS,
  required: true,
};
const rgContainment = [{ arg: 'resource_group_name', parentTypes: ['azurerm_resource_group'] }];
const rgConnection = {
  targetTypes: ['azurerm_resource_group'],
  arg: 'resource_group_name',
  attr: 'name',
  mode: 'set' as const,
};

const planField = {
  name: 'service_plan_id',
  type: 'string' as const,
  refTo: ['azurerm_service_plan'],
  required: true,
};
const planConnection = {
  targetTypes: ['azurerm_service_plan'],
  arg: 'service_plan_id',
  attr: 'id',
  mode: 'set' as const,
};
/** apps render inside their plan; fall back to the resource group */
const planContainment = [
  { arg: 'service_plan_id', parentTypes: ['azurerm_service_plan'] },
  ...rgContainment,
];

export const AZURE_RESOURCES = [
  defineResource({
    type: 'azurerm_resource_group',
    provider: 'azure',
    category: 'network',
    displayName: 'Resource Group',
    shortName: 'Resource Group',
    description: 'Logical container for Azure resources',
    container: true,
    fields: [
      { name: 'name', type: 'string', required: true },
      locationField,
    ],
    defaults: { location: lit('eastus') },
    subtitle: (args) => litStr(args.location),
  }),

  defineResource({
    type: 'azurerm_virtual_network',
    provider: 'azure',
    category: 'network',
    displayName: 'Virtual Network',
    shortName: 'VNet',
    description: 'Isolated network in Azure',
    container: true,
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'address_space', type: 'list', required: true },
      locationField,
      rgField,
    ],
    connections: [rgConnection],
    subtitle: (args) => {
      const space = args.address_space;
      if (space?.kind === 'list' && space.items[0]) return litStr(space.items[0]);
      return undefined;
    },
  }),

  defineResource({
    type: 'azurerm_subnet',
    provider: 'azure',
    category: 'network',
    displayName: 'Subnet',
    shortName: 'Subnet',
    description: 'Subnet inside a VNet',
    container: true,
    containment: [{ arg: 'virtual_network_name', parentTypes: ['azurerm_virtual_network'] }],
    fields: [
      { name: 'name', type: 'string', required: true },
      rgField,
      {
        name: 'virtual_network_name',
        type: 'string',
        refTo: ['azurerm_virtual_network'],
        refAttr: 'name',
        required: true,
      },
      { name: 'address_prefixes', type: 'list', required: true },
    ],
    connections: [
      {
        targetTypes: ['azurerm_virtual_network'],
        arg: 'virtual_network_name',
        attr: 'name',
        mode: 'set',
      },
    ],
    subtitle: (args) => {
      const p = args.address_prefixes;
      if (p?.kind === 'list' && p.items[0]) return litStr(p.items[0]);
      return undefined;
    },
  }),

  defineResource({
    type: 'azurerm_network_security_group',
    provider: 'azure',
    category: 'network',
    displayName: 'Network Security Group',
    shortName: 'NSG',
    description: 'Network traffic filter rules',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      locationField,
      rgField,
    ],
    connections: [rgConnection],
    subtitle: () => 'firewall',
  }),

  defineResource({
    type: 'azurerm_network_interface',
    provider: 'azure',
    category: 'network',
    displayName: 'Network Interface',
    shortName: 'NIC',
    description: 'Virtual network interface for a VM',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      locationField,
      rgField,
    ],
    connections: [rgConnection],
    subtitle: () => 'network interface',
  }),

  defineResource({
    type: 'azurerm_linux_virtual_machine',
    provider: 'azure',
    category: 'compute',
    displayName: 'Linux Virtual Machine',
    shortName: 'Azure VM',
    description: 'Linux virtual machine',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'size',
        type: 'select',
        required: true,
        options: ['Standard_B1s', 'Standard_B2s', 'Standard_D2s_v3', 'Standard_D4s_v3'],
      },
      { name: 'admin_username', type: 'string', required: true },
      locationField,
      rgField,
      {
        name: 'network_interface_ids',
        type: 'list',
        refTo: ['azurerm_network_interface'],
        label: 'Network interfaces',
      },
    ],
    defaults: { size: lit('Standard_B1s'), admin_username: lit('azureuser') },
    connections: [
      rgConnection,
      {
        targetTypes: ['azurerm_network_interface'],
        arg: 'network_interface_ids',
        attr: 'id',
        mode: 'append',
      },
    ],
    subtitle: (args) => litStr(args.size),
  }),

  defineResource({
    type: 'azurerm_storage_account',
    provider: 'azure',
    category: 'storage',
    displayName: 'Storage Account',
    shortName: 'Storage',
    description: 'Blob / file / queue storage',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true, doc: 'Lowercase letters and numbers only' },
      rgField,
      locationField,
      { name: 'account_tier', type: 'select', options: ['Standard', 'Premium'], required: true },
      {
        name: 'account_replication_type',
        type: 'select',
        options: ['LRS', 'GRS', 'ZRS', 'RAGRS'],
        required: true,
      },
    ],
    defaults: { account_tier: lit('Standard'), account_replication_type: lit('LRS') },
    connections: [rgConnection],
    subtitle: (args) => {
      const tier = litStr(args.account_tier);
      const repl = litStr(args.account_replication_type);
      return tier ? `${tier} ${repl ?? ''}`.trim() : undefined;
    },
  }),

  defineResource({
    type: 'azurerm_mssql_server',
    provider: 'azure',
    category: 'database',
    displayName: 'SQL Server',
    shortName: 'SQL Server',
    description: 'Managed SQL Server instance',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      rgField,
      locationField,
      { name: 'version', type: 'select', options: ['12.0'], required: true },
      { name: 'administrator_login', type: 'string', required: true },
      {
        name: 'administrator_login_password',
        type: 'string',
        required: true,
        doc: 'Prefer var.sql_admin_password over a literal',
      },
    ],
    defaults: { version: lit('12.0'), administrator_login: lit('sqladmin') },
    connections: [rgConnection],
    subtitle: () => 'SQL Server',
  }),

  defineResource({
    type: 'azurerm_cdn_profile',
    provider: 'azure',
    category: 'edge',
    displayName: 'CDN Profile',
    shortName: 'CDN Profile',
    description: 'Container for CDN endpoints',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'location', type: 'select', options: [...AZURE_LOCATIONS, 'global'], required: true },
      rgField,
      {
        name: 'sku',
        type: 'select',
        options: ['Standard_Microsoft', 'Standard_Akamai', 'Standard_Verizon'],
        required: true,
      },
    ],
    defaults: { location: lit('global'), sku: lit('Standard_Microsoft') },
    connections: [rgConnection],
    subtitle: (args) => litStr(args.sku),
  }),

  defineResource({
    type: 'azurerm_cdn_endpoint',
    provider: 'azure',
    category: 'edge',
    displayName: 'CDN Endpoint',
    shortName: 'CDN Endpoint',
    description: 'Serves cached content from the edge',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'profile_name',
        type: 'string',
        refTo: ['azurerm_cdn_profile'],
        refAttr: 'name',
        required: true,
      },
      { name: 'location', type: 'select', options: [...AZURE_LOCATIONS, 'global'], required: true },
      rgField,
    ],
    defaults: { location: lit('global') },
    connections: [
      rgConnection,
      { targetTypes: ['azurerm_cdn_profile'], arg: 'profile_name', attr: 'name', mode: 'set' },
    ],
    subtitle: () => 'CDN endpoint',
  }),

  defineResource({
    type: 'azurerm_mssql_database',
    provider: 'azure',
    category: 'database',
    displayName: 'SQL Database',
    shortName: 'SQL DB',
    description: 'Database on a SQL Server',
    fields: [
      { name: 'name', type: 'string', required: true },
      {
        name: 'server_id',
        type: 'string',
        refTo: ['azurerm_mssql_server'],
        required: true,
      },
      { name: 'sku_name', type: 'select', options: ['Basic', 'S0', 'S1', 'P1'] },
      { name: 'max_size_gb', type: 'number' },
    ],
    defaults: { sku_name: lit('Basic') },
    connections: [
      { targetTypes: ['azurerm_mssql_server'], arg: 'server_id', attr: 'id', mode: 'set' },
    ],
    subtitle: (args) => litStr(args.sku_name),
  }),

  defineResource({
    type: 'azurerm_public_ip',
    provider: 'azure',
    category: 'network',
    displayName: 'Public IP',
    shortName: 'Public IP',
    description: 'Static or dynamic public IP address',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      locationField,
      rgField,
      { name: 'allocation_method', type: 'select', options: ['Static', 'Dynamic'], required: true },
      { name: 'sku', type: 'select', options: ['Standard', 'Basic'] },
    ],
    defaults: { allocation_method: lit('Static'), sku: lit('Standard') },
    connections: [rgConnection],
    subtitle: (args) => `${litStr(args.allocation_method) ?? 'Static'} IP`,
  }),

  defineResource({
    type: 'azurerm_service_plan',
    provider: 'azure',
    category: 'compute',
    displayName: 'App Service Plan',
    shortName: 'Service Plan',
    description: 'Compute that hosts web and function apps',
    container: true,
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      locationField,
      rgField,
      { name: 'os_type', type: 'select', options: ['Linux', 'Windows'], required: true },
      {
        name: 'sku_name',
        type: 'select',
        options: ['B1', 'B2', 'S1', 'P0v3', 'P1v3', 'Y1'],
        required: true,
        doc: 'Y1 = Functions consumption plan',
      },
    ],
    defaults: { os_type: lit('Linux'), sku_name: lit('B1') },
    connections: [rgConnection],
    subtitle: (args) => `${litStr(args.os_type) ?? 'Linux'} · ${litStr(args.sku_name) ?? 'B1'}`,
  }),

  defineResource({
    type: 'azurerm_linux_web_app',
    provider: 'azure',
    category: 'compute',
    displayName: 'Linux Web App',
    shortName: 'Web App',
    description: 'Managed web application (App Service)',
    containment: planContainment,
    fields: [
      { name: 'name', type: 'string', required: true, doc: 'Globally unique (becomes <name>.azurewebsites.net)' },
      locationField,
      rgField,
      planField,
      { name: 'https_only', type: 'boolean' },
    ],
    defaults: { https_only: lit(true), site_config: block({}) },
    connections: [planConnection, rgConnection],
    subtitle: () => 'web app',
  }),

  defineResource({
    type: 'azurerm_linux_function_app',
    provider: 'azure',
    category: 'compute',
    displayName: 'Linux Function App',
    shortName: 'Function App',
    description: 'Serverless functions on App Service',
    containment: planContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      locationField,
      rgField,
      planField,
      {
        name: 'storage_account_name',
        type: 'string',
        refTo: ['azurerm_storage_account'],
        refAttr: 'name',
      },
      {
        name: 'storage_account_access_key',
        type: 'string',
        doc: 'Usually azurerm_storage_account.<name>.primary_access_key',
      },
    ],
    defaults: { site_config: block({}) },
    connections: [
      planConnection,
      rgConnection,
      { targetTypes: ['azurerm_storage_account'], arg: 'storage_account_name', attr: 'name', mode: 'set' },
    ],
    subtitle: () => 'functions',
  }),

  defineResource({
    type: 'azurerm_kubernetes_cluster',
    provider: 'azure',
    category: 'containers',
    displayName: 'AKS Cluster',
    shortName: 'AKS',
    description: 'Managed Kubernetes',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      locationField,
      rgField,
      { name: 'dns_prefix', type: 'string', required: true },
      { name: 'kubernetes_version', type: 'string', placeholder: '1.33' },
    ],
    defaults: {
      dns_prefix: lit('aks'),
      default_node_pool: block({
        name: lit('default'),
        node_count: lit(1),
        vm_size: lit('Standard_B2s'),
      }),
      identity: block({ type: lit('SystemAssigned') }),
    },
    connections: [rgConnection],
    subtitle: (args) => {
      const v = litStr(args.kubernetes_version);
      return v ? `Kubernetes ${v}` : 'Kubernetes';
    },
  }),

  defineResource({
    type: 'azurerm_container_registry',
    provider: 'azure',
    category: 'containers',
    displayName: 'Container Registry',
    shortName: 'ACR',
    description: 'Private container image registry',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true, doc: 'Alphanumeric only, globally unique' },
      locationField,
      rgField,
      { name: 'sku', type: 'select', options: ['Basic', 'Standard', 'Premium'], required: true },
      { name: 'admin_enabled', type: 'boolean' },
    ],
    defaults: { sku: lit('Basic') },
    connections: [rgConnection],
    subtitle: (args) => litStr(args.sku),
  }),

  defineResource({
    type: 'azurerm_key_vault',
    provider: 'azure',
    category: 'identity',
    displayName: 'Key Vault',
    shortName: 'Key Vault',
    description: 'Secrets, keys and certificates',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true, doc: '3–24 chars, globally unique' },
      locationField,
      rgField,
      {
        name: 'tenant_id',
        type: 'string',
        required: true,
        doc: 'Usually data.azurerm_client_config.current.tenant_id',
      },
      { name: 'sku_name', type: 'select', options: ['standard', 'premium'], required: true },
      { name: 'purge_protection_enabled', type: 'boolean' },
      { name: 'soft_delete_retention_days', type: 'number', doc: '7–90 days' },
    ],
    defaults: { sku_name: lit('standard') },
    connections: [rgConnection],
    subtitle: () => 'secrets',
  }),

  defineResource({
    type: 'azurerm_postgresql_flexible_server',
    provider: 'azure',
    category: 'database',
    displayName: 'PostgreSQL Flexible Server',
    shortName: 'PostgreSQL',
    description: 'Managed PostgreSQL',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      locationField,
      rgField,
      { name: 'version', type: 'select', options: ['14', '15', '16'] },
      {
        name: 'sku_name',
        type: 'select',
        options: ['B_Standard_B1ms', 'GP_Standard_D2s_v3', 'MO_Standard_E4s_v3'],
      },
      { name: 'storage_mb', type: 'number' },
      { name: 'administrator_login', type: 'string' },
      { name: 'administrator_password', type: 'string', doc: 'Prefer var.pg_admin_password over a literal' },
    ],
    defaults: {
      version: lit('16'),
      sku_name: lit('B_Standard_B1ms'),
      storage_mb: lit(32768),
      administrator_login: lit('pgadmin'),
    },
    connections: [rgConnection],
    subtitle: (args) => `PostgreSQL ${litStr(args.version) ?? ''}`.trim(),
  }),

  defineResource({
    type: 'azurerm_redis_cache',
    provider: 'azure',
    category: 'database',
    displayName: 'Azure Cache for Redis',
    shortName: 'Redis',
    description: 'Managed in-memory cache',
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true },
      locationField,
      rgField,
      { name: 'capacity', type: 'number', required: true, doc: 'Size within the family (C: 0–6, P: 1–5)' },
      { name: 'family', type: 'select', options: ['C', 'P'], required: true },
      { name: 'sku_name', type: 'select', options: ['Basic', 'Standard', 'Premium'], required: true },
    ],
    defaults: { capacity: lit(0), family: lit('C'), sku_name: lit('Basic') },
    connections: [rgConnection],
    subtitle: (args) => litStr(args.sku_name),
  }),

  defineResource({
    type: 'azurerm_servicebus_namespace',
    provider: 'azure',
    category: 'integration',
    displayName: 'Service Bus Namespace',
    shortName: 'Service Bus',
    description: 'Container for queues and topics',
    container: true,
    containment: rgContainment,
    fields: [
      { name: 'name', type: 'string', required: true, doc: 'Globally unique' },
      locationField,
      rgField,
      { name: 'sku', type: 'select', options: ['Basic', 'Standard', 'Premium'], required: true },
    ],
    defaults: { sku: lit('Standard') },
    connections: [rgConnection],
    subtitle: (args) => litStr(args.sku),
  }),

  defineResource({
    type: 'azurerm_servicebus_queue',
    provider: 'azure',
    category: 'integration',
    displayName: 'Service Bus Queue',
    shortName: 'Queue',
    description: 'Durable message queue',
    containment: [{ arg: 'namespace_id', parentTypes: ['azurerm_servicebus_namespace'] }],
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'namespace_id', type: 'string', required: true, refTo: ['azurerm_servicebus_namespace'] },
      { name: 'max_delivery_count', type: 'number' },
      { name: 'dead_lettering_on_message_expiration', type: 'boolean' },
    ],
    connections: [
      { targetTypes: ['azurerm_servicebus_namespace'], arg: 'namespace_id', attr: 'id', mode: 'set' },
    ],
    subtitle: () => 'queue',
  }),
];
