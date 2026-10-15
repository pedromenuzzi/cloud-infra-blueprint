/**
 * Level 4 · References and data (code): how Terraform orders the work
 * (references, and `depends_on` when there is none), `data` blocks that
 * read what already exists, and the expressions that compute values. The
 * terminal is the feedback loop: the order of `Creating...`, the
 * `Reading...` lines, values already worked out in the plan.
 */
import { all, any, applied, argRefs, has, inside, not, ran } from '../goals';
import type { Lesson } from '../types';
import { everyUsesLocal, fromVar } from './predicates-01';
import { defaultRouteToIgw } from './predicates-23';
import { dataArg, nothingPasted, outputReadsData, readsData, redundantDependsOn, subnetRangesFit, writtenWith } from './predicates-4';
import { aws } from './shared';

/* ------------------------------------------------------------ 4.1 */

/** the level 2 network, upside down, with ids pasted from the console where references belong */
const SCRAMBLED = `# This file is upside down on purpose: the association comes first, the VPC last.
# TODO: replace each pasted id with a reference to the block it stands for.

resource "aws_route_table_association" "public" {
  subnet_id      = "subnet-0a1b2c3d4e5f60718"
  route_table_id = "rtb-0a1b2c3d4e5f60718"
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = "igw-0a1b2c3d4e5f60718"
  }
}

resource "aws_subnet" "public" {
  vpc_id            = "vpc-0a1b2c3d4e5f60718"
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
`;

const REFERENCED = `# This file is upside down on purpose: the association comes first, the VPC last.

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
`;

/* ------------------------------------------------------------ 4.2 */

const AL2023 = `data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}
`;

/** the server: it reads its settings from the bucket at boot */
const appServer = (waits: string) => `${AL2023}
resource "aws_instance" "app" {
  ami                  = data.aws_ami.al2023.id
  instance_type        = "t3.micro"
  iam_instance_profile = aws_iam_instance_profile.app.name

  # At boot, the app downloads its settings from the config bucket.
  user_data = <<-EOT
    #!/bin/bash
    aws s3 cp s3://\${aws_s3_bucket.config.bucket}/app.env /etc/app.env
  EOT

  metadata_options {
    http_tokens = "required"
  }
${waits}}
`;

/** the server's identity in `iam.tf`; `profileWaits`: the redundant `depends_on` 4.2 starts with */
const iam = (profileWaits: string) => `# The server's identity: a role, what it may do, and the profile EC2 wears.

resource "aws_s3_bucket" "config" {
  bucket = "learn-app-config-2026"
}

resource "aws_iam_role" "app" {
  name = "app-server"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_policy" "read_config" {
  name = "read-app-config"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "s3:GetObject"
      Resource = "\${aws_s3_bucket.config.arn}/*"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "read_config" {
  role       = aws_iam_role.app.name
  policy_arn = aws_iam_policy.read_config.arn
}

resource "aws_iam_instance_profile" "app" {
  name = "app-server"
  role = aws_iam_role.app.name
${profileWaits}}
`;

/* ------------------------------------------------------------ 4.3 */

const PASTED_SERVER = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"

  # TODO: ask AWS which zones are available instead.
  availability_zone = "us-east-1a"
}

resource "aws_instance" "app" {
  # TODO: copied from a blog post, for another region, two years ago. Look it up.
  ami           = "ami-0123456789abcdef0"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.app.id

  metadata_options {
    http_tokens = "required"
  }
}
`;

const LOOKED_UP_SERVER = `data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical, who publishes Ubuntu

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = data.aws_availability_zones.available.names[0]
}

resource "aws_instance" "app" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.app.id

  metadata_options {
    http_tokens = "required"
  }
}

output "ami_name" {
  value = data.aws_ami.ubuntu.name
}
`;

/* ------------------------------------------------------------ 4.4 */

const EXISTING_START = `# This account already has a network: the default VPC AWS creates in every region.
# TODO 1: look it up with a data "aws_vpc" block, and use its id and its range below.
# TODO 2: bucket names are unique across all of AWS. Build this one from the
#         account id (data "aws_caller_identity") and the region (data "aws_region").

resource "aws_security_group" "app" {
  name        = "app"
  description = "HTTPS from inside the VPC"
  vpc_id      = "vpc-0a1b2c3d4e5f60718"

  ingress {
    description = "HTTPS from the VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["172.31.0.0/16"]
  }
}

resource "aws_s3_bucket" "logs" {
  bucket = "app-logs-123456789012-us-east-1"
}
`;

const EXISTING_SOLUTION = `data "aws_vpc" "default" {
  default = true
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

resource "aws_security_group" "app" {
  name        = "app"
  description = "HTTPS from inside the VPC"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTPS from the VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.default.cidr_block]
  }
}

resource "aws_s3_bucket" "logs" {
  bucket = "app-logs-\${data.aws_caller_identity.current.account_id}-\${data.aws_region.current.name}"
}

output "account_id" {
  value = data.aws_caller_identity.current.account_id
}
`;

/* ------------------------------------------------------------ 4.5 */

const ENVIRONMENT = `variable "environment" {
  type    = string
  default = "dev"
}
`;

const EXPRESSION_LOCALS = `locals {
  common_tags = {
    Project   = "learn"
    ManagedBy = "terraform"
  }

  # One size per environment.
  instance_types = {
    dev  = "t3.micro"
    prod = "t3.large"
  }
}
`;

const EXPRESSIONS_START = `${EXPRESSION_LOCALS}
${AL2023}
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  tags       = local.common_tags
}

# TODO 1: work both ranges out from the VPC's cidr_block with cidrsubnet().
resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_subnet" "data" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.2.0/24"
}

resource "aws_instance" "web" {
  ami       = data.aws_ami.al2023.id
  subnet_id = aws_subnet.app.id

  # TODO 2: pick the size from local.instance_types by var.environment.
  instance_type = "t3.micro"

  # TODO 3: the common tags, merged with a Name built from the environment ("dev-web").
  tags = {
    Name = "web"
  }

  metadata_options {
    http_tokens = "required"
  }
}
`;

const EXPRESSIONS_SOLUTION = `${EXPRESSION_LOCALS}
${AL2023}
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  tags       = local.common_tags
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, 1)
}

