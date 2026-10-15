/**
 * Level 5 · Repetition (code): one block standing for many. `count`, then
 * `for_each` (and why indexes shift), `dynamic` blocks, resources on a
 * switch, and `moved {}` to change addresses without destroying anything.
 * The canvas draws repeated resources as a stack ("×3", "×0–1"); the
 * simulated terminal expands them to instance addresses.
 */
import { all, applied, argRefs, inside, noErrors, not, ran, variable } from '../goals';
import type { Files, Lesson } from '../types';
import { named } from './predicates-01';
import { rangesFit, subnetsAcrossZones } from './predicates-23';
import {
  appliedByKeys,
  appliedInstances,
  distinctPerInstance,
  dynamicBlocks,
  instanceKeysMatch,
  listVariable,
  movesKeep,
  noStaticBlocks,
  optional,
  outputListsAll,
  outputSurvivesZero,
  plansWithout,
  repeats,
  writes,
} from './predicates-5';
import { aws } from './shared';

const VPC = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
`;

/* ------------------------------------------------------------ 5.1 */

const COUNT_START = aws(`${VPC}
locals {
  zones = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

# TODO 1: three subnets from this one block, with count.
#         Give each its own range and its own zone (count.index helps).
resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

# TODO 2: an output with the ids of every subnet.
`);

const COUNT_SOLUTION = aws(`${VPC}
locals {
  zones = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

resource "aws_subnet" "app" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.\${count.index + 1}.0/24"
  availability_zone = local.zones[count.index]

  tags = {
    Name = "app-\${count.index}"
  }
}

output "subnet_ids" {
  value = aws_subnet.app[*].id
}
`);

/* ------------------------------------------------------------ 5.2 */

const EACH_START = aws(`${VPC}
# Step 1: apply this code as it is.
# Step 2: delete "api" from the list and run plan. Read it before you apply!
locals {
  tiers = ["web", "api", "data"]
}

resource "aws_subnet" "app" {
  count      = length(local.tiers)
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.\${count.index + 1}.0/24"

  tags = {
    Name = local.tiers[count.index]
  }
}

# Step 3: rewrite the block above with for_each over a map, and apply.
`);

const EACH_SOLUTION = aws(`${VPC}
locals {
  subnets = {
    web  = "10.0.1.0/24"
    data = "10.0.3.0/24"
  }
}

resource "aws_subnet" "app" {
  for_each   = local.subnets
  vpc_id     = aws_vpc.main.id
  cidr_block = each.value

  tags = {
    Name = each.key
  }
}
`);

/* ------------------------------------------------------------ 5.3 */

const EGRESS = `  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }`;

const staticRule = (port: number) => `  ingress {
    from_port   = ${port}
    to_port     = ${port}
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }
`;

const DYNAMIC_START = aws(`${VPC}
# TODO 1: a variable "ingress_ports" holding the list [80, 443, 8080].
# TODO 2: replace the three copied ingress blocks with one dynamic "ingress" over it.

resource "aws_security_group" "app" {
  name        = "app"
  description = "App ports from inside the VPC"
  vpc_id      = aws_vpc.main.id

${[80, 443, 8080].map(staticRule).join('\n')}
${EGRESS}
}
`);

const DYNAMIC_SOLUTION = aws(`${VPC}
variable "ingress_ports" {
  description = "TCP ports open to the rest of the VPC"
  type        = list(number)
  default     = [80, 443, 8080]
}

resource "aws_security_group" "app" {
  name        = "app"
  description = "App ports from inside the VPC"
  vpc_id      = aws_vpc.main.id

  dynamic "ingress" {
    for_each = var.ingress_ports

    content {
      description = "Port \${ingress.value}"
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = [aws_vpc.main.cidr_block]
    }
  }

${EGRESS}
}
`);

/* ------------------------------------------------------------ 5.4 */

/** a VPC with one public and one private subnet, each with its route table */
const NAT_NETWORK = `# The network: a VPC with a public and a private subnet.

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
}

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}
`;

const NAT_START = aws(
  `# TODO: a NAT gateway bills every hour it exists, even idle. Put these three
# resources behind a bool variable "enable_nat", off by default, and keep the
# output working when they don't exist.

resource "aws_eip" "nat" {
  domain = "vpc"
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id
}

resource "aws_route" "private_out" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat.id
}

output "nat_public_ip" {
  value = aws_nat_gateway.nat.public_ip
}
`,
  { 'network.tf': NAT_NETWORK },
);

const NAT_SOLUTION = aws(
  `variable "enable_nat" {
  description = "Create a NAT gateway so the private subnet can reach the internet"
  type        = bool
  default     = false
}

resource "aws_eip" "nat" {
  count  = var.enable_nat ? 1 : 0
  domain = "vpc"
}

resource "aws_nat_gateway" "nat" {
  count         = var.enable_nat ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public.id
}

resource "aws_route" "private_out" {
  count                  = var.enable_nat ? 1 : 0
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat[0].id
}

output "nat_public_ip" {
  value = one(aws_nat_gateway.nat[*].public_ip)
}
`,
  { 'network.tf': NAT_NETWORK },
);

/* ------------------------------------------------------------ 5.5 */

const MOVED_START: Files = aws(`${VPC}
locals {
  zones = ["us-east-1a", "us-east-1b"]
}

# Apply this first. Then rename "this" to "app" and switch it from count to
# for_each, keyed by zone, without destroying a single subnet.
resource "aws_subnet" "this" {
  count             = length(local.zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.\${count.index + 1}.0/24"
  availability_zone = local.zones[count.index]
}
`);

const MOVED_SOLUTION = aws(`${VPC}
locals {
  subnets = {
    "us-east-1a" = "10.0.1.0/24"
    "us-east-1b" = "10.0.2.0/24"
  }
}

resource "aws_subnet" "app" {
  for_each          = local.subnets
  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value
  availability_zone = each.key
}

moved {
  from = aws_subnet.this[0]
  to   = aws_subnet.app["us-east-1a"]
}

moved {
  from = aws_subnet.this[1]
  to   = aws_subnet.app["us-east-1b"]
}
`);

/* ------------------------------------------------------------ C5 */

const CHALLENGE_NETWORK = `# The network: a VPC, its internet gateway and a route table to it.

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}
`;

const CHALLENGE_SOLUTION = aws(
  `variable "subnets" {
  description = "Public subnets, by name"
  type = map(object({
    cidr = string
    az   = string
  }))
  default = {
    public_a = {
      cidr = "10.0.1.0/24"
      az   = "us-east-1a"
    }
    public_b = {
      cidr = "10.0.2.0/24"
      az   = "us-east-1b"
    }
  }
}

