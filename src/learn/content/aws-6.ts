/**
 * Level 6 · Modules (code). One network module grows across the level: a
 * folder that is called as is (6.1), gets inputs and outputs (6.2), is
 * called once per environment (6.3); then a Registry module (6.4) and a
 * module written from scratch (C6). Module files ship in the lesson's
 * files under `modules/network/`; the canvas opens them on a double-click.
 */
import { all, applied, output, ran } from '../goals';
import type { Files, Lesson } from '../types';
import {
  appliedEnvs,
  callsModule,
  callsRegistry,
  environments,
  fromInput,
  fromModuleOutput,
  fromRegistryOutput,
  inModule,
  namesApart,
  passesInput,
  pinnedTo,
  publicInside,
  rangesApart,
  registryInputs,
  zonesPerEnv,
} from './predicates-6';
import { aws } from './shared';

const DIR = 'modules/network';
const VPC_MODULE = 'terraform-aws-modules/vpc/aws';

/** the network module's resources; `cidr`, `name` and `zones` are HCL expressions */
const networkMain = (cidr: string, name: string, zones: string, intro = '') => `${intro}resource "aws_vpc" "this" {
  cidr_block           = ${cidr}
  enable_dns_hostnames = true

  tags = {
    Name = ${name}
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}

resource "aws_subnet" "public" {
  count                   = length(${zones})
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(aws_vpc.this.cidr_block, 8, count.index)
  availability_zone       = ${zones}[count.index]
  map_public_ip_on_launch = true
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}

resource "aws_route_table_association" "public" {
  count          = length(${zones})
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
`;

/** the module as 6.1 finds it: everything written in stone */
const FIXED_MAIN = networkMain(
  '"10.0.0.0/16"',
  '"learn"',
  'local.zones',
  `# A small network: a VPC, an internet gateway, and a public subnet in
# each of two availability zones, routed to the internet.

locals {
  zones = ["us-east-1a", "us-east-1b"]
}

`,
);

const VARIABLES = `variable "name" {
  description = "Name tag of the VPC"
  type        = string
}

variable "cidr_block" {
  description = "Address range of the VPC, like 10.0.0.0/16"
  type        = string
}
`;

const OUTPUTS = `output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.this.id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets, one per zone"
  value       = aws_subnet.public[*].id
}
`;

/** the module after 6.2: a name and a range come in, the ids go out */
const MODULE_62: Files = {
  [`${DIR}/main.tf`]: networkMain(
    'var.cidr_block',
    'var.name',
    'local.zones',
    `locals {
  zones = ["us-east-1a", "us-east-1b"]
}

`,
  ),
  [`${DIR}/variables.tf`]: VARIABLES,
  [`${DIR}/outputs.tf`]: OUTPUTS,
};

/** the module from 6.3 on: the zones are an input too */
const MODULE: Files = {
  [`${DIR}/main.tf`]: networkMain('var.cidr_block', 'var.name', 'var.zones'),
  [`${DIR}/variables.tf`]: `${VARIABLES}
variable "zones" {
  description = "Availability zones, one public subnet in each"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}
`,
  [`${DIR}/outputs.tf`]: OUTPUTS,
};

const CALL_NETWORK = `module "network" {
  source = "./modules/network"
}
`;

const SG = (vpcId: string) => `resource "aws_security_group" "web" {
  name        = "web"
  description = "Web servers"
${vpcId}}
`;

const STAGING = `module "staging" {
  source = "./modules/network"

  name       = "staging"
  cidr_block = "10.0.0.0/16"
}
`;

const PRODUCTION = `module "production" {
  source = "./modules/network"

  name       = "production"
  cidr_block = "10.1.0.0/16"
  zones      = ["us-east-1a", "us-east-1b", "us-east-1c"]
}
`;

const REGISTRY_VPC = `module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.21.0"

  name = "learn"
  cidr = "10.0.0.0/16"

  azs            = ["us-east-1a", "us-east-1b"]
  public_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
}
`;

const SERVER = `data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.al2023.id
  instance_type = "t3.micro"
  subnet_id     = module.staging.public_subnet_ids[0]

  metadata_options {
    http_tokens = "required"
  }
}
`;

