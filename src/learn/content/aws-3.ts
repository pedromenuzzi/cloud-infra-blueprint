/**
 * Level 3 · Compute and security (code): the learner types, the canvas draws.
 * The network from level 2 sits in `network.tf`; each lesson writes in
 * `main.tf`. The security audit is the feedback loop: its findings and grade
 * are goals.
 */
import { applied, argIs, argRefs, argSet, hasData, inside, noErrors, noFinding } from '../goals';
import type { Lesson } from '../types';
import {
  allowsOutbound,
  grade,
  inSubnet,
  opensToInternet,
  reachableOn,
  roleTrusts,
} from './predicates-23';
import { aws } from './shared';

/** the network from level 2: a VPC with one public subnet, routed to an internet gateway */
const NETWORK = `# The network from level 2: a VPC with one public subnet.

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true

  tags = {
    Name = "learn-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
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

/** `main.tf` (after the AWS header) and the network beside it */
const level3 = (body: string) => aws(body, { 'network.tf': NETWORK });

const WEB_SG = `resource "aws_security_group" "web" {
  name        = "web"
  description = "HTTPS in, everything out"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Everything out"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
`;

const AMI = `data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}
`;

const INSTANCE = `resource "aws_instance" "web" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
}
`;

/** the instance once 3.3 has locked it down */
const LOCKED_INSTANCE = `resource "aws_instance" "web" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]

  metadata_options {
    http_tokens = "required"
  }
}
`;

const RISKY_SG = `resource "aws_security_group" "web" {
  name        = "web"
  description = "Web server"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Opened "for five minutes" to debug something, last year.
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # A load test that ended long ago.
  ingress {
    description = "Test ports"
    from_port   = 8000
    to_port     = 8999
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Everything out"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
`;

const IAM = `resource "aws_iam_role" "web" {
  name = "web-server"

  # The trust policy: who may assume this role. Here, the EC2 service.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.web.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "web" {
  name = "web-server"
  role = aws_iam_role.web.name
}
`;

export const lessons: Lesson[] = [
  /* ------------------------------------------------------------ 3.1 */
  {
    slug: 'security-groups',
    code: '3.1',
    kind: 'lesson',
    mode: 'code',
    minutes: 9,
    xp: 60,
    title: { en: 'Security groups', pt: 'Grupos de segurança' },
    summary: {
      en: 'Type your first firewall by hand: what may come in, what may go out.',
      pt: 'Digite seu primeiro firewall à mão: o que pode entrar e o que pode sair.',
    },
    body: [
      {
        en: 'From here on you type and the canvas draws. Notice the new `network.tf` tab: it holds the network from level 2. Terraform reads every `.tf` file in the folder as one configuration, so you split code however it reads best.',
        pt: 'Daqui em diante você digita e o canvas desenha. Repare na nova aba `network.tf`: ela guarda a rede do nível 2. O Terraform lê todos os arquivos `.tf` da pasta como uma configuração só, então você divide o código do jeito que ficar mais legível.',
      },
      {
        en: 'A *security group* is a firewall wrapped around a resource, and out of the box it lets nothing in. Each `ingress` block opens one door: a protocol, a range of ports (`from_port` to `to_port`) and who may knock (`cidr_blocks`). `egress` blocks do the same for traffic going out.',
        pt: 'Um *grupo de segurança* é um firewall em volta de um recurso, e de fábrica ele não deixa nada entrar. Cada bloco `ingress` abre uma porta: um protocolo, uma faixa de portas (de `from_port` até `to_port`) e quem pode bater (`cidr_blocks`). Blocos `egress` fazem o mesmo para o tráfego que sai.',
      },
      {
        en: 'It\'s also *stateful*: it remembers conversations. Let HTTPS in and the replies find their way out on their own. One catch: Terraform removes the allow-all outbound rule AWS adds by default, so write your own `egress`, or the server can\'t even download updates.',
        pt: 'Ele também é *com estado* (stateful): lembra das conversas. Deixe o HTTPS entrar e as respostas acham sozinhas o caminho de volta. Um detalhe: o Terraform remove a regra que a AWS cria por padrão liberando toda a saída, então escreva o seu próprio `egress`, ou o servidor não consegue nem baixar atualizações.',
      },
      {
        en: 'In `main.tf`, write a `resource "aws_security_group"` with `vpc_id = aws_vpc.main.id` and watch the group appear inside the VPC box. Then open the security panel: the audit notes the group *isn\'t attached to anything*. True, and the next lesson attaches it.',
        pt: 'No `main.tf`, escreva um `resource "aws_security_group"` com `vpc_id = aws_vpc.main.id` e veja o grupo aparecer dentro da caixa da VPC. Depois abra o painel de segurança: a auditoria avisa que o grupo *não está associado a nada*. É verdade, e a próxima lição associa.',
      },
    ],
    asides: [
      {
        title: { en: 'Security group or network ACL?', pt: 'Grupo de segurança ou ACL de rede?' },
        body: [
          {
            en: 'AWS has two firewalls. A *security group* wraps each resource and is stateful. A *network ACL* guards a whole subnet, is stateless (replies need rules of their own) and checks numbered rules in order.',
            pt: 'A AWS tem dois firewalls. Um *grupo de segurança* envolve cada recurso e é com estado. Uma *ACL de rede* protege uma sub-rede inteira, é sem estado (as respostas precisam de regras próprias) e confere regras numeradas, em ordem.',
          },
          {
            en: 'Most designs keep the default network ACL, which allows everything, and do the real work in security groups.',
            pt: 'A maioria dos projetos mantém a ACL de rede padrão, que libera tudo, e faz o trabalho de verdade nos grupos de segurança.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'Inline blocks or separate rules?', pt: 'Blocos dentro do grupo ou regras separadas?' },
        body: [
          {
            en: 'Each rule can also be a resource of its own, `aws_vpc_security_group_ingress_rule` or `aws_vpc_security_group_egress_rule`, which the AWS provider recommends for groups that grow. Inline blocks read better while you learn. Both pass every goal here; just don\'t mix the two styles on one group.',
            pt: 'Cada regra também pode ser um recurso próprio, `aws_vpc_security_group_ingress_rule` ou `aws_vpc_security_group_egress_rule`, que o provider da AWS recomenda para grupos que crescem. Blocos dentro do grupo são mais fáceis de ler enquanto você aprende. Os dois estilos passam em todos os objetivos daqui; só não misture os dois no mesmo grupo.',
          },
        ],
      },
    ],
    start: level3(`# TODO: a security group for a web server, in the VPC from network.tf.
#   in:  HTTPS (TCP 443) from anywhere
#   out: everything
`),
    solution: level3(WEB_SG),
    goals: [
      {
        id: 'sg',
        text: { en: 'A security group inside the VPC', pt: 'Um grupo de segurança dentro da VPC' },
        hint: {
          en: '`resource "aws_security_group" "web" {` on one line, `vpc_id = aws_vpc.main.id` on the next, then `}`. Any name works.',
          pt: '`resource "aws_security_group" "web" {` numa linha, `vpc_id = aws_vpc.main.id` na seguinte e depois `}`. Qualquer nome serve.',
        },
        test: inside('aws_security_group', 'aws_vpc'),
      },
      {
        id: 'description',
        text: { en: 'A `description` that says what it\'s for', pt: 'Uma `description` que diz para que ele serve' },
        hint: {
          en: 'Add `description = "HTTPS in, everything out"`. Write it now: AWS can\'t change a group\'s description later without replacing the whole group.',
          pt: 'Adicione `description = "HTTPS in, everything out"`. Escreva agora: a AWS não consegue mudar a descrição de um grupo depois sem substituir o grupo inteiro.',
        },
        test: argSet('aws_security_group', 'description'),
      },
      {
        id: 'https',
        text: {
          en: 'HTTPS (443) allowed in from anywhere, and nothing riskier',
          pt: 'HTTPS (443) liberado de qualquer lugar, e nada mais arriscado',
        },
        hint: {
          en: 'An `ingress` block with `from_port = 443`, `to_port = 443`, `protocol = "tcp"` and `cidr_blocks = ["0.0.0.0/0"]`.',
          pt: 'Um bloco `ingress` com `from_port = 443`, `to_port = 443`, `protocol = "tcp"` e `cidr_blocks = ["0.0.0.0/0"]`.',
        },
        test: (ctx) => opensToInternet(443)(ctx) && noFinding(/open to the internet/)(ctx),
      },
      {
        id: 'egress',
        text: { en: 'Outbound traffic allowed', pt: 'Tráfego de saída liberado' },
        hint: {
          en: 'An `egress` block with `from_port = 0`, `to_port = 0`, `protocol = "-1"` (every protocol) and `cidr_blocks = ["0.0.0.0/0"]`.',
          pt: 'Um bloco `egress` com `from_port = 0`, `to_port = 0`, `protocol = "-1"` (todos os protocolos) e `cidr_blocks = ["0.0.0.0/0"]`.',
        },
        test: allowsOutbound,
      },
      {
        id: 'valid',
        text: { en: 'The code is valid', pt: 'O código é válido' },
        hint: {
          en: 'Look for red marks in the code panel. Every block needs its closing `}`, and lists go in square brackets.',
          pt: 'Procure marcas vermelhas no painel de código. Todo bloco precisa do seu `}` de fechamento, e listas vão entre colchetes.',
        },
        test: noErrors,
      },
    ],
    teaches: ['aws_security_group', 'aws_vpc_security_group_ingress_rule', 'aws_vpc_security_group_egress_rule'],
  },

  /* ------------------------------------------------------------ 3.2 */
  {
    slug: 'ec2-in-a-subnet',
    code: '3.2',
    kind: 'lesson',
    mode: 'code',
    minutes: 10,
    xp: 70,
    title: { en: 'A server in the subnet', pt: 'Um servidor na sub-rede' },
    summary: {
      en: 'Launch an EC2 instance in the public subnet, behind your security group.',
      pt: 'Crie uma instância EC2 na sub-rede pública, atrás do seu grupo de segurança.',
    },
    body: [
      {
        en: '*EC2* is AWS\'s service for virtual machines. An `aws_instance` needs two things: an `ami`, the disk image it boots from, and an `instance_type`, the size of the machine. `t3.micro` is small and cheap.',
        pt: 'O *EC2* é o serviço de máquinas virtuais da AWS. Um `aws_instance` precisa de duas coisas: um `ami`, a imagem de disco de onde ela inicializa, e um `instance_type`, o tamanho da máquina. `t3.micro` é pequena e barata.',
      },
      {
        en: 'AMI ids differ per region and change with every release, so don\'t paste one: *look it up*. A `data` block reads something that already exists instead of creating it. `data "aws_ami"` asks AWS for the newest Amazon Linux image, and you use the answer as `data.aws_ami.al2023.id`.',
        pt: 'Os ids de AMI mudam de região para região e a cada versão, então não cole um: *busque*. Um bloco `data` lê algo que já existe em vez de criar. `data "aws_ami"` pede à AWS a imagem mais recente do Amazon Linux, e você usa a resposta como `data.aws_ami.al2023.id`.',
      },
      {
        en: 'Then place the server: `subnet_id` puts it in the public subnet, and `vpc_security_group_ids` (a list) puts the group around it. Watch the canvas while you type: the instance drops into the subnet, two boxes deep (subnet, then VPC), and a dashed line ties it to its security group.',
        pt: 'Depois posicione o servidor: `subnet_id` o coloca na sub-rede pública, e `vpc_security_group_ids` (uma lista) põe o grupo em volta dele. Olhe o canvas enquanto digita: a instância cai dentro da sub-rede, duas caixas de profundidade (sub-rede, depois VPC), e uma linha tracejada a liga ao seu grupo de segurança.',
      },
      {
        en: 'Peek at the security panel: the *not attached* note from last lesson is gone, and a new finding about IMDSv1 showed up. Leave it for now: the next lesson is all about findings.',
        pt: 'Dê uma olhada no painel de segurança: o aviso de *não associado* da lição anterior sumiu, e apareceu um achado novo sobre IMDSv1. Por enquanto, deixe como está: a próxima lição é toda sobre achados.',
      },
    ],
    asides: [
      {
        title: { en: 'What is an AMI?', pt: 'O que é uma AMI?' },
        body: [
          {
            en: 'An Amazon Machine Image is a template for the server\'s disk: an operating system plus whatever comes preinstalled. Amazon, software vendors and the community publish thousands of them; `owners = ["amazon"]` keeps you on Amazon\'s own.',
            pt: 'Uma Amazon Machine Image é um modelo do disco do servidor: um sistema operacional e o que mais vier instalado. A Amazon, fornecedores de software e a comunidade publicam milhares delas; `owners = ["amazon"]` garante que você use as da própria Amazon.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: level3(`${WEB_SG}
