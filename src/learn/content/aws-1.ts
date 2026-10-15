/**
 * Level 1 · First resources. The canvas still does what it can (buckets,
 * tags, public access blocks); variables, locals, outputs and the versioning
 * resource aren't on the palette, so those parts are small typed edits.
 */
import { all, applied, argRefs, noErrors, ran, variable } from '../goals';
import type { Lesson } from '../types';
import { bucketPrivate, bucketVersioned, everyUsesLocal, fromVar, hasLocals, outputReads, tagCount } from './predicates-01';
import { aws } from './shared';

const ENVIRONMENT_VAR = `variable "environment" {
  type    = string
  default = "dev"
}
`;

const PUBLIC_ACCESS_BLOCK = (bucket: string) => `resource "aws_s3_bucket_public_access_block" "${bucket}" {
  bucket                  = aws_s3_bucket.${bucket}.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
`;

const VERSIONING = (bucket: string, status: string) => `resource "aws_s3_bucket_versioning" "${bucket}" {
  bucket = aws_s3_bucket.${bucket}.id

  versioning_configuration {
    status = "${status}"
  }
}
`;

const TWO_BUCKETS = `resource "aws_s3_bucket" "site" {
  bucket = "acme-\${var.environment}-site"

  tags = {
    Project     = "acme"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_s3_bucket" "logs" {
  bucket = "acme-\${var.environment}-logs"

  tags = {
    Project     = "acme"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
`;

const SITE_BUCKET = `resource "aws_s3_bucket" "site" {
  bucket = "acme-site-assets"
}
`;