export const lessons: Lesson[] = [
  /* ------------------------------------------------------------ 6.1 */
  {
    slug: 'what-is-a-module',
    code: '6.1',
    kind: 'lesson',
    mode: 'code',
    minutes: 8,
    xp: 60,
    title: { en: 'What is a module?', pt: 'O que é um módulo?' },
    summary: {
      en: 'Call a module someone already wrote, open it on the canvas and meet its addresses.',
      pt: 'Chame um módulo que alguém já escreveu, abra no canvas e conheça os endereços dele.',
    },
    body: [
      {
        en: 'You have been writing modules since level 0 without knowing it. A *module* is simply a folder of `.tf` files, and the folder you run Terraform in is the *root module*. Everything so far lived there.',
        pt: 'Você escreve módulos desde o nível 0 sem saber. Um *módulo* é simplesmente uma pasta de arquivos `.tf`, e a pasta onde você roda o Terraform é o *módulo raiz*. Tudo até aqui morava nela.',
      },
      {
        en: 'Look at the tabs: after `main.tf` comes `modules/network/main.tf`. That folder is a *child module*, a VPC with an internet gateway and two public subnets, written once by someone on your team. On its own it does nothing. Like a recipe, it waits for someone to cook it.',
        pt: 'Olhe as abas: depois do `main.tf` vem `modules/network/main.tf`. Essa pasta é um *módulo filho*, uma VPC com um internet gateway e duas sub-redes públicas, escrita uma vez por alguém do seu time. Sozinha, ela não faz nada. Como uma receita, espera alguém para cozinhá-la.',
      },
      {
        en: 'Cooking it is a `module` block in `main.tf`: a name of your choice and a `source` that points at the folder. The canvas draws one card for the whole network. Double-click it and the canvas *opens* the module: the VPC box, the subnets inside, the path root › network in the bar on top. Esc brings you back.',
        pt: 'Cozinhar é escrever um bloco `module` no `main.tf`: um nome à sua escolha e um `source` que aponta para a pasta. O canvas desenha um cartão só para a rede inteira. Clique duas vezes nele e o canvas *abre* o módulo: a caixa da VPC, as sub-redes dentro dela, o caminho raiz › network na barra no topo. Esc traz você de volta.',
      },
      {
        en: 'Now the terminal. A new module means `terraform init` again: Terraform installs modules the way it installs providers. Then `plan`, and read the addresses: `module.network.aws_vpc.this`. One card on the canvas, seven resources in the plan, each one named after the module that holds it.',
        pt: 'Agora o terminal. Módulo novo pede `terraform init` de novo: o Terraform instala módulos do mesmo jeito que instala providers. Depois, `plan`, e leia os endereços: `module.network.aws_vpc.this`. Um cartão no canvas, sete recursos no plano, cada um com o nome do módulo que o guarda.',
      },
    ],
    asides: [
      {
        title: { en: 'Why is everything called `this`?', pt: 'Por que tudo se chama `this`?' },
        body: [
          {
            en: 'Inside a module, a resource that is the only one of its type is often named `this`. The call already says which network it is, so `module.network.aws_vpc.this` reads well without saying "network" twice.',
            pt: 'Dentro de um módulo, um recurso que é o único do seu tipo costuma se chamar `this`. A chamada já diz de qual rede se trata, então `module.network.aws_vpc.this` se lê bem sem repetir "network".',
          },
        ],
      },
    ],
    start: aws(
      `# The folder modules/network holds a module someone already wrote.
# TODO: call it from here with a module block named "network".
`,
      { [`${DIR}/main.tf`]: FIXED_MAIN },
    ),
    solution: aws(CALL_NETWORK, { [`${DIR}/main.tf`]: FIXED_MAIN }),
    goals: [
      {
        id: 'call',
        text: { en: 'A `module` block whose `source` is `./modules/network`', pt: 'Um bloco `module` cujo `source` é `./modules/network`' },
        hint: {
          en: '`module "network" {` on one line, `source = "./modules/network"` on the next, then `}`. The `./` matters: it tells Terraform the source is a folder of this project.',
          pt: '`module "network" {` numa linha, `source = "./modules/network"` na seguinte e depois `}`. O `./` faz diferença: ele diz ao Terraform que a origem é uma pasta deste projeto.',
        },
        test: callsModule(DIR),
      },
      {
        id: 'init',
        text: { en: 'Run `terraform init` with the module in place', pt: 'Rode `terraform init` com o módulo no lugar' },
        hint: {
          en: 'Under *Initializing modules* the terminal lists `- network in modules/network`: Terraform found the folder.',
          pt: 'Em *Initializing modules* o terminal lista `- network in modules/network`: o Terraform encontrou a pasta.',
        },
        test: all(callsModule(DIR), ran('init')),
      },
      {
        id: 'plan',
        text: { en: 'Run `terraform plan` and find `module.network` in the addresses', pt: 'Rode `terraform plan` e encontre `module.network` nos endereços' },
        hint: {
          en: 'Every resource of the module is listed as `module.network.` followed by its usual address, like `module.network.aws_subnet.public[0]`.',
          pt: 'Cada recurso do módulo aparece como `module.network.` seguido do endereço de sempre, como `module.network.aws_subnet.public[0]`.',
        },
        test: all(callsModule(DIR), ran('plan')),
      },
      {
        id: 'apply',
        text: { en: 'Apply it: the network exists', pt: 'Aplique: a rede passa a existir' },
        hint: {
          en: 'Type `terraform apply`. The VPC goes first, then everything that needs its id.',
          pt: 'Digite `terraform apply`. A VPC vem primeiro, depois tudo que precisa do id dela.',
        },
        test: appliedEnvs(1),
      },
    ],
  },

  /* ------------------------------------------------------------ 6.2 */
  {
    slug: 'module-inputs-outputs',
    code: '6.2',
    kind: 'lesson',
    mode: 'code',
    minutes: 11,
    xp: 80,
    title: { en: 'Inputs and outputs', pt: 'Entradas e outputs' },
    summary: {
      en: 'Turn the module\'s fixed values into inputs, and hand its VPC id back with an output.',
      pt: 'Transforme os valores fixos do módulo em entradas e devolva o id da VPC com um output.',
    },
    body: [
      {
        en: 'The network module from the last lesson has its range written in stone: `10.0.0.0/16`. Call it twice and you get two networks with the same addresses. A module earns its keep when the caller can tune it, and that is what variables are for.',
        pt: 'O módulo de rede da lição anterior tem o intervalo cravado no código: `10.0.0.0/16`. Chame o módulo duas vezes e você tem duas redes com os mesmos endereços. Um módulo vale a pena quando quem chama consegue ajustá-lo, e é para isso que servem as variáveis.',
      },
      {
        en: 'Think of a module as a function. Its `variable` blocks are the *inputs*, its parameters. Inside the module they read as `var.cidr_block`, as in level 1, and the `module` block passes them as plain arguments: `cidr_block = "10.0.0.0/16"`, just like a resource\'s.',
        pt: 'Pense num módulo como uma função. Os blocos `variable` dele são as *entradas*, os parâmetros. Dentro do módulo elas são lidas como `var.cidr_block`, como no nível 1, e o bloco `module` passa cada uma como argumento comum: `cidr_block = "10.0.0.0/16"`, igual aos de um recurso.',
      },
      {
        en: 'Its `output` blocks are the *return values*. Everything else is private: the root can\'t reach the `aws_vpc.this` in there, only what the module chooses to hand back. Declare `output "vpc_id"` in the module, and the root reads it as `module.network.vpc_id`.',
        pt: 'Os blocos `output` dele são os *valores de retorno*. Todo o resto é privado: a raiz não alcança o `aws_vpc.this` lá dentro, só o que o módulo escolhe devolver. Declare `output "vpc_id"` no módulo, e a raiz lê o valor como `module.network.vpc_id`.',
      },
      {
        en: 'Use it as the security group\'s `vpc_id`. Until the output exists, the editor warns that the module has no such output; declare it and the warning goes away, and a line ties the group to the module\'s card. Open the module: *Inputs and outputs* in its bar lists the interface you just wrote.',
        pt: 'Use o output como `vpc_id` do grupo de segurança. Enquanto ele não existe, o editor avisa que o módulo não tem esse output; declare e o aviso some, e uma linha liga o grupo ao cartão do módulo. Abra o módulo: *Entradas e outputs*, na barra dele, lista a interface que você acabou de escrever.',
      },
      {
        en: 'Then `init`, `plan` and `apply`. The group\'s `vpc_id` shows as `(known after apply)` in the plan: it waits for a VPC that doesn\'t exist yet. The apply creates the module\'s resources first and the group last, because the group reads the module\'s output.',
        pt: 'Depois, `init`, `plan` e `apply`. O `vpc_id` do grupo aparece como `(known after apply)` no plano: ele espera uma VPC que ainda não existe. O apply cria primeiro os recursos do módulo e por último o grupo, porque o grupo lê o output do módulo.',
      },
    ],
    asides: [
      {
        title: { en: 'One folder, three files', pt: 'Uma pasta, três arquivos' },
        body: [
          {
            en: 'Terraform reads every `.tf` file in a module\'s folder as one, so the split is a convention, and a strong one: `main.tf` for resources, `variables.tf` for inputs, `outputs.tf` for outputs. Whoever opens the folder knows where the interface is.',
            pt: 'O Terraform lê todos os arquivos `.tf` da pasta de um módulo como um só, então a divisão é uma convenção, e das fortes: `main.tf` para os recursos, `variables.tf` para as entradas, `outputs.tf` para os outputs. Quem abre a pasta sabe onde está a interface.',
          },
          {
            en: 'Give each variable a `description` and a `type`. An input without a `default` is required: leave it out of the call and the plan stops with an error.',
            pt: 'Dê a cada variável uma `description` e um `type`. Uma entrada sem `default` é obrigatória: deixe-a de fora da chamada e o plano para com um erro.',
          },
        ],
      },
    ],
    start: aws(
      `${CALL_NETWORK.replace('}\n', '\n  # TODO: pass the inputs you declare in modules/network/variables.tf\n}\n')}
${SG('\n  # TODO: vpc_id, read from an output of the module\n')}`,
      {
        [`${DIR}/main.tf`]: FIXED_MAIN,
        [`${DIR}/variables.tf`]: `# TODO: the module's inputs. At least the VPC's address range;
# the Name tag makes a good second one.
`,
        [`${DIR}/outputs.tf`]: `# TODO: the module's outputs. At least the VPC's id.
`,
      },
    ),
    solution: aws(
      `module "network" {
  source = "./modules/network"

  name       = "learn"
  cidr_block = "10.0.0.0/16"
}

${SG('  vpc_id      = module.network.vpc_id\n')}`,
      MODULE_62,
    ),
    goals: [
      {
        id: 'input',
        text: { en: 'The module\'s VPC takes its range from a variable', pt: 'A VPC do módulo recebe o intervalo de uma variável' },
        hint: {
          en: 'In `modules/network/variables.tf`, declare `variable "cidr_block" {` with `type = string`. In `modules/network/main.tf`, set the VPC\'s `cidr_block = var.cidr_block`.',
          pt: 'No `modules/network/variables.tf`, declare `variable "cidr_block" {` com `type = string`. No `modules/network/main.tf`, defina o `cidr_block = var.cidr_block` da VPC.',
        },
        test: inModule(fromInput('aws_vpc', 'cidr_block')),
      },
      {
        id: 'pass',
        text: { en: 'The call passes the range', pt: 'A chamada passa o intervalo' },
        hint: {
          en: 'In the `module "network"` block of `main.tf`, add `cidr_block = "10.0.0.0/16"`: the argument\'s name is the variable\'s name.',
          pt: 'No bloco `module "network"` do `main.tf`, adicione `cidr_block = "10.0.0.0/16"`: o nome do argumento é o nome da variável.',
        },
        test: passesInput('aws_vpc', 'cidr_block'),
      },
      {
        id: 'output',
        text: { en: 'An output that returns the VPC\'s id', pt: 'Um output que devolve o id da VPC' },
        hint: {
          en: 'In `modules/network/outputs.tf`: `output "vpc_id" {`, then `value = aws_vpc.this.id`, then `}`.',
          pt: 'No `modules/network/outputs.tf`: `output "vpc_id" {`, depois `value = aws_vpc.this.id` e depois `}`.',
        },
        test: inModule(output(undefined, 'aws_vpc')),
      },
      {
        id: 'use',
        text: { en: 'The security group lands in that VPC through the output', pt: 'O grupo de segurança fica nessa VPC por meio do output' },
        hint: {
          en: 'In the security group: `vpc_id = module.network.vpc_id`. The module\'s name, then the output\'s name.',
          pt: 'No grupo de segurança: `vpc_id = module.network.vpc_id`. O nome do módulo, depois o nome do output.',
        },
        test: fromModuleOutput('aws_security_group', 'vpc_id', 'aws_vpc'),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. If the plan stops on a missing argument, the call lacks a required input: pass it, or give its variable a `default`.',
          pt: 'No terminal: `init`, `plan`, `apply`. Se o plano parar num argumento faltando, a chamada não passa uma entrada obrigatória: passe, ou dê à variável um `default`.',
        },
        test: all(applied('aws_security_group'), appliedEnvs(1)),
      },
    ],
  },

  /* ------------------------------------------------------------ 6.3 */
  {
    slug: 'module-reuse',
    code: '6.3',
    kind: 'lesson',
    mode: 'code',
    minutes: 10,
    xp: 80,
    title: { en: 'One module, two environments', pt: 'Um módulo, dois ambientes' },
    summary: {
      en: 'Call the same module twice, staging and production, each with its own range and size.',
      pt: 'Chame o mesmo módulo duas vezes, staging e produção, cada um com seu intervalo e seu tamanho.',
    },
    body: [
      {
        en: 'Here comes the payoff. The module now takes a `name`, a `cidr_block` and a list of `zones`, and `main.tf` already calls it once for *staging*. Production should be the same network, only bigger and in an address range of its own.',
        pt: 'Aqui vem a recompensa. O módulo agora recebe um `name`, um `cidr_block` e uma lista de `zones`, e o `main.tf` já o chama uma vez para *staging*. Produção deve ser a mesma rede, só que maior e num intervalo de endereços só dela.',
      },
      {
        en: 'Add a second `module` block with the same `source` and different inputs: `10.1.0.0/16` and three zones. That is the whole change. No copied resources, no second folder: fix something in the module once and both environments get it on the next apply.',
        pt: 'Adicione um segundo bloco `module` com o mesmo `source` e entradas diferentes: `10.1.0.0/16` e três zonas. A mudança é só essa. Nenhum recurso copiado, nenhuma segunda pasta: corrija algo no módulo uma vez e os dois ambientes recebem a correção no próximo apply.',
      },
      {
        en: 'Watch the canvas: two cards out of one folder. Open either and you find the same blueprint filled in with its own values, two subnets in one, three in the other; select a card and the inspector sums up the findings and the cost inside that copy alone. In the plan the same resources appear twice, as `module.staging.aws_vpc.this` and `module.production.aws_vpc.this`.',
        pt: 'Olhe o canvas: dois cartões saídos de uma pasta só. Abra qualquer um e você encontra a mesma planta preenchida com os valores dele, duas sub-redes num, três no outro; selecione um cartão e o inspetor resume os achados e o custo só daquela cópia. No plano, os mesmos recursos aparecem duas vezes, como `module.staging.aws_vpc.this` e `module.production.aws_vpc.this`.',
      },
      {
        en: 'Remember `for_each` from level 5? It works on modules too: one block with `for_each` over a map of environments makes the same two copies, addressed as `module.network["staging"]`. Either style passes the goals.',
        pt: 'Lembra do `for_each` do nível 5? Ele também funciona em módulos: um bloco só, com `for_each` sobre um mapa de ambientes, cria as mesmas duas cópias, com endereços como `module.network["staging"]`. Os dois estilos passam nos objetivos.',
      },
    ],
    asides: [
      {
        title: { en: 'One root, or one per environment?', pt: 'Uma raiz só, ou uma por ambiente?' },
        body: [
          {
            en: 'Here both environments share one root module, so they share one state and one apply: a slip while changing staging can touch production in the same run.',
            pt: 'Aqui os dois ambientes dividem um módulo raiz, então dividem um estado e um apply: um deslize ao mexer em staging pode atingir produção na mesma execução.',
          },
          {
            en: 'Many teams give each environment its own root folder, like `envs/staging` and `envs/production`, each calling the same module with its own values. Same reuse, separate blast radius.',
            pt: 'Muitos times dão a cada ambiente uma pasta raiz própria, como `envs/staging` e `envs/production`, cada uma chamando o mesmo módulo com seus valores. O mesmo reúso, com o estrago de um erro contido num ambiente só.',
          },
        ],
      },
    ],
    start: aws(
      `${STAGING}
# TODO: production, from the same module, in 10.1.0.0/16 and across
# three availability zones (us-east-1a, us-east-1b and us-east-1c).
`,
      MODULE,
    ),
    solution: aws(`${STAGING}\n${PRODUCTION}`, MODULE),
    goals: [
      {
        id: 'twice',
        text: { en: 'Two environments from the same module', pt: 'Dois ambientes a partir do mesmo módulo' },
        hint: {
          en: 'A second block, `module "production" {`, with `source = "./modules/network"` and its own `name` and `cidr_block`. Or a single block with `for_each = { staging = "10.0.0.0/16", production = "10.1.0.0/16" }`, `name = each.key` and `cidr_block = each.value`.',
          pt: 'Um segundo bloco, `module "production" {`, com `source = "./modules/network"` e seus próprios `name` e `cidr_block`. Ou um bloco só com `for_each = { staging = "10.0.0.0/16", production = "10.1.0.0/16" }`, `name = each.key` e `cidr_block = each.value`.',
        },
        test: environments(2),
      },
      {
        id: 'apart',
        text: { en: 'Their ranges don\'t overlap', pt: 'Os intervalos deles não se sobrepõem' },
        hint: {
          en: 'Production gets `cidr_block = "10.1.0.0/16"`. Overlapping ranges can never be connected to each other later.',
          pt: 'Produção recebe `cidr_block = "10.1.0.0/16"`. Intervalos que se sobrepõem nunca poderão ser conectados entre si depois.',
        },
        test: rangesApart,
      },
      {
        id: 'names',
        text: { en: 'Each VPC has a `Name` of its own', pt: 'Cada VPC tem um `Name` só dela' },
        hint: {
          en: 'Pass `name = "production"`. Two VPCs called the same are a guessing game in the AWS console.',
          pt: 'Passe `name = "production"`. Duas VPCs com o mesmo nome viram um jogo de adivinhação no console da AWS.',
        },
        test: namesApart,
      },
      {
        id: 'zones',
        text: { en: 'Production spans three zones', pt: 'Produção ocupa três zonas' },
        hint: {
          en: 'Pass `zones = ["us-east-1a", "us-east-1b", "us-east-1c"]`. The module makes one public subnet per zone, so production gets three.',
          pt: 'Passe `zones = ["us-east-1a", "us-east-1b", "us-east-1c"]`. O módulo cria uma sub-rede pública por zona, então produção fica com três.',
        },
        test: zonesPerEnv(3),
      },
      {
        id: 'apply',
        text: { en: 'Apply both', pt: 'Aplique os dois' },
        hint: {
          en: 'A new module call means `init` again, then `plan` and `apply`.',
          pt: 'Chamada de módulo nova pede `init` de novo, depois `plan` e `apply`.',
        },
        test: appliedEnvs(2),
      },
    ],
  },

  /* ------------------------------------------------------------ 6.4 */
  {
    slug: 'registry-modules',
    code: '6.4',
    kind: 'lesson',
    mode: 'code',
    minutes: 9,
    xp: 70,
    title: { en: 'Modules from the Registry', pt: 'Módulos do Registry' },
    summary: {
      en: 'Use a community VPC module from the Terraform Registry, pinned to a version you trust.',
      pt: 'Use um módulo de VPC da comunidade, do Terraform Registry, fixado numa versão em que você confia.',
    },
    body: [
      {
        en: 'You don\'t have to write every module yourself. The *Terraform Registry* publishes thousands, and `terraform-aws-modules/vpc/aws` is one of the most used: a whole VPC, with public and private subnets, NAT gateways and routes, behind a few dozen inputs.',
        pt: 'Você não precisa escrever todo módulo sozinho. O *Terraform Registry* publica milhares, e `terraform-aws-modules/vpc/aws` é um dos mais usados: uma VPC inteira, com sub-redes públicas e privadas, NAT gateways e rotas, por trás de algumas dezenas de entradas.',
      },
      {
        en: 'The `source` reads namespace, name and provider. Without `./` in front, Terraform fetches it from the Registry during `init`. Then pin it: `version = "5.21.0"`. Unpinned, every `init` takes the latest release, and version 6 of this module needs version 6 of the AWS provider, which the `~> 5.0` at the top of the file rules out.',
        pt: 'O `source` traz namespace, nome e provider. Sem `./` na frente, o Terraform busca o módulo no Registry durante o `init`. Depois fixe a versão: `version = "5.21.0"`. Sem isso, cada `init` pega a versão mais recente, e a versão 6 deste módulo exige a versão 6 do provider da AWS, que o `~> 5.0` no topo do arquivo descarta.',
      },
      {
        en: 'The card on the canvas shows the pin in its corner, `v5.21.0`, and counts the inputs you pass. But which inputs exist? You read them. The card\'s menu has *Registry page*, which lists every input with its default and every output. This lesson needs `name`, `cidr`, `azs` and `public_subnets`, and reads the `vpc_id` output.',
        pt: 'O cartão no canvas mostra a versão fixada no canto, `v5.21.0`, e conta as entradas que você passa. Mas quais entradas existem? Você lê. O menu do cartão tem *Página no Registry*, que lista cada entrada com seu valor padrão e cada output. Esta lição precisa de `name`, `cidr`, `azs` e `public_subnets`, e lê o output `vpc_id`.',
      },
      {
        en: 'One honest limit: this terminal is a simulation and downloads nothing. `init` acts the download out, and the plan shows the module as a single *not simulated* line instead of its resources. For the same reason the canvas can\'t open it and the security and cost panels skip it. On your machine, `terraform init` puts its code in `.terraform/modules`, where you can read every line.',
        pt: 'Um limite, com honestidade: este terminal é uma simulação e não baixa nada. O `init` encena o download, e o plano mostra o módulo numa única linha *not simulated* em vez dos recursos dele. Pelo mesmo motivo, o canvas não consegue abri-lo e os painéis de segurança e de custo o deixam de fora. Na sua máquina, `terraform init` coloca o código dele em `.terraform/modules`, onde você pode ler cada linha.',
      },
    ],
    asides: [
      {
        title: { en: 'Your own module or one from the Registry?', pt: 'Seu próprio módulo ou um do Registry?' },
        body: [
          {
            en: 'A popular Registry module has been run by thousands of teams: edge cases handled, security fixes shipped, documentation written. In return you inherit its choices, its many inputs, and its upgrades, where a new major version may rename things.',
            pt: 'Um módulo popular do Registry já rodou nas mãos de milhares de times: casos raros tratados, correções de segurança publicadas, documentação escrita. Em troca você herda as escolhas dele, as muitas entradas e as atualizações, em que uma versão principal nova pode renomear coisas.',
          },
          {
            en: 'Your own module is small and fits you exactly, and you maintain it. Either way, read the source before you trust it: a module can create anything your credentials allow.',
            pt: 'O seu próprio módulo é pequeno e serve sob medida, e a manutenção é sua. De um jeito ou de outro, leia o código antes de confiar nele: um módulo pode criar qualquer coisa que as suas credenciais permitam.',
          },
        ],
      },
      {
        title: { en: 'How tight should the pin be?', pt: 'Quão justa deve ser a versão?' },
        body: [
          {
            en: '`version = "5.21.0"` takes exactly that release: nothing changes until you change it. `version = "~> 5.21"` accepts 5.22 and later fixes, but never 6.0. Teams often pin exactly and let a bot propose the upgrades.',
            pt: '`version = "5.21.0"` usa exatamente essa versão: nada muda até você mudar. `version = "~> 5.21"` aceita a 5.22 e as correções seguintes, mas nunca a 6.0. Muitos times fixam a versão exata e deixam um robô propor as atualizações.',
          },
        ],
      },
    ],
    start: aws(`# TODO: a network from the Terraform Registry instead of a folder of your
# own: the module terraform-aws-modules/vpc/aws, pinned to a version.

${SG('\n  # TODO: vpc_id, read from the module\'s vpc_id output\n')}`),
    solution: aws(`${REGISTRY_VPC}\n${SG('  vpc_id      = module.vpc.vpc_id\n')}`),
    goals: [
      {
        id: 'source',
        text: { en: 'A `module` from `terraform-aws-modules/vpc/aws`', pt: 'Um `module` vindo de `terraform-aws-modules/vpc/aws`' },
        hint: {
          en: '`module "vpc" {` with `source = "terraform-aws-modules/vpc/aws"` inside. No `./`: that is how Terraform knows to look in the Registry.',
          pt: '`module "vpc" {` com `source = "terraform-aws-modules/vpc/aws"` dentro. Sem `./`: é assim que o Terraform sabe que deve buscar no Registry.',
        },
        test: callsRegistry(VPC_MODULE),
      },
      {
        id: 'version',
        text: { en: 'A `version` that stays on major version 5', pt: 'Uma `version` que fica na versão principal 5' },
        hint: {
          en: 'Add `version = "5.21.0"` under the `source`. `>= 5.0` isn\'t a pin: it lets version 6 in.',
          pt: 'Adicione `version = "5.21.0"` abaixo do `source`. `>= 5.0` não fixa nada: deixa a versão 6 entrar.',
        },
        test: pinnedTo(VPC_MODULE, 5),
      },
      {
        id: 'inputs',
        text: { en: 'Its inputs: `cidr`, `azs` and `public_subnets`', pt: 'As entradas dele: `cidr`, `azs` e `public_subnets`' },
        hint: {
          en: '`cidr = "10.0.0.0/16"`, `azs = ["us-east-1a", "us-east-1b"]` and `public_subnets = ["10.0.1.0/24", "10.0.2.0/24"]`: one subnet range per zone, in the same order.',
          pt: '`cidr = "10.0.0.0/16"`, `azs = ["us-east-1a", "us-east-1b"]` e `public_subnets = ["10.0.1.0/24", "10.0.2.0/24"]`: um intervalo de sub-rede por zona, na mesma ordem.',
        },
        test: registryInputs(VPC_MODULE, ['cidr', 'azs', 'public_subnets']),
      },
      {
        id: 'use',
        text: { en: 'The security group reads the module\'s `vpc_id`', pt: 'O grupo de segurança lê o `vpc_id` do módulo' },
        hint: {
          en: 'In the security group: `vpc_id = module.vpc.vpc_id`. Outputs read the same way, local module or Registry.',
          pt: 'No grupo de segurança: `vpc_id = module.vpc.vpc_id`. Outputs se leem do mesmo jeito, módulo local ou do Registry.',
        },
        test: fromRegistryOutput('aws_security_group', 'vpc_id', VPC_MODULE, 'vpc_id'),
      },
      {
        id: 'plan',
        text: { en: 'Run `init` and `plan`, and find the module\'s line', pt: 'Rode `init` e `plan`, e encontre a linha do módulo' },
        hint: {
          en: 'After `init`, `terraform plan` lists the security group and one line for `module.vpc`: not simulated here, created for real on your machine.',
          pt: 'Depois do `init`, `terraform plan` lista o grupo de segurança e uma linha para `module.vpc`: não simulado aqui, criado de verdade na sua máquina.',
        },
        test: all(callsRegistry(VPC_MODULE), ran('init'), ran('plan')),
      },
    ],
  },

  /* ------------------------------------------------------------ C6 */
  {
    slug: 'challenge-network-module',
    code: 'C6',
    kind: 'challenge',
    mode: 'code',
    minutes: 20,
    xp: 250,
    title: { en: 'Challenge: your own network module', pt: 'Desafio: seu próprio módulo de rede' },
    summary: {
      en: 'Write a network module from scratch, call it for two environments and put a server in one of them.',
      pt: 'Escreva um módulo de rede do zero, chame-o para dois ambientes e coloque um servidor em um deles.',
    },
    body: [
      {
        en: 'Everything from level 6, in one go. The files in `modules/network/` are empty. Write a module that builds a VPC from a range it receives as an input, with public subnets in at least two availability zones, routed to an internet gateway.',
        pt: 'Tudo do nível 6, de uma vez. Os arquivos em `modules/network/` estão vazios. Escreva um módulo que monta uma VPC a partir de um intervalo recebido como entrada, com sub-redes públicas em pelo menos duas zonas de disponibilidade, roteadas para um internet gateway.',
      },
      {
        en: 'Give it outputs for the VPC id and the subnet ids. Then, in `main.tf`, call it for two environments whose ranges don\'t overlap, and launch a `t3.micro` in a public subnet of one of them, through the module\'s output rather than a pasted id.',
        pt: 'Dê a ele outputs para o id da VPC e para os ids das sub-redes. Depois, no `main.tf`, chame o módulo para dois ambientes cujos intervalos não se sobrepõem, e crie uma `t3.micro` numa sub-rede pública de um deles, pelo output do módulo e não com um id colado.',
      },
      {
        en: 'Names, layout and style are yours: two `module` blocks or one with `for_each`; `count`, `for_each` or separate blocks for the subnets. The goals read the plan, so any code that builds the same thing passes.',
        pt: 'Nomes, organização e estilo ficam por sua conta: dois blocos `module` ou um com `for_each`; `count`, `for_each` ou blocos separados para as sub-redes. Os objetivos leem o plano, então qualquer código que construa a mesma coisa passa.',
      },
      {
        en: 'When it all plans, look at the canvas: two cards, and a line from the server to the card of its environment, because its subnet comes out of that module.',
        pt: 'Quando tudo passar no plano, olhe o canvas: dois cartões, e uma linha do servidor até o cartão do ambiente dele, porque a sub-rede dele sai daquele módulo.',
      },
    ],
    start: aws(
      `# Challenge: a network module of your own, used twice.
#   modules/network: a VPC whose range is an input, public subnets in two
#   availability zones routed to an internet gateway, and outputs for the
#   VPC id and the subnet ids.
#   Here: call it for two environments with ranges that don't overlap, and
#   launch a t3.micro in a public subnet of one of them.
`,
      {
        [`${DIR}/main.tf`]: '# The module\'s resources: the VPC, the internet gateway, the subnets and their routes.\n',
        [`${DIR}/variables.tf`]: '# The module\'s inputs.\n',
        [`${DIR}/outputs.tf`]: '# The module\'s outputs.\n',
      },
    ),
    solution: aws(`${STAGING}\n${PRODUCTION}\n${SERVER}`, MODULE),
    goals: [
      {
        id: 'module',
        text: { en: 'A module whose VPC range is an input', pt: 'Um módulo cujo intervalo da VPC é uma entrada' },
        hint: {
          en: 'In `modules/network/`: a `variable` for the range and an `aws_vpc` with `cidr_block = var.<name>`. Call it from `main.tf` with `source = "./modules/network"`.',
          pt: 'Em `modules/network/`: uma `variable` para o intervalo e um `aws_vpc` com `cidr_block = var.<name>`. Chame o módulo no `main.tf` com `source = "./modules/network"`.',
        },
        test: inModule(fromInput('aws_vpc', 'cidr_block')),
      },
      {
        id: 'public',
        text: { en: 'Public subnets in two zones, in every environment', pt: 'Sub-redes públicas em duas zonas, em todos os ambientes' },
        hint: {
          en: 'Subnets in the module\'s VPC, each with its own `availability_zone`, an `aws_internet_gateway`, and a route table with `0.0.0.0/0` to the gateway, associated with every subnet.',
          pt: 'Sub-redes na VPC do módulo, cada uma com sua própria `availability_zone`, um `aws_internet_gateway` e uma tabela de rotas com `0.0.0.0/0` para o gateway, associada a cada sub-rede.',
        },
        test: all(inModule(publicInside), zonesPerEnv(2, true)),
      },
      {
        id: 'outputs',
        text: { en: 'Outputs for the VPC id and the subnet ids', pt: 'Outputs para o id da VPC e os ids das sub-redes' },
        hint: {
          en: 'Two `output` blocks in the module: one with `value = aws_vpc.<name>.id`, one returning the subnets, like `value = aws_subnet.<name>[*].id`.',
          pt: 'Dois blocos `output` no módulo: um com `value = aws_vpc.<name>.id` e outro que devolve as sub-redes, como `value = aws_subnet.<name>[*].id`.',
        },
        test: inModule(output(undefined, 'aws_vpc'), output(undefined, 'aws_subnet')),
      },
      {
        id: 'envs',
        text: { en: 'Two environments, ranges apart', pt: 'Dois ambientes, intervalos separados' },
        hint: {
          en: 'Two calls (or one with `for_each`), say `10.0.0.0/16` and `10.1.0.0/16`.',
          pt: 'Duas chamadas (ou uma com `for_each`), por exemplo `10.0.0.0/16` e `10.1.0.0/16`.',
        },
        test: all(environments(2), rangesApart),
      },
      {
        id: 'server',
        text: { en: 'A server in a subnet the module returns', pt: 'Um servidor numa sub-rede que o módulo devolve' },
        hint: {
          en: 'An `aws_instance` with `subnet_id = module.<env>.<output>[0]`. Look the image up with a `data "aws_ami"` block, as in level 3.',
          pt: 'Um `aws_instance` com `subnet_id = module.<env>.<output>[0]`. Busque a imagem com um bloco `data "aws_ami"`, como no nível 3.',
        },
        test: fromModuleOutput('aws_instance', 'subnet_id', 'aws_subnet'),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`.',
          pt: 'No terminal: `init`, `plan`, `apply`.',
        },
        test: all(applied('aws_instance'), appliedEnvs(2)),
      },
    ],
  },
];