resource "aws_subnet" "data" {
  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, 2)
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.al2023.id
  subnet_id     = aws_subnet.app.id
  instance_type = lookup(local.instance_types, var.environment, "t3.micro")

  tags = merge(local.common_tags, {
    Name = "\${var.environment}-web"
  })

  metadata_options {
    http_tokens = "required"
  }
}
`;

/* ------------------------------------------------------------ C4 */

const DATA_DRIVEN = `${AL2023}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  common_tags = {
    Project   = "learn"
    ManagedBy = "terraform"
  }
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  tags       = merge(local.common_tags, { Name = "learn-vpc" })
}

resource "aws_subnet" "app" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 1)
  availability_zone = data.aws_availability_zones.available.names[0]
  tags              = merge(local.common_tags, { Name = "learn-app" })
}

resource "aws_instance" "app" {
  ami           = data.aws_ami.al2023.id
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.app.id
  tags          = merge(local.common_tags, { Name = "learn-server" })

  metadata_options {
    http_tokens = "required"
  }
}
`;

export const lessons: Lesson[] = [
  /* ------------------------------------------------------------ 4.1 */
  {
    slug: 'implicit-dependencies',
    code: '4.1',
    kind: 'lesson',
    mode: 'code',
    minutes: 8,
    xp: 60,
    title: { en: 'Who comes first', pt: 'Quem vem primeiro' },
    summary: {
      en: 'References decide the order of creation, and of destruction in reverse. The canvas draws that order.',
      pt: 'Referências decidem a ordem de criação, e a de destruição ao contrário. O canvas desenha essa ordem.',
    },
    body: [
      {
        en: 'This file is upside down on purpose: the association that ties everything together comes first, the VPC last. Terraform doesn\'t mind. It never reads a file as a to-do list from top to bottom; it reads every block and every reference between them, and works the order out by itself.',
        pt: 'Este arquivo está de cabeça para baixo de propósito: a associação que amarra tudo vem primeiro, a VPC por último. O Terraform não se importa. Ele nunca lê um arquivo como uma lista de tarefas de cima para baixo; lê todos os blocos e todas as referências entre eles, e descobre a ordem sozinho.',
      },
      {
        en: 'Every reference is a promise to wait. `vpc_id = aws_vpc.main.id` means the subnet can\'t be created until the VPC exists and AWS has given it an id. Put all those promises together and you get a *dependency graph*. You\'ve been looking at it all along: each line and each box on the canvas is a reference.',
        pt: 'Toda referência é uma promessa de espera. `vpc_id = aws_vpc.main.id` quer dizer que a sub-rede não pode ser criada antes de a VPC existir e de a AWS dar um id a ela. Junte todas essas promessas e você tem um *grafo de dependências*. Você já está olhando para ele há um tempo: cada linha e cada caixa do canvas é uma referência.',
      },
      {
        en: 'Here someone pasted ids from the AWS console instead. To Terraform they are just text: nothing says `vpc-0a1b2c3d4e5f60718` is the VPC at the bottom of the file, and a new VPC gets a new id anyway. Replace each pasted id with a reference and watch the canvas: the subnet jumps into the VPC box, and lines appear where the strings were.',
        pt: 'Aqui alguém colou ids do console da AWS no lugar. Para o Terraform eles são só texto: nada diz que `vpc-0a1b2c3d4e5f60718` é a VPC no fim do arquivo, e uma VPC nova ganha um id novo de qualquer jeito. Troque cada id colado por uma referência e olhe o canvas: a sub-rede pula para dentro da caixa da VPC, e aparecem linhas onde estavam os textos.',
      },
      {
        en: 'Then the terminal. `plan` lists resources alphabetically, but find the subnet\'s `vpc_id`: `(known after apply)`, the promise to wait, in writing. `apply` follows the graph: the VPC, then the gateway and the subnet, then the route table, the association last. And `destroy` walks it backwards, because AWS won\'t delete a VPC that still has a subnet in it.',
        pt: 'Agora o terminal. O `plan` lista os recursos em ordem alfabética, mas procure o `vpc_id` da sub-rede: `(known after apply)`, a promessa de espera por escrito. O `apply` segue o grafo: a VPC, depois o gateway e a sub-rede, depois a tabela de rotas, a associação por último. E o `destroy` percorre o caminho ao contrário, porque a AWS não exclui uma VPC que ainda tem uma sub-rede dentro.',
      },
    ],
    asides: [
      {
        title: { en: 'One at a time?', pt: 'Um de cada vez?' },
        body: [
          {
            en: 'No: blocks that don\'t depend on each other are created at the same time, up to 10 at once by default (`-parallelism` changes it). The gateway and the subnet only wait for the VPC, not for each other. The terminal here shows them in rounds, so the graph is easy to read.',
            pt: 'Não: blocos que não dependem um do outro são criados ao mesmo tempo, até 10 de uma vez por padrão (`-parallelism` muda isso). O gateway e a sub-rede só esperam a VPC, não um ao outro. O terminal daqui mostra tudo em rodadas, para o grafo ficar fácil de ler.',
          },
        ],
      },
      {
        title: { en: 'What if two blocks wait for each other?', pt: 'E se dois blocos esperarem um pelo outro?' },
        body: [
          {
            en: 'Then neither can go first, and Terraform stops with a `Cycle` error that lists the blocks involved. The usual fix is to split one of them: two security groups that allow each other in, for example, become two groups plus separate rule resources.',
            pt: 'Aí nenhum dos dois pode ir primeiro, e o Terraform para com um erro `Cycle` que lista os blocos envolvidos. A saída comum é dividir um deles: dois grupos de segurança que liberam a entrada um do outro, por exemplo, viram dois grupos mais recursos de regra separados.',
          },
        ],
      },
    ],
    start: aws(SCRAMBLED),
    solution: aws(REFERENCED),
    goals: [
      {
        id: 'subnet',
        text: { en: 'The subnet references the VPC, and sits inside it', pt: 'A sub-rede referencia a VPC e fica dentro dela' },
        hint: {
          en: 'In the subnet, replace the pasted string with `vpc_id = aws_vpc.main.id`. No quotes: a reference isn\'t text.',
          pt: 'Na sub-rede, troque o texto colado por `vpc_id = aws_vpc.main.id`. Sem aspas: uma referência não é texto.',
        },
        test: inside('aws_subnet', 'aws_vpc'),
      },
      {
        id: 'route',
        text: { en: 'The route sends `0.0.0.0/0` to the internet gateway by reference', pt: 'A rota manda `0.0.0.0/0` para o internet gateway por referência' },
        hint: {
          en: 'Inside the `route` block: `gateway_id = aws_internet_gateway.main.id`.',
          pt: 'Dentro do bloco `route`: `gateway_id = aws_internet_gateway.main.id`.',
        },
        test: defaultRouteToIgw,
      },
      {
        id: 'association',
        text: { en: 'The association references the subnet and the route table', pt: 'A associação referencia a sub-rede e a tabela de rotas' },
        hint: {
          en: '`subnet_id = aws_subnet.public.id` and `route_table_id = aws_route_table.public.id`.',
          pt: '`subnet_id = aws_subnet.public.id` e `route_table_id = aws_route_table.public.id`.',
        },
        test: (ctx) =>
          argRefs('aws_route_table_association', 'subnet_id', 'aws_subnet')(ctx) &&
          argRefs('aws_route_table_association', 'route_table_id', 'aws_route_table')(ctx),
      },
      {
        id: 'apply',
        text: { en: 'Apply, and read the order of `Creating...`', pt: 'Aplique e leia a ordem dos `Creating...`' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. The VPC comes first even though it\'s last in the file.',
          pt: 'No terminal: `init`, `plan`, `apply`. A VPC vem primeiro, mesmo sendo a última do arquivo.',
        },
        test: ran('apply'),
      },
      {
        id: 'destroy',
        text: { en: 'Destroy it, and read the order backwards', pt: 'Destrua e leia a ordem ao contrário' },
        hint: {
          en: 'Run `destroy` after the apply. The association goes first now, and the VPC last.',
          pt: 'Rode `destroy` depois do apply. Agora a associação vai primeiro, e a VPC por último.',
        },
        test: all(ran('apply'), ran('destroy')),
      },
    ],
  },

  /* ------------------------------------------------------------ 4.2 */
  {
    slug: 'depends-on',
    code: '4.2',
    kind: 'lesson',
    mode: 'code',
    minutes: 9,
    xp: 70,
    title: { en: 'Waiting without a reference', pt: 'Esperar sem referência' },
    summary: {
      en: '`depends_on` for the dependency no reference can show, and why it\'s the exception.',
      pt: '`depends_on` para a dependência que nenhuma referência mostra, e por que ele é a exceção.',
    },
    body: [
      {
        en: 'Meet a server with a habit: when it boots, it downloads its settings from an S3 bucket, using the IAM role from level 3. The role and its friends live in the new `iam.tf` tab. It may read the bucket thanks to a policy *attachment*, a separate resource that joins a policy to the role.',
        pt: 'Conheça um servidor com uma mania: quando inicializa, ele baixa as configurações de um bucket S3, usando o perfil do IAM do nível 3. O perfil do IAM e companhia ficam na nova aba `iam.tf`. Ele pode ler o bucket graças a um *anexo* de política, um recurso separado que liga uma política ao perfil.',
      },
      {
        en: 'Now follow the references from the instance. It names its instance profile, so Terraform waits for the profile and the role inside it. It names the bucket in `user_data`, so it waits for the bucket. But nothing in the instance names the attachment. Terraform sees no reason to wait for it, so the server and the attachment start in the same round, and on a bad day the server boots, asks for its settings and gets `AccessDenied`.',
        pt: 'Agora siga as referências a partir da instância. Ela cita o perfil de instância, então o Terraform espera o perfil de instância e o perfil do IAM que ele envolve. Ela cita o bucket no `user_data`, então espera o bucket. Mas nada na instância cita o anexo. O Terraform não vê motivo para esperar, então o servidor e o anexo começam na mesma rodada, e num dia ruim o servidor inicializa, pede as configurações e recebe `AccessDenied`.',
      },
      {
        en: 'That is the job of `depends_on`: a list of blocks to wait for when no reference says so. Add `depends_on = [aws_iam_role_policy_attachment.read_config]` to the instance. A new line appears on the canvas, from the server to the attachment; select it and its label reads `depends_on`. Then `apply`: the instance is the very last thing created.',
        pt: 'Esse é o papel do `depends_on`: uma lista de blocos a esperar quando nenhuma referência diz isso. Adicione `depends_on = [aws_iam_role_policy_attachment.read_config]` à instância. Uma linha nova aparece no canvas, do servidor até o anexo; selecione a linha e o rótulo dela diz `depends_on`. Depois rode `apply`: a instância é a última coisa a ser criada.',
      },
      {
        en: 'And when not to use it: when a reference already says it. Someone wrote `depends_on = [aws_iam_role.app]` in the instance profile, right under `role = aws_iam_role.app.name`. It changes nothing and makes the next reader wonder what they missed. Delete it.',
        pt: 'E quando não usar: quando uma referência já diz isso. Alguém escreveu `depends_on = [aws_iam_role.app]` no perfil de instância, logo abaixo de `role = aws_iam_role.app.name`. Isso não muda nada e deixa o próximo leitor se perguntando o que deixou passar. Apague.',
      },
    ],
    asides: [
      {
        title: { en: 'A reference beats `depends_on`', pt: 'Uma referência vence o `depends_on`' },
        body: [
          {
            en: 'A reference carries a value *and* an order; `depends_on` only carries the order, and only for whole blocks: you list `aws_iam_role_policy_attachment.read_config`, never an attribute of it. It also makes Terraform more cautious: on a `data` block, it can push the lookup to the apply, and its values turn into `(known after apply)`.',
            pt: 'Uma referência carrega um valor *e* uma ordem; o `depends_on` só carrega a ordem, e só de blocos inteiros: você lista `aws_iam_role_policy_attachment.read_config`, nunca um atributo dele. Ele também deixa o Terraform mais cauteloso: num bloco `data`, pode empurrar a consulta para o apply, e os valores dela viram `(known after apply)`.',
          },
          {
            en: 'So use it for what lives outside Terraform\'s sight: a permission a script relies on, a bucket policy an app needs before its first request. Then leave a comment that says why.',
            pt: 'Então use para o que fica fora da vista do Terraform: uma permissão de que um script depende, uma política de bucket de que uma aplicação precisa antes da primeira requisição. E deixe um comentário dizendo por quê.',
          },
        ],
      },
    ],
    start: aws(
      appServer(`
  # TODO: make the server wait until its permission to read the bucket is attached.