export const lessons: Lesson[] = [
  {
    slug: 's3-bucket-tags',
    code: '1.1',
    kind: 'lesson',
    mode: 'mixed',
    minutes: 7,
    xp: 50,
    title: { en: 'A bucket done right', pt: 'Um bucket bem feito' },
    summary: {
      en: 'Tags, a public access block and versioning: the bucket real projects use.',
      pt: 'Tags, bloqueio de acesso público e versionamento: o bucket dos projetos reais.',
    },
    body: [
      {
        en: 'This bucket will hold the files of a website: HTML, CSS, images. A bare bucket works, but real projects give every bucket three extras, and you will add them here.',
        pt: 'Este bucket vai guardar os arquivos de um site: HTML, CSS, imagens. Um bucket simples funciona, mas projetos reais dão três extras a todo bucket, e você vai acrescentá-los aqui.',
      },
      {
        en: '*Tags*, so anyone can tell what a resource is for and whose budget pays for it: add `Project` and `Environment` in the inspector. A *public access block*, connected like in lesson 0.5, so the files never leak by mistake.',
        pt: '*Tags*, para qualquer pessoa saber para que serve o recurso e qual orçamento paga por ele: adicione `Project` e `Environment` no inspetor. Um *bloqueio de acesso público*, ligado como na lição 0.5, para os arquivos nunca vazarem por engano.',
      },
      {
        en: 'And *versioning*, so overwriting or deleting a file keeps the old copy. In AWS provider v5 it is a separate resource that points at the bucket, and it is already in the code: `aws_s3_bucket_versioning`. The palette doesn\'t offer it yet, so this part is typed: in the code panel, change its `status` from `"Suspended"` to `"Enabled"`.',
        pt: 'E *versionamento*, para que sobrescrever ou excluir um arquivo mantenha a cópia antiga. Na versão 5 do provider da AWS ele é um recurso separado que aponta para o bucket, e já está no código: `aws_s3_bucket_versioning`. A paleta ainda não o oferece, então esta parte é digitada: no painel de código, troque o `status` de `"Suspended"` para `"Enabled"`.',
      },
    ],
    asides: [
      {
        title: { en: 'Why is versioning a separate resource?', pt: 'Por que o versionamento é um recurso separado?' },
        body: [
          {
            en: 'Older code turns it on with a `versioning` block inside `aws_s3_bucket`. That block is deprecated now: each bucket setting (versioning, encryption, lifecycle rules) is a resource of its own that points at the bucket. You will still find the old style online, so it helps to recognize it.',
            pt: 'Códigos mais antigos ligam o versionamento com um bloco `versioning` dentro de `aws_s3_bucket`. Esse bloco agora é obsoleto: cada configuração do bucket (versionamento, criptografia, regras de ciclo de vida) é um recurso próprio que aponta para o bucket. Você ainda vai encontrar o estilo antigo por aí, então é bom reconhecê-lo.',
          },
        ],
      },
    ],
    start: aws(`${SITE_BUCKET}
${VERSIONING('site', 'Suspended')}`),
    solution: aws(`resource "aws_s3_bucket" "site" {
  bucket = "acme-site-assets"

  tags = {
    Project     = "acme"
    Environment = "dev"
  }
}

${VERSIONING('site', 'Enabled')}
${PUBLIC_ACCESS_BLOCK('site')}`),
    goals: [
      {
        id: 'tags',
        text: { en: 'The bucket has `Project` and `Environment` tags', pt: 'O bucket tem as tags `Project` e `Environment`' },
        hint: {
          en: 'Select the bucket, find *tags* in the inspector and add each key with a value, like `acme` and `dev`.',
          pt: 'Selecione o bucket, encontre *tags* no inspetor e adicione cada chave com um valor, como `acme` e `dev`.',
        },
        test: tagCount('aws_s3_bucket', 2),
      },
      {
        id: 'block',
        text: { en: 'A public access block connected to the bucket', pt: 'Um bloqueio de acesso público ligado ao bucket' },
        hint: {
          en: 'Drag *S3 Public Access Block* from the palette and connect it to the bucket from its right handle. Its four settings come `true` already.',
          pt: 'Arraste *Bloqueio de acesso público do S3* da paleta e ligue ao bucket pela alça direita. As quatro configurações já vêm em `true`.',
        },
        test: bucketPrivate,
      },
      {
        id: 'versioning',
        text: { en: 'Versioning is `"Enabled"`', pt: 'O versionamento está `"Enabled"`' },
        hint: {
          en: 'In the code panel, find `status = "Suspended"` inside `aws_s3_bucket_versioning` and swap the word. Mind the capital E.',
          pt: 'No painel de código, encontre `status = "Suspended"` dentro de `aws_s3_bucket_versioning` e troque a palavra. Atenção ao E maiúsculo.',
        },
        test: bucketVersioned,
      },
      {
        id: 'apply',
        text: { en: 'Run `apply`', pt: 'Rode `apply`' },
        hint: {
          en: '`terraform init`, then `terraform apply`. Three resources: the bucket, its versioning and its block.',
          pt: '`terraform init` e depois `terraform apply`. Três recursos: o bucket, o versionamento e o bloqueio.',
        },
        test: all(applied('aws_s3_bucket_versioning'), applied('aws_s3_bucket_public_access_block')),
      },
    ],
    teaches: ['aws_s3_bucket'],
  },
  {
    slug: 'variables',
    code: '1.2',
    kind: 'lesson',
    mode: 'mixed',
    minutes: 7,
    xp: 50,
    title: { en: 'Variables', pt: 'Variáveis' },
    summary: {
      en: 'Turn hard-coded values into inputs with `variable` and `var`.',
      pt: 'Transforme valores fixos em entradas com `variable` e `var`.',
    },
    body: [
      {
        en: '`dev` is written twice in this bucket. To create a `prod` copy you would hunt down every spot by hand, and sooner or later miss one.',
        pt: '`dev` aparece escrito duas vezes neste bucket. Para criar uma cópia `prod`, você teria que caçar cada ocorrência à mão, e mais cedo ou mais tarde esqueceria uma.',
      },
      {
        en: 'A `variable` block declares an *input* of the project: a name, a `type` and, if you like, a `default`. The code reads it as `var.<name>`. Think of the project as a function and its variables as the parameters.',
        pt: 'Um bloco `variable` declara uma *entrada* do projeto: um nome, um `type` e, se quiser, um `default`. O código lê o valor como `var.<name>`. Pense no projeto como uma função e nas variáveis como os parâmetros dela.',
      },
      {
        en: 'Variables live in `variables.tf` by convention, and they are typed, not drawn: a variable isn\'t infrastructure, so it never shows on the canvas. Declare `environment` there, then use `var.environment` for the tag. In the name, `${...}` puts a value inside a string: `"acme-site-${var.environment}"`.',
        pt: 'Por convenção, as variáveis ficam em `variables.tf`, e elas são digitadas, não desenhadas: variável não é infraestrutura, então nunca aparece no canvas. Declare `environment` lá e use `var.environment` na tag. No nome, `${...}` coloca um valor dentro de uma string: `"acme-site-${var.environment}"`.',
      },
      {
        en: 'Run `plan`: it shows `acme-site-dev`, with the variable already replaced by its value. Change the `default` and plan again to see both spots follow.',
        pt: 'Rode `plan`: ele mostra `acme-site-dev`, com a variável já trocada pelo valor. Mude o `default` e rode o plan de novo para ver os dois lugares acompanharem.',
      },
    ],
    asides: [
      {
        title: { en: 'Other types', pt: 'Outros tipos' },
        body: [
          {
            en: 'Besides `string` there are `number`, `bool`, `list(string)`, `map(string)` and more. The type catches mistakes early: give `"ten"` to a `number` and Terraform stops before calling AWS.',
            pt: 'Além de `string`, existem `number`, `bool`, `list(string)`, `map(string)` e outros. O tipo pega erros cedo: passe `"ten"` para um `number` e o Terraform para antes de chamar a AWS.',
          },
        ],
      },
      {
        title: { en: 'Where do values come from?', pt: 'De onde vêm os valores?' },
        body: [
          {
            en: 'The `default` is used when nobody passes a value. Real projects also pass values with `-var`, a `terraform.tfvars` file or environment variables like `TF_VAR_environment`.',
            pt: 'O `default` vale quando ninguém passa um valor. Projetos reais também passam valores com `-var`, um arquivo `terraform.tfvars` ou variáveis de ambiente como `TF_VAR_environment`.',
          },
        ],
      },
    ],
    start: aws(
      `resource "aws_s3_bucket" "site" {
  bucket = "acme-site-dev"

  tags = {
    Project     = "acme"
    Environment = "dev"
  }
}
`,
      { 'variables.tf': '# The inputs of this project.\n' },
    ),
    solution: aws(
      `resource "aws_s3_bucket" "site" {
  bucket = "acme-site-\${var.environment}"

  tags = {
    Project     = "acme"
    Environment = var.environment
  }
}
`,
      { 'variables.tf': ENVIRONMENT_VAR },
    ),
    goals: [
      {
        id: 'declare',
        text: { en: 'A `variable` with a `type` and a `default`', pt: 'Uma `variable` com `type` e `default`' },
        hint: {
          en: 'In `variables.tf`, type `variable "environment" {`, then `type = string` and `default = "dev"` on lines of their own, and close it with `}`.',
          pt: 'Em `variables.tf`, digite `variable "environment" {`, depois `type = string` e `default = "dev"` em linhas próprias, e feche com `}`.',
        },
        test: variable(undefined, { type: 'string', hasDefault: true }),
      },
      {
        id: 'tag',
        text: { en: 'A tag reads the variable', pt: 'Uma tag lê a variável' },
        hint: {
          en: 'In `main.tf`, replace the `"dev"` of the tag with `var.environment`, no quotes.',
          pt: 'Em `main.tf`, troque o `"dev"` da tag por `var.environment`, sem aspas.',
        },
        test: argRefs('aws_s3_bucket', 'tags', 'var'),
      },
      {
        id: 'name',
        text: { en: 'The bucket name reads the variable', pt: 'O nome do bucket lê a variável' },
        hint: {
          en: 'Write `bucket = "acme-site-${var.environment}"`. The `${...}` goes inside the quotes.',
          pt: 'Escreva `bucket = "acme-site-${var.environment}"`. O `${...}` vai dentro das aspas.',
        },
        test: argRefs('aws_s3_bucket', 'bucket', 'var'),
      },
      {
        id: 'plan',
        text: { en: 'Run `plan` and find the real name', pt: 'Rode `plan` e encontre o nome de verdade' },
        hint: {
          en: '`terraform init`, then `terraform plan`. Look at the `bucket` line.',
          pt: '`terraform init` e depois `terraform plan`. Olhe a linha de `bucket`.',
        },
        test: ran('plan'),
      },
    ],
  },
  {
    slug: 'locals',
    code: '1.3',
    kind: 'lesson',
    mode: 'mixed',
    minutes: 8,
    xp: 50,
    title: { en: 'Locals', pt: 'Valores locais' },
    summary: {
      en: 'Name a value once and reuse it everywhere: common tags and computed names.',
      pt: 'Dê nome a um valor uma vez e reutilize em todo lugar: tags comuns e nomes calculados.',
    },
    body: [
      {
        en: 'Two buckets: the same three tags written twice, the same name pattern twice. A third bucket makes it three times, and sooner or later one copy drifts away from the others.',
        pt: 'Dois buckets: as mesmas três tags escritas duas vezes, o mesmo padrão de nome duas vezes. Um terceiro bucket faz virar três, e cedo ou tarde uma cópia se desencontra das outras.',
      },
      {
        en: 'A `locals` block names a value inside the project, worked out once and reused as `local.<name>`. Variables are inputs that come from outside; locals are your own shorthand, and they can be built from variables. Mind the spelling: the block is `locals`, the reference is `local`.',
        pt: 'Um bloco `locals` dá nome a um valor dentro do projeto, calculado uma vez e reutilizado como `local.<name>`. Variáveis são entradas que vêm de fora; locals são atalhos seus, e podem ser montados a partir de variáveis. Atenção à grafia: o bloco é `locals`, a referência é `local`.',
      },
      {
        en: 'Before refactoring, `apply` the code as it is. Then, at the top of `main.tf`, write a `locals` block with `name_prefix = "acme-${var.environment}"` and a `common_tags` map holding the three tags. Give both buckets `tags = local.common_tags` and names like `"${local.name_prefix}-logs"`.',
        pt: 'Antes de refatorar, rode `apply` no código como está. Depois, no topo de `main.tf`, escreva um bloco `locals` com `name_prefix = "acme-${var.environment}"` e um mapa `common_tags` com as três tags. Dê aos dois buckets `tags = local.common_tags` e nomes como `"${local.name_prefix}-logs"`.',
      },
      {
        en: 'Now run `plan`. The best result a refactor can get: `No changes`. Same infrastructure, cleaner code.',
        pt: 'Agora rode `plan`. O melhor resultado que uma refatoração pode ter: `No changes`. Mesma infraestrutura, código mais limpo.',
      },
    ],
    asides: [
      {
        title: { en: 'Variable or local?', pt: 'Variável ou local?' },
        body: [
          {
            en: 'Use a variable when the value changes from one use of the project to the next: the environment, a size. Use a local when it is derived or repeated inside the project: a name prefix, common tags. If nobody outside should set it, it is a local.',
            pt: 'Use uma variável quando o valor muda de um uso do projeto para outro: o ambiente, um tamanho. Use um local quando ele é derivado ou repetido dentro do projeto: um prefixo de nome, tags comuns. Se ninguém de fora deve definir o valor, é um local.',
          },
        ],
      },
    ],
    start: aws(TWO_BUCKETS, { 'variables.tf': ENVIRONMENT_VAR }),
    solution: aws(
      `locals {
  name_prefix = "acme-\${var.environment}"

  common_tags = {
    Project     = "acme"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_s3_bucket" "site" {
  bucket = "\${local.name_prefix}-site"
  tags   = local.common_tags
}

resource "aws_s3_bucket" "logs" {
  bucket = "\${local.name_prefix}-logs"
  tags   = local.common_tags
}
`,
      { 'variables.tf': ENVIRONMENT_VAR },
    ),
    goals: [
      {
        id: 'apply',
        text: { en: 'Apply the starting code first', pt: 'Aplique o código inicial primeiro' },
        hint: {
          en: '`terraform init`, then `terraform apply`. The `plan` at the end compares against this.',
          pt: '`terraform init` e depois `terraform apply`. O `plan` do final compara com isto.',
        },
        test: applied('aws_s3_bucket'),
      },
      {
        id: 'locals',
        text: { en: 'A `locals` block', pt: 'Um bloco `locals`' },
        hint: {
          en: 'At the top of `main.tf`: `locals {`, one value per line, then `}`. Start with `name_prefix = "acme-${var.environment}"`.',
          pt: 'No topo de `main.tf`: `locals {`, um valor por linha, depois `}`. Comece com `name_prefix = "acme-${var.environment}"`.',
        },
        test: hasLocals,
      },
      {
        id: 'tags',
        text: { en: 'Both buckets take their tags from `locals`', pt: 'Os dois buckets pegam as tags de `locals`' },
        hint: {
          en: 'Move the three tags into `common_tags = { ... }` inside `locals`, then write `tags = local.common_tags` in each bucket.',
          pt: 'Leve as três tags para `common_tags = { ... }` dentro de `locals` e escreva `tags = local.common_tags` em cada bucket.',
        },
        test: everyUsesLocal('aws_s3_bucket', 'tags'),
      },
      {
        id: 'names',
        text: { en: 'Both names are built from `locals`', pt: 'Os dois nomes são montados a partir de `locals`' },
        hint: {
          en: 'Write `bucket = "${local.name_prefix}-site"` in one bucket and the same with `-logs` in the other.',
          pt: 'Escreva `bucket = "${local.name_prefix}-site"` em um bucket e o mesmo com `-logs` no outro.',
        },
        test: everyUsesLocal('aws_s3_bucket', 'bucket'),
      },
      {
        id: 'plan',
        text: { en: 'Run `plan`: `No changes`', pt: 'Rode `plan`: `No changes`' },
        hint: {
          en: 'If the plan wants to change something, a value came out different: compare the names and tags with the starting code.',
          pt: 'Se o plano quiser mudar algo, algum valor saiu diferente: compare os nomes e as tags com o código inicial.',
        },
        test: ran('plan'),
      },
    ],
  },
  {
    slug: 'outputs',
    code: '1.4',
    kind: 'lesson',
    mode: 'mixed',
    minutes: 6,
    xp: 40,
    title: { en: 'Outputs', pt: 'Outputs do projeto' },
    summary: {
      en: 'Print the values that only exist after `apply`, like the bucket ARN.',
      pt: 'Mostre os valores que só existem depois do `apply`, como o ARN do bucket.',
    },
    body: [
      {
        en: 'Some values only exist after `apply`: the ARN AWS gives the bucket, an IP address, a website URL. An `output` block prints a value at the end of `apply` and keeps it in the state for later.',
        pt: 'Alguns valores só existem depois do `apply`: o ARN que a AWS dá ao bucket, um endereço IP, a URL de um site. Um bloco `output` mostra um valor no fim do `apply` e o guarda no estado para depois.',
      },
      {
        en: 'Outputs are also how a project hands values to the outside world: to scripts, to your CI, to other Terraform projects. If variables are the parameters of a function, outputs are its return values.',
        pt: 'Outputs também são como um projeto entrega valores para o mundo de fora: para scripts, para o seu CI, para outros projetos Terraform. Se as variáveis são os parâmetros de uma função, os outputs são o retorno dela.',
      },
      {
        en: 'By convention they live in `outputs.tf`. Add `bucket_name` with `value = aws_s3_bucket.site.bucket`, and another one for the bucket\'s `arn`. An output\'s value is a reference like any other.',
        pt: 'Por convenção, eles ficam em `outputs.tf`. Adicione `bucket_name` com `value = aws_s3_bucket.site.bucket` e outro para o `arn` do bucket. O valor de um output é uma referência como qualquer outra.',
      },
      {
        en: 'Run `plan` first: the ARN shows as `(known after apply)`, because AWS hasn\'t created anything yet. Then `apply` and find both values under `Outputs:`.',
        pt: 'Rode `plan` primeiro: o ARN aparece como `(known after apply)`, porque a AWS ainda não criou nada. Depois rode `apply` e encontre os dois valores em `Outputs:`.',
      },
    ],
    asides: [
      {
        title: { en: 'What is an ARN?', pt: 'O que é um ARN?' },
        body: [
          {
            en: 'An Amazon Resource Name is the full, unique address of a resource across all of AWS, like `arn:aws:s3:::acme-site-assets`. Permissions and other services point at resources by their ARN.',
            pt: 'Um Amazon Resource Name é o endereço completo e único de um recurso em toda a AWS, como `arn:aws:s3:::acme-site-assets`. Permissões e outros serviços apontam para recursos pelo ARN.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: aws(SITE_BUCKET, { 'outputs.tf': '# What this project reports after apply.\n' }),
    solution: aws(SITE_BUCKET, {
      'outputs.tf': `output "bucket_name" {
  description = "The name of the website bucket"
  value       = aws_s3_bucket.site.bucket
}

output "bucket_arn" {
  description = "The ARN of the website bucket"
  value       = aws_s3_bucket.site.arn
}
`,
    }),
    goals: [
      {
        id: 'name',
        text: { en: 'An output with the bucket\'s name', pt: 'Um output com o nome do bucket' },
        hint: {
          en: 'In `outputs.tf`: `output "bucket_name" {`, then `value = aws_s3_bucket.site.bucket`, then `}`.',
          pt: 'Em `outputs.tf`: `output "bucket_name" {`, depois `value = aws_s3_bucket.site.bucket`, depois `}`.',
        },
        test: outputReads('aws_s3_bucket', /^(bucket|id)$/),
      },
      {
        id: 'arn',
        text: { en: 'An output with the bucket\'s `arn`', pt: 'Um output com o `arn` do bucket' },
        hint: {
          en: 'Same shape, another name: `value = aws_s3_bucket.site.arn`.',
          pt: 'Mesmo formato, outro nome: `value = aws_s3_bucket.site.arn`.',
        },
        test: outputReads('aws_s3_bucket', /^arn$/),
      },
      {
        id: 'apply',
        text: { en: 'Run `apply` and read the outputs', pt: 'Rode `apply` e leia os outputs' },
        hint: {
          en: '`terraform init`, then `terraform apply`. The outputs come last.',
          pt: '`terraform init` e depois `terraform apply`. Os outputs vêm por último.',
        },
        test: all(ran('apply'), applied('aws_s3_bucket')),
      },
    ],
  },
  {
    slug: 'challenge-private-bucket',
    code: 'C1',
    kind: 'challenge',
    mode: 'mixed',
    minutes: 12,
    xp: 140,
    title: { en: 'Challenge: a private bucket', pt: 'Desafio: um bucket privado' },
    summary: {
      en: 'No steps this time: a private, versioned bucket named from a variable.',
      pt: 'Sem passo a passo: um bucket privado e versionado, com nome vindo de uma variável.',
    },
    body: [
      {
        en: 'Your turn, with no step-by-step. The team needs a bucket for backups. It must be *private*, it must keep old versions of every file, its name must come from a variable, and `apply` must print that name.',
        pt: 'Sua vez, sem passo a passo. O time precisa de um bucket para backups. Ele tem que ser *privado*, tem que guardar versões antigas de cada arquivo, o nome tem que vir de uma variável, e o `apply` tem que mostrar esse nome.',
      },
      {
        en: 'Everything you need is in levels 0 and 1. Use the canvas where it helps and type the rest. Name things your own way: the goals check the result, not the spelling.',
        pt: 'Tudo de que você precisa está nos níveis 0 e 1. Use o canvas onde ajudar e digite o resto. Dê os nomes que quiser: os objetivos conferem o resultado, não a grafia.',
      },
    ],
    start: aws('', {
      'variables.tf': '# The inputs of this project.\n',
      'outputs.tf': '# What this project reports after apply.\n',
    }),
    solution: aws(
      `resource "aws_s3_bucket" "backups" {
  bucket = var.bucket_name

  tags = {
    Project = "backups"
  }
}

${VERSIONING('backups', 'Enabled')}
${PUBLIC_ACCESS_BLOCK('backups')}`,
      {
        'variables.tf': `variable "bucket_name" {
  description = "Name of the backups bucket"
  type        = string
  default     = "acme-backups-dev"
}
`,
        'outputs.tf': `output "bucket_name" {
  value = aws_s3_bucket.backups.bucket
}
`,
      },
    ),
    goals: [
      {
        id: 'variable',
        text: { en: 'The bucket\'s name comes from a variable', pt: 'O nome do bucket vem de uma variável' },
        hint: {
          en: 'Declare a `variable` with a `default` in `variables.tf` and use `var.<name>` in the bucket\'s `bucket` argument (lesson 1.2).',
          pt: 'Declare uma `variable` com `default` em `variables.tf` e use `var.<name>` no argumento `bucket` do bucket (lição 1.2).',
        },
        test: fromVar('aws_s3_bucket', 'bucket'),
      },
      {
        id: 'versioned',
        text: { en: 'Versioning is on', pt: 'O versionamento está ligado' },
        hint: {
          en: 'An `aws_s3_bucket_versioning` whose `bucket` references your bucket, with `status = "Enabled"` inside `versioning_configuration` (lesson 1.1).',
          pt: 'Um `aws_s3_bucket_versioning` cujo `bucket` referencia o seu bucket, com `status = "Enabled"` dentro de `versioning_configuration` (lição 1.1).',
        },
        test: bucketVersioned,
      },
      {
        id: 'private',
        text: {
          en: 'Public access is blocked, all four settings `true`',
          pt: 'O acesso público está bloqueado, com as quatro configurações em `true`',
        },
        hint: {
          en: 'A public access block from the palette, connected to the bucket (lesson 0.5).',
          pt: 'Um bloqueio de acesso público da paleta, ligado ao bucket (lição 0.5).',
        },
        test: bucketPrivate,
      },
      {
        id: 'output',
        text: { en: 'An output prints the bucket\'s name', pt: 'Um output mostra o nome do bucket' },
        hint: {
          en: 'In `outputs.tf`, an `output` whose `value` is your bucket\'s `bucket` or `id` (lesson 1.4).',
          pt: 'Em `outputs.tf`, um `output` cujo `value` é o `bucket` ou o `id` do seu bucket (lição 1.4).',
        },
        test: outputReads('aws_s3_bucket', /^(bucket|id)$/),
      },
      {
        id: 'apply',
        text: { en: 'Applied, with no errors', pt: 'Aplicado, sem erros' },
        hint: {
          en: 'Run `terraform init` and `terraform apply`. If the code panel shows red marks, fix those first.',
          pt: 'Rode `terraform init` e `terraform apply`. Se o painel de código mostrar marcas vermelhas, corrija-as antes.',
        },
        test: all(noErrors, applied('aws_s3_bucket')),
      },
    ],
  },
];
