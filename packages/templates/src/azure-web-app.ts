import { edge, newResource, ref } from '@blueprint/ir';
import { z } from 'zod';

import { defineTemplate } from './types.js';

export const webAppAzure = defineTemplate({
  slug: 'web-app-azure',
  name: 'Web App on Azure',
  description: 'Resource Group + VNet + Subnet + Linux VM + SQL Database.',
  provider: 'azure',
  thumbnail: '/templates/web-app-azure.png',
  params: z.object({
    appName: z.string().min(1).default('my-app'),
    location: z.string().default('eastus'),
  }),
  build({ appName, location }) {
    const rg = newResource('azurerm_resource_group', `${appName}-rg`, {
      name: `${appName}-rg`,
      location,
    });
    const vnet = newResource('azurerm_virtual_network', `${appName}-vnet`, {
      name: `${appName}-vnet`,
      address_space: ['10.0.0.0/16'],
      location,
      resource_group_name: ref({
        type: 'azurerm_resource_group',
        name: `${appName}-rg`,
        attr: 'name',
      }),
    });
    const subnet = newResource('azurerm_subnet', `${appName}-subnet`, {
      name: `${appName}-subnet`,
      resource_group_name: ref({
        type: 'azurerm_resource_group',
        name: `${appName}-rg`,
        attr: 'name',
      }),
      virtual_network_name: ref({
        type: 'azurerm_virtual_network',
        name: `${appName}-vnet`,
        attr: 'name',
      }),
      address_prefixes: ['10.0.1.0/24'],
    });
    return {
      addResources: [rg, vnet, subnet],
      addEdges: [edge(rg, vnet, 'reference'), edge(vnet, subnet, 'network')],
      setProviders: { azure: {} },
    };
  },
});
