import { defineResource } from '@blueprint/ir';
import { z } from 'zod';

export const azurermResourceGroup = defineResource({
  provider: 'azure',
  type: 'azurerm_resource_group',
  category: 'Other',
  displayName: 'Resource Group',
  description: 'Logical container for Azure resources.',
  icon: '/icons/azure/resource-group.svg',
  schema: z.object({
    name: z.string(),
    location: z.string(),
    tags: z.record(z.string()).optional(),
  }),
  defaults: { location: 'eastus' },
  ports: {
    in: [],
    out: [{ kind: 'reference', label: 'contains' }],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['azurerm_resource_group', res.name], res.args);
  },
});

export const azurermVirtualNetwork = defineResource({
  provider: 'azure',
  type: 'azurerm_virtual_network',
  category: 'Network',
  displayName: 'Virtual Network',
  icon: '/icons/azure/vnet.svg',
  schema: z.object({
    name: z.string(),
    address_space: z.array(z.string()),
    location: z.string(),
    resource_group_name: z.string(),
    tags: z.record(z.string()).optional(),
  }),
  defaults: { address_space: ['10.0.0.0/16'] },
  ports: {
    in: [{ kind: 'reference', label: 'in resource group' }],
    out: [{ kind: 'network', label: 'subnets' }],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['azurerm_virtual_network', res.name], res.args);
  },
});

export const azurermSubnet = defineResource({
  provider: 'azure',
  type: 'azurerm_subnet',
  category: 'Network',
  displayName: 'Subnet',
  icon: '/icons/azure/subnet.svg',
  schema: z.object({
    name: z.string(),
    resource_group_name: z.string(),
    virtual_network_name: z.string(),
    address_prefixes: z.array(z.string()),
  }),
  defaults: {},
  ports: {
    in: [{ kind: 'network', label: 'in vnet' }],
    out: [{ kind: 'network', label: 'hosts' }],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['azurerm_subnet', res.name], res.args);
  },
});

export const azurermLinuxVirtualMachine = defineResource({
  provider: 'azure',
  type: 'azurerm_linux_virtual_machine',
  category: 'Compute',
  displayName: 'Linux VM',
  icon: '/icons/azure/vm.svg',
  schema: z.object({
    name: z.string(),
    resource_group_name: z.string(),
    location: z.string(),
    size: z.enum(['Standard_B1s', 'Standard_B2s', 'Standard_D2s_v5', 'Standard_D4s_v5']),
    admin_username: z.string(),
    network_interface_ids: z.array(z.string()),
    tags: z.record(z.string()).optional(),
  }),
  defaults: { size: 'Standard_B1s', admin_username: 'azureuser' },
  ports: {
    in: [{ kind: 'network', label: 'nic' }],
    out: [],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['azurerm_linux_virtual_machine', res.name], res.args);
  },
});

export const azurermStorageAccount = defineResource({
  provider: 'azure',
  type: 'azurerm_storage_account',
  category: 'Storage',
  displayName: 'Storage Account',
  icon: '/icons/azure/storage.svg',
  schema: z.object({
    name: z.string(),
    resource_group_name: z.string(),
    location: z.string(),
    account_tier: z.enum(['Standard', 'Premium']),
    account_replication_type: z.enum(['LRS', 'GRS', 'ZRS', 'GZRS']),
    tags: z.record(z.string()).optional(),
  }),
  defaults: { account_tier: 'Standard', account_replication_type: 'LRS' },
  ports: {
    in: [{ kind: 'reference', label: 'in resource group' }],
    out: [],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['azurerm_storage_account', res.name], res.args);
  },
});

export const azurermMssqlDatabase = defineResource({
  provider: 'azure',
  type: 'azurerm_mssql_database',
  category: 'Database',
  displayName: 'SQL Database',
  icon: '/icons/azure/sql.svg',
  schema: z.object({
    name: z.string(),
    server_id: z.string(),
    sku_name: z.string().optional(),
    tags: z.record(z.string()).optional(),
  }),
  defaults: { sku_name: 'Basic' },
  ports: { in: [{ kind: 'network', label: 'sql server' }], out: [] },
  emit(res, ctx) {
    return ctx.block('resource', ['azurerm_mssql_database', res.name], res.args);
  },
});

export const azureCatalog = [
  azurermResourceGroup,
  azurermVirtualNetwork,
  azurermSubnet,
  azurermLinuxVirtualMachine,
  azurermStorageAccount,
  azurermMssqlDatabase,
];
