/**
 * Level 0 · Fundamentals. Canvas lessons: the learner drags and uses the
 * inspector, reads the code it writes, and runs the simulated terminal.
 */
import { all, applied, argIs, argRefs, has, inside, not, ran, tagged, valueOf } from '../goals';
import type { Lesson } from '../types';
import { listOf, named, stateMatchesCode, tagCount } from './predicates-01';
import { aws } from './shared';

const HELLO = aws(`resource "aws_s3_bucket" "hello" {
  bucket = "hello-terraform-bucket"
}
`);

/* 0.6: the three kinds of change, each its own goal; the last apply needs all of them */
const ORIGINAL_NAME = 'photos-demo-2026';
const tagUpdated = all(tagged('aws_s3_bucket', 'Environment', 'prod'), ran('plan'));
const renamed = all(
  named('aws_s3_bucket', 'photos', (r, ctx) => {
    const name = valueOf(ctx.ir, r.args.bucket);
    return typeof name === 'string' && name !== '' && name !== ORIGINAL_NAME;
  }),
  ran('plan'),
);
const tempRemoved = all(not(named('aws_s3_bucket', 'temp')), has('aws_s3_bucket'), ran('plan'));

export const lessons: Lesson[] = [
  {
    slug: 'what-is-terraform',
    code: '0.1',
    kind: 'lesson',
    mode: 'canvas',
    minutes: 5,
    xp: 30,
    title: { en: 'What is Terraform?', pt: 'O que é Terraform?' },
    summary: {
      en: 'Describe what you want and let Terraform build it: init, plan, apply.',
      pt: 'Descreva o que você quer e deixe o Terraform construir: init, plan, apply.',
    },
    body: [
      {
        en: 'Clicking through a cloud console works the first time. Doing it again, exactly the same, for a second environment or after a mistake, is where it breaks. *Infrastructure as code* (IaC) means writing your infrastructure down in files you can read, review and run again.',
        pt: 'Clicar pelo console da nuvem funciona na primeira vez. Repetir tudo exatamente igual, para um segundo ambiente ou depois de um erro, é onde a coisa desanda. *Infraestrutura como código* (IaC) é escrever sua infraestrutura em arquivos que você pode ler, revisar e rodar de novo.',
      },
      {
        en: 'Terraform is an IaC tool, and it is *declarative*: you describe the result, not the steps. The code here says "there is an S3 bucket called `hello-terraform-bucket`", and the canvas draws that same code as a diagram. How to create the bucket, or whether it already exists, is Terraform\'s problem.',
        pt: 'O Terraform é uma ferramenta de IaC, e ele é *declarativo*: você descreve o resultado, não os passos. O código aqui diz "existe um bucket S3 chamado `hello-terraform-bucket`", e o canvas desenha esse mesmo código como diagrama. Como criar o bucket, ou se ele já existe, é problema do Terraform.',
      },
      {
        en: 'Three commands do the work. `terraform init` downloads the *provider*, the plugin that knows how to talk to AWS. `terraform plan` compares the code with what exists and lists what it would change. `terraform apply` makes it so. Run them in the terminal, in that order. It is all simulated: no AWS account, no bill.',
        pt: 'Três comandos fazem o trabalho. `terraform init` baixa o *provider*, o plugin que sabe conversar com a AWS. `terraform plan` compara o código com o que já existe e lista o que mudaria. `terraform apply` executa. Rode os três no terminal, nessa ordem. Tudo aqui é simulado: sem conta na AWS, sem cobrança.',
      },
      {
        en: 'Then run `terraform plan` once more. This time there is nothing to do, because the bucket already matches the code. That is the declarative idea at work: run Terraform twice and you still have one bucket.',
        pt: 'Depois, rode `terraform plan` mais uma vez. Agora não há nada a fazer, porque o bucket já corresponde ao código. É a ideia declarativa em ação: rode o Terraform duas vezes e você continua com um bucket só.',
      },
    ],
    asides: [
      {
        title: { en: 'What is AWS?', pt: 'O que é a AWS?' },
        body: [
          {
            en: 'AWS (Amazon Web Services) rents out computing by the hour: servers, storage, networks, databases. You can create them by clicking in its web console, or let a tool like Terraform call AWS for you.',
            pt: 'A AWS (Amazon Web Services) aluga computação por hora: servidores, armazenamento, redes, bancos de dados. Você pode criar tudo clicando no console web dela, ou deixar uma ferramenta como o Terraform chamar a AWS por você.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'What is S3?', pt: 'O que é o S3?' },
        body: [
          {
            en: 'S3 stores files of any size, from a photo to terabytes of backups. Files live in *buckets*: named containers you create first.',
            pt: 'O S3 guarda arquivos de qualquer tamanho, de uma foto a terabytes de backup. Os arquivos ficam em *buckets*: contêineres com nome que você cria antes.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: HELLO,
    solution: HELLO,
    goals: [
      {
        id: 'init',
        text: { en: 'Run `terraform init`', pt: 'Rode `terraform init`' },
        hint: {
          en: 'Click the terminal, type `terraform init` and press Enter. It prepares the project and downloads the AWS provider.',
          pt: 'Clique no terminal, digite `terraform init` e pressione Enter. Ele prepara o projeto e baixa o provider da AWS.',
        },
        test: ran('init'),
      },
      {
        id: 'plan',
        text: { en: 'Run `terraform plan`', pt: 'Rode `terraform plan`' },
        hint: {
          en: 'Type `terraform plan`. Look for the line that starts with `+`: the bucket Terraform would create.',
          pt: 'Digite `terraform plan`. Procure a linha que começa com `+`: é o bucket que o Terraform criaria.',
        },
        test: ran('plan'),
      },
      {
        id: 'apply',
        text: { en: 'Run `terraform apply`: the bucket exists', pt: 'Rode `terraform apply`: o bucket passa a existir' },
        hint: {
          en: 'Type `terraform apply`. It shows the plan once more and then creates the bucket.',
          pt: 'Digite `terraform apply`. Ele mostra o plano mais uma vez e então cria o bucket.',
        },
        test: applied('aws_s3_bucket'),
      },
    ],
  },
  {
    slug: 'first-resource',
    code: '0.2',
    kind: 'lesson',
    mode: 'canvas',
    minutes: 6,
    xp: 40,
    title: { en: 'Your first resource', pt: 'Seu primeiro recurso' },
    summary: {
      en: 'Drag an S3 bucket onto the canvas and meet its two names.',
      pt: 'Arraste um bucket S3 para o canvas e conheça os dois nomes dele.',
    },
    body: [
      {
        en: 'This time the code has only two blocks. `terraform` says which provider to download, and `provider "aws"` says which region to work in. Neither creates anything, so the canvas is empty.',
        pt: 'Desta vez o código tem só dois blocos. `terraform` diz qual provider baixar, e `provider "aws"` diz em qual região trabalhar. Nenhum dos dois cria nada, por isso o canvas está vazio.',
      },
      {
        en: 'A `resource` block is something Terraform creates and looks after. Drag an *S3 bucket* from the palette onto the canvas and watch the code: a block like `resource "aws_s3_bucket" "bucket" {}` appears. The first label is the *type*, the second is the block\'s *name*.',
        pt: 'Um bloco `resource` é algo que o Terraform cria e mantém. Arraste um *bucket S3* da paleta para o canvas e observe o código: aparece um bloco como `resource "aws_s3_bucket" "bucket" {}`. O primeiro rótulo é o *tipo*; o segundo, o *nome* do bloco.',
      },
      {
        en: 'So the bucket ends up with two names, and they do different jobs. The block\'s name is how *your code* refers to it: rename it to `photos` and the bucket becomes `aws_s3_bucket.photos`. The `bucket` argument is the name *AWS* sees, and no other bucket in the world can have it.',
        pt: 'Então o bucket acaba com dois nomes, e cada um tem uma função. O nome do bloco é como *o seu código* se refere a ele: renomeie para `photos` e o bucket passa a ser `aws_s3_bucket.photos`. O argumento `bucket` é o nome que *a AWS* enxerga, e nenhum outro bucket no mundo pode ter esse nome.',
      },
      {
        en: 'Set both in the inspector, then run `plan` and `apply`.',
        pt: 'Defina os dois no inspetor e depois rode `plan` e `apply`.',
      },
    ],
    asides: [
      {
        title: { en: 'Choosing a bucket name', pt: 'Como escolher o nome do bucket' },
        body: [
          {
            en: 'Bucket names are global, so `photos` was taken long ago. Use 3 to 63 characters: lowercase letters, digits and hyphens. Adding something of your own helps, like `photos-ana-2026`.',
            pt: 'Nomes de bucket são globais, então `photos` foi pego faz tempo. Use de 3 a 63 caracteres: letras minúsculas, dígitos e hifens. Acrescentar algo seu ajuda, como `photos-ana-2026`.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: aws(),
    solution: aws(`resource "aws_s3_bucket" "photos" {
  bucket = "photos-ana-2026"
}
`),
    goals: [
      {
        id: 'bucket',
        text: { en: 'An S3 bucket on the canvas', pt: 'Um bucket S3 no canvas' },
        hint: {
          en: 'Search for "s3" in the palette and drag *S3 Bucket* onto the canvas.',
          pt: 'Busque "s3" na paleta e arraste *Bucket S3* para o canvas.',
        },
        test: has('aws_s3_bucket'),
      },
      {
        id: 'label',
        text: { en: 'The block is named `photos`', pt: 'O bloco se chama `photos`' },
        hint: {
          en: 'Select the bucket and change *Terraform name* in the inspector to `photos`. In the code, it is the second label.',
          pt: 'Selecione o bucket e mude o *Nome no Terraform* no inspetor para `photos`. No código, é o segundo rótulo.',
        },
        test: named('aws_s3_bucket', 'photos'),
      },
      {
        id: 'name',
        text: { en: 'A valid name in `bucket`', pt: 'Um nome válido em `bucket`' },
        hint: {
          en: 'Fill in the *bucket* field with lowercase letters, digits and hyphens, like `photos-ana-2026`.',
          pt: 'Preencha o campo *bucket* com letras minúsculas, dígitos e hifens, como `photos-ana-2026`.',
        },
        test: argIs('aws_s3_bucket', 'bucket', /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
      },
      {
        id: 'apply',
        text: { en: 'Run `plan`, then `apply`', pt: 'Rode `plan` e depois `apply`' },
        hint: {
          en: 'In the terminal: `terraform init`, then `terraform plan` and `terraform apply`.',
          pt: 'No terminal: `terraform init`, depois `terraform plan` e `terraform apply`.',
        },
        test: all(ran('plan'), applied('aws_s3_bucket')),
      },
    ],
    teaches: ['aws_s3_bucket'],
  },
  {
    slug: 'arguments-and-types',
    code: '0.3',
    kind: 'lesson',
    mode: 'canvas',
    minutes: 6,
    xp: 40,
    title: { en: 'Arguments and types', pt: 'Argumentos e tipos' },
    summary: {
      en: 'Strings, numbers and booleans, set from the inspector on an SQS queue.',
      pt: 'Strings, números e booleanos, definidos pelo inspetor numa fila SQS.',
    },
    body: [
      {
        en: 'Each `name = value` line inside a block is an *argument*: one setting of the resource. Every value has a *type*, and Terraform checks types before it talks to AWS.',
        pt: 'Cada linha `name = value` dentro de um bloco é um *argumento*: uma configuração do recurso. Todo valor tem um *tipo*, e o Terraform confere os tipos antes de falar com a AWS.',
      },
      {
        en: 'Three types cover most arguments. A *string* is text in quotes: `"orders"`. A *number* has no quotes: `86400`. A *boolean* is `true` or `false`, also without quotes. Careful: `"true"` in quotes is a string, not a boolean.',
        pt: 'Três tipos cobrem a maioria dos argumentos. Uma *string* é texto entre aspas: `"orders"`. Um *número* não tem aspas: `86400`. Um *booleano* é `true` ou `false`, também sem aspas. Atenção: `"true"` entre aspas é uma string, não um booleano.',
      },
      {
        en: 'Drag an *SQS queue* onto the canvas and set it up in the inspector. Each field writes its own type: text fields add quotes, number fields don\'t, and yes/no fields write `true` or `false`. Keep an eye on the code as you go.',
        pt: 'Arraste uma *fila SQS* para o canvas e configure pelo inspetor. Cada campo escreve o próprio tipo: campos de texto põem aspas, campos numéricos não, e campos de sim ou não escrevem `true` ou `false`. Acompanhe o código enquanto isso.',
      },
      {
        en: 'Arguments can depend on each other. Setting `fifo_queue` to `true` makes the queue keep strict order, and AWS then requires its name to end in `.fifo`.',
        pt: 'Argumentos podem depender uns dos outros. Pôr `fifo_queue` em `true` faz a fila manter a ordem estrita, e aí a AWS exige que o nome termine em `.fifo`.',
      },
    ],
    asides: [
      {
        title: { en: 'What is SQS?', pt: 'O que é o SQS?' },
        body: [
          {
            en: 'SQS is a message queue. One program drops messages in, another picks them up when it is ready, so neither waits for the other. Think of order tickets in a restaurant kitchen: waiters hang them up, cooks take them in turn.',
            pt: 'O SQS é uma fila de mensagens. Um programa coloca mensagens nela, outro as retira quando estiver pronto, e nenhum espera pelo outro. Pense nas comandas de uma cozinha de restaurante: os garçons penduram, os cozinheiros pegam na vez.',
          },
          {
            en: 'A standard queue is fast but may deliver messages out of order. A FIFO queue (first in, first out) keeps the exact order.',
            pt: 'Uma fila padrão é rápida, mas pode entregar mensagens fora de ordem. Uma fila FIFO (primeiro a entrar, primeiro a sair) mantém a ordem exata.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: aws(),
    solution: aws(`resource "aws_sqs_queue" "orders" {
  name                      = "orders.fifo"
  fifo_queue                = true
  message_retention_seconds = 86400
}
`),
    goals: [
      {
        id: 'queue',
        text: { en: 'An SQS queue on the canvas', pt: 'Uma fila SQS no canvas' },
        hint: {
          en: 'Search for "sqs" in the palette and drag *SQS Queue* onto the canvas.',
          pt: 'Busque "sqs" na paleta e arraste *Fila SQS* para o canvas.',
        },
        test: has('aws_sqs_queue'),
      },
      {
        id: 'number',
        text: {
          en: '`message_retention_seconds` is the number `86400` (one day)',
          pt: '`message_retention_seconds` é o número `86400` (um dia)',
        },
        hint: {
          en: 'Type `86400` in the *message_retention_seconds* field. The code shows it without quotes: it is a number.',
          pt: 'Digite `86400` no campo *message_retention_seconds*. O código mostra o valor sem aspas: é um número.',
        },
        test: argIs('aws_sqs_queue', 'message_retention_seconds', 86400),
      },
      {
        id: 'boolean',
        text: { en: '`fifo_queue` is `true`', pt: '`fifo_queue` é `true`' },
        hint: {
          en: 'Pick `true` in the *fifo_queue* field. If you type it in the code, leave out the quotes: `"true"` would be a string.',
          pt: 'Escolha `true` no campo *fifo_queue*. Se digitar no código, sem aspas: `"true"` seria uma string.',
        },
        test: argIs('aws_sqs_queue', 'fifo_queue', true),
      },
      {
        id: 'string',
        text: { en: 'The `name` is a string ending in `.fifo`', pt: 'O `name` é uma string terminada em `.fifo`' },
        hint: {
          en: 'FIFO queues require it. Change *name* to `orders.fifo`: the inspector adds the quotes for you.',
          pt: 'Filas FIFO exigem isso. Mude o *name* para `orders.fifo`: o inspetor coloca as aspas para você.',
        },
        test: argIs('aws_sqs_queue', 'name', /\.fifo$/),
      },
      {
        id: 'plan',
        text: { en: 'Run `plan` and spot the three types', pt: 'Rode `plan` e encontre os três tipos' },
        hint: {
          en: '`terraform init`, then `terraform plan`. The name has quotes; `86400` and `true` don\'t.',
          pt: '`terraform init` e depois `terraform plan`. O nome tem aspas; `86400` e `true`, não.',
        },
        test: ran('plan'),
      },
    ],
    teaches: ['aws_sqs_queue'],
  },
  {
    slug: 'lists-and-maps',
    code: '0.4',
    kind: 'lesson',
    mode: 'canvas',
    minutes: 6,
    xp: 40,
    title: { en: 'Lists and maps', pt: 'Listas e mapas' },
    summary: {
      en: 'Values that hold many values: a list of addresses and a map of tags.',
      pt: 'Valores que guardam vários valores: uma lista de endereços e um mapa de tags.',
    },
    body: [
      {
        en: 'Some arguments hold several values. A *list* is an ordered row of values: `["192.0.2.10", "192.0.2.11"]`. A *map* pairs keys with values: `{ Project = "shop" }`. You have seen one already: the `aws = { ... }` in the `terraform` block.',
        pt: 'Alguns argumentos guardam vários valores. Uma *lista* é uma fileira ordenada de valores: `["192.0.2.10", "192.0.2.11"]`. Um *mapa* associa chaves a valores: `{ Project = "shop" }`. Você já viu um: o `aws = { ... }` no bloco `terraform`.',
      },
      {
        en: 'The record on the canvas sends `www.example.com` to a single server. Give it a second one: select the record and add `192.0.2.11` to *records* in the inspector. Watch the list grow in the code. (The line from the record to the zone is a reference: that is the next lesson.)',
        pt: 'O registro no canvas manda `www.example.com` para um único servidor. Dê a ele um segundo: selecione o registro e adicione `192.0.2.11` em *records* no inspetor. Veja a lista crescer no código. (A linha do registro até a zona é uma referência: esse é o assunto da próxima lição.)',
      },
      {
        en: 'Maps shine in `tags`: labels you stick on resources so anyone can tell what they are and who pays for them. Give the zone two tags, `Project` and `Environment`. Its *tags* field is under *All arguments* in the inspector.',
        pt: 'Mapas são perfeitos para `tags`: etiquetas que você cola nos recursos para qualquer pessoa saber o que são e quem paga por eles. Dê à zona duas tags, `Project` e `Environment`. O campo *tags* dela fica em *Todos os argumentos* no inspetor.',
      },
    ],
    asides: [
      {
        title: { en: 'What is Route 53?', pt: 'O que é o Route 53?' },
        body: [
          {
            en: 'Route 53 is the DNS of AWS: the internet\'s address book, turning names into IP addresses. A *zone* holds the records of one domain, like `example.com`. An `A` record points a name such as `www.example.com` to IPv4 addresses.',
            pt: 'O Route 53 é o DNS da AWS: a agenda de endereços da internet, que transforma nomes em endereços IP. Uma *zona* guarda os registros de um domínio, como `example.com`. Um registro `A` aponta um nome como `www.example.com` para endereços IPv4.',
          },
          {
            en: 'The range `192.0.2.0/24` is reserved for documentation, so these addresses are safe to use in examples.',
            pt: 'O intervalo `192.0.2.0/24` é reservado para documentação, então esses endereços são seguros para usar em exemplos.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: aws(`resource "aws_route53_zone" "main" {
  name = "example.com"
}

resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "www.example.com"
  type    = "A"
  ttl     = 300
  records = ["192.0.2.10"]
}
`),
    solution: aws(`resource "aws_route53_zone" "main" {
  name = "example.com"

  tags = {
    Project     = "shop"
    Environment = "dev"
  }
}

resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "www.example.com"
  type    = "A"
  ttl     = 300
  records = ["192.0.2.10", "192.0.2.11"]
}
`),
    goals: [
      {
        id: 'list',
        text: { en: 'The record points to two addresses', pt: 'O registro aponta para dois endereços' },
        hint: {
          en: 'Select the record, type `192.0.2.11` in the *records* field and press Enter.',
          pt: 'Selecione o registro, digite `192.0.2.11` no campo *records* e pressione Enter.',
        },
        test: listOf('aws_route53_record', 'records', 2),
      },
      {
        id: 'map',
        text: { en: 'The zone has two tags', pt: 'A zona tem duas tags' },
        hint: {
          en: 'Select the zone, open *All arguments*, search for `tags` and add `Project` and `Environment`, each with a value.',
          pt: 'Selecione a zona, abra *Todos os argumentos*, busque `tags` e adicione `Project` e `Environment`, cada uma com um valor.',
        },
        test: tagCount('aws_route53_zone', 2),
      },
      {
        id: 'plan',
        text: { en: 'Run `plan` and find the list and the map', pt: 'Rode `plan` e encontre a lista e o mapa' },
        hint: {
          en: '`terraform init`, then `terraform plan`. Lists show in brackets, maps in braces.',
          pt: '`terraform init` e depois `terraform plan`. Listas aparecem entre colchetes; mapas, entre chaves.',
        },
        test: ran('plan'),
      },
    ],
    teaches: ['aws_route53_zone', 'aws_route53_record'],
  },
  {
    slug: 'references',
    code: '0.5',
    kind: 'lesson',
    mode: 'canvas',
    minutes: 7,
    xp: 50,
    title: { en: 'References', pt: 'Referências' },
    summary: {
      en: 'Connect blocks to each other and watch the canvas draw lines and boxes.',
      pt: 'Ligue blocos entre si e veja o canvas desenhar linhas e caixas.',
    },
    body: [
      {
        en: 'Resources rarely live alone. A *reference* lets one block read another block\'s attribute: `aws_s3_bucket.photos.id` means "the `id` of the `aws_s3_bucket` named `photos`". Type, name and attribute, joined by dots.',
        pt: 'Recursos raramente vivem sozinhos. Uma *referência* permite que um bloco leia um atributo de outro: `aws_s3_bucket.photos.id` significa "o `id` do `aws_s3_bucket` chamado `photos`". Tipo, nome e atributo, unidos por pontos.',
      },
      {
        en: 'The canvas draws every reference. Usually it is a line between two nodes. When the reference means *lives inside*, like a subnet\'s `vpc_id`, the node is drawn inside the other one instead. Nothing on this diagram is decoration: it all comes from references in the code.',
        pt: 'O canvas desenha toda referência. Normalmente é uma linha entre dois nós. Quando a referência quer dizer *fica dentro de*, como o `vpc_id` de uma sub-rede, o nó é desenhado dentro do outro. Nada neste diagrama é enfeite: tudo vem de referências no código.',
      },
      {
        en: 'Try both. Drag a *public access block* onto the canvas, then drag from its right handle to the bucket: that line writes `bucket = aws_s3_bucket.photos.id` for you. Then drop a *subnet* inside the VPC box and look for `vpc_id` in its block.',
        pt: 'Experimente os dois. Arraste um *bloqueio de acesso público* para o canvas e depois arraste da alça direita dele até o bucket: essa linha escreve `bucket = aws_s3_bucket.photos.id` para você. Em seguida, solte uma *sub-rede* dentro da caixa da VPC e procure `vpc_id` no bloco dela.',
      },
      {
        en: 'References also decide the order. Terraform can\'t lock a bucket that doesn\'t exist yet, so it creates the bucket first and its block after. You never write that order down: it follows from the references, not from where the blocks sit in the file.',
        pt: 'As referências também decidem a ordem. O Terraform não consegue travar um bucket que ainda não existe, então cria o bucket primeiro e o bloqueio depois. Você nunca escreve essa ordem: ela vem das referências, não da posição dos blocos no arquivo.',
      },
    ],
    asides: [
      {
        title: { en: 'What is a public access block?', pt: 'O que é um bloqueio de acesso público?' },
        body: [
          {
            en: 'A safety switch for S3. With its four settings `true`, no policy or permission can make the bucket public, not even by mistake. Leaked buckets are among the most common cloud incidents, so every bucket deserves one.',
            pt: 'Uma trava de segurança do S3. Com as quatro configurações em `true`, nenhuma política ou permissão consegue tornar o bucket público, nem por engano. Buckets vazados estão entre os incidentes mais comuns na nuvem, então todo bucket merece uma.',
          },
        ],
        awsBasics: true,
      },
      {
        title: { en: 'What are a VPC and a subnet?', pt: 'O que são VPC e sub-rede?' },
        body: [
          {
            en: 'A VPC is your own private network inside AWS, and subnets split it into smaller networks where servers and databases live. Level 2 builds a network properly; here the VPC is just a box to drop things into.',
            pt: 'Uma VPC é a sua rede privada dentro da AWS, e as sub-redes a dividem em redes menores, onde ficam servidores e bancos de dados. O nível 2 monta uma rede de verdade; aqui a VPC é só uma caixa onde soltar coisas.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: aws(`resource "aws_s3_bucket" "photos" {
  bucket = "photos-demo-2026"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
`),
    solution: aws(`resource "aws_s3_bucket" "photos" {
  bucket = "photos-demo-2026"
}

resource "aws_s3_bucket_public_access_block" "block" {
  bucket                  = aws_s3_bucket.photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "subnet" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
`),
    goals: [
      {
        id: 'block',
        text: { en: 'A public access block connected to the bucket', pt: 'Um bloqueio de acesso público ligado ao bucket' },
        hint: {
          en: 'Drag *S3 Public Access Block* from the palette, then drag from its right handle onto the bucket. Or pick the bucket in its *bucket* field in the inspector.',
          pt: 'Arraste *Bloqueio de acesso público do S3* da paleta e depois arraste da alça direita dele até o bucket. Ou escolha o bucket no campo *bucket* dele, no inspetor.',
        },
        test: argRefs('aws_s3_bucket_public_access_block', 'bucket', 'aws_s3_bucket'),
      },
      {
        id: 'subnet',
        text: { en: 'A subnet inside the VPC', pt: 'Uma sub-rede dentro da VPC' },
        hint: {
          en: 'Drag *Subnet* from the palette and release it over the VPC box. The subnet gets `vpc_id = aws_vpc.main.id` and a free address range.',
          pt: 'Arraste *Sub-rede* da paleta e solte sobre a caixa da VPC. A sub-rede ganha `vpc_id = aws_vpc.main.id` e um intervalo de endereços livre.',
        },
        test: inside('aws_subnet', 'aws_vpc'),
      },
      {
        id: 'apply',
        text: {
          en: 'Run `apply` and check the order: the bucket comes before its block',
          pt: 'Rode `apply` e confira a ordem: o bucket vem antes do bloqueio',
        },
        hint: {
          en: 'In the terminal: `terraform init`, then `terraform apply`. Read the creation lines from top to bottom.',
          pt: 'No terminal: `terraform init` e depois `terraform apply`. Leia as linhas de criação de cima para baixo.',
        },
        test: all(applied('aws_s3_bucket_public_access_block'), applied('aws_subnet')),
      },
    ],
    teaches: ['aws_s3_bucket_public_access_block'],
  },
  {
    slug: 'plan-apply-cycle',
    code: '0.6',
    kind: 'lesson',
    mode: 'canvas',
    minutes: 8,
    xp: 60,
    title: { en: 'The plan/apply cycle', pt: 'O ciclo plan/apply' },
    summary: {
      en: 'Update, replace, destroy: learn to read what a plan is about to do.',
      pt: 'Alterar, substituir, destruir: aprenda a ler o que um plano vai fazer.',
    },
    body: [
      {
        en: 'A plan is the difference between your code and what exists. Each change starts with a symbol: `+` create, `~` update in place, `-/+` replace (destroy, then create anew) and `-` destroy. The last line adds them up: `Plan: 0 to add, 1 to change, 0 to destroy.`',
        pt: 'Um plano é a diferença entre o seu código e o que já existe. Cada mudança começa com um símbolo: `+` cria, `~` altera no lugar, `-/+` substitui (destrói e cria de novo) e `-` destrói. A última linha soma tudo: `Plan: 0 to add, 1 to change, 0 to destroy.`',
      },
      {
        en: 'Start by applying the code as it is. Then make one change at a time and run `plan` after each, reading its symbol before you move on.',
        pt: 'Comece aplicando o código como está. Depois faça uma mudança de cada vez e rode `plan` após cada uma, lendo o símbolo antes de seguir.',
      },
      {
        en: 'Change the `Environment` tag to `prod`: tags can change on a live bucket, so it is `~`. Give `photos` a new `bucket` name: AWS can\'t rename a bucket, so Terraform destroys it and creates another, `-/+`. Then delete `temp` from the canvas: a block removed from the code is a resource destroyed in the cloud, `-`.',
        pt: 'Mude a tag `Environment` para `prod`: tags podem mudar num bucket existente, então é `~`. Dê ao `photos` um novo nome em `bucket`: a AWS não renomeia buckets, então o Terraform destrói e cria outro, `-/+`. Depois exclua o `temp` no canvas: um bloco removido do código é um recurso destruído na nuvem, `-`.',
      },
      {
        en: 'Look twice before applying a `-/+`: a replaced bucket comes back *empty*. Reading the plan is how you catch that in time. When you are done, `apply` once more so the cloud matches the code.',
        pt: 'Olhe duas vezes antes de aplicar um `-/+`: um bucket substituído volta *vazio*. Ler o plano é como você percebe isso a tempo. No fim, rode `apply` mais uma vez para a nuvem ficar igual ao código.',
      },
    ],
    start: aws(`resource "aws_s3_bucket" "photos" {
  bucket = "${ORIGINAL_NAME}"

  tags = {
    Environment = "dev"
  }
}

resource "aws_s3_bucket" "temp" {
  bucket = "temp-demo-2026"
}
`),
    solution: aws(`resource "aws_s3_bucket" "photos" {
  bucket = "photos-prod-2026"

  tags = {
    Environment = "prod"
  }
}
`),
    goals: [
      {
        id: 'apply',
        text: { en: 'Apply the starting code', pt: 'Aplique o código inicial' },
        hint: {
          en: '`terraform init`, then `terraform apply`: two buckets are created.',
          pt: '`terraform init` e depois `terraform apply`: dois buckets são criados.',
        },
        test: applied('aws_s3_bucket'),
      },
      {
        id: 'update',
        text: { en: '`Environment` is `prod`: an update in place, `~`', pt: '`Environment` vale `prod`: alteração no lugar, `~`' },
        hint: {
          en: 'Select the `photos` bucket and edit the tag\'s value in the inspector, then run `plan`.',
          pt: 'Selecione o bucket `photos` e edite o valor da tag no inspetor; depois rode `plan`.',
        },
        test: tagUpdated,
      },
      {
        id: 'replace',
        text: { en: '`photos` has a new `bucket` name: a replacement, `-/+`', pt: 'O `photos` tem um novo nome em `bucket`: substituição, `-/+`' },
        hint: {
          en: 'Change the *bucket* field of `photos` to any other valid name, then run `plan` and find the `-/+`.',
          pt: 'Mude o campo *bucket* do `photos` para qualquer outro nome válido; depois rode `plan` e encontre o `-/+`.',
        },
        test: renamed,
      },
      {
        id: 'destroy',
        text: { en: '`temp` is gone from the code: a destroy, `-`', pt: 'O `temp` saiu do código: destruição, `-`' },
        hint: {
          en: 'Select the `temp` bucket and press Delete (or use *Delete resource* in the inspector), then run `plan`.',
          pt: 'Selecione o bucket `temp` e pressione Del (ou use *Excluir recurso* no inspetor); depois rode `plan`.',
        },
        test: tempRemoved,
      },
      {
        id: 'sync',
        text: { en: 'Apply again: the cloud matches the code', pt: 'Aplique de novo: a nuvem fica igual ao código' },
        hint: {
          en: 'Run `terraform apply`. It carries out the three changes together, and a new `plan` finds nothing left to do.',
          pt: 'Rode `terraform apply`. Ele faz as três mudanças juntas, e um novo `plan` não encontra mais nada a fazer.',
        },
        test: all(tagUpdated, renamed, tempRemoved, stateMatchesCode),
      },
    ],
  },
];
