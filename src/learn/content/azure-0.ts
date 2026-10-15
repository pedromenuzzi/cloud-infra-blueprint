/**
 * Azure preview (canvas): resource groups, and how everything in Azure nests
 * inside one, linked by name rather than by id.
 */
import { argRefs, has, inside } from '../goals';
import type { Lesson } from '../types';
import { azure } from './shared';

export const lessons: Lesson[] = [
  {
    slug: 'azure-resource-groups',
    code: 'A.1',
    kind: 'lesson',
    mode: 'canvas',
    minutes: 8,
    xp: 50,
    title: { en: 'Resource groups', pt: 'Grupos de recursos' },
    summary: {
      en: 'In Azure everything lives in a resource group. Build one and nest a network inside it.',
      pt: 'No Azure tudo vive em um grupo de recursos. Crie um e aninhe uma rede dentro dele.',
    },
    body: [
      {
        en: 'Azure has a rule AWS doesn\'t: every resource must belong to a *resource group*. Think of a labeled folder with a home region: you see what a project costs, give a team access, or delete the whole thing in one go.',
        pt: 'O Azure tem uma regra que a AWS não tem: todo recurso precisa pertencer a um *grupo de recursos*. Pense numa pasta etiquetada com uma região de origem: você vê quanto um projeto custa, dá acesso a uma equipe ou exclui tudo de uma vez.',
      },
      {
        en: 'Drag a *Resource Group* onto the canvas. Like a VPC, it lands as a box. Drop a *Virtual Network* inside it, then a *Subnet* inside the network.',
        pt: 'Arraste um *Grupo de recursos* para o canvas. Como uma VPC, ele chega como uma caixa. Solte uma *Rede virtual* dentro dele e depois uma *Sub-rede* dentro da rede.',
      },
      {
        en: 'Now read the code the drops wrote. Where AWS links by id (`vpc_id`), Azure links by *name*: `resource_group_name = azurerm_resource_group.<name>.name`. The network also took its `location` from the group, so one line decides the region of everything inside.',
        pt: 'Agora leia o código que apareceu. Onde a AWS liga por id (`vpc_id`), o Azure liga por *nome*: `resource_group_name = azurerm_resource_group.<name>.name`. A rede também pegou a `location` do grupo, então uma linha decide a região de tudo lá dentro.',
      },
      {
        en: 'Finish with a *Storage Account* in the group. Its `name` is picky: 3 to 24 lowercase letters and digits, unique across all of Azure.',
        pt: 'Termine com uma *Conta de armazenamento* no grupo. O `name` dela é exigente: de 3 a 24 letras minúsculas e números, único em todo o Azure.',
      },
    ],
    asides: [
      {
        title: { en: 'Azure next to AWS', pt: 'O Azure ao lado da AWS' },
        body: [
          {
            en: 'A *virtual network* (VNet) is Azure\'s VPC, and its subnets work the same way. A *storage account* holds blob containers, much like an account full of S3 buckets.',
            pt: 'Uma *rede virtual* (VNet) é a VPC do Azure, e as sub-redes funcionam do mesmo jeito. Uma *conta de armazenamento* guarda contêineres de blobs, parecido com uma conta cheia de buckets S3.',
          },
          {
            en: 'AWS has nothing quite like it. The nearest thing is grouping by tags, except that here the group is mandatory, and deleting it deletes everything inside.',
            pt: 'A AWS não tem nada bem igual. O mais próximo é agrupar por tags, só que aqui o grupo é obrigatório, e excluí-lo exclui tudo que está dentro.',
          },
        ],
      },
    ],
    start: azure(),
    solution: azure(`resource "azurerm_resource_group" "main" {
  name     = "learn-rg"
  location = "eastus"
}

resource "azurerm_virtual_network" "main" {
  name                = "learn-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_subnet" "app" {
  name                 = "app"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_storage_account" "data" {
  name                     = "learnstorage2026"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
`),
    goals: [
      {
        id: 'group',
        text: { en: 'A resource group', pt: 'Um grupo de recursos' },
        hint: {
          en: 'Search the palette for "resource group" and drag it onto the canvas.',
          pt: 'Busque "grupo de recursos" na paleta e arraste para o canvas.',
        },
        test: has('azurerm_resource_group'),
      },
      {
        id: 'vnet',
        text: { en: 'A virtual network inside the group', pt: 'Uma rede virtual dentro do grupo' },
        hint: {
          en: 'Drag *Virtual Network* and release it over the resource group box.',
          pt: 'Arraste *Rede virtual* e solte sobre a caixa do grupo de recursos.',
        },
        test: inside('azurerm_virtual_network', 'azurerm_resource_group'),
      },
      {
        id: 'location',
        text: { en: 'The network takes its location from the group', pt: 'A rede pega a localização do grupo' },
        hint: {
          en: 'Dropping the network inside the group writes it for you. In code: `location = azurerm_resource_group.<name>.location`.',
          pt: 'Soltar a rede dentro do grupo escreve isso para você. No código: `location = azurerm_resource_group.<name>.location`.',
        },
        test: argRefs('azurerm_virtual_network', 'location', 'azurerm_resource_group'),
      },
      {
        id: 'subnet',
        text: { en: 'A subnet inside the network', pt: 'Uma sub-rede dentro da rede' },
        hint: {
          en: 'Drop a *Subnet* over the virtual network\'s box: it nests one level deeper through `virtual_network_name`.',
          pt: 'Solte uma *Sub-rede* sobre a caixa da rede virtual: ela fica um nível mais fundo por `virtual_network_name`.',
        },
        test: inside('azurerm_subnet', 'azurerm_virtual_network'),
      },
      {
        id: 'storage',
        text: { en: 'A storage account in the group', pt: 'Uma conta de armazenamento no grupo' },
        hint: {
          en: 'Drop a *Storage Account* over the resource group box, then give it a `name` like `learnstorage2026`.',
          pt: 'Solte uma *Conta de armazenamento* sobre a caixa do grupo de recursos e dê a ela um `name` como `learnstorage2026`.',
        },
        test: inside('azurerm_storage_account', 'azurerm_resource_group'),
      },
    ],
    teaches: ['azurerm_resource_group', 'azurerm_virtual_network', 'azurerm_subnet', 'azurerm_storage_account'],
  },
];
