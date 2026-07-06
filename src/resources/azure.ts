import { lit, literalString } from '@/ir/expr';
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
];