variable "app_ports" {
  description = "TCP ports open to the rest of the VPC"
  type        = list(number)
  default     = [80, 443]
}

variable "enable_nat" {
  description = "Create a NAT gateway for outbound traffic"
  type        = bool
  default     = false
}

resource "aws_subnet" "public" {
  for_each          = var.subnets
  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value.cidr
  availability_zone = each.value.az

  tags = {
    Name = each.key
  }
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "app" {
  name        = "app"
  description = "App ports from inside the VPC"
  vpc_id      = aws_vpc.main.id

  dynamic "ingress" {
    for_each = var.app_ports

    content {
      description = "Port \${ingress.value}"
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = [aws_vpc.main.cidr_block]
    }
  }

${EGRESS}
}

resource "aws_eip" "nat" {
  count  = var.enable_nat ? 1 : 0
  domain = "vpc"
}

resource "aws_nat_gateway" "nat" {
  count         = var.enable_nat ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public["public_a"].id
}
`,
  { 'network.tf': CHALLENGE_NETWORK },
);

export const lessons: Lesson[] = [
  /* ------------------------------------------------------------ 5.1 */
  {
    slug: 'count',
    code: '5.1',
    kind: 'lesson',
    mode: 'code',
    minutes: 8,
    xp: 60,
    title: { en: 'count: many from one', pt: 'count: vários a partir de um' },
    summary: {
      en: 'Turn one block into three subnets with `count`, and meet `count.index`.',
      pt: 'Transforme um bloco em três sub-redes com `count` e conheça o `count.index`.',
    },
    body: [
      {
        en: 'Three subnets that differ only in their range used to mean three nearly identical blocks. Copies drift: someone fixes one and forgets the others. The `count` meta-argument turns one block into many: write `count = 3` and Terraform manages three *instances* of the same resource.',
        pt: 'Três sub-redes que só mudam no intervalo significavam três blocos quase idênticos. Cópias se desencontram: alguém corrige uma e esquece as outras. O meta-argumento `count` transforma um bloco em vários: escreva `count = 3` e o Terraform gerencia três *instâncias* do mesmo recurso.',
      },
      {
        en: 'Inside the block, `count.index` is the number of the instance being built, starting at 0. Use it wherever instances must differ: `"10.0.${count.index + 1}.0/24"` gives `10.0.1.0/24`, `10.0.2.0/24` and `10.0.3.0/24`, and `local.zones[count.index]` picks one zone per instance from a list.',
        pt: 'Dentro do bloco, `count.index` é o número da instância sendo montada, começando em 0. Use-o onde as instâncias precisam ser diferentes: `"10.0.${count.index + 1}.0/24"` gera `10.0.1.0/24`, `10.0.2.0/24` e `10.0.3.0/24`, e `local.zones[count.index]` escolhe uma zona por instância a partir de uma lista.',
      },
      {
        en: 'Watch the canvas as you add `count`: the subnet turns into a stack with a `×3` badge. Still one block and one node, but three subnets in the cloud. Then run `plan`: each instance has an address of its own, `aws_subnet.app[0]`, `aws_subnet.app[1]` and `aws_subnet.app[2]`.',
        pt: 'Olhe o canvas enquanto adiciona o `count`: a sub-rede vira uma pilha com o selo `×3`. Continua sendo um bloco e um nó, mas são três sub-redes na nuvem. Depois rode `plan`: cada instância tem um endereço próprio, `aws_subnet.app[0]`, `aws_subnet.app[1]` e `aws_subnet.app[2]`.',
      },
      {
        en: 'That address is also how you reach them: `aws_subnet.app[0].id` is the first subnet\'s id, and `aws_subnet.app[*].id`, a *splat*, is a list with all of them. Give the subnets their ranges and zones, add an output with every id, and apply.',
        pt: 'O endereço também é o jeito de alcançá-las: `aws_subnet.app[0].id` é o id da primeira sub-rede, e `aws_subnet.app[*].id`, um *splat*, é uma lista com todos eles. Dê às sub-redes seus intervalos e zonas, adicione um output com todos os ids e aplique.',
      },
    ],
    asides: [
      {
        title: { en: 'A tidier range: `cidrsubnet`', pt: 'Um intervalo mais elegante: `cidrsubnet`' },
        body: [
          {
            en: '`cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 1)` computes the same ranges from the VPC\'s own: it adds 8 bits to the `/16` prefix, making `/24` blocks, and picks block number `count.index + 1`. Change the VPC\'s range and every subnet follows.',
            pt: '`cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 1)` calcula os mesmos intervalos a partir do intervalo da VPC: soma 8 bits ao prefixo `/16`, formando blocos `/24`, e escolhe o bloco de número `count.index + 1`. Mude o intervalo da VPC e todas as sub-redes acompanham.',
          },
        ],
      },
    ],
    start: COUNT_START,
    solution: COUNT_SOLUTION,
    goals: [
      {
        id: 'count',
        text: { en: 'One block, three subnets: `count = 3`', pt: 'Um bloco, três sub-redes: `count = 3`' },
        hint: {
          en: 'Add `count = 3` as the first line inside the subnet block. The canvas draws a stack with `×3`.',
          pt: 'Adicione `count = 3` como primeira linha dentro do bloco da sub-rede. O canvas desenha uma pilha com `×3`.',
        },
        test: repeats('aws_subnet', 'count', 3),
      },
      {
        id: 'ranges',
        text: { en: 'Each subnet with its own range, inside the VPC', pt: 'Cada sub-rede com seu próprio intervalo, dentro da VPC' },
        hint: {
          en: 'Three copies of `10.0.1.0/24` would collide. Write `cidr_block = "10.0.${count.index + 1}.0/24"`.',
          pt: 'Três cópias de `10.0.1.0/24` entrariam em conflito. Escreva `cidr_block = "10.0.${count.index + 1}.0/24"`.',
        },
        test: all(distinctPerInstance('aws_subnet', 'cidr_block', 3), rangesFit),
      },
      {
        id: 'zones',
        text: { en: 'Each subnet in its own availability zone', pt: 'Cada sub-rede na sua própria zona de disponibilidade' },
        hint: {
          en: '`availability_zone = local.zones[count.index]`: instance 0 takes the first zone in the list, instance 1 the second, and so on.',
          pt: '`availability_zone = local.zones[count.index]`: a instância 0 pega a primeira zona da lista, a instância 1 a segunda, e assim por diante.',
        },
        test: distinctPerInstance('aws_subnet', 'availability_zone', 3),
      },
      {
        id: 'output',
        text: { en: 'An output with every subnet id', pt: 'Um output com o id de todas as sub-redes' },
        hint: {
          en: '`output "subnet_ids" {` with `value = aws_subnet.app[*].id` inside. The `[*]` collects the attribute from every instance.',
          pt: '`output "subnet_ids" {` com `value = aws_subnet.app[*].id` dentro. O `[*]` junta o atributo de todas as instâncias.',
        },
        test: outputListsAll('aws_subnet'),
      },
      {
        id: 'apply',
        text: { en: 'Apply: three subnets in the state', pt: 'Aplique: três sub-redes no estado' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. Read the addresses in the plan: `[0]`, `[1]`, `[2]`.',
          pt: 'No terminal: `init`, `plan`, `apply`. Leia os endereços no plano: `[0]`, `[1]`, `[2]`.',
        },
        test: appliedInstances('aws_subnet', 3),
      },
    ],
  },

  /* ------------------------------------------------------------ 5.2 */
  {
    slug: 'for-each',
    code: '5.2',
    kind: 'lesson',
    mode: 'code',
    minutes: 10,
    xp: 70,
    title: { en: 'for_each: instances with names', pt: 'for_each: instâncias com nome' },
    summary: {
      en: 'See why removing an item from a `count` list shifts the others, and let `for_each` name instances by key.',
      pt: 'Veja por que tirar um item de uma lista com `count` desloca os outros, e deixe o `for_each` nomear as instâncias por chave.',
    },
    body: [
      {
        en: '`count` numbers its instances, and that number is all Terraform knows them by. To Terraform, `aws_subnet.app[1]` is "the second one", not "the api subnet". Take an item out of the middle of the list and every item after it slides down one place.',
        pt: 'O `count` numera as instâncias, e esse número é tudo o que o Terraform sabe delas. Para o Terraform, `aws_subnet.app[1]` é "a segunda", não "a sub-rede da api". Tire um item do meio da lista e todos os itens depois dele descem uma posição.',
      },
      {
        en: 'See for yourself. Apply the starting code: three subnets, `web`, `api` and `data`. Now delete `"api"` from the list and run `plan`. You meant to remove one subnet, and the plan does something else: it changes the `Name` of `aws_subnet.app[1]` from `api` to `data`, and destroys `aws_subnet.app[2]`, the one holding `10.0.3.0/24`. That is the real data subnet, and whatever runs inside it would go too. Don\'t apply that.',
        pt: 'Veja com seus próprios olhos. Aplique o código inicial: três sub-redes, `web`, `api` e `data`. Agora apague `"api"` da lista e rode `plan`. Você queria remover uma sub-rede, e o plano faz outra coisa: muda o `Name` de `aws_subnet.app[1]` de `api` para `data` e destrói `aws_subnet.app[2]`, a que tem `10.0.3.0/24`. Essa é a sub-rede de dados de verdade, e o que estiver rodando dentro dela iria junto. Não aplique isso.',
      },
      {
        en: '`for_each` names instances instead of numbering them. Give it a map and you get one instance per key; inside the block, `each.key` is the key (`"web"`) and `each.value` its value (here, the range). The addresses become `aws_subnet.app["web"]` and `aws_subnet.app["data"]`, and each key keeps its own subnet whatever happens to the others.',
        pt: 'O `for_each` dá nome às instâncias em vez de numerá-las. Passe um mapa e você ganha uma instância por chave; dentro do bloco, `each.key` é a chave (`"web"`) e `each.value` o valor (aqui, o intervalo). Os endereços viram `aws_subnet.app["web"]` e `aws_subnet.app["data"]`, e cada chave fica com a sua sub-rede, aconteça o que acontecer com as outras.',
      },
      {
        en: 'Rewrite the block with `for_each` over a map of `web` and `data`, keeping `data` on `10.0.3.0/24`, name each subnet after its key and apply. Changing how a resource repeats changes every address, so this one apply replaces the subnets (lesson 5.5 shows how to avoid even that). From then on, delete a key and `plan`: exactly one subnet goes, the one you named.',
        pt: 'Reescreva o bloco com `for_each` sobre um mapa com `web` e `data`, mantendo `data` em `10.0.3.0/24`, dê a cada sub-rede o nome da sua chave e aplique. Mudar a forma de repetir um recurso muda todos os endereços, então esse apply substitui as sub-redes (a lição 5.5 mostra como evitar até isso). Daí em diante, apague uma chave e rode `plan`: sai exatamente uma sub-rede, a que você nomeou.',
      },
    ],
    asides: [
      {
        title: { en: 'Maps, sets and lists', pt: 'Mapas, conjuntos e listas' },
        body: [
          {
            en: '`for_each` takes a map or a set of strings. A list has an order and may repeat items, so it must become a set first: `for_each = toset(["web", "data"])`. In a set, `each.key` and `each.value` are the same string.',
            pt: 'O `for_each` aceita um mapa ou um conjunto (set) de strings. Uma lista tem ordem e pode repetir itens, então precisa virar um conjunto antes: `for_each = toset(["web", "data"])`. Num conjunto, `each.key` e `each.value` são a mesma string.',
          },
          {
            en: '`count` still has its place: identical copies where only how many matters, and switching a resource on or off, two lessons from now.',
            pt: 'O `count` continua tendo seu lugar: cópias idênticas, em que só a quantidade importa, e ligar ou desligar um recurso, assunto de daqui a duas lições.',
          },
        ],
      },
    ],
    start: EACH_START,
    solution: EACH_SOLUTION,
    goals: [
      {
        id: 'apply',
        text: { en: 'Apply the starting code', pt: 'Aplique o código inicial' },
        hint: {
          en: '`init`, then `apply`: three subnets, from `aws_subnet.app[0]` to `aws_subnet.app[2]`.',
          pt: '`init` e depois `apply`: três sub-redes, de `aws_subnet.app[0]` a `aws_subnet.app[2]`.',
        },
        test: applied('aws_subnet'),
      },
      {
        id: 'shift',
        text: { en: '`api` is gone, and you read the plan', pt: 'A `api` saiu, e você leu o plano' },
        hint: {
          en: 'Delete `"api"` from the list and run `plan`. Find the subnet with `10.0.3.0/24`: is it the one being destroyed?',
          pt: 'Apague `"api"` da lista e rode `plan`. Procure a sub-rede com `10.0.3.0/24`: é ela que vai ser destruída?',
        },
        test: all(ran('plan'), plansWithout('aws_subnet', 2, 'api')),
      },
      {
        id: 'for-each',
        text: { en: 'Subnets from a map, with `for_each` and `each.value`', pt: 'Sub-redes a partir de um mapa, com `for_each` e `each.value`' },
        hint: {
          en: 'Replace `count` with `for_each = { web = "10.0.1.0/24", data = "10.0.3.0/24" }` (or a local holding that map) and set `cidr_block = each.value`.',
          pt: 'Troque o `count` por `for_each = { web = "10.0.1.0/24", data = "10.0.3.0/24" }` (ou um local com esse mapa) e defina `cidr_block = each.value`.',
        },
        test: all(repeats('aws_subnet', 'for_each', 2), writes('aws_subnet', 'cidr_block', /\beach\.value\b/)),
      },
      {
        id: 'name',
        text: { en: 'Each subnet named after its key', pt: 'Cada sub-rede com o nome da sua chave' },
        hint: {
          en: 'In `tags`, set `Name = each.key`.',
          pt: 'Em `tags`, defina `Name = each.key`.',
        },
        test: writes('aws_subnet', 'tags.Name', /\beach\.key\b/),
      },
      {
        id: 'keys',
        text: { en: 'Apply: the state holds each subnet by its key', pt: 'Aplique: o estado guarda cada sub-rede pela sua chave' },
        hint: {
          en: 'Run `apply`. The addresses end in `["data"]` and `["web"]` now.',
          pt: 'Rode `apply`. Agora os endereços terminam em `["data"]` e `["web"]`.',
        },
        test: appliedByKeys('aws_subnet'),
      },
    ],
  },

  /* ------------------------------------------------------------ 5.3 */
  {
    slug: 'dynamic-blocks',
    code: '5.3',
    kind: 'lesson',
    mode: 'code',
    minutes: 8,
    xp: 60,
    title: { en: 'Dynamic blocks', pt: 'Blocos dynamic' },
    summary: {
      en: 'Write a security group\'s rules from a list of ports with a single `dynamic "ingress"` block.',
      pt: 'Escreva as regras de um grupo de segurança a partir de uma lista de portas com um único bloco `dynamic "ingress"`.',
    },
    body: [
      {
        en: '`count` and `for_each` repeat whole resources. Sometimes what repeats is a block *inside* one, like the `ingress` rules of a security group. The starting code has three, identical except for the port. A fourth port means a fourth copy, and copies drift.',
        pt: 'O `count` e o `for_each` repetem recursos inteiros. Às vezes o que se repete é um bloco *dentro* de um recurso, como as regras `ingress` de um grupo de segurança. O código inicial tem três, iguais a não ser pela porta. Uma quarta porta exige uma quarta cópia, e cópias se desencontram.',
      },
      {
        en: 'A `dynamic` block writes nested blocks from a collection. `dynamic "ingress"` names the block to generate, `for_each` says what to loop over and `content` is the template for each one. Inside `content`, the block\'s own name is the loop variable: `ingress.value` is the current port, and `ingress.key` its position in the list.',
        pt: 'Um bloco `dynamic` escreve blocos aninhados a partir de uma coleção. `dynamic "ingress"` diz qual bloco gerar, `for_each` diz sobre o que repetir e `content` é o modelo de cada um. Dentro do `content`, o próprio nome do bloco é a variável da repetição: `ingress.value` é a porta da vez, e `ingress.key` a posição dela na lista.',
      },
      {
        en: 'Unlike a resource\'s `for_each`, a `dynamic` block happily takes a plain list. Move the ports into a variable, replace the three copies with one `dynamic "ingress"` and run `plan`: the security group still gets one `ingress` rule per port. Adding a port is now one more number in a list.',
        pt: 'Diferente do `for_each` de um recurso, um bloco `dynamic` aceita uma lista comum sem reclamar. Leve as portas para uma variável, troque as três cópias por um único `dynamic "ingress"` e rode `plan`: o grupo de segurança continua com uma regra `ingress` por porta. Adicionar uma porta agora é um número a mais numa lista.',
      },
      {
        en: 'Use it with restraint. The rules of a `dynamic` block only exist once Terraform evaluates the loop, so whoever reads the code has to run it in their head. The security panel can\'t either: open it and it warns that the group\'s inbound rules can\'t be verified. It shines when the list comes from outside, like a variable or a module input; for two fixed rules, plain blocks read better.',
        pt: 'Use com moderação. As regras de um bloco `dynamic` só existem quando o Terraform avalia a repetição, então quem lê o código precisa executá-la de cabeça. O painel de segurança também não: abra e veja o aviso de que as regras de entrada do grupo não podem ser verificadas. Ele brilha quando a lista vem de fora, como uma variável ou uma entrada de módulo; para duas regras fixas, blocos comuns são mais legíveis.',
      },
    ],
    asides: [
      {
        title: { en: 'Richer rules, other names', pt: 'Regras mais ricas, outros nomes' },
        body: [
          {
            en: 'Loop over a list of objects, like `{ port = 443, cidr = "10.0.0.0/16" }`, and each rule can carry more than a port: `ingress.value.port`, `ingress.value.cidr`.',
            pt: 'Repita sobre uma lista de objetos, como `{ port = 443, cidr = "10.0.0.0/16" }`, e cada regra pode carregar mais que uma porta: `ingress.value.port`, `ingress.value.cidr`.',
          },
          {
            en: '`iterator = rule` gives the loop variable another name, and `content` then reads `rule.value`. It helps when `dynamic` blocks nest inside each other.',
            pt: '`iterator = rule` dá outro nome à variável da repetição, e o `content` passa a ler `rule.value`. Isso ajuda quando blocos `dynamic` ficam um dentro do outro.',
          },
        ],
      },
    ],
    start: DYNAMIC_START,
    solution: DYNAMIC_SOLUTION,
    goals: [
      {
        id: 'variable',
        text: { en: 'The ports in a list variable', pt: 'As portas numa variável do tipo lista' },
        hint: {
          en: '`variable "ingress_ports" {` with `type = list(number)` and `default = [80, 443, 8080]`.',
          pt: '`variable "ingress_ports" {` com `type = list(number)` e `default = [80, 443, 8080]`.',
        },
        test: listVariable(3),
      },
      {
        id: 'dynamic',
        text: { en: 'One `dynamic "ingress"` over that variable', pt: 'Um único `dynamic "ingress"` sobre essa variável' },
        hint: {
          en: 'Inside the group: `dynamic "ingress" {`, then `for_each = var.ingress_ports` and a `content` block.',
          pt: 'Dentro do grupo: `dynamic "ingress" {`, depois `for_each = var.ingress_ports` e um bloco `content`.',
        },
        test: dynamicBlocks('aws_security_group', 'ingress', { min: 3, fromVar: true }),
      },
      {
        id: 'ports',
        text: { en: 'Each rule takes its port from `ingress.value`', pt: 'Cada regra pega a porta de `ingress.value`' },
        hint: {
          en: 'In `content`: `from_port = ingress.value` and `to_port = ingress.value`, then `protocol` and `cidr_blocks` as before.',
          pt: 'No `content`: `from_port = ingress.value` e `to_port = ingress.value`, depois `protocol` e `cidr_blocks` como antes.',
        },
        test: dynamicBlocks('aws_security_group', 'ingress', { ports: true }),
      },
      {
        id: 'copies',
        text: { en: 'No copied `ingress` blocks left', pt: 'Nenhuma cópia de bloco `ingress` sobrando' },
        hint: {
          en: 'Delete the three static `ingress` blocks: the `dynamic` block writes them now. Keep the `egress` block.',
          pt: 'Apague os três blocos `ingress` fixos: o bloco `dynamic` escreve as regras agora. Mantenha o bloco `egress`.',
        },
        test: all(dynamicBlocks('aws_security_group', 'ingress'), noStaticBlocks('aws_security_group', 'ingress')),
      },
      {
        id: 'plan',
        text: { en: 'A clean `plan`', pt: 'Um `plan` sem erros' },
        hint: {
          en: 'Run `plan` in the terminal. If it complains, check that every `{` has its `}`.',
          pt: 'Rode `plan` no terminal. Se ele reclamar, confira se cada `{` tem o seu `}`.',
        },
        test: all(noErrors, ran('plan')),
      },
    ],
    teaches: ['aws_security_group'],
  },

  /* ------------------------------------------------------------ 5.4 */
  {
    slug: 'conditional-resources',
    code: '5.4',
    kind: 'lesson',
    mode: 'code',
    minutes: 10,
    xp: 70,
    title: { en: 'Resources on a switch', pt: 'Recursos com interruptor' },
    summary: {
      en: 'Create a NAT gateway only when a variable says so, and reference it safely with `one()`.',
      pt: 'Crie um NAT gateway só quando uma variável mandar, e referencie-o com segurança usando `one()`.',
    },
    body: [
      {
        en: 'A NAT gateway lets private subnets reach the internet, and it bills every hour it exists: around US$ 32 a month before any traffic. Production needs one; a test environment often doesn\'t. You want one configuration with a switch, not two copies of the code.',
        pt: 'Um NAT gateway deixa sub-redes privadas acessarem a internet, e é cobrado por cada hora em que existe: cerca de US$ 32 por mês antes de qualquer tráfego. Produção precisa de um; um ambiente de testes muitas vezes não. Você quer uma configuração com um interruptor, não duas cópias do código.',
      },
      {
        en: '`count` is the switch: `count = var.enable_nat ? 1 : 0`. The `? :` picks the first value when the condition is true and the second otherwise, so the resource has one instance or none. The canvas marks it `×0–1`: it may or may not exist, and only the plan decides.',
        pt: 'O `count` é o interruptor: `count = var.enable_nat ? 1 : 0`. O `? :` escolhe o primeiro valor quando a condição é verdadeira e o segundo caso contrário, então o recurso tem uma instância ou nenhuma. O canvas o marca com `×0–1`: ele pode existir ou não, e só o plano decide.',
      },
      {
        en: 'The catch is every reference. With `count`, `aws_eip.nat.id` no longer names anything, and the editor warns about it: write `aws_eip.nat[0].id`. Between resources on the same switch, `[0]` is safe, since they only exist together. An output is different: with the switch off, `[0]` points at nothing and Terraform stops with an error. `one(aws_nat_gateway.nat[*].public_ip)` returns the single value, or `null` when there is none.',
        pt: 'O problema está em cada referência. Com `count`, `aws_eip.nat.id` não aponta mais para nada, e o editor avisa: escreva `aws_eip.nat[0].id`. Entre recursos ligados ao mesmo interruptor, o `[0]` é seguro, já que eles só existem juntos. Um output é diferente: com o interruptor desligado, o `[0]` aponta para o vazio e o Terraform interrompe tudo com um erro. `one(aws_nat_gateway.nat[*].public_ip)` devolve o único valor, ou `null` quando não há nenhum.',
      },
      {
        en: 'Put the Elastic IP, the NAT gateway and the private route behind a `bool` variable, off by default. Flip the default to `true` and run `plan`: the three of them show up. Flip it back to `false`: they vanish from the plan, and the output becomes `null`. Then apply with the switch off.',
        pt: 'Coloque o Elastic IP, o NAT gateway e a rota privada atrás de uma variável `bool`, desligada por padrão. Mude o padrão para `true` e rode `plan`: os três aparecem. Volte para `false`: eles somem do plano, e o output vira `null`. Depois aplique com o interruptor desligado.',
      },
    ],
    asides: [
      {
        title: { en: 'What is an Elastic IP?', pt: 'O que é um Elastic IP?' },
        body: [
          {
            en: 'A public IPv4 address that belongs to your account until you release it, instead of changing whenever something restarts. A NAT gateway needs one: it is the address your private servers show the internet.',
            pt: 'Um endereço IPv4 público que pertence à sua conta até você liberá-lo, em vez de mudar sempre que algo reinicia. Um NAT gateway precisa de um: é o endereço que seus servidores privados mostram para a internet.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'And the cost estimate?', pt: 'E a estimativa de custo?' },
        body: [
          {
            en: 'It can\'t know which way the switch will go, so it lists the NAT gateway as conditional instead of adding its price to the total. The switch is decided when you plan, not when you draw.',
            pt: 'Ela não tem como saber para que lado o interruptor vai, então lista o NAT gateway como condicional em vez de somar o preço dele ao total. O interruptor é decidido no plan, não no desenho.',
          },
        ],
      },
    ],
    start: NAT_START,
    solution: NAT_SOLUTION,
    goals: [
      {
        id: 'switch',
        text: { en: 'A `bool` variable as the switch', pt: 'Uma variável `bool` como interruptor' },
        hint: {
          en: '`variable "enable_nat" {` with `type = bool` and `default = false`.',
          pt: '`variable "enable_nat" {` com `type = bool` e `default = false`.',
        },
        test: variable(undefined, { type: 'bool' }),
      },
      {
        id: 'nat',
        text: { en: 'The NAT gateway exists only when the switch is on', pt: 'O NAT gateway só existe com o interruptor ligado' },
        hint: {
          en: 'Add `count = var.enable_nat ? 1 : 0` to the NAT gateway. Its badge on the canvas turns into `×0–1`.',
          pt: 'Adicione `count = var.enable_nat ? 1 : 0` ao NAT gateway. O selo dele no canvas vira `×0–1`.',
        },
        test: optional('aws_nat_gateway'),
      },
      {
        id: 'together',
        text: { en: 'Its Elastic IP and route follow the same switch', pt: 'O Elastic IP e a rota seguem o mesmo interruptor' },
        hint: {
          en: 'The same `count` line in `aws_eip` and `aws_route`: a route to a NAT gateway that doesn\'t exist can\'t be created.',
          pt: 'A mesma linha de `count` em `aws_eip` e `aws_route`: uma rota para um NAT gateway que não existe não pode ser criada.',
        },
        test: all(optional('aws_eip'), optional('aws_route')),
      },
      {
        id: 'refs',
        text: {
          en: 'Every reference names an instance, and the output survives the switch off',
          pt: 'Toda referência aponta uma instância, e o output sobrevive ao interruptor desligado',
        },
        hint: {
          en: 'In the resources: `aws_eip.nat[0].id` and `aws_nat_gateway.nat[0].id`. In the output: `one(aws_nat_gateway.nat[*].public_ip)`.',
          pt: 'Nos recursos: `aws_eip.nat[0].id` e `aws_nat_gateway.nat[0].id`. No output: `one(aws_nat_gateway.nat[*].public_ip)`.',
        },
        test: all(noErrors, instanceKeysMatch, outputSurvivesZero('aws_nat_gateway')),
      },
      {
        id: 'apply',
        text: { en: 'Apply with the switch off: no NAT gateway to pay for', pt: 'Aplique com o interruptor desligado: nenhum NAT gateway para pagar' },
        hint: {
          en: 'With `default = false`, run `apply`. The plan creates the network and nothing behind the switch.',
          pt: 'Com `default = false`, rode `apply`. O plano cria a rede e nada do que está atrás do interruptor.',
        },
        test: all(optional('aws_nat_gateway'), applied('aws_subnet'), not(applied('aws_nat_gateway'))),
      },
    ],
    teaches: ['aws_nat_gateway', 'aws_eip'],
  },

  /* ------------------------------------------------------------ 5.5 */
  {
    slug: 'moved-blocks',
    code: '5.5',
    kind: 'lesson',
    mode: 'code',
    minutes: 10,
    xp: 80,
    title: { en: 'Moved blocks', pt: 'Blocos moved' },
    summary: {
      en: 'Rename a resource and switch `count` to `for_each` without destroying anything, with `moved {}`.',
      pt: 'Renomeie um recurso e troque `count` por `for_each` sem destruir nada, com `moved {}`.',
    },
    body: [
      {
        en: 'Terraform knows each object by its address. Rename `aws_subnet.this` to `aws_subnet.app` and, as far as it can tell, one resource left the code and another arrived: destroy the old, create the new. For a subnet with servers inside, that is an outage caused by tidying up.',
        pt: 'O Terraform conhece cada objeto pelo endereço. Renomeie `aws_subnet.this` para `aws_subnet.app` e, até onde ele sabe, um recurso saiu do código e outro chegou: destrói o antigo, cria o novo. Para uma sub-rede com servidores dentro, isso é uma queda causada por uma arrumação.',
      },
      {
        en: 'Try it. Apply the starting code, rename the block to `app` and run `plan`: two subnets to destroy and two to create, `Plan: 2 to add, 0 to change, 2 to destroy.` Nothing about them changed except a name in your code.',
        pt: 'Experimente. Aplique o código inicial, renomeie o bloco para `app` e rode `plan`: duas sub-redes a destruir e duas a criar, `Plan: 2 to add, 0 to change, 2 to destroy.` Nada nelas mudou além de um nome no seu código.',
      },
      {
        en: 'A `moved` block tells Terraform the object only changed address: `from = aws_subnet.this` and `to = aws_subnet.app`. Run `plan` again: each subnet `has moved to` its new address, and the summary drops to `0 to add, 0 to change, 0 to destroy`. The state is updated, and the cloud is left alone.',
        pt: 'Um bloco `moved` avisa o Terraform que o objeto só mudou de endereço: `from = aws_subnet.this` e `to = aws_subnet.app`. Rode `plan` de novo: cada sub-rede `has moved to` o novo endereço, e o resumo cai para `0 to add, 0 to change, 0 to destroy`. O estado é atualizado, e a nuvem fica como está.',
      },
      {
        en: 'Switching `count` to `for_each` changes addresses too: `[0]` becomes `["us-east-1a"]`. Rewrite the block with `for_each` over a map of zone to range, and write one `moved` block per instance, from its index to its key. The plan should only say `has moved to`; if a subnet is replaced instead, its range or zone changed on the way.',
        pt: 'Trocar `count` por `for_each` também muda endereços: `[0]` vira `["us-east-1a"]`. Reescreva o bloco com `for_each` sobre um mapa de zona para intervalo e escreva um bloco `moved` por instância, do índice para a chave. O plano deve dizer apenas `has moved to`; se uma sub-rede for substituída, o intervalo ou a zona dela mudou no caminho.',
      },
    ],
    asides: [
      {
        title: { en: 'Let the editor write them', pt: 'Deixe o editor escrever' },
        body: [
          {
            en: 'In the editor, renaming a resource or changing its *Repeat* section offers *Keep the state*, which writes the `moved` blocks for you.',
            pt: 'No editor, renomear um recurso ou mudar a seção *Repetição* dele oferece *Manter o estado*, que escreve os blocos `moved` para você.',
          },
        ],
      },
      {
        title: { en: 'When can they go?', pt: 'Quando dá para apagar?' },
        body: [
          {
            en: 'Once every state that uses this code has been applied with them, a `moved` block has done its job. In a module other teams use, keep them for a long while: you can\'t know when everyone will upgrade, and deleting one too early brings back the destroy and create.',
            pt: 'Depois que todo estado que usa este código foi aplicado com eles, um bloco `moved` cumpriu o papel. Num módulo que outros times usam, mantenha por bastante tempo: você não sabe quando todo mundo vai atualizar, e apagar cedo demais traz de volta o destruir e criar.',
          },
        ],
      },
    ],
    start: MOVED_START,
    solution: MOVED_SOLUTION,
    goals: [
      {
        id: 'apply',
        text: { en: 'Apply the starting code', pt: 'Aplique o código inicial' },
        hint: {
          en: '`init`, then `apply`: `aws_subnet.this[0]` and `aws_subnet.this[1]`.',
          pt: '`init` e depois `apply`: `aws_subnet.this[0]` e `aws_subnet.this[1]`.',
        },
        test: applied('aws_subnet'),
      },
      {
        id: 'rename',
        text: { en: 'Renamed to `app`, with a `moved` block keeping the state', pt: 'Renomeado para `app`, com um bloco `moved` mantendo o estado' },
        hint: {
          en: 'Rename the block, then add a `moved` block with `from = aws_subnet.this` and `to = aws_subnet.app` inside.',
          pt: 'Renomeie o bloco e depois adicione um bloco `moved` com `from = aws_subnet.this` e `to = aws_subnet.app` dentro.',
        },
        test: all(not(named('aws_subnet', 'this')), movesKeep(MOVED_START)),
      },
      {
        id: 'for-each',
        text: { en: 'Repeated with `for_each`, every instance moved to its key', pt: 'Repetido com `for_each`, cada instância movida para a sua chave' },
        hint: {
          en: '`for_each` over `{ "us-east-1a" = "10.0.1.0/24", "us-east-1b" = "10.0.2.0/24" }`, then one `moved` per instance: `from = aws_subnet.this[0]` and `to = aws_subnet.app["us-east-1a"]`, and the same for `[1]`.',
          pt: '`for_each` sobre `{ "us-east-1a" = "10.0.1.0/24", "us-east-1b" = "10.0.2.0/24" }`, depois um `moved` por instância: `from = aws_subnet.this[0]` e `to = aws_subnet.app["us-east-1a"]`, e o mesmo para `[1]`.',
        },
        test: all(repeats('aws_subnet', 'for_each', 2), movesKeep(MOVED_START)),
      },
      {
        id: 'same',
        text: { en: 'Each subnet keeps its range and zone', pt: 'Cada sub-rede mantém o intervalo e a zona' },
        hint: {
          en: '`us-east-1a` had `10.0.1.0/24` and `us-east-1b` had `10.0.2.0/24`. A move that changes the range is a replacement in disguise.',
          pt: '`us-east-1a` tinha `10.0.1.0/24` e `us-east-1b` tinha `10.0.2.0/24`. Uma mudança de endereço que altera o intervalo é uma substituição disfarçada.',
        },
        test: all(repeats('aws_subnet', 'for_each', 2), movesKeep(MOVED_START, ['cidr_block', 'availability_zone'])),
      },
      {
        id: 'applied',
        text: { en: '`plan`, then `apply`: the state follows the `moved` blocks', pt: '`plan` e depois `apply`: o estado acompanha os blocos `moved`' },
        hint: {
          en: 'Run `plan` and check that it only moves things, then `apply`.',
          pt: 'Rode `plan` e confira se ele só muda endereços; depois rode `apply`.',
        },
        test: all(ran('plan'), appliedByKeys('aws_subnet')),
      },
    ],
  },

  /* ------------------------------------------------------------ C5 */
  {
    slug: 'challenge-subnets-from-map',
    code: 'C5',
    kind: 'challenge',
    mode: 'code',
    minutes: 20,
    xp: 200,
    title: { en: 'Challenge: a network from data', pt: 'Desafio: uma rede a partir de dados' },
    summary: {
      en: 'Subnets from a map, rules from a list, a NAT gateway on a switch: change the data, not the code.',
      pt: 'Sub-redes a partir de um mapa, regras a partir de uma lista, um NAT gateway com interruptor: mude os dados, não o código.',
    },
    body: [
      {
        en: 'Everything from level 5, in one go. The goal is a configuration where adding a subnet or a port means editing a variable, never copying a block. `network.tf` has the VPC, its internet gateway and a route table to it; write the rest in `main.tf`.',
        pt: 'Tudo do nível 5, de uma vez. O objetivo é uma configuração em que adicionar uma sub-rede ou uma porta seja editar uma variável, nunca copiar um bloco. O `network.tf` tem a VPC, o internet gateway dela e uma tabela de rotas até ele; escreva o resto no `main.tf`.',
      },
      {
        en: 'The subnets come from a map variable, from a name to an object with a `cidr` and an `az`: at least two, in different zones, all created by a single `aws_subnet` block. A security group in the VPC takes its `ingress` rules from a list of ports. A NAT gateway, with its Elastic IP, exists only when a `bool` variable says so.',
        pt: 'As sub-redes vêm de uma variável do tipo mapa, de um nome para um objeto com `cidr` e `az`: pelo menos duas, em zonas diferentes, todas criadas por um único bloco `aws_subnet`. Um grupo de segurança na VPC tira as regras `ingress` de uma lista de portas. Um NAT gateway, com o seu Elastic IP, só existe quando uma variável `bool` mandar.',
      },
      {
        en: 'Bonus, not graded: associate the route table with every subnet using `for_each = aws_subnet.<name>` (a `for_each` can loop over another resource\'s instances). Then add a third subnet to the map and `plan`: it adds one subnet and its association, and nothing else moves.',
        pt: 'Bônus, sem nota: associe a tabela de rotas a todas as sub-redes usando `for_each = aws_subnet.<name>` (um `for_each` pode repetir sobre as instâncias de outro recurso). Depois adicione uma terceira sub-rede ao mapa e rode `plan`: entram uma sub-rede e a associação dela, e nada mais se mexe.',
      },
    ],
    start: aws(
      `# Challenge: a network you change by editing data.
#   * subnets from a map variable, name => { cidr, az }, in two zones or more,
#     all from one aws_subnet block
#   * a security group in the VPC whose ingress rules come from a list of ports
#   * a NAT gateway and its Elastic IP, created only when a bool variable is true
`,
      { 'network.tf': CHALLENGE_NETWORK },
    ),
    solution: CHALLENGE_SOLUTION,
    goals: [
      {
        id: 'map',
        text: { en: 'Subnets from a map of objects, in one `for_each` block', pt: 'Sub-redes a partir de um mapa de objetos, num único bloco com `for_each`' },
        hint: {
          en: 'A variable with `type = map(object({ cidr = string, az = string }))`, then `for_each = var.subnets` with `cidr_block = each.value.cidr` and `availability_zone = each.value.az`.',
          pt: 'Uma variável com `type = map(object({ cidr = string, az = string }))`, depois `for_each = var.subnets` com `cidr_block = each.value.cidr` e `availability_zone = each.value.az`.',
        },
        test: all(
          repeats('aws_subnet', 'for_each', 2),
          writes('aws_subnet', 'cidr_block', /\beach\.value\b/),
          writes('aws_subnet', 'availability_zone', /\beach\.value\b/),
        ),
      },
      {
        id: 'spread',
        text: { en: 'In two zones or more, with ranges that fit the VPC', pt: 'Em duas zonas ou mais, com intervalos que cabem na VPC' },
        hint: {
          en: 'Give each entry its own `cidr` inside `10.0.0.0/16`, and use at least two different `az` values, like `us-east-1a` and `us-east-1b`.',
          pt: 'Dê a cada item um `cidr` próprio dentro de `10.0.0.0/16` e use pelo menos dois valores diferentes de `az`, como `us-east-1a` e `us-east-1b`.',
        },
        test: all(distinctPerInstance('aws_subnet', 'cidr_block', 2), subnetsAcrossZones('any', 2), rangesFit),
      },
      {
        id: 'rules',
        text: { en: 'A security group whose `ingress` rules come from a list', pt: 'Um grupo de segurança com regras `ingress` vindas de uma lista' },
        hint: {
          en: 'In an `aws_security_group` in the VPC: a `dynamic "ingress"` block over a list of ports, with `from_port = ingress.value` and `to_port = ingress.value` in its `content`.',
          pt: 'Num `aws_security_group` na VPC: um bloco `dynamic "ingress"` sobre uma lista de portas, com `from_port = ingress.value` e `to_port = ingress.value` no `content`.',
        },
        test: all(
          inside('aws_security_group', 'aws_vpc'),
          dynamicBlocks('aws_security_group', 'ingress', { min: 2, ports: true }),
          noStaticBlocks('aws_security_group', 'ingress'),
        ),
      },
      {
        id: 'nat',
        text: { en: 'A NAT gateway and its Elastic IP behind a `bool` switch', pt: 'Um NAT gateway e o Elastic IP dele atrás de um interruptor `bool`' },
        hint: {
          en: 'A variable with `type = bool`, and `count = var.enable_nat ? 1 : 0` on both. The NAT gateway takes `allocation_id = aws_eip.nat[0].id` and a `subnet_id` that picks one subnet by its key.',
          pt: 'Uma variável com `type = bool`, e `count = var.enable_nat ? 1 : 0` nos dois. O NAT gateway recebe `allocation_id = aws_eip.nat[0].id` e um `subnet_id` que escolhe uma sub-rede pela chave.',
        },
        test: all(
          variable(undefined, { type: 'bool' }),
          optional('aws_nat_gateway'),
          optional('aws_eip'),
          argRefs('aws_nat_gateway', 'allocation_id', 'aws_eip'),
          argRefs('aws_nat_gateway', 'subnet_id', 'aws_subnet'),
        ),
      },
      {
        id: 'valid',
        text: { en: 'Every reference names an instance, and the code is valid', pt: 'Toda referência aponta uma instância, e o código é válido' },
        hint: {
          en: 'One subnet of the map is `aws_subnet.<name>["<key>"]`, the Elastic IP is `aws_eip.<name>[0]`. The code panel flags references that miss their key.',
          pt: 'Uma sub-rede do mapa é `aws_subnet.<name>["<key>"]`, o Elastic IP é `aws_eip.<name>[0]`. O painel de código marca as referências que esquecem a chave.',
        },
        test: all(noErrors, instanceKeysMatch),
      },
      {
        id: 'apply',
        text: { en: 'Apply: every subnet in the state by its key', pt: 'Aplique: cada sub-rede no estado pela sua chave' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`.',
          pt: 'No terminal: `init`, `plan`, `apply`.',
        },
        test: appliedByKeys('aws_subnet'),
      },
    ],
  },
];