# TODO 1: look up the newest Amazon Linux 2023 image with a data "aws_ami" block.
# TODO 2: an aws_instance (t3.micro) booting from it, in the public subnet,
#         protected by the security group above.
`),
    solution: level3(`${WEB_SG}\n${AMI}\n${INSTANCE}`),
    goals: [
      {
        id: 'ami',
        text: { en: 'An image looked up with `data "aws_ami"`', pt: 'Uma imagem buscada com `data "aws_ami"`' },
        hint: {
          en: 'Open it with `data "aws_ami" "al2023" {`, then `most_recent = true`, `owners = ["amazon"]` and a `filter` block with `name = "name"` and `values = ["al2023-ami-*-x86_64"]`.',
          pt: 'Abra com `data "aws_ami" "al2023" {`, depois `most_recent = true`, `owners = ["amazon"]` e um bloco `filter` com `name = "name"` e `values = ["al2023-ami-*-x86_64"]`.',
        },
        test: hasData('aws_ami'),
      },
      {
        id: 'instance',
        text: { en: 'An instance that boots from it', pt: 'Uma instância que inicializa a partir dela' },
        hint: {
          en: 'Inside `resource "aws_instance" "web" {`: `ami = data.aws_ami.al2023.id` and `instance_type = "t3.micro"`.',
          pt: 'Dentro de `resource "aws_instance" "web" {`: `ami = data.aws_ami.al2023.id` e `instance_type = "t3.micro"`.',
        },
        test: argRefs('aws_instance', 'ami', 'aws_ami'),
      },
      {
        id: 'subnet',
        text: { en: 'Drawn inside the public subnet', pt: 'Desenhada dentro da sub-rede pública' },
        hint: {
          en: 'Add `subnet_id = aws_subnet.public.id` to the instance.',
          pt: 'Adicione `subnet_id = aws_subnet.public.id` à instância.',
        },
        test: inside('aws_instance', 'aws_subnet'),
      },
      {
        id: 'sg',
        text: { en: 'Protected by your security group', pt: 'Protegida pelo seu grupo de segurança' },
        hint: {
          en: 'Add `vpc_security_group_ids = [aws_security_group.web.id]`. Square brackets: it\'s a list, since a server can wear several groups.',
          pt: 'Adicione `vpc_security_group_ids = [aws_security_group.web.id]`. Colchetes: é uma lista, porque um servidor pode ter vários grupos.',
        },
        test: argRefs('aws_instance', 'vpc_security_group_ids', 'aws_security_group'),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. The plan reads the image first, then creates everything else.',
          pt: 'No terminal: `init`, `plan`, `apply`. O plano lê a imagem primeiro e depois cria todo o resto.',
        },
        test: applied('aws_instance'),
      },
    ],
    teaches: ['aws_instance'],
  },

  /* ------------------------------------------------------------ 3.3 */
  {
    slug: 'lock-it-down',
    code: '3.3',
    kind: 'lesson',
    mode: 'code',
    minutes: 10,
    xp: 70,
    title: { en: 'Lock it down', pt: 'Feche as portas' },
    summary: {
      en: 'A risky server is waiting. Let the security findings guide your fixes until the audit says A.',
      pt: 'Um servidor arriscado espera por você. Deixe os achados de segurança guiarem as correções até a auditoria dar A.',
    },
    body: [
      {
        en: 'This server works, and it\'s a mess. Someone opened SSH to the whole internet to debug something, a thousand ports for a load test, and nobody ever closed them. Open the security panel: a poor grade, and a list of findings, worst first.',
        pt: 'Este servidor funciona, e está uma bagunça. Alguém abriu o SSH para a internet inteira para depurar algo, mil portas para um teste de carga, e ninguém nunca fechou. Abra o painel de segurança: uma nota ruim e uma lista de achados, os piores primeiro.',
      },
      {
        en: 'Work from the top. Each finding names the rule and explains the risk; fix it in the code and watch it disappear. Deleting a rule is a perfectly good fix. The panel offers one-click fixes too, but typing them is how you learn what they change.',
        pt: 'Comece pelo topo. Cada achado aponta a regra e explica o risco; corrija no código e veja o achado sumir. Apagar uma regra é uma correção perfeitamente boa. O painel também oferece correções com um clique, mas digitar é como você aprende o que elas mudam.',
      },
      {
        en: 'About SSH: the safest number of open admin ports is zero. In the next lesson the server gets an IAM role, and with it you can open a shell through AWS Systems Manager without any inbound port at all.',
        pt: 'Sobre o SSH: o número mais seguro de portas de administração abertas é zero. Na próxima lição o servidor ganha um perfil do IAM, e com ele você abre um terminal pelo AWS Systems Manager sem nenhuma porta de entrada.',
      },
      {
        en: '*IMDSv1* is the subtle one. Every instance can ask a metadata service at `169.254.169.254` for its own credentials. Version 1 answers any request, so a bug that makes your app fetch a URL for someone can leak them. A `metadata_options` block with `http_tokens = "required"` switches to version 2, which demands a token first.',
        pt: 'O *IMDSv1* é o mais sutil. Toda instância pode pedir as próprias credenciais a um serviço de metadados em `169.254.169.254`. A versão 1 responde a qualquer requisição, então um bug que faça sua aplicação buscar uma URL a pedido de alguém pode vazá-las. Um bloco `metadata_options` com `http_tokens = "required"` muda para a versão 2, que exige um token antes.',
      },
    ],
    start: level3(`${AMI}
# Something here is not right. Ask the security panel.
${RISKY_SG}
${INSTANCE}`),
    solution: level3(`${AMI}\n${WEB_SG}\n${LOCKED_INSTANCE}`),
    goals: [
      {
        id: 'ssh',
        text: { en: 'SSH no longer open to the internet', pt: 'SSH não está mais aberto para a internet' },
        hint: {
          en: 'Delete the `ingress` block for port 22. If you truly need SSH, limit `cidr_blocks` to your own address, like `["203.0.113.10/32"]`.',
          pt: 'Apague o bloco `ingress` da porta 22. Se você realmente precisar de SSH, limite `cidr_blocks` ao seu próprio endereço, como `["203.0.113.10/32"]`.',
        },
        test: noFinding(/SSH/),
      },
      {
        id: 'ports',
        text: { en: 'The wide port range closed', pt: 'A faixa ampla de portas fechada' },
        hint: {
          en: 'The block from `8000` to `8999` lets anyone try a thousand ports. The test is over: delete it.',
          pt: 'O bloco de `8000` a `8999` deixa qualquer um tentar mil portas. O teste acabou: apague.',
        },
        test: noFinding(/^Wide port range/),
      },
      {
        id: 'imds',
        text: { en: 'The instance requires IMDSv2', pt: 'A instância exige IMDSv2' },
        hint: {
          en: 'Inside the instance, add a `metadata_options` block containing `http_tokens = "required"`.',
          pt: 'Dentro da instância, adicione um bloco `metadata_options` contendo `http_tokens = "required"`.',
        },
        test: noFinding(/IMDSv1/),
      },
      {
        id: 'https',
        text: { en: 'The site is still reachable on 443', pt: 'O site continua acessível na 443' },
        hint: {
          en: 'Keep the `ingress` block for 443: locking down doesn\'t mean switching off.',
          pt: 'Mantenha o bloco `ingress` da 443: fechar as portas não é desligar o servidor.',
        },
        test: reachableOn('aws_instance', [443]),
      },
      {
        id: 'grade',
        text: { en: 'The security audit grades it A', pt: 'A auditoria de segurança dá nota A' },
        hint: {
          en: 'Read what\'s left in the security panel: each finding says what to change.',
          pt: 'Leia o que sobrou no painel de segurança: cada achado diz o que mudar.',
        },
        test: grade('A'),
      },
    ],
    teaches: ['aws_security_group', 'aws_instance'],
  },

  /* ------------------------------------------------------------ 3.4 */
  {
    slug: 'iam-role-for-ec2',
    code: '3.4',
    kind: 'lesson',
    mode: 'code',
    minutes: 10,
    xp: 70,
    title: { en: 'An IAM role for the server', pt: 'Um perfil do IAM para o servidor' },
    summary: {
      en: 'Give the server an identity with just the permissions it needs, and no keys on disk.',
      pt: 'Dê ao servidor uma identidade com apenas as permissões de que ele precisa, e nenhuma chave no disco.',
    },
    body: [
      {
        en: 'Servers often need to call AWS: read a bucket, write logs. The wrong way is copying access keys onto the disk. The right way is an *IAM role*: an identity the server *assumes*, with short-lived credentials AWS rotates for you, served by the metadata service you just locked down.',
        pt: 'Servidores muitas vezes precisam chamar a AWS: ler um bucket, gravar logs. O jeito errado é copiar chaves de acesso para o disco. O jeito certo é um *perfil do IAM*: uma identidade que o servidor *assume*, com credenciais de vida curta que a AWS renova para você, entregues pelo serviço de metadados que você acabou de proteger.',
      },
      {
        en: 'A role carries two kinds of policy. The *trust policy* (`assume_role_policy`) says *who* may wear it: here, the EC2 service. *Permission* policies say what the wearer may do. Attach the AWS managed policy `AmazonSSMManagedInstanceCore` and Systems Manager can open a shell on the server: the SSH replacement promised last lesson.',
        pt: 'Um perfil carrega dois tipos de política. A *política de confiança* (`assume_role_policy`) diz *quem* pode usá-lo: aqui, o serviço EC2. As políticas de *permissão* dizem o que quem o usa pode fazer. Anexe a política gerenciada da AWS `AmazonSSMManagedInstanceCore` e o Systems Manager consegue abrir um terminal no servidor: o substituto do SSH prometido na lição anterior.',
      },
      {
        en: 'One more piece: EC2 doesn\'t take a role directly. It takes an *instance profile*, a thin wrapper around one role. Create an `aws_iam_instance_profile` whose `role` is your role\'s name, then set `iam_instance_profile` on the instance.',
        pt: 'Falta uma peça: o EC2 não recebe um perfil do IAM diretamente. Ele recebe um *perfil de instância* (instance profile), um invólucro fino em volta de um perfil do IAM. Crie um `aws_iam_instance_profile` cujo `role` é o nome do seu perfil e depois defina `iam_instance_profile` na instância.',
      },
      {
        en: 'Then follow the lines on the canvas: from the instance to the instance profile, from there to the role, and from the policy attachment to the role too. Identity is wiring as well, drawn from the same kind of references that put the server in its subnet.',
        pt: 'Depois siga as linhas no canvas: da instância ao perfil de instância, dele ao perfil do IAM, e também do anexo da política ao perfil do IAM. Identidade também é fiação, desenhada pelo mesmo tipo de referência que pôs o servidor na sub-rede.',
      },
    ],
    asides: [
      {
        title: { en: 'What is IAM?', pt: 'O que é o IAM?' },
        body: [
          {
            en: 'IAM (Identity and Access Management) decides who may do what in an AWS account. *Users* are people, with passwords or long-lived keys. *Roles* have no password at all: a service or a person assumes one for a while and gets temporary credentials.',
            pt: 'O IAM (Identity and Access Management) decide quem pode fazer o quê numa conta da AWS. *Usuários* são pessoas, com senhas ou chaves de longa duração. *Perfis* não têm senha nenhuma: um serviço ou uma pessoa assume um por um tempo e recebe credenciais temporárias.',
          },
          {
            en: 'Every policy starts from "deny everything" and adds only what\'s listed. Grant the least you can.',
            pt: 'Toda política parte de "negar tudo" e acrescenta só o que está listado. Conceda o mínimo possível.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: level3(`${AMI}
${WEB_SG}
# TODO 1: an aws_iam_role that the EC2 service may assume.
# TODO 2: attach the AWS managed policy AmazonSSMManagedInstanceCore to it.
# TODO 3: an aws_iam_instance_profile wrapping the role, used by the instance below.

${LOCKED_INSTANCE}`),
    solution: level3(`${AMI}
${WEB_SG}
${IAM}
resource "aws_instance" "web" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.web.name

  metadata_options {
    http_tokens = "required"
  }
}
`),
    goals: [
      {
        id: 'role',
        text: { en: 'A role that EC2 may assume', pt: 'Um perfil do IAM que o EC2 pode assumir' },
        hint: {
          en: 'In an `aws_iam_role`, set `assume_role_policy = jsonencode({ ... })` with a statement that allows `sts:AssumeRole` for `Principal = { Service = "ec2.amazonaws.com" }`.',
          pt: 'Num `aws_iam_role`, defina `assume_role_policy = jsonencode({ ... })` com uma declaração que permite `sts:AssumeRole` para `Principal = { Service = "ec2.amazonaws.com" }`.',
        },
        test: roleTrusts('ec2.amazonaws.com'),
      },
      {
        id: 'ssm',
        text: { en: 'The role may use Systems Manager', pt: 'O perfil pode usar o Systems Manager' },
        hint: {
          en: 'An `aws_iam_role_policy_attachment` with `role = aws_iam_role.<name>.name` and `policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"`.',
          pt: 'Um `aws_iam_role_policy_attachment` com `role = aws_iam_role.<name>.name` e `policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"`.',
        },
        test: (ctx) =>
          argIs('aws_iam_role_policy_attachment', 'policy_arn', /AmazonSSMManagedInstanceCore$/)(ctx) &&
          argRefs('aws_iam_role_policy_attachment', 'role', 'aws_iam_role')(ctx),
      },
      {
        id: 'profile',
        text: { en: 'An instance profile around the role', pt: 'Um perfil de instância em volta do perfil do IAM' },
        hint: {
          en: '`resource "aws_iam_instance_profile" "web" {` with `role = aws_iam_role.<name>.name` inside.',
          pt: '`resource "aws_iam_instance_profile" "web" {` com `role = aws_iam_role.<name>.name` dentro.',
        },
        test: argRefs('aws_iam_instance_profile', 'role', 'aws_iam_role'),
      },
      {
        id: 'attached',
        text: { en: 'The instance uses the profile', pt: 'A instância usa o perfil de instância' },
        hint: {
          en: 'In the instance: `iam_instance_profile = aws_iam_instance_profile.<name>.name`.',
          pt: 'Na instância: `iam_instance_profile = aws_iam_instance_profile.<name>.name`.',
        },
        test: argRefs('aws_instance', 'iam_instance_profile', 'aws_iam_instance_profile'),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. The plan should change the instance in place, not replace it.',
          pt: 'No terminal: `init`, `plan`, `apply`. O plano deve alterar a instância no lugar, sem substituí-la.',
        },
        test: applied('aws_iam_instance_profile'),
      },
    ],
    teaches: ['aws_iam_role', 'aws_iam_role_policy_attachment', 'aws_iam_instance_profile'],
  },

  /* ------------------------------------------------------------ C3 */
  {
    slug: 'challenge-web-server',
    code: 'C3',
    kind: 'challenge',
    mode: 'code',
    minutes: 15,
    xp: 200,
    title: { en: 'Challenge: a locked-down web server', pt: 'Desafio: um servidor web blindado' },
    summary: {
      en: 'From an empty file to a web server open on 443 only, with IMDSv2 and no SSH.',
      pt: 'De um arquivo vazio a um servidor web aberto só na 443, com IMDSv2 e sem SSH.',
    },
    body: [
      {
        en: 'Everything from level 3, in one go. In `main.tf`, launch a web server in the public subnet of `network.tf` that the internet can reach on HTTPS (443), and on nothing else.',
        pt: 'Tudo do nível 3, de uma vez. No `main.tf`, crie um servidor web na sub-rede pública do `network.tf` que a internet consiga alcançar por HTTPS (443), e por nada mais.',
      },
      {
        en: 'The rules: no SSH from the internet, and the instance requires IMDSv2. Look the image up instead of pasting an id. The security lens is your judge: the server should show as public on 443 alone, and the audit should give an A.',
        pt: 'As regras: nada de SSH vindo da internet, e a instância exige IMDSv2. Busque a imagem em vez de colar um id. A lente de segurança é a sua juíza: o servidor deve aparecer como público só na 443, e a auditoria deve dar A.',
      },
      {
        en: 'Bonus, not graded: give it the IAM role from the last lesson, so you can still get a shell with every admin port closed.',
        pt: 'Bônus, sem nota: dê a ele o perfil do IAM da lição anterior, para você ainda conseguir um terminal com todas as portas de administração fechadas.',
      },
    ],
    start: level3(`# Challenge: a web server in the public subnet from network.tf.
#   * reachable from the internet on HTTPS (443), and nothing else
#   * no SSH
#   * IMDSv2 required
`),
    solution: level3(`${AMI}\n${WEB_SG}\n${LOCKED_INSTANCE}`),
    goals: [
      {
        id: 'public',
        text: { en: 'A server in the public subnet', pt: 'Um servidor na sub-rede pública' },
        hint: {
          en: 'An `aws_instance` with `subnet_id = aws_subnet.public.id`. That subnet is public thanks to the route table in `network.tf`.',
          pt: 'Um `aws_instance` com `subnet_id = aws_subnet.public.id`. Essa sub-rede é pública graças à tabela de rotas do `network.tf`.',
        },
        test: inSubnet('aws_instance', 'public'),
      },
      {
        id: 'https-only',
        text: { en: 'Reachable from the internet on 443, and only 443', pt: 'Acessível pela internet na 443, e só na 443' },
        hint: {
          en: 'A security group with a single `ingress` for TCP 443 from `0.0.0.0/0`, attached through `vpc_security_group_ids`. Any other inbound rule from the internet breaks this goal.',
          pt: 'Um grupo de segurança com um único `ingress` para TCP 443 de `0.0.0.0/0`, associado por `vpc_security_group_ids`. Qualquer outra regra de entrada vinda da internet quebra este objetivo.',
        },
        test: reachableOn('aws_instance', [443], true),
      },
      {
        id: 'no-ssh',
        text: { en: 'No SSH from the internet', pt: 'Nenhum SSH vindo da internet' },
        hint: {
          en: 'No security group may open port 22 to `0.0.0.0/0`, attached or not.',
          pt: 'Nenhum grupo de segurança pode abrir a porta 22 para `0.0.0.0/0`, associado ou não.',
        },
        test: (ctx) => inSubnet('aws_instance', 'public')(ctx) && noFinding(/SSH/)(ctx),
      },
      {
        id: 'imdsv2',
        text: { en: 'IMDSv2 required', pt: 'IMDSv2 obrigatório' },
        hint: {
          en: 'A `metadata_options` block in the instance with `http_tokens = "required"`.',
          pt: 'Um bloco `metadata_options` na instância com `http_tokens = "required"`.',
        },
        test: argIs('aws_instance', 'metadata_options.http_tokens', 'required'),
      },
      {
        id: 'grade',
        text: { en: 'The security audit grades it A', pt: 'A auditoria de segurança dá nota A' },
        hint: {
          en: 'Open the security panel and fix whatever it still lists.',
          pt: 'Abra o painel de segurança e corrija o que ele ainda listar.',
        },
        test: grade('A'),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`.',
          pt: 'No terminal: `init`, `plan`, `apply`.',
        },
        test: applied('aws_instance'),
      },
    ],
  },
];