`),
      {
        'iam.tf': iam(`
  # TODO: this depends_on repeats what the reference above already says.
  depends_on = [aws_iam_role.app]
`),
      },
    ),
    solution: aws(
      appServer(`
  # The app reads the bucket at boot: its permission must be attached first.
  depends_on = [aws_iam_role_policy_attachment.read_config]
`),
      { 'iam.tf': iam('') },
    ),
    goals: [
      {
        id: 'waits',
        text: { en: 'The server waits for its permission', pt: 'O servidor espera a própria permissão' },
        hint: {
          en: 'Inside the instance: `depends_on = [aws_iam_role_policy_attachment.read_config]`. A list of blocks, no `.id` at the end.',
          pt: 'Dentro da instância: `depends_on = [aws_iam_role_policy_attachment.read_config]`. Uma lista de blocos, sem `.id` no fim.',
        },
        test: any(
          argRefs('aws_instance', 'depends_on', 'aws_iam_role_policy_attachment'),
          argRefs('aws_instance', 'depends_on', 'aws_iam_role_policy'),
        ),
      },
      {
        id: 'redundant',
        text: { en: 'No `depends_on` that repeats a reference', pt: 'Nenhum `depends_on` que repete uma referência' },
        hint: {
          en: 'In `iam.tf`, the instance profile already says `role = aws_iam_role.app.name`. Delete its `depends_on` line.',
          pt: 'No `iam.tf`, o perfil de instância já diz `role = aws_iam_role.app.name`. Apague a linha `depends_on` dele.',
        },
        test: not(redundantDependsOn),
      },
      {
        id: 'profile',
        text: { en: 'The instance profile still wraps its role', pt: 'O perfil de instância continua envolvendo o perfil do IAM' },
        hint: {
          en: 'Keep `role = aws_iam_role.app.name` in the instance profile: that reference is the one that matters.',
          pt: 'Mantenha `role = aws_iam_role.app.name` no perfil de instância: essa referência é a que importa.',
        },
        test: argRefs('aws_iam_instance_profile', 'role', 'aws_iam_role'),
      },
      {
        id: 'apply',
        text: { en: 'Apply it: the server comes last', pt: 'Aplique: o servidor vem por último' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. Look for `aws_instance.app: Creating...` after the attachment\'s `Creation complete`.',
          pt: 'No terminal: `init`, `plan`, `apply`. Procure `aws_instance.app: Creating...` depois do `Creation complete` do anexo.',
        },
        test: all(ran('apply'), applied('aws_instance')),
      },
    ],
  },

  /* ------------------------------------------------------------ 4.3 */
  {
    slug: 'data-sources',
    code: '4.3',
    kind: 'lesson',
    mode: 'code',
    minutes: 9,
    xp: 70,
    title: { en: 'Data sources', pt: 'Fontes de dados' },
    summary: {
      en: 'Ask instead of paste: `data` blocks look up an image and the zones, and never create a thing.',
      pt: 'Pergunte em vez de colar: blocos `data` buscam uma imagem e as zonas, e nunca criam nada.',
    },
    body: [
      {
        en: 'Not everything your code uses is yours to create. Canonical publishes the Ubuntu images; the availability zones belong to the region. You need their *current* values, and pasting them is how code goes stale: the AMI id in this file came from a blog post, for another region, two years ago.',
        pt: 'Nem tudo que o seu código usa é seu para criar. A Canonical publica as imagens do Ubuntu; as zonas de disponibilidade pertencem à região. Você precisa dos valores *atuais* delas, e colar esses valores é como o código envelhece: o id de AMI deste arquivo veio de um post de blog, de outra região, dois anos atrás.',
      },
      {
        en: 'A `data` block is a question, not an order. `data "aws_ami"` asks: of the images published by these `owners` and matching every `filter`, which is the newest (`most_recent = true`)? Terraform asks again on every `plan`, and you read the answer like any attribute, with a `data.` in front: `data.aws_ami.ubuntu.id`.',
        pt: 'Um bloco `data` é uma pergunta, não uma ordem. `data "aws_ami"` pergunta: das imagens publicadas por estes `owners` e que passam em todos os `filter`, qual é a mais nova (`most_recent = true`)? O Terraform pergunta de novo a cada `plan`, e você lê a resposta como qualquer atributo, com um `data.` na frente: `data.aws_ami.ubuntu.id`.',
      },
      {
        en: 'Look up Ubuntu 24.04 (Canonical\'s account is `099720109477`) and boot the server from it. Then ask for the zones with `data "aws_availability_zones"` and put the subnet in the first one, `names[0]`: lists count from zero. Finish with an output that shows the name of the image Terraform found.',
        pt: 'Busque o Ubuntu 24.04 (a conta da Canonical é `099720109477`) e inicialize o servidor a partir dele. Depois peça as zonas com `data "aws_availability_zones"` e coloque a sub-rede na primeira, `names[0]`: listas contam a partir do zero. Termine com um output que mostra o nome da imagem que o Terraform encontrou.',
      },
      {
        en: 'On the canvas, lookups are drawn dashed, with a count of the blocks that read them: read, never created. In the terminal, `plan` opens with `Reading...` lines, and the `Plan:` line doesn\'t count them. `destroy` won\'t touch them either: Canonical\'s images are safe from you.',
        pt: 'No canvas, as consultas aparecem tracejadas, com a contagem dos blocos que as leem: lidas, nunca criadas. No terminal, o `plan` começa com linhas `Reading...`, e a linha `Plan:` não as conta. O `destroy` também não toca nelas: as imagens da Canonical estão a salvo de você.',
      },
    ],
    asides: [
      {
        title: { en: 'Why `most_recent`?', pt: 'Por que `most_recent`?' },
        body: [
          {
            en: 'A lookup must find exactly one answer. Canonical publishes a new Ubuntu image every few weeks, so a name filter with `*` matches dozens, and without `most_recent = true` the lookup fails with an error instead of guessing.',
            pt: 'Uma consulta precisa achar exatamente uma resposta. A Canonical publica uma imagem nova do Ubuntu a cada poucas semanas, então um filtro de nome com `*` encontra dezenas, e sem `most_recent = true` a consulta falha com um erro em vez de chutar.',
          },
          {
            en: 'Newest has a price, though: when a new image comes out, the next plan changes the instance\'s `ami`, and that replaces the server. Teams that don\'t want that add `lifecycle { ignore_changes = [ami] }` to the instance, or build images of their own.',
            pt: 'Só que a mais nova tem um preço: quando sai uma imagem nova, o próximo plano muda o `ami` da instância, e isso substitui o servidor. Times que não querem isso adicionam `lifecycle { ignore_changes = [ami] }` à instância, ou constroem as próprias imagens.',
          },
        ],
      },
    ],
    start: aws(PASTED_SERVER),
    solution: aws(LOOKED_UP_SERVER),
    goals: [
      {
        id: 'ami',
        text: { en: 'An image looked up: owner, filter, newest', pt: 'Uma imagem buscada: dono, filtro, a mais nova' },
        hint: {
          en: '`data "aws_ami" "ubuntu" {` with `most_recent = true`, `owners = ["099720109477"]` and a `filter` block: `name = "name"`, `values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]`. A second `filter` with `name = "virtualization-type"` and `values = ["hvm"]` makes it sharper.',
          pt: '`data "aws_ami" "ubuntu" {` com `most_recent = true`, `owners = ["099720109477"]` e um bloco `filter`: `name = "name"`, `values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]`. Um segundo `filter` com `name = "virtualization-type"` e `values = ["hvm"]` deixa a busca mais precisa.',
        },
        test: all(dataArg('aws_ami', 'most_recent', true), dataArg('aws_ami', 'owners'), dataArg('aws_ami', 'filter')),
      },
      {
        id: 'instance',
        text: { en: 'The server boots from the image it found', pt: 'O servidor inicializa a partir da imagem encontrada' },
        hint: {
          en: 'Replace the pasted id: `ami = data.aws_ami.ubuntu.id`.',
          pt: 'Troque o id colado: `ami = data.aws_ami.ubuntu.id`.',
        },
        test: readsData('aws_instance', 'ami', 'aws_ami'),
      },
      {
        id: 'zone',
        text: { en: 'The subnet\'s zone comes from a lookup', pt: 'A zona da sub-rede vem de uma consulta' },
        hint: {
          en: 'Add `data "aws_availability_zones" "available" {` with `state = "available"`, then in the subnet: `availability_zone = data.aws_availability_zones.available.names[0]`.',
          pt: 'Adicione `data "aws_availability_zones" "available" {` com `state = "available"` e depois, na sub-rede: `availability_zone = data.aws_availability_zones.available.names[0]`.',
        },
        test: readsData('aws_subnet', 'availability_zone', 'aws_availability_zones'),
      },
      {
        id: 'output',
        text: { en: 'An output shows which image was found', pt: 'Um output mostra qual imagem foi encontrada' },
        hint: {
          en: '`output "ami_name" {` with `value = data.aws_ami.ubuntu.name`.',
          pt: '`output "ami_name" {` com `value = data.aws_ami.ubuntu.name`.',
        },
        test: outputReadsData('aws_ami', /^name$/),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. Read the `Reading...` lines first, then the `Outputs:` at the end.',
          pt: 'No terminal: `init`, `plan`, `apply`. Leia primeiro as linhas `Reading...`, depois os `Outputs:` no fim.',
        },
        test: all(ran('apply'), applied('aws_instance')),
      },
    ],
  },

  /* ------------------------------------------------------------ 4.4 */
  {
    slug: 'existing-infrastructure',
    code: '4.4',
    kind: 'lesson',
    mode: 'code',
    minutes: 8,
    xp: 60,
    title: { en: 'What already exists', pt: 'O que já existe' },
    summary: {
      en: 'Read the default VPC, the account and the region, and build on them without owning them.',
      pt: 'Leia a VPC padrão, a conta e a região, e construa sobre elas sem ser dono delas.',
    },
    body: [
      {
        en: 'Real projects rarely start from nothing. The network was built by another team, the account was set up years ago. Your code still needs their ids and ranges. The `data` blocks from the last lesson read those too: anything that exists, whoever made it.',
        pt: 'Projetos de verdade raramente começam do zero. A rede foi montada por outro time, a conta foi configurada anos atrás. O seu código ainda precisa dos ids e intervalos delas. Os blocos `data` da lição anterior também leem isso: qualquer coisa que exista, não importa quem criou.',
      },
      {
        en: 'Three lookups worth knowing by heart. `data "aws_vpc"` with `default = true` finds the default VPC AWS puts in every region. `data "aws_caller_identity"` tells you which account the code runs in (`account_id`), and `data "aws_region"` which region (`name`). Those two take no arguments at all: `{}` is enough.',
        pt: 'Três consultas que vale saber de cor. `data "aws_vpc"` com `default = true` encontra a VPC padrão que a AWS cria em toda região. `data "aws_caller_identity"` diz em qual conta o código roda (`account_id`), e `data "aws_region"` em qual região (`name`). Essas duas não recebem argumento nenhum: `{}` basta.',
      },
      {
        en: 'Put the security group in the default VPC and let HTTPS in from the VPC\'s own range, its `cidr_block`. Then name the bucket after the account and the region. Bucket names are unique across all of AWS, so `"app-logs-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}"` is yours alone, in any account and any region, without anyone typing an id.',
        pt: 'Coloque o grupo de segurança na VPC padrão e libere a entrada de HTTPS a partir do intervalo da própria VPC, o `cidr_block` dela. Depois dê ao bucket um nome com a conta e a região. Nomes de bucket são únicos em toda a AWS, então `"app-logs-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}"` é só seu, em qualquer conta e qualquer região, sem ninguém digitar um id.',
      },
      {
        en: 'Run `plan` and read the bucket: the whole name is already there, account and region filled in. Lookups are read *before* anything is created, so their values are known at plan time, unlike an `id` that waits for `(known after apply)`. And on the canvas the security group points at a dashed VPC instead of sitting in a box: it uses that network, it doesn\'t own it.',
        pt: 'Rode `plan` e leia o bucket: o nome inteiro já está lá, com conta e região preenchidas. Consultas são lidas *antes* de qualquer coisa ser criada, então os valores delas já são conhecidos no plano, ao contrário de um `id` que espera `(known after apply)`. E no canvas o grupo de segurança aponta para uma VPC tracejada em vez de ficar dentro de uma caixa: ele usa essa rede, não é dono dela.',
      },
    ],
    asides: [
      {
        title: { en: 'Read, not adopt', pt: 'Ler não é adotar' },
        body: [
          {
            en: 'A data source never changes or deletes what it reads: the default VPC outlives every `destroy`. To have Terraform *manage* something that already exists, you bring it into the state with an `import` block. That is a different tool, for when the thing should become yours.',
            pt: 'Uma fonte de dados nunca altera nem exclui o que lê: a VPC padrão sobrevive a todo `destroy`. Para o Terraform *gerenciar* algo que já existe, você traz esse recurso para o estado com um bloco `import`. É outra ferramenta, para quando a coisa deve passar a ser sua.',
          },
        ],
      },
      {
        title: { en: 'What is the default VPC?', pt: 'O que é a VPC padrão?' },
        body: [
          {
            en: 'Every AWS account gets one VPC per region, ready to use, with the range `172.31.0.0/16` and a public subnet in each availability zone. It\'s why you can launch a server in a brand new account without building a network first. Handy for experiments; real workloads get a VPC of their own, like the one from level 2.',
            pt: 'Toda conta da AWS ganha uma VPC por região, pronta para uso, com o intervalo `172.31.0.0/16` e uma sub-rede pública em cada zona de disponibilidade. É por isso que dá para criar um servidor numa conta novinha sem montar uma rede antes. Prática para experimentos; cargas de trabalho de verdade ganham uma VPC própria, como a do nível 2.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: aws(EXISTING_START),
    solution: aws(EXISTING_SOLUTION),
    goals: [
      {
        id: 'vpc',
        text: { en: 'The default VPC looked up', pt: 'A VPC padrão buscada' },
        hint: {
          en: '`data "aws_vpc" "default" {` with `default = true` inside.',
          pt: '`data "aws_vpc" "default" {` com `default = true` dentro.',
        },
        test: dataArg('aws_vpc', 'default', true),
      },
      {
        id: 'sg',
        text: { en: 'The security group placed in it by reference', pt: 'O grupo de segurança colocado nela por referência' },
        hint: {
          en: 'Replace the pasted id: `vpc_id = data.aws_vpc.default.id`.',
          pt: 'Troque o id colado: `vpc_id = data.aws_vpc.default.id`.',
        },
        test: readsData('aws_security_group', 'vpc_id', 'aws_vpc'),
      },
      {
        id: 'range',
        text: { en: 'HTTPS allowed from the range the lookup found', pt: 'HTTPS liberado a partir do intervalo que a consulta encontrou' },
        hint: {
          en: 'In the `ingress` block: `cidr_blocks = [data.aws_vpc.default.cidr_block]`. Square brackets: it\'s still a list.',
          pt: 'No bloco `ingress`: `cidr_blocks = [data.aws_vpc.default.cidr_block]`. Colchetes: continua sendo uma lista.',
        },
        test: any(
          readsData('aws_security_group', 'ingress.cidr_blocks', 'aws_vpc'),
          readsData('aws_vpc_security_group_ingress_rule', 'cidr_ipv4', 'aws_vpc'),
        ),
      },
      {
        id: 'bucket',
        text: { en: 'The bucket named after the account and the region', pt: 'O bucket com o nome da conta e da região' },
        hint: {
          en: 'Add `data "aws_caller_identity" "current" {}` and `data "aws_region" "current" {}`, then build the name with a template: `"app-logs-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}"`.',
          pt: 'Adicione `data "aws_caller_identity" "current" {}` e `data "aws_region" "current" {}` e depois monte o nome com um template: `"app-logs-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}"`.',
        },
        test: all(readsData('aws_s3_bucket', 'bucket', 'aws_caller_identity'), readsData('aws_s3_bucket', 'bucket', 'aws_region')),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. The plan already shows the bucket\'s full name.',
          pt: 'No terminal: `init`, `plan`, `apply`. O plano já mostra o nome completo do bucket.',
        },
        test: all(ran('apply'), applied('aws_s3_bucket')),
      },
    ],
  },

  /* ------------------------------------------------------------ 4.5 */
  {
    slug: 'expressions-and-functions',
    code: '4.5',
    kind: 'lesson',
    mode: 'code',
    minutes: 10,
    xp: 80,
    title: { en: 'Expressions and functions', pt: 'Expressões e funções' },
    summary: {
      en: 'Templates, conditionals and functions like `cidrsubnet`, `merge` and `lookup`: let Terraform do the math.',
      pt: 'Templates, condicionais e funções como `cidrsubnet`, `merge` e `lookup`: deixe o Terraform fazer as contas.',
    },
    body: [
      {
        en: 'You\'ve used expressions since level 1: `"acme-${var.environment}"` is a *string template*, and `merge()` joined two maps. An expression is anything that *computes* a value. Terraform works each one out while it plans, so the plan shows the result, not the formula.',
        pt: 'Você usa expressões desde o nível 1: `"acme-${var.environment}"` é um *template de string*, e `merge()` juntou dois mapas. Uma expressão é qualquer coisa que *calcula* um valor. O Terraform resolve cada uma enquanto planeja, então o plano mostra o resultado, não a fórmula.',
      },
      {
        en: 'Three new tools. `cidrsubnet(prefix, newbits, netnum)` carves a range out of a bigger one: in postal terms, `cidrsubnet("10.0.0.0/16", 8, 2)` takes the city `10.0`, adds 8 bits to make streets of size /24, and picks street number 2: `"10.0.2.0/24"`. A *conditional*, `condition ? if_true : if_false`, picks between two values. And `lookup(map, key, default)` picks from many.',
        pt: 'Três ferramentas novas. `cidrsubnet(prefix, newbits, netnum)` recorta um intervalo de dentro de um maior: em termos postais, `cidrsubnet("10.0.0.0/16", 8, 2)` pega a cidade `10.0`, soma 8 bits para fazer ruas de tamanho /24 e escolhe a rua número 2: `"10.0.2.0/24"`. Uma *condicional*, `condition ? if_true : if_false`, escolhe entre dois valores. E `lookup(map, key, default)` escolhe entre vários.',
      },
      {
        en: 'Work both subnet ranges out from `aws_vpc.main.cidr_block`, so changing the VPC moves them along. Pick the instance size from `local.instance_types` by `var.environment`. Give the server `merge(local.common_tags, { ... })` with a `Name` built from a template: `dev-web` today.',
        pt: 'Calcule os dois intervalos das sub-redes a partir de `aws_vpc.main.cidr_block`, assim mudar a VPC leva as sub-redes junto. Escolha o tamanho da instância em `local.instance_types` por `var.environment`. Dê ao servidor `merge(local.common_tags, { ... })` com um `Name` montado por um template: `dev-web` hoje.',
      },
      {
        en: 'Real Terraform has `terraform console`, a prompt that answers expressions. Here the plan plays that part: every value it can work out is already in it, `cidr_block = "10.0.1.0/24"` and all. After the `apply`, try it: in `variables.tf`, set the default of `environment` to `"prod"` and `plan` again. One word changed, and the plan shows `~ instance_type = "t3.micro" -> "t3.large"` and the new name, updated in place.',
        pt: 'O Terraform de verdade tem o `terraform console`, um prompt que responde expressões. Aqui o plano faz esse papel: todo valor que ele consegue calcular já está lá, `cidr_block = "10.0.1.0/24"` e tudo mais. Depois do `apply`, experimente: no `variables.tf`, mude o default de `environment` para `"prod"` e rode `plan` de novo. Uma palavra mudou, e o plano mostra `~ instance_type = "t3.micro" -> "t3.large"` e o nome novo, alterados no lugar.',
      },
    ],
    asides: [
      {
        title: { en: 'Think like the console', pt: 'Pense como o console' },
        body: [
          {
            en: '`upper("dev")` is `"DEV"`, and `lower("Web")` is `"web"`: handy for names AWS wants in lowercase, like buckets.',
            pt: '`upper("dev")` é `"DEV"`, e `lower("Web")` é `"web"`: útil para nomes que a AWS quer em minúsculas, como os de buckets.',
          },
          {
            en: '`length(["a", "b", "c"])` is `3`; on a map it counts the keys, on a string the characters.',
            pt: '`length(["a", "b", "c"])` é `3`; num mapa ele conta as chaves, numa string os caracteres.',
          },
          {
            en: '`lookup({ dev = "t3.micro" }, "prod", "t3.small")` is `"t3.small"`: the default, because the key is missing.',
            pt: '`lookup({ dev = "t3.micro" }, "prod", "t3.small")` é `"t3.small"`: o default, porque a chave não existe.',
          },
          {
            en: '`var.environment == "prod" ? 2 : 1` is `1` in dev. Both sides must have the same type.',
            pt: '`var.environment == "prod" ? 2 : 1` é `1` em dev. Os dois lados precisam ter o mesmo tipo.',
          },
          {
            en: '`merge({ a = 1 }, { a = 2, b = 3 })` is `{ a = 2, b = 3 }`: when a key repeats, the last map wins. That\'s how a resource\'s own `Name` lands on top of the common tags.',
            pt: '`merge({ a = 1 }, { a = 2, b = 3 })` é `{ a = 2, b = 3 }`: quando uma chave se repete, o último mapa vence. É assim que o `Name` do próprio recurso fica por cima das tags comuns.',
          },
        ],
      },
    ],
    start: aws(EXPRESSIONS_START, { 'variables.tf': ENVIRONMENT }),
    solution: aws(EXPRESSIONS_SOLUTION, { 'variables.tf': ENVIRONMENT }),
    goals: [
      {
        id: 'cidrsubnet',
        text: { en: 'Both subnet ranges worked out with `cidrsubnet`, without overlapping', pt: 'Os dois intervalos das sub-redes calculados com `cidrsubnet`, sem sobreposição' },
        hint: {
          en: '`cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, 1)` in one subnet, and `8, 2` in the other. Same `netnum` twice would give the same range.',
          pt: '`cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, 1)` numa sub-rede, e `8, 2` na outra. O mesmo `netnum` duas vezes daria o mesmo intervalo.',
        },
        test: all(writtenWith('aws_subnet', 'cidr_block', /\bcidrsubnet\(/), subnetRangesFit),
      },
      {
        id: 'size',
        text: { en: 'The instance size follows `var.environment`', pt: 'O tamanho da instância segue `var.environment`' },
        hint: {
          en: '`instance_type = lookup(local.instance_types, var.environment, "t3.micro")`. A conditional works too: `var.environment == "prod" ? "t3.large" : "t3.micro"`.',
          pt: '`instance_type = lookup(local.instance_types, var.environment, "t3.micro")`. Uma condicional também serve: `var.environment == "prod" ? "t3.large" : "t3.micro"`.',
        },
        test: fromVar('aws_instance', 'instance_type'),
      },
      {
        id: 'tags',
        text: { en: 'The server\'s tags: the common tags merged with its own', pt: 'As tags do servidor: as tags comuns mescladas com as dele' },
        hint: {
          en: '`tags = merge(local.common_tags, { Name = "web" })`. The first map brings the shared tags, the second adds the server\'s own.',
          pt: '`tags = merge(local.common_tags, { Name = "web" })`. O primeiro mapa traz as tags compartilhadas, o segundo acrescenta as do servidor.',
        },
        test: all(writtenWith('aws_instance', 'tags', /\bmerge\(/), everyUsesLocal('aws_instance', 'tags')),
      },
      {
        id: 'name',
        text: { en: 'A `Name` built from the environment with a template', pt: 'Um `Name` montado a partir do ambiente com um template' },
        hint: {
          en: 'In the second map: `Name = "${var.environment}-web"`. The plan shows it as `"dev-web"`.',
          pt: 'No segundo mapa: `Name = "${var.environment}-web"`. O plano mostra isso como `"dev-web"`.',
        },
        test: all(writtenWith('aws_instance', 'tags', /\$\{/), fromVar('aws_instance', 'tags')),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. Then try `"prod"` and `plan` once more.',
          pt: 'No terminal: `init`, `plan`, `apply`. Depois experimente `"prod"` e rode `plan` mais uma vez.',
        },
        test: all(ran('apply'), applied('aws_instance')),
      },
    ],
  },

  /* ------------------------------------------------------------ C4 */
  {
    slug: 'challenge-data-driven',
    code: 'C4',
    kind: 'challenge',
    mode: 'code',
    minutes: 15,
    xp: 200,
    title: { en: 'Challenge: nothing pasted', pt: 'Desafio: nada colado' },
    summary: {
      en: 'A server that finds its own image, zone and range, from an empty file and without a single pasted id.',
      pt: 'Um servidor que encontra a própria imagem, zona e intervalo, de um arquivo vazio e sem nenhum id colado.',
    },
    body: [
      {
        en: 'Everything from level 4, in one go. In `main.tf`, build a VPC and a subnet whose range is worked out from the VPC\'s with `cidrsubnet`, in the first availability zone AWS reports as available. In that subnet, launch a server on the newest Amazon Linux 2023 image.',
        pt: 'Tudo do nível 4, de uma vez. No `main.tf`, monte uma VPC e uma sub-rede cujo intervalo é calculado a partir do da VPC com `cidrsubnet`, na primeira zona de disponibilidade que a AWS informa como disponível. Nessa sub-rede, crie um servidor com a imagem mais nova do Amazon Linux 2023.',
      },
      {
        en: 'The rules: the VPC, the subnet and the server all carry the same common tags from one local, merged with a `Name` of their own. And nothing is pasted: no image id, no zone name, no resource id. If a value exists somewhere, look it up or reference it.',
        pt: 'As regras: a VPC, a sub-rede e o servidor carregam as mesmas tags comuns, vindas de um local, mescladas com um `Name` próprio. E nada é colado: nenhum id de imagem, nenhum nome de zona, nenhum id de recurso. Se um valor existe em algum lugar, busque ou referencie.',
      },
      {
        en: 'When it\'s done, the plan should read like a report: the image it found, the zone, the range, the tags, all worked out before a single resource exists.',
        pt: 'Quando estiver pronto, o plano deve parecer um relatório: a imagem encontrada, a zona, o intervalo, as tags, tudo calculado antes de qualquer recurso existir.',
      },
    ],
    start: aws(`# Challenge: a server that finds everything it needs by itself.
#   * a VPC, and a subnet whose range comes from the VPC's with cidrsubnet()
#   * the subnet in the first availability zone AWS reports as available
#   * a server in that subnet, on the newest Amazon Linux 2023 image, looked up
#   * VPC, subnet and server tagged from one local map, merged with their own Name
#   * nothing pasted: no image id, zone name or resource id
`),
    solution: aws(DATA_DRIVEN),
    goals: [
      {
        id: 'ami',
        text: { en: 'The server boots from the newest image, looked up', pt: 'O servidor inicializa com a imagem mais nova, buscada' },
        hint: {
          en: 'A `data "aws_ami"` with `most_recent = true`, `owners = ["amazon"]` and a `filter` on `name` like `al2023-ami-*-x86_64`; then `ami = data.aws_ami.<name>.id`.',
          pt: 'Um `data "aws_ami"` com `most_recent = true`, `owners = ["amazon"]` e um `filter` em `name` como `al2023-ami-*-x86_64`; depois `ami = data.aws_ami.<name>.id`.',
        },
        test: all(readsData('aws_instance', 'ami', 'aws_ami'), dataArg('aws_ami', 'most_recent', true)),
      },
      {
        id: 'range',
        text: { en: 'A subnet carved from the VPC\'s range with `cidrsubnet`', pt: 'Uma sub-rede recortada do intervalo da VPC com `cidrsubnet`' },
        hint: {
          en: 'Inside the VPC (`vpc_id = aws_vpc.<name>.id`), with `cidr_block = cidrsubnet(aws_vpc.<name>.cidr_block, 8, 1)`.',
          pt: 'Dentro da VPC (`vpc_id = aws_vpc.<name>.id`), com `cidr_block = cidrsubnet(aws_vpc.<name>.cidr_block, 8, 1)`.',
        },
        test: all(inside('aws_subnet', 'aws_vpc'), writtenWith('aws_subnet', 'cidr_block', /\bcidrsubnet\(/), subnetRangesFit),
      },
      {
        id: 'zone',
        text: { en: 'The server in that subnet, in a zone that was looked up', pt: 'O servidor nessa sub-rede, numa zona que foi buscada' },
        hint: {
          en: 'A `data "aws_availability_zones"` with `state = "available"`; the subnet takes `names[0]` from it, and the server takes `subnet_id` from the subnet.',
          pt: 'Um `data "aws_availability_zones"` com `state = "available"`; a sub-rede pega `names[0]` dele, e o servidor pega `subnet_id` da sub-rede.',
        },
        test: all(readsData('aws_subnet', 'availability_zone', 'aws_availability_zones'), inside('aws_instance', 'aws_subnet')),
      },
      {
        id: 'tags',
        text: { en: 'VPC, subnet and server tagged from one local, merged with their own', pt: 'VPC, sub-rede e servidor com tags de um local, mescladas com as próprias' },
        hint: {
          en: 'A `locals` block with `common_tags = { ... }`; on each of the three, `tags = merge(local.common_tags, { Name = "..." })`.',
          pt: 'Um bloco `locals` com `common_tags = { ... }`; em cada um dos três, `tags = merge(local.common_tags, { Name = "..." })`.',
        },
        test: all(
          everyUsesLocal('aws_vpc', 'tags'),
          everyUsesLocal('aws_subnet', 'tags'),
          everyUsesLocal('aws_instance', 'tags'),
          writtenWith('aws_vpc', 'tags', /\bmerge\(/),
          writtenWith('aws_subnet', 'tags', /\bmerge\(/),
          writtenWith('aws_instance', 'tags', /\bmerge\(/),
        ),
      },
      {
        id: 'pasted',
        text: { en: 'Nothing pasted: no image id, zone name or resource id', pt: 'Nada colado: nenhum id de imagem, nome de zona ou id de recurso' },
        hint: {
          en: 'Search the code for `ami-`, `us-east-1a` or `vpc-` in quotes. Each one has a lookup or a reference that can replace it.',
          pt: 'Procure no código por `ami-`, `us-east-1a` ou `vpc-` entre aspas. Cada um tem uma consulta ou uma referência que pode substituí-lo.',
        },
        test: all(has('aws_instance'), nothingPasted()),
      },
      {
        id: 'apply',
        text: { en: 'Apply it', pt: 'Aplique' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`.',
          pt: 'No terminal: `init`, `plan`, `apply`.',
        },
        test: all(ran('apply'), applied('aws_instance')),
      },
    ],
  },
];
