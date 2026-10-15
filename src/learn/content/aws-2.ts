/**
 * Level 2 · Network (mixed): the VPC as a box, subnets and CIDR, the way out
 * to the internet, and what really makes a subnet public. The canvas still
 * does most of the work; the route and a few arguments are typed.
 */
import { applied, argIs, has, inside, ran, tagged } from '../goals';
import type { Lesson } from '../types';
import { defaultRouteToIgw, rangesFit, subnetIs, subnetsAcrossZones } from './predicates-23';
import { aws } from './shared';

const VPC = `resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true

  tags = {
    Name = "learn-vpc"
  }
}
`;

const PUBLIC_SUBNET = `resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
}
`;

const ROUTING = `resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
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
`;

export const lessons: Lesson[] = [
  /* ------------------------------------------------------------ 2.1 */
  {
    slug: 'your-vpc',
    code: '2.1',
    kind: 'lesson',
    mode: 'mixed',
    minutes: 7,
    xp: 50,
    title: { en: 'Your VPC', pt: 'Sua VPC' },
    summary: {
      en: 'Drag in a VPC, your own private network, and watch it become a box.',
      pt: 'Arraste uma VPC, sua rede privada, e veja-a virar uma caixa.',
    },
    body: [
      {
        en: 'An S3 bucket lives outside any network you manage. Servers don\'t: they need a network, and on AWS that network is a *VPC*. Picture a fenced plot of land: nothing gets in or out until you build a gate.',
        pt: 'Um bucket S3 vive fora de qualquer rede que você gerencie. Servidores, não: eles precisam de uma rede, e na AWS essa rede é uma *VPC*. Imagine um terreno cercado: nada entra nem sai até você construir um portão.',
      },
      {
        en: 'Drag a *VPC* from the palette onto the canvas. Unlike the bucket, it lands as a *box*: a VPC is a container, and everything that lives in it will be drawn inside it.',
        pt: 'Arraste uma *VPC* da paleta para o canvas. Ao contrário do bucket, ela chega como uma *caixa*: uma VPC é um contêiner, e tudo que viver nela será desenhado lá dentro.',
      },
      {
        en: 'Look at the code that appeared: `cidr_block = "10.0.0.0/16"` is the range of private addresses your network owns, 65,536 of them. The next lesson teaches you to read that number at a glance.',
        pt: 'Olhe o código que apareceu: `cidr_block = "10.0.0.0/16"` é o intervalo de endereços privados da sua rede, 65.536 deles. A próxima lição ensina a ler esse número num relance.',
      },
      {
        en: 'Now type your first lines. In the code, inside the VPC block, add `enable_dns_hostnames = true` so servers with a public IP also get a public DNS name, and a `Name` tag: it\'s the name the AWS console shows. Then `plan` and `apply`.',
        pt: 'Agora digite suas primeiras linhas. No código, dentro do bloco da VPC, adicione `enable_dns_hostnames = true` para que servidores com IP público ganhem também um nome DNS público, e uma tag `Name`: é o nome que o console da AWS mostra. Depois, `plan` e `apply`.',
      },
    ],
    asides: [
      {
        title: { en: 'What is a VPC?', pt: 'O que é uma VPC?' },
        body: [
          {
            en: 'VPC stands for Virtual Private Cloud: a network of your own inside AWS, isolated from every other customer\'s. Each VPC lives in one region (here `us-east-1`, set in the `provider` block) and starts out completely closed.',
            pt: 'VPC significa Virtual Private Cloud (nuvem privada virtual): uma rede só sua dentro da AWS, isolada da de todos os outros clientes. Cada VPC vive em uma região (aqui `us-east-1`, definida no bloco `provider`) e começa completamente fechada.',
          },
          {
            en: 'Every account comes with a *default VPC* in each region, handy for quick experiments. Real projects create their own, so every rule in it is one they chose.',
            pt: 'Toda conta vem com uma *VPC padrão* em cada região, útil para testes rápidos. Projetos de verdade criam a sua própria, para que cada regra nela seja uma escolha deles.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: aws(),
    solution: aws(VPC),
    goals: [
      {
        id: 'vpc',
        text: { en: 'A VPC with `10.0.0.0/16`', pt: 'Uma VPC com `10.0.0.0/16`' },
        hint: {
          en: 'Search the palette for "vpc" and drag *VPC* onto the canvas. It comes with `10.0.0.0/16` already.',
          pt: 'Busque "vpc" na paleta e arraste *VPC* para o canvas. Ela já vem com `10.0.0.0/16`.',
        },
        test: argIs('aws_vpc', 'cidr_block', '10.0.0.0/16'),
      },
      {
        id: 'dns',
        text: { en: '`enable_dns_hostnames = true` on the VPC', pt: '`enable_dns_hostnames = true` na VPC' },
        hint: {
          en: 'In the code panel, put the cursor on a new line inside the VPC block, below `cidr_block`, and type `enable_dns_hostnames = true`. No quotes: it\'s a boolean.',
          pt: 'No painel de código, abra uma linha nova dentro do bloco da VPC, abaixo de `cidr_block`, e digite `enable_dns_hostnames = true`. Sem aspas: é um booleano.',
        },
        test: argIs('aws_vpc', 'enable_dns_hostnames', true),
      },
      {
        id: 'name',
        text: { en: 'A `Name` tag on the VPC', pt: 'Uma tag `Name` na VPC' },
        hint: {
          en: 'Inside the VPC block: `tags = { Name = "learn-vpc" }`. Any name works.',
          pt: 'Dentro do bloco da VPC: `tags = { Name = "learn-vpc" }`. Qualquer nome serve.',
        },
        test: tagged('aws_vpc', 'Name'),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal, run `init`, then `plan` (it should say `1 to add`) and `apply`.',
          pt: 'No terminal, rode `init`, depois `plan` (ele deve dizer `1 to add`) e `apply`.',
        },
        test: applied('aws_vpc'),
      },
    ],
    teaches: ['aws_vpc'],
  },

  /* ------------------------------------------------------------ 2.2 */
  {
    slug: 'subnets-and-cidr',
    code: '2.2',
    kind: 'lesson',
    mode: 'mixed',
    minutes: 9,
    xp: 60,
    title: { en: 'Subnets and CIDR', pt: 'Sub-redes e CIDR' },
    summary: {
      en: 'Split the VPC into subnets in two availability zones, and read CIDR like a postal address.',
      pt: 'Divida a VPC em sub-redes em duas zonas de disponibilidade e leia CIDR como um endereço postal.',
    },
    body: [
      {
        en: 'A VPC is too big to use in one piece. You split it into *subnets*, and each subnet lives in a single *availability zone* (AZ), one of the separate data centers of the region. Two subnets in two AZs means a whole building can go dark and your app keeps running.',
        pt: 'Uma VPC é grande demais para usar como um bloco só. Você a divide em *sub-redes*, e cada sub-rede fica em uma única *zona de disponibilidade* (AZ), um dos data centers separados da região. Duas sub-redes em duas AZs significam que um prédio inteiro pode apagar e sua aplicação continua no ar.',
      },
      {
        en: 'Now that number. Read `10.0.0.0/16` like a postal address: the `/16` says the first 16 bits, the first two numbers, are fixed. So this VPC is the city `10.0`, and every address in it starts that way. A subnet like `10.0.1.0/24` fixes three numbers: it\'s the street `10.0.1`, with 256 houses. One /16 city has room for 256 /24 streets.',
        pt: 'Agora aquele número. Leia `10.0.0.0/16` como um endereço postal: o `/16` diz que os primeiros 16 bits, os dois primeiros números, são fixos. Então esta VPC é a cidade `10.0`, e todo endereço nela começa assim. Uma sub-rede como `10.0.1.0/24` fixa três números: é a rua `10.0.1`, com 256 casas. Uma cidade /16 tem espaço para 256 ruas /24.',
      },
      {
        en: 'Drag a *Subnet* from the palette and drop it *inside* the VPC box. The drop wrote `vpc_id = aws_vpc.main.id`, and that one reference is the only reason the subnet is drawn inside. Delete the line and it pops out; type it back and it jumps in.',
        pt: 'Arraste uma *Sub-rede* da paleta e solte *dentro* da caixa da VPC. O código ganhou `vpc_id = aws_vpc.main.id`, e é só por causa dessa referência que a sub-rede aparece lá dentro. Apague a linha e ela sai; digite de novo e ela volta.',
      },
      {
        en: 'Set its `availability_zone` to `us-east-1a`, then add a second subnet in `us-east-1b`. Shortcut: select the VPC and use the *Address plan* card in the inspector. It shows how much space is left and can split it across zones for you.',
        pt: 'Defina `availability_zone` como `us-east-1a` e depois adicione uma segunda sub-rede em `us-east-1b`. Atalho: selecione a VPC e use o cartão *Plano de endereços* no inspetor. Ele mostra quanto espaço sobra e pode dividir entre as zonas para você.',
      },
    ],
    asides: [
      {
        title: { en: 'Regions and availability zones', pt: 'Regiões e zonas de disponibilidade' },
        body: [
          {
            en: 'A *region* is a part of the world, like `us-east-1` in Virginia. Inside it AWS runs several *availability zones*, `us-east-1a`, `us-east-1b` and so on: groups of data centers with their own power and networking, kilometers apart.',
            pt: 'Uma *região* é uma parte do mundo, como `us-east-1` na Virgínia. Dentro dela a AWS mantém várias *zonas de disponibilidade*, `us-east-1a`, `us-east-1b` e assim por diante: grupos de data centers com energia e rede próprias, a quilômetros uns dos outros.',
          },
          {
            en: 'A subnet, and every server in it, sits in exactly one AZ. Spreading across two is the cheapest insurance in the cloud.',
            pt: 'Uma sub-rede, e cada servidor nela, fica em exatamente uma AZ. Espalhar por duas é o seguro mais barato da nuvem.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'Why 251 and not 256?', pt: 'Por que 251 e não 256?' },
        body: [
          {
            en: 'AWS keeps five addresses in every subnet: the first four (the network itself, the VPC router, DNS and one held for later) and the last one. In `10.0.1.0/24` your servers get `10.0.1.4` to `10.0.1.254`. The address plan card does this math for you.',
            pt: 'A AWS reserva cinco endereços em toda sub-rede: os quatro primeiros (a própria rede, o roteador da VPC, o DNS e um guardado para o futuro) e o último. Em `10.0.1.0/24` seus servidores ficam com `10.0.1.4` a `10.0.1.254`. O cartão do plano de endereços faz essa conta para você.',
          },
        ],
      },
    ],
    start: aws(VPC),
    solution: aws(`${VPC}
resource "aws_subnet" "a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "us-east-1b"
}
`),
    goals: [
      {
        id: 'inside',
        text: { en: 'A subnet drawn inside the VPC', pt: 'Uma sub-rede desenhada dentro da VPC' },
        hint: {
          en: 'Drag *Subnet* from the palette and release it over the VPC box, not beside it. Typing `vpc_id = aws_vpc.main.id` in a subnet block does the same.',
          pt: 'Arraste *Sub-rede* da paleta e solte sobre a caixa da VPC, não ao lado. Digitar `vpc_id = aws_vpc.main.id` num bloco de sub-rede faz o mesmo.',
        },
        test: inside('aws_subnet', 'aws_vpc'),
      },
      {
        id: 'zones',
        text: { en: 'Two subnets in two different availability zones', pt: 'Duas sub-redes em duas zonas de disponibilidade diferentes' },
        hint: {
          en: 'Each subnet needs an `availability_zone`: `us-east-1a` on one, `us-east-1b` on the other. The *Address plan* card on the VPC can create both at once.',
          pt: 'Cada sub-rede precisa de um `availability_zone`: `us-east-1a` em uma, `us-east-1b` na outra. O cartão *Plano de endereços* da VPC cria as duas de uma vez.',
        },
        test: subnetsAcrossZones('any', 2),
      },
      {
        id: 'fit',
        text: { en: 'Their ranges fit in the VPC and don\'t overlap', pt: 'Os intervalos cabem na VPC e não se sobrepõem' },
        hint: {
          en: 'Each subnet gets its own street, like `10.0.1.0/24` and `10.0.2.0/24`. The code panel warns about a range that overlaps another or falls outside `10.0.0.0/16`.',
          pt: 'Cada sub-rede ganha a sua rua, como `10.0.1.0/24` e `10.0.2.0/24`. O painel de código avisa quando um intervalo se sobrepõe a outro ou fica fora de `10.0.0.0/16`.',
        },
        test: rangesFit,
      },
      {
        id: 'plan',
        text: { en: 'Run `terraform plan`', pt: 'Rode `terraform plan`' },
        hint: {
          en: 'In the terminal: `init`, then `plan`. Find both subnets in the list of things to create.',
          pt: 'No terminal: `init` e depois `plan`. Encontre as duas sub-redes na lista do que será criado.',
        },
        test: ran('plan'),
      },
    ],
    teaches: ['aws_subnet'],
  },

  /* ------------------------------------------------------------ 2.3 */
  {
    slug: 'internet-gateway-routes',
    code: '2.3',
    kind: 'lesson',
    mode: 'mixed',
    minutes: 9,
    xp: 60,
    title: { en: 'Internet gateway and routes', pt: 'Internet gateway e rotas' },
    summary: {
      en: 'Give the VPC a gate to the internet, and write the route that leads to it.',
      pt: 'Dê à VPC um portão para a internet e escreva a rota que leva até ele.',
    },
    body: [
      {
        en: 'Your VPC is sealed: nothing inside can reach the internet, and nothing outside can reach in. Time to build the gate promised in lesson 2.1, and the directions that lead to it.',
        pt: 'Sua VPC está lacrada: nada lá dentro alcança a internet, e nada de fora entra. Hora de construir o portão prometido na lição 2.1, e as indicações que levam até ele.',
      },
      {
        en: 'The gate is an *internet gateway*. Drag one from the palette into the VPC box: it attaches through `vpc_id`, just like the subnet. The directions live in a *route table*; drag one into the VPC too.',
        pt: 'O portão é um *internet gateway*. Arraste um da paleta para dentro da caixa da VPC: ele se prende por `vpc_id`, igual à sub-rede. As indicações ficam em uma *tabela de rotas*; arraste uma para dentro da VPC também.',
      },
      {
        en: 'Now type the route itself. Inside the route table block, add a `route` block with `cidr_block = "0.0.0.0/0"` and a `gateway_id` that references your gateway. `0.0.0.0/0` means *any address*: whatever isn\'t inside the VPC goes out through the gate.',
        pt: 'Agora digite a rota em si. Dentro do bloco da tabela de rotas, adicione um bloco `route` com `cidr_block = "0.0.0.0/0"` e um `gateway_id` que referencia o seu gateway. `0.0.0.0/0` quer dizer *qualquer endereço*: o que não estiver dentro da VPC sai pelo portão.',
      },
      {
        en: 'A table only steers the subnets *associated* with it. Drag a *Route Table Association* onto the canvas and connect it, from its right handle, to the subnet and to the table. Then turn on the security lens and watch the subnet\'s badge flip from private to *public*.',
        pt: 'Uma tabela só orienta as sub-redes *associadas* a ela. Arraste uma *Associação de tabela de rotas* para o canvas e conecte-a, pela alça da direita, à sub-rede e à tabela. Depois ative a lente de segurança e veja o selo da sub-rede trocar de privada para *pública*.',
      },
    ],
    asides: [
      {
        title: { en: 'The main route table', pt: 'A tabela de rotas principal' },
        body: [
          {
            en: 'Every VPC is born with a *main* route table that holds a single `local` route: traffic between addresses of the VPC. Any subnet without an association uses it, which is why a new subnet starts private.',
            pt: 'Toda VPC nasce com uma tabela de rotas *principal* que tem uma única rota `local`: o tráfego entre endereços da própria VPC. Toda sub-rede sem associação usa essa tabela, e é por isso que uma sub-rede nova começa privada.',
          },
          {
            en: 'Leaving the main table alone and associating public subnets one by one is the safe habit: a subnet only becomes public because you said so.',
            pt: 'Deixar a tabela principal quieta e associar as sub-redes públicas uma a uma é o hábito seguro: uma sub-rede só fica pública porque você mandou.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: aws(`${VPC}\n${PUBLIC_SUBNET}`),
    solution: aws(`${VPC}\n${PUBLIC_SUBNET}\n${ROUTING}`),
    goals: [
      {
        id: 'igw',
        text: { en: 'An internet gateway in the VPC', pt: 'Um internet gateway na VPC' },
        hint: {
          en: 'Search the palette for "internet" and drop *Internet Gateway* inside the VPC box.',
          pt: 'Busque "internet" na paleta e solte *Internet gateway* dentro da caixa da VPC.',
        },
        test: inside('aws_internet_gateway', 'aws_vpc'),
      },
      {
        id: 'table',
        text: { en: 'A route table in the VPC', pt: 'Uma tabela de rotas na VPC' },
        hint: {
          en: 'Drop a *Route Table* inside the VPC box, or type `vpc_id = aws_vpc.main.id` in its block.',
          pt: 'Solte uma *Tabela de rotas* dentro da caixa da VPC, ou digite `vpc_id = aws_vpc.main.id` no bloco dela.',
        },
        test: inside('aws_route_table', 'aws_vpc'),
      },
      {
        id: 'route',
        text: { en: 'A route that sends `0.0.0.0/0` to the gateway', pt: 'Uma rota que envia `0.0.0.0/0` para o gateway' },
        hint: {
          en: 'Inside the route table block, type a `route` block with two lines: `cidr_block = "0.0.0.0/0"` and `gateway_id = aws_internet_gateway.<name>.id`, using your gateway\'s name from the code.',
          pt: 'Dentro do bloco da tabela de rotas, digite um bloco `route` com duas linhas: `cidr_block = "0.0.0.0/0"` e `gateway_id = aws_internet_gateway.<name>.id`, com o nome do seu gateway que está no código.',
        },
        test: defaultRouteToIgw,
      },
      {
        id: 'associated',
        text: { en: 'The subnet uses that table, so it\'s public', pt: 'A sub-rede usa essa tabela, então ela é pública' },
        hint: {
          en: 'Add a *Route Table Association* and connect it to the subnet and to the table. Typing works too: `subnet_id = aws_subnet.public.id` and `route_table_id = aws_route_table.<name>.id`.',
          pt: 'Adicione uma *Associação de tabela de rotas* e conecte-a à sub-rede e à tabela. Digitar também funciona: `subnet_id = aws_subnet.public.id` e `route_table_id = aws_route_table.<name>.id`.',
        },
        test: subnetIs('public'),
      },
    ],
    teaches: ['aws_internet_gateway', 'aws_route_table', 'aws_route_table_association', 'aws_route'],
  },

  /* ------------------------------------------------------------ 2.4 */
  {
    slug: 'public-vs-private',
    code: '2.4',
    kind: 'lesson',
    mode: 'mixed',
    minutes: 8,
    xp: 60,
    title: { en: 'Public and private subnets', pt: 'Sub-redes públicas e privadas' },
    summary: {
      en: 'What really makes a subnet public, and a private one right beside it.',
      pt: 'O que realmente torna uma sub-rede pública, e uma privada logo ao lado.',
    },
    body: [
      {
        en: 'AWS has no "public" checkbox. A subnet is public for one reason only: its route table sends `0.0.0.0/0` to an internet gateway. You built that in the last lesson, and it\'s exactly what the security lens checks.',
        pt: 'A AWS não tem uma caixinha de "pública". Uma sub-rede é pública por um único motivo: a tabela de rotas dela envia `0.0.0.0/0` para um internet gateway. Você construiu isso na lição anterior, e é exatamente o que a lente de segurança verifica.',
      },
      {
        en: 'A route is only half the way in, though. A server also needs a *public IP address*, or the internet has no number to call. Type `map_public_ip_on_launch = true` in the public subnet: every server launched there gets one automatically.',
        pt: 'Mas a rota é só metade do caminho. Um servidor também precisa de um *endereço IP público*, senão a internet não tem para que número ligar. Digite `map_public_ip_on_launch = true` na sub-rede pública: todo servidor criado nela ganha um automaticamente.',
      },
      {
        en: 'Now the private side. Drag a second subnet into the VPC and *don\'t* associate it with anything. Without an association it uses the VPC\'s main route table, which only knows the VPC itself. Databases and internal services live here: nobody on the internet can even address them.',
        pt: 'Agora o lado privado. Arraste uma segunda sub-rede para dentro da VPC e *não* a associe a nada. Sem associação ela usa a tabela de rotas principal da VPC, que só conhece a própria VPC. Bancos de dados e serviços internos moram aqui: ninguém na internet consegue sequer endereçá-los.',
      },
      {
        en: 'Turn on the security lens and compare the two boxes. Same VPC, same size, one *public* and one *private*. All that separates them is the association and its two lines.',
        pt: 'Ative a lente de segurança e compare as duas caixas. Mesma VPC, mesmo tamanho, uma *pública* e uma *privada*. Tudo que as separa é a associação e suas duas linhas.',
      },
    ],
    asides: [
      {
        title: { en: 'How does a private server get updates?', pt: 'Como um servidor privado recebe atualizações?' },
        body: [
          {
            en: 'Sometimes a private server must *call out*, to download updates, without ever being reachable. That\'s a *NAT gateway*: it sits in a public subnet and lets private subnets go out, never in.',
            pt: 'Às vezes um servidor privado precisa *chamar para fora*, para baixar atualizações, sem nunca ficar acessível. Para isso existe o *NAT gateway*: ele fica numa sub-rede pública e deixa as sub-redes privadas saírem, nunca entrarem.',
          },
          {
            en: 'It costs about $33 a month plus traffic, so this course leaves it out. Now you know where it would go.',
            pt: 'Ele custa cerca de US$ 33 por mês mais o tráfego, então este curso fica sem ele. Agora você sabe onde ele entraria.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: aws(`${VPC}\n${PUBLIC_SUBNET}\n${ROUTING}`),
    solution: aws(`${VPC}
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
}

resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "us-east-1a"
}

${ROUTING}`),
    goals: [
      {
        id: 'public-ip',
        text: { en: 'The public subnet hands out public IPs', pt: 'A sub-rede pública distribui IPs públicos' },
        hint: {
          en: 'Inside the public subnet\'s block, type `map_public_ip_on_launch = true`. The inspector has the same switch.',
          pt: 'Dentro do bloco da sub-rede pública, digite `map_public_ip_on_launch = true`. O inspetor tem a mesma chave.',
        },
        test: subnetIs('public', true),
      },
      {
        id: 'private',
        text: {
          en: 'A private subnet beside it, in its own range, with no public IPs',
          pt: 'Uma sub-rede privada ao lado, no seu próprio intervalo, sem IPs públicos',
        },
        hint: {
          en: 'Drag another *Subnet* into the VPC box and leave it without an association. The drop picks a free range for it, like `10.0.2.0/24`.',
          pt: 'Arraste outra *Sub-rede* para dentro da caixa da VPC e deixe sem associação. Ela já chega com um intervalo livre, como `10.0.2.0/24`.',
        },
        test: (ctx) => subnetIs('private', false)(ctx) && rangesFit(ctx),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan` (read what it will create), then `apply`.',
          pt: 'No terminal: `init`, `plan` (leia o que ele vai criar) e depois `apply`.',
        },
        test: applied('aws_subnet'),
      },
    ],
    teaches: ['aws_subnet'],
  },

  /* ------------------------------------------------------------ C2 */
  {
    slug: 'challenge-two-az-network',
    code: 'C2',
    kind: 'challenge',
    mode: 'mixed',
    minutes: 15,
    xp: 175,
    title: { en: 'Challenge: a network in two zones', pt: 'Desafio: uma rede em duas zonas' },
    summary: {
      en: 'Build a production-shaped network: public and private subnets in two availability zones.',
      pt: 'Monte uma rede com cara de produção: sub-redes públicas e privadas em duas zonas de disponibilidade.',
    },
    body: [
      {
        en: 'Time to put level 2 together. Most real AWS networks share one shape: in each of two availability zones, a *public* subnet for what the internet must reach, and a *private* subnet for everything else.',
        pt: 'Hora de juntar o nível 2. A maioria das redes reais na AWS tem o mesmo formato: em cada uma de duas zonas de disponibilidade, uma sub-rede *pública* para o que a internet precisa alcançar e uma *privada* para todo o resto.',
      },
      {
        en: 'Build it from an empty file: a VPC, an internet gateway, two public subnets routed to it and two private subnets, spread across two AZs. Canvas, code or both; the names are yours, and if you know `count`, it works as well as separate blocks.',
        pt: 'Monte a partir de um arquivo vazio: uma VPC, um internet gateway, duas sub-redes públicas roteadas para ele e duas privadas, espalhadas por duas AZs. Canvas, código ou os dois; os nomes são seus, e se você conhece `count`, ele funciona tão bem quanto blocos separados.',
      },
      {
        en: 'Tip: one route table can serve both public subnets, with one association each. The *Address plan* card on the VPC hands out ranges that never overlap.',
        pt: 'Dica: uma tabela de rotas pode atender as duas sub-redes públicas, com uma associação para cada. O cartão *Plano de endereços* da VPC entrega intervalos que nunca se sobrepõem.',
      },
    ],
    start: aws(`# Challenge: a VPC with an internet gateway, two public and two private
# subnets, spread across two availability zones.
`),
    solution: aws(`${VPC}
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "us-east-1b"
  map_public_ip_on_launch = true
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.12.0/24"
  availability_zone = "us-east-1b"
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}
`),
    goals: [
      {
        id: 'igw',
        text: { en: 'A VPC with an internet gateway', pt: 'Uma VPC com um internet gateway' },
        hint: {
          en: 'A VPC first, then an *Internet Gateway* dropped inside it (`vpc_id`).',
          pt: 'Primeiro uma VPC, depois um *Internet gateway* dentro dela (`vpc_id`).',
        },
        test: (ctx) => has('aws_vpc')(ctx) && inside('aws_internet_gateway', 'aws_vpc')(ctx),
      },
      {
        id: 'public',
        text: { en: 'Two public subnets, in two different AZs', pt: 'Duas sub-redes públicas, em duas AZs diferentes' },
        hint: {
          en: 'A subnet is public when it\'s associated with a route table that sends `0.0.0.0/0` to the internet gateway. Give the two a different `availability_zone` each.',
          pt: 'Uma sub-rede é pública quando está associada a uma tabela de rotas que envia `0.0.0.0/0` para o internet gateway. Dê a cada uma um `availability_zone` diferente.',
        },
        test: subnetsAcrossZones('public', 2),
      },
      {
        id: 'private',
        text: { en: 'Two private subnets, in two different AZs', pt: 'Duas sub-redes privadas, em duas AZs diferentes' },
        hint: {
          en: 'Subnets without an association stay private. Two of them, one per zone.',
          pt: 'Sub-redes sem associação continuam privadas. Duas delas, uma por zona.',
        },
        test: subnetsAcrossZones('private', 2),
      },
      {
        id: 'fit',
        text: { en: 'Every range fits in the VPC, with no overlaps', pt: 'Todo intervalo cabe na VPC, sem sobreposições' },
        hint: {
          en: 'Four streets in one city: `10.0.1.0/24`, `10.0.2.0/24`, `10.0.11.0/24` and `10.0.12.0/24` work, and so does anything the address plan card picks.',
          pt: 'Quatro ruas numa cidade: `10.0.1.0/24`, `10.0.2.0/24`, `10.0.11.0/24` e `10.0.12.0/24` funcionam, assim como qualquer coisa que o cartão do plano de endereços escolher.',
        },
        test: rangesFit,
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. Count the subnets in the plan before you confirm.',
          pt: 'No terminal: `init`, `plan`, `apply`. Conte as sub-redes no plano antes de confirmar.',
        },
        test: applied('aws_subnet'),
      },
    ],
  },
];
