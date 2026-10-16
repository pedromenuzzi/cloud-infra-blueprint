/**
 * Level 8 · Production (code): what changes when Terraform runs for a team.
 * Remote state and its bootstrap, one code for many environments, secrets
 * kept out of the code, lifecycle rules, adopting and handing over objects
 * with `import` and `removed`, and reading a plan like a reviewer.
 * Lessons ship the extra files they need (`backend.tf`, `dev.tfvars`).
 */
import { all, applied, argIs, argRefs, argSet, noErrors, not, ran } from '../goals';
import type { Files, Lesson } from '../types';
import { bucketPrivate, bucketVersioned } from './predicates-01';
import {
  backendIs,
  backendLocked,
  backendOnOwnBucket,
  backendS3Set,
  declares,
  environmentVariable,
  ignores,
  importsApplied,
  importsInto,
  inSync,
  managesPassword,
  noneTyped,
  noSecretsInCode,
  planDestroysNothing,
  removedGone,
  removedKeeps,
  secretFromAws,
  secretOutputsSensitive,
  stateAttr,
  stateHolds,
  varFile,
  varFilesDiffer,
} from './predicates-8';
import { aws } from './shared';

const AL2023 = `data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}
`;

/* ------------------------------------------------------------ 8.1 */

const STATE_START = aws(
  `# Step 1: the bucket that will hold the state of every project.
# Give it versioning, a public access block and prevent_destroy,
# then apply it with the local state, as usual.
resource "aws_s3_bucket" "state" {
  bucket = "acme-terraform-state"
}
`,
  {
    'backend.tf': `# Step 2: once the bucket exists, keep this project's state in it.
# A backend "s3" block goes inside a terraform block, here.
`,
  },
);

const STATE_SOLUTION = aws(
  `resource "aws_s3_bucket" "state" {
  bucket = "acme-terraform-state"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
`,
  {
    'backend.tf': `terraform {
  backend "s3" {
    bucket       = "acme-terraform-state"
    key          = "bootstrap/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
`,
  },
);

/* ------------------------------------------------------------ 8.2 */

const ENV_START = aws(
  `${AL2023}
# Only one environment fits in this code: dev is typed everywhere.
resource "aws_s3_bucket" "uploads" {
  bucket = "acme-shop-dev-uploads"

  tags = {
    Environment = "dev"
  }
}

resource "aws_instance" "app" {
  ami           = data.aws_ami.al2023.id
  instance_type = "t3.micro"

  metadata_options {
    http_tokens = "required"
  }

  tags = {
    Name        = "shop-dev-app"
    Environment = "dev"
  }
}
`,
  {
    'variables.tf': '# What changes between environments: the environment\'s name and the server size.\n',
    'dev.tfvars': '# Values for dev, one per line: name = value\n',
    'prod.tfvars': '# Values for prod, one per line: name = value\n',
  },
);

const ENV_SOLUTION = aws(
  `${AL2023}
resource "aws_s3_bucket" "uploads" {
  bucket = "acme-shop-\${var.environment}-uploads"

  tags = {
    Environment = var.environment
  }
}

resource "aws_instance" "app" {
  ami           = data.aws_ami.al2023.id
  instance_type = var.instance_type

  metadata_options {
    http_tokens = "required"
  }

  tags = {
    Name        = "shop-\${var.environment}-app"
    Environment = var.environment
  }
}
`,
  {
    'variables.tf': `variable "environment" {
  description = "Where this copy runs: dev or prod"
  type        = string
  default     = "dev"
}

variable "instance_type" {
  description = "Size of the app server"
  type        = string
  default     = "t3.micro"
}
`,
    'dev.tfvars': `environment   = "dev"
instance_type = "t3.micro"
`,
    'prod.tfvars': `environment   = "prod"
instance_type = "t3.large"
`,
  },
);

/* ------------------------------------------------------------ 8.3 */

const SECRETS_START = aws(`# The shop's database, and the settings its deploy pipeline reads.
# Three secrets are in plain sight in this file. Find them all.

variable "db_password" {
  description = "Master password of the database"
  type        = string
  default     = "Sup3r-Secret-2026"
}

variable "payments_api_key" {
  description = "Key for the payments provider"
  type        = string
  default     = "pk_live_51Hx9aQ2"
}

resource "aws_db_instance" "main" {
  identifier          = "shop-db"
  engine              = "postgres"
  instance_class      = "db.t4g.micro"
  allocated_storage   = 20
  username            = "shop"
  password            = var.db_password
  storage_encrypted   = true
  skip_final_snapshot = true
}

output "app_settings" {
  value = {
    db_host          = aws_db_instance.main.address
    payments_api_key = var.payments_api_key
  }
}
`);

const SECRETS_SOLUTION = aws(`data "aws_ssm_parameter" "payments_api_key" {
  name = "/shop/payments-api-key"
}

resource "aws_db_instance" "main" {
  identifier                  = "shop-db"
  engine                      = "postgres"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  username                    = "shop"
  manage_master_user_password = true
  storage_encrypted           = true
  skip_final_snapshot         = true
}

output "db_host" {
  value = aws_db_instance.main.address
}

output "payments_api_key" {
  value     = data.aws_ssm_parameter.payments_api_key.value
  sensitive = true
}
`);

/* ------------------------------------------------------------ 8.4 */

const DATABASE = (lifecycle = '') => `resource "aws_db_instance" "main" {
  identifier                  = "shop-db"
  engine                      = "postgres"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  username                    = "shop"
  manage_master_user_password = true
  storage_encrypted           = true
  skip_final_snapshot         = true
${lifecycle}}
`;

const TEMPLATE = (size: string) => `resource "aws_launch_template" "web" {
  name_prefix   = "web-"
  image_id      = data.aws_ami.al2023.id
  instance_type = "${size}"

  metadata_options {
    http_tokens = "required"
  }
}
`;

const LIFECYCLE_START = aws(`${AL2023}
${DATABASE()}
${TEMPLATE('t3.micro')}
resource "aws_autoscaling_group" "web" {
  name               = "web"
  min_size           = 2
  max_size           = 6
  desired_capacity   = 2
  availability_zones = ["us-east-1a", "us-east-1b"]

  launch_template {
    id      = aws_launch_template.web.id
    version = aws_launch_template.web.latest_version
  }
}
`);

const LIFECYCLE_SOLUTION = aws(`${AL2023}
${DATABASE(`
  lifecycle {
    prevent_destroy = true
  }
`)}
${TEMPLATE('t3.small')}
resource "aws_autoscaling_group" "web" {
  name_prefix        = "web-"
  min_size           = 2
  max_size           = 6
  desired_capacity   = 2
  availability_zones = ["us-east-1a", "us-east-1b"]

  launch_template {
    id      = aws_launch_template.web.id
    version = aws_launch_template.web.latest_version
  }

  lifecycle {
    create_before_destroy = true
    ignore_changes        = [desired_capacity]
    replace_triggered_by  = [aws_launch_template.web.latest_version]
  }
}
`);

/* ------------------------------------------------------------ 8.5 */

const IMPORT_START = aws(`# Step 1: apply this as it is. For now, the reports bucket is ours.
resource "aws_s3_bucket" "reports" {
  bucket = "acme-legacy-reports"
}

# Step 2: the data team takes the reports bucket over, in their own project.
#         Stop managing it here, without deleting it.

# Step 3: "acme-invoices-2023" was created by hand in the console, back in
#         2023, and holds every invoice since. Bring it under Terraform.
`);

const IMPORT_SOLUTION = aws(`removed {
  from = aws_s3_bucket.reports

  lifecycle {
    destroy = false
  }
}

import {
  to = aws_s3_bucket.invoices
  id = "acme-invoices-2023"
}

resource "aws_s3_bucket" "invoices" {
  bucket = "acme-invoices-2023"

  lifecycle {
    prevent_destroy = true
  }
}
`);

/* ------------------------------------------------------------ 8.6 */

const REVIEW_START = aws(`# Production, as it is on main. Apply it first.
#
# Then make the four changes of Ana's pull request, exactly as written,
# run plan and review it before anything else:
#   1. instance_class "db.t4g.micro" becomes "db.t4g.small"
#   2. allocated_storage 20 becomes 50
#   3. username "shop" becomes "shop_admin"
#   4. the bucket block "assets" is renamed to "static_assets"

resource "aws_db_instance" "main" {
  identifier                  = "shop-db"
  engine                      = "postgres"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  username                    = "shop"
  manage_master_user_password = true
  storage_encrypted           = true
  skip_final_snapshot         = true
}

resource "aws_s3_bucket" "assets" {
  bucket = "acme-shop-assets"
}
`);

const REVIEW_SOLUTION = aws(`resource "aws_db_instance" "main" {
  identifier                  = "shop-db"
  engine                      = "postgres"
  instance_class              = "db.t4g.small"
  allocated_storage           = 50
  username                    = "shop"
  manage_master_user_password = true
  storage_encrypted           = true
  skip_final_snapshot         = true
}

resource "aws_s3_bucket" "static_assets" {
  bucket = "acme-shop-assets"
}

moved {
  from = aws_s3_bucket.assets
  to   = aws_s3_bucket.static_assets
}
`);

/* ------------------------------------------------------------ C8 */

const CHALLENGE_START: Files = aws(
  `# Challenge: make this stack production ready.
#   1. backend.tf: the state in S3, encrypted and locked.
#   2. dev.tfvars and prod.tfvars: one code, two environments.
#   3. No secret in any file, and outputs that carry one marked sensitive.
#   4. The database protected against destroy.
#   5. The media bucket, created by hand in each environment as
#      acme-shop-dev-media and acme-shop-prod-media, adopted with import.
#   6. A plan that destroys and replaces nothing, then apply.

variable "payments_api_key" {
  description = "Key for the payments provider"
  type        = string
  default     = "pk_live_51Hx9aQ2"
}

resource "aws_db_instance" "main" {
  identifier          = "shop-dev-db"
  engine              = "postgres"
  instance_class      = "db.t4g.micro"
  allocated_storage   = 20
  username            = "shop"
  password            = "Change-me-2026"
  storage_encrypted   = true
  skip_final_snapshot = true
}

resource "aws_s3_bucket" "uploads" {
  bucket = "acme-shop-dev-uploads"
}

output "db_host" {
  value = aws_db_instance.main.address
}

output "payments_api_key" {
  value = var.payments_api_key
}
`,
  {
    'backend.tf': '# Where the state lives.\n',
    'variables.tf': '# What changes between environments.\n',
    'dev.tfvars': '# Values for dev.\n',
    'prod.tfvars': '# Values for prod.\n',
  },
);

const CHALLENGE_SOLUTION = aws(
  `data "aws_ssm_parameter" "payments_api_key" {
  name = "/shop/\${var.environment}/payments-api-key"
}

resource "aws_db_instance" "main" {
  identifier                  = "shop-\${var.environment}-db"
  engine                      = "postgres"
  instance_class              = var.db_instance_class
  allocated_storage           = 20
  username                    = "shop"
  manage_master_user_password = true
  storage_encrypted           = true
  skip_final_snapshot         = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket" "uploads" {
  bucket = "acme-shop-\${var.environment}-uploads"
}

import {
  to = aws_s3_bucket.media
  id = "acme-shop-\${var.environment}-media"
}

resource "aws_s3_bucket" "media" {
  bucket = "acme-shop-\${var.environment}-media"
}

output "db_host" {
  value = aws_db_instance.main.address
}

output "payments_api_key" {
  value     = data.aws_ssm_parameter.payments_api_key.value
  sensitive = true
}
`,
  {
    'backend.tf': `# Each environment passes its own key at init:
#   terraform init -backend-config="key=shop/prod/terraform.tfstate"
terraform {
  backend "s3" {
    bucket       = "acme-terraform-state"
    key          = "shop/dev/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
`,
    'variables.tf': `variable "environment" {
  description = "Where this copy runs: dev or prod"
  type        = string
  default     = "dev"
}

variable "db_instance_class" {
  description = "Size of the database"
  type        = string
  default     = "db.t4g.micro"
}
`,
    'dev.tfvars': `environment       = "dev"
db_instance_class = "db.t4g.micro"
`,
    'prod.tfvars': `environment       = "prod"
db_instance_class = "db.t4g.medium"
`,
  },
);

const ASG = 'aws_autoscaling_group';

export const lessons: Lesson[] = [
  /* ------------------------------------------------------------ 8.1 */
  {
    slug: 'remote-state',
    code: '8.1',
    kind: 'lesson',
    mode: 'code',
    minutes: 12,
    xp: 100,
    title: { en: 'Remote state', pt: 'Estado remoto' },
    summary: {
      en: 'Move Terraform\'s memory off your laptop: a state bucket, a `backend "s3"` and a lock, solving the bootstrap puzzle on the way.',
      pt: 'Tire a memória do Terraform do seu notebook: um bucket de estado, um `backend "s3"` e um bloqueio, resolvendo no caminho o quebra-cabeça do bootstrap.',
    },
    body: [
      {
        en: 'Every `apply` so far ended the same way: Terraform wrote down what it built. Which block made which object, its id, every attribute. That record is the *state*, a JSON file named `terraform.tfstate`. The code says what you want; the state says what Terraform already has. Every plan is the difference between the two.',
        pt: 'Todo `apply` até aqui terminou do mesmo jeito: o Terraform anotou o que construiu. Qual bloco criou qual objeto, o id dele, cada atributo. Esse registro é o *estado*, um arquivo JSON chamado `terraform.tfstate`. O código diz o que você quer; o estado diz o que o Terraform já tem. Todo plano é a diferença entre os dois.',
      },
      {
        en: 'On a laptop, that file breaks the day a second person joins. Your teammate clones the repository and runs `plan`: no state, so Terraform offers to create everything again, next to what already runs. Two people applying at once both write the file, and one of them loses. And a lost laptop takes Terraform\'s memory with it: the cloud keeps running, and nothing remembers what manages it.',
        pt: 'Num notebook, esse arquivo quebra no dia em que entra uma segunda pessoa. Sua colega clona o repositório e roda `plan`: sem estado, o Terraform propõe criar tudo de novo, ao lado do que já está rodando. Se duas pessoas aplicam ao mesmo tempo, as duas escrevem no arquivo, e uma delas perde. E um notebook perdido leva junto a memória do Terraform: a nuvem continua rodando, e nada lembra quem a gerencia.',
      },
      {
        en: 'The fix is a *backend*: the state lives somewhere shared. On AWS, that\'s an S3 bucket. A `backend "s3"` block inside `terraform {}` names the `bucket`, the `key` (the path of the state file inside it, one per project and environment), the `region`, `encrypt = true` and a lock. With `use_lockfile = true`, every command that writes the state first leaves a small `.tflock` file next to it; whoever tries at the same moment gets `Error acquiring the state lock` and waits their turn.',
        pt: 'A solução é um *backend*: o estado mora num lugar compartilhado. Na AWS, um bucket S3. Um bloco `backend "s3"` dentro de `terraform {}` informa o `bucket`, a `key` (o caminho do arquivo de estado dentro dele, um por projeto e ambiente), a `region`, `encrypt = true` e um bloqueio. Com `use_lockfile = true`, todo comando que escreve o estado deixa antes um pequeno arquivo `.tflock` ao lado dele; quem tentar no mesmo momento recebe `Error acquiring the state lock` e espera a vez.',
      },
      {
        en: 'Now the famous catch: the bucket must exist before any project can keep its state in it, including the project that creates the bucket. The way out takes two steps. First, create the bucket with the local state, as you\'ve done all along. Then add the backend and run `init` again: Terraform notices the new backend and offers to copy the local state into the bucket. From then on, even the bucket\'s own state lives inside it.',
        pt: 'Agora a pegadinha famosa: o bucket precisa existir antes que qualquer projeto guarde o estado nele, inclusive o projeto que cria o bucket. A saída tem dois passos. Primeiro, crie o bucket com o estado local, como você fez até agora. Depois adicione o backend e rode `init` de novo: o Terraform percebe o backend novo e oferece copiar o estado local para o bucket. Daí em diante, até o estado do próprio bucket mora dentro dele.',
      },
      {
        en: 'Give the bucket what a state bucket needs: versioning, so every version of the state is kept and a broken one can be restored; a public access block; and `prevent_destroy`, which lesson 8.4 covers properly: Terraform refuses any plan that would delete the bucket. Apply. Then write the backend in `backend.tf` and run `init`.',
        pt: 'Dê ao bucket o que um bucket de estado precisa: versionamento, para que cada versão do estado fique guardada e uma quebrada possa ser restaurada; um bloqueio de acesso público; e `prevent_destroy`, que a lição 8.4 explica direito: o Terraform recusa qualquer plano que excluiria o bucket. Aplique. Depois escreva o backend no `backend.tf` e rode `init`.',
      },
    ],
    asides: [
      {
        title: { en: 'Locking before `use_lockfile`', pt: 'Bloqueio antes do `use_lockfile`' },
        body: [
          {
            en: 'S3 only learned to hold the lock itself in Terraform 1.10. Before that, the lock lived in a DynamoDB table, named with `dynamodb_table = "terraform-locks"`. You\'ll meet it in many projects: it still works, though it\'s now deprecated in favour of `use_lockfile`.',
            pt: 'O S3 só aprendeu a guardar o bloqueio sozinho no Terraform 1.10. Antes disso, o bloqueio morava numa tabela do DynamoDB, indicada com `dynamodb_table = "terraform-locks"`. Você vai encontrar isso em muitos projetos: ainda funciona, mas agora é obsoleto em favor do `use_lockfile`.',
          },
          {
            en: 'A run that crashes can leave its lock behind. `terraform force-unlock` with the lock\'s id releases it, once you are sure nobody else is running.',
            pt: 'Uma execução que cai pode deixar o bloqueio para trás. `terraform force-unlock` com o id do bloqueio o libera, depois que você tiver certeza de que ninguém mais está rodando.',
          },
        ],
      },
      {
        title: { en: 'No variables in a backend', pt: 'Nada de variáveis no backend' },
        body: [
          {
            en: 'The backend is read before anything else, so `bucket = var.state_bucket` fails with `Variables may not be used here`. What changes per environment goes in at `init` time instead: `terraform init -backend-config="key=shop/prod/terraform.tfstate"`.',
            pt: 'O backend é lido antes de tudo, então `bucket = var.state_bucket` falha com `Variables may not be used here`. O que muda por ambiente entra na hora do `init`: `terraform init -backend-config="key=shop/prod/terraform.tfstate"`.',
          },
        ],
      },
      {
        title: { en: 'The state is a vault', pt: 'O estado é um cofre' },
        body: [
          {
            en: 'Open a state file and you\'ll find every attribute of every resource in plain text, including passwords and keys some resources return. Keep the state bucket encrypted, versioned, private, and readable only by the people and pipelines that run Terraform. Lesson 8.3 comes back to this.',
            pt: 'Abra um arquivo de estado e você vai encontrar cada atributo de cada recurso em texto puro, inclusive senhas e chaves que alguns recursos devolvem. Mantenha o bucket de estado criptografado, versionado, privado e legível só pelas pessoas e pipelines que rodam o Terraform. A lição 8.3 volta a esse assunto.',
          },
        ],
      },
    ],
    start: STATE_START,
    solution: STATE_SOLUTION,
    goals: [
      {
        id: 'versioned',
        text: { en: 'A state bucket with versioning', pt: 'Um bucket de estado com versionamento' },
        hint: {
          en: 'An `aws_s3_bucket_versioning` with `bucket = aws_s3_bucket.state.id` and a `versioning_configuration` block whose `status = "Enabled"`, as in level 1.',
          pt: 'Um `aws_s3_bucket_versioning` com `bucket = aws_s3_bucket.state.id` e um bloco `versioning_configuration` com `status = "Enabled"`, como no nível 1.',
        },
        test: bucketVersioned,
      },
      {
        id: 'private',
        text: { en: 'No public access', pt: 'Sem acesso público' },
        hint: {
          en: 'An `aws_s3_bucket_public_access_block` for the bucket with its four settings `true`: `block_public_acls`, `block_public_policy`, `ignore_public_acls` and `restrict_public_buckets`.',
          pt: 'Um `aws_s3_bucket_public_access_block` para o bucket com as quatro opções em `true`: `block_public_acls`, `block_public_policy`, `ignore_public_acls` e `restrict_public_buckets`.',
        },
        test: bucketPrivate,
      },
      {
        id: 'guarded',
        text: { en: 'Guarded with `prevent_destroy`', pt: 'Protegido com `prevent_destroy`' },
        hint: {
          en: 'Inside the bucket\'s block, a `lifecycle` block with `prevent_destroy = true`.',
          pt: 'Dentro do bloco do bucket, um bloco `lifecycle` com `prevent_destroy = true`.',
        },
        test: argIs('aws_s3_bucket', 'lifecycle.prevent_destroy', true),
      },
      {
        id: 'bootstrap',
        text: { en: 'Step 1: apply with the local state', pt: 'Passo 1: aplique com o estado local' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`. The state is still a local file, and the bucket that will hold it now exists.',
          pt: 'No terminal: `init`, `plan`, `apply`. O estado ainda é um arquivo local, e o bucket que vai guardá-lo agora existe.',
        },
        test: all(applied('aws_s3_bucket'), applied('aws_s3_bucket_versioning')),
      },
      {
        id: 'backend',
        text: { en: 'Step 2: a `backend "s3"` in that bucket', pt: 'Passo 2: um `backend "s3"` nesse bucket' },
        hint: {
          en: 'In `backend.tf`, a `terraform` block with a `backend "s3"` block inside, holding `bucket = "acme-terraform-state"`, a `key` like `"bootstrap/terraform.tfstate"` and `region = "us-east-1"`. Plain strings: a backend reads no variables.',
          pt: 'No `backend.tf`, um bloco `terraform` com um bloco `backend "s3"` dentro, contendo `bucket = "acme-terraform-state"`, uma `key` como `"bootstrap/terraform.tfstate"` e `region = "us-east-1"`. Strings simples: um backend não lê variáveis.',
        },
        test: backendOnOwnBucket,
      },
      {
        id: 'locked',
        text: { en: 'Encrypted, locked, and `init` again', pt: 'Criptografado, com bloqueio, e `init` de novo' },
        hint: {
          en: 'Add `encrypt = true` and `use_lockfile = true` to the backend, then run `init`: it moves the state into the bucket.',
          pt: 'Acrescente `encrypt = true` e `use_lockfile = true` ao backend e rode `init`: ele leva o estado para dentro do bucket.',
        },
        test: all(backendIs('encrypt', true), backendLocked, ran('init')),
      },
    ],
  },

  /* ------------------------------------------------------------ 8.2 */
  {
    slug: 'environments',
    code: '8.2',
    kind: 'lesson',
    mode: 'code',
    minutes: 12,
    xp: 100,
    title: { en: 'One code, many environments', pt: 'Um código, vários ambientes' },
    summary: {
      en: 'Turn what differs between dev and prod into variables, give each environment a `.tfvars` file, and meet workspaces.',
      pt: 'Transforme o que muda entre dev e prod em variáveis, dê a cada ambiente um arquivo `.tfvars` e conheça os workspaces.',
    },
    body: [
      {
        en: 'Real projects live more than once: a `dev` to try things, a `prod` your customers use, often a `staging` in between. Same architecture, different names and sizes. Copying the folder for each one works for a week, until a fix lands in one copy and not the others. What you want is one code, many environments.',
        pt: 'Projetos reais vivem mais de uma vez: um `dev` para testar, um `prod` que seus clientes usam, muitas vezes um `staging` no meio. Mesma arquitetura, nomes e tamanhos diferentes. Copiar a pasta para cada um funciona por uma semana, até uma correção entrar numa cópia e não nas outras. O que você quer é um código, vários ambientes.',
      },
      {
        en: 'Start by finding what changes. In the starting code, `dev` is typed in four places and the server size in one. Turn them into two variables, `environment` and `instance_type`, and build the names from them: `"acme-shop-${var.environment}-uploads"`. Give each variable dev\'s value as its `default`, so a plan with no flags is the harmless one.',
        pt: 'Comece achando o que muda. No código inicial, `dev` está digitado em quatro lugares e o tamanho do servidor em um. Transforme isso em duas variáveis, `environment` e `instance_type`, e monte os nomes a partir delas: `"acme-shop-${var.environment}-uploads"`. Dê a cada variável o valor de dev como `default`, para que um plano sem parâmetros seja o inofensivo.',
      },
      {
        en: 'Then write each environment\'s values in a file of its own. A `.tfvars` file holds nothing but `name = value` lines: `dev.tfvars` says `instance_type = "t3.micro"`, `prod.tfvars` says `"t3.large"`. You pick one when you run: `terraform plan -var-file=prod.tfvars`. Same code, two plans, and the difference between them is exactly the difference between the files.',
        pt: 'Depois escreva os valores de cada ambiente num arquivo próprio. Um arquivo `.tfvars` só tem linhas `name = value`: o `dev.tfvars` diz `instance_type = "t3.micro"`, o `prod.tfvars` diz `"t3.large"`. Você escolhe um na hora de rodar: `terraform plan -var-file=prod.tfvars`. Mesmo código, dois planos, e a diferença entre eles é exatamente a diferença entre os arquivos.',
      },
      {
        en: 'One thing must never be shared: the state. Dev\'s apply must not see prod\'s resources. Terraform\'s built-in answer is *workspaces*: `terraform workspace new prod` starts a second state for the same code, `terraform workspace select dev` switches back, and `terraform.workspace` tells the code which one is running. With an S3 backend, each workspace gets a file of its own in the bucket.',
        pt: 'Uma coisa nunca pode ser compartilhada: o estado. O apply de dev não pode enxergar os recursos de prod. A resposta embutida do Terraform são os *workspaces*: `terraform workspace new prod` começa um segundo estado para o mesmo código, `terraform workspace select dev` volta, e `terraform.workspace` diz ao código qual deles está rodando. Com um backend S3, cada workspace ganha um arquivo próprio no bucket.',
      },
      {
        en: 'Write the variables, fill both files and run `plan` with each. Then try `terraform workspace new prod` in the terminal and watch the plan start again from an empty state.',
        pt: 'Escreva as variáveis, preencha os dois arquivos e rode `plan` com cada um. Depois experimente `terraform workspace new prod` no terminal e veja o plano recomeçar de um estado vazio.',
      },
    ],
    asides: [
      {
        title: { en: 'Workspaces or folders?', pt: 'Workspaces ou pastas?' },
        body: [
          {
            en: 'Workspaces share everything except the state: the same code, the same backend, the same credentials. That suits short-lived copies, like one environment per feature branch. The risk is human: one forgotten `terraform workspace select` and the next apply lands in prod.',
            pt: 'Workspaces compartilham tudo menos o estado: o mesmo código, o mesmo backend, as mesmas credenciais. Isso combina com cópias de vida curta, como um ambiente por branch de funcionalidade. O risco é humano: um `terraform workspace select` esquecido e o próximo apply cai em prod.',
          },
          {
            en: 'For long-lived environments, most teams prefer a folder per environment (`envs/dev`, `envs/prod`): each a small root module that calls the shared modules from level 6, with its own backend `key`, often in its own AWS account. More files, but no way to mix them up: you are in the folder you are in.',
            pt: 'Para ambientes de vida longa, a maioria dos times prefere uma pasta por ambiente (`envs/dev`, `envs/prod`): cada uma é um pequeno módulo raiz que chama os módulos compartilhados do nível 6, com sua própria `key` no backend, muitas vezes na sua própria conta AWS. Mais arquivos, mas sem como confundir: você está na pasta em que está.',
          },
        ],
      },
      {
        title: { en: 'Files Terraform reads by itself', pt: 'Arquivos que o Terraform lê sozinho' },
        body: [
          {
            en: '`terraform.tfvars` and any `*.auto.tfvars` load on every run, no flag needed; other files, like `prod.tfvars`, only with `-var-file`. `-var` and `-var-file` on the command line win over both, and `TF_VAR_instance_type` in the environment loses to all of them.',
            pt: '`terraform.tfvars` e qualquer `*.auto.tfvars` são carregados em toda execução, sem parâmetro; os outros arquivos, como `prod.tfvars`, só com `-var-file`. `-var` e `-var-file` na linha de comando ganham dos dois, e `TF_VAR_instance_type` no ambiente perde para todos.',
          },
        ],
      },
    ],
    start: ENV_START,
    solution: ENV_SOLUTION,
    goals: [
      {
        id: 'vars',
        text: { en: 'Variables for the environment and the server size', pt: 'Variáveis para o ambiente e o tamanho do servidor' },
        hint: {
          en: 'In `variables.tf`: `variable "environment"` and `variable "instance_type"`, each with `type = string` and dev\'s value as `default`. Then `instance_type = var.instance_type` in the server.',
          pt: 'No `variables.tf`: `variable "environment"` e `variable "instance_type"`, cada uma com `type = string` e o valor de dev como `default`. Depois `instance_type = var.instance_type` no servidor.',
        },
        test: all(environmentVariable, argRefs('aws_instance', 'instance_type', 'var')),
      },
      {
        id: 'names',
        text: { en: 'No environment typed into the resources', pt: 'Nenhum ambiente digitado nos recursos' },
        hint: {
          en: 'Every `"dev"` becomes `var.environment`, and inside a name a template does it: `"shop-${var.environment}-app"`.',
          pt: 'Cada `"dev"` vira `var.environment`, e dentro de um nome quem resolve é um template: `"shop-${var.environment}-app"`.',
        },
        test: all(noneTyped(/\bdev\b/i), noneTyped(/\bprod\b/i)),
      },
      {
        id: 'dev',
        text: { en: '`dev.tfvars` with dev\'s values', pt: '`dev.tfvars` com os valores de dev' },
        hint: {
          en: 'Two lines: `environment = "dev"` and `instance_type = "t3.micro"`. Only names you declared as variables.',
          pt: 'Duas linhas: `environment = "dev"` e `instance_type = "t3.micro"`. Só nomes que você declarou como variáveis.',
        },
        test: varFile('dev', 2),
      },
      {
        id: 'prod',
        text: { en: '`prod.tfvars`: prod, on a bigger server', pt: '`prod.tfvars`: prod, num servidor maior' },
        hint: {
          en: '`environment = "prod"` and `instance_type = "t3.large"`.',
          pt: '`environment = "prod"` e `instance_type = "t3.large"`.',
        },
        test: all(varFile('prod', 2), varFilesDiffer(2)),
      },
      {
        id: 'plan',
        text: { en: 'Plan with each file', pt: 'Rode o plano com cada arquivo' },
        hint: {
          en: 'In the terminal: `terraform init`, then `terraform plan -var-file=dev.tfvars` and `terraform plan -var-file=prod.tfvars`. Compare the names and the `instance_type`.',
          pt: 'No terminal: `terraform init`, depois `terraform plan -var-file=dev.tfvars` e `terraform plan -var-file=prod.tfvars`. Compare os nomes e o `instance_type`.',
        },
        test: all(ran('plan'), noErrors),
      },
    ],
  },

  /* ------------------------------------------------------------ 8.3 */
  {
    slug: 'sensitive-values',
    code: '8.3',
    kind: 'lesson',
    mode: 'code',
    minutes: 12,
    xp: 110,
    title: { en: 'Secrets and sensitive values', pt: 'Segredos e valores sensíveis' },
    summary: {
      en: 'Get three secrets out of the code: a password AWS manages, a key read from Parameter Store, and an output marked `sensitive`.',
      pt: 'Tire três segredos do código: uma senha que a AWS gerencia, uma chave lida do Parameter Store e um output marcado como `sensitive`.',
    },
    body: [
      {
        en: 'Code lives in git, and git never forgets. A password typed into a `.tf` file is in every clone, every fork and every backup of the repository, for good: deleting the line later only adds a commit. The starting code has three secrets in plain sight. Find them before you read on.',
        pt: 'Código mora no git, e o git nunca esquece. Uma senha digitada num arquivo `.tf` está em cada clone, cada fork e cada backup do repositório, para sempre: apagar a linha depois só acrescenta um commit. O código inicial tem três segredos à vista. Ache os três antes de continuar lendo.',
      },
      {
        en: 'The best secret is one Terraform never holds. With `manage_master_user_password = true`, RDS creates the database password itself, keeps it in AWS Secrets Manager and can rotate it. It never reaches your code, your plan or your state; the application reads it from Secrets Manager. Swap `password` for that line and delete the variable.',
        pt: 'O melhor segredo é aquele que o Terraform nunca segura. Com `manage_master_user_password = true`, o próprio RDS cria a senha do banco, guarda no AWS Secrets Manager e pode trocá-la periodicamente. Ela nunca chega ao seu código, ao seu plano ou ao seu estado; a aplicação lê a senha do Secrets Manager. Troque o `password` por essa linha e apague a variável.',
      },
      {
        en: 'A secret someone else issues, like the payments provider\'s key, belongs in a vault too. Store it once in SSM Parameter Store as a `SecureString` and read it with `data "aws_ssm_parameter"`: the code keeps only the parameter\'s name, `/shop/payments-api-key`. Secrets Manager works the same way, with `data "aws_secretsmanager_secret_version"`.',
        pt: 'Um segredo emitido por outra empresa, como a chave do provedor de pagamentos, também pertence a um cofre. Guarde uma vez no SSM Parameter Store como `SecureString` e leia com `data "aws_ssm_parameter"`: o código guarda só o nome do parâmetro, `/shop/payments-api-key`. O Secrets Manager funciona do mesmo jeito, com `data "aws_secretsmanager_secret_version"`.',
      },
      {
        en: 'Then the output. The deploy pipeline reads the key from it, and Terraform prints outputs at the end of every apply, straight into the CI logs. Mark it `sensitive = true`: the plan shows `(sensitive value)` and the apply `<sensitive>`. Terraform insists, by the way: an output that reads a sensitive value without the mark is an error. Move what isn\'t secret, like the database host, to an output of its own so it stays readable.',
        pt: 'Depois, o output. O pipeline de deploy lê a chave dele, e o Terraform imprime os outputs no fim de cada apply, direto nos logs do CI. Marque com `sensitive = true`: o plano mostra `(sensitive value)` e o apply, `<sensitive>`. Aliás, o Terraform insiste: um output que lê um valor sensível sem a marca é um erro. Leve o que não é segredo, como o host do banco, para um output próprio, para continuar legível.',
      },
      {
        en: 'And what `sensitive` doesn\'t do: it hides values from the screen, not from the state. The key you read from SSM sits in the state file in plain text, which is why lesson 8.1 locked the state bucket down. Plan, apply, and look for the key in the terminal. You won\'t find it.',
        pt: 'E o que o `sensitive` não faz: ele esconde valores da tela, não do estado. A chave lida do SSM fica no arquivo de estado em texto puro, e é por isso que a lição 8.1 trancou o bucket de estado. Rode o plano, aplique e procure a chave no terminal. Você não vai achar.',
      },
    ],
    asides: [
      {
        title: { en: 'Sensitive variables', pt: 'Variáveis sensíveis' },
        body: [
          {
            en: 'When a secret has to come in as a variable, say a token your pipeline passes as `TF_VAR_alerts_token`, declare it with `sensitive = true` and no `default`. Everything computed from it is sensitive too, all the way to the plan.',
            pt: 'Quando um segredo precisa entrar como variável, por exemplo um token que o pipeline passa como `TF_VAR_alerts_token`, declare com `sensitive = true` e sem `default`. Tudo que for calculado a partir dele também fica sensível, até o plano.',
          },
          {
            en: '`terraform output payments_api_key` still prints the value when you ask for it by name: `sensitive` protects logs from accidents, not you from yourself.',
            pt: '`terraform output payments_api_key` ainda imprime o valor quando você pede pelo nome: o `sensitive` protege os logs de acidentes, não você de você mesmo.',
          },
        ],
      },
      {
        title: { en: 'Where does the app find the password?', pt: 'Onde a aplicação acha a senha?' },
        body: [
          {
            en: '`aws_db_instance.main.master_user_secret[0].secret_arn` is the ARN of the secret RDS created. Hand it to the application (an output, an environment variable of its container) and give the application\'s IAM role permission to read that one secret.',
            pt: '`aws_db_instance.main.master_user_secret[0].secret_arn` é o ARN do segredo que o RDS criou. Entregue esse ARN à aplicação (um output, uma variável de ambiente do contêiner dela) e dê ao perfil do IAM da aplicação permissão para ler só esse segredo.',
          },
        ],
      },
    ],
    start: SECRETS_START,
    solution: SECRETS_SOLUTION,
    goals: [
      {
        id: 'managed',
        text: { en: 'RDS keeps the master password', pt: 'O RDS guarda a senha mestra' },
        hint: {
          en: 'In the database, replace `password = var.db_password` with `manage_master_user_password = true`.',
          pt: 'No banco, troque `password = var.db_password` por `manage_master_user_password = true`.',
        },
        test: managesPassword('aws_db_instance'),
      },
      {
        id: 'typed',
        text: { en: 'No secret typed in the code', pt: 'Nenhum segredo digitado no código' },
        hint: {
          en: 'Delete the variables `db_password` and `payments_api_key`, or at least their `default`. A secret in a `.tfvars` file counts too: it goes to git just the same.',
          pt: 'Apague as variáveis `db_password` e `payments_api_key`, ou pelo menos o `default` delas. Um segredo num arquivo `.tfvars` também conta: ele vai para o git do mesmo jeito.',
        },
        test: noSecretsInCode,
      },
      {
        id: 'ssm',
        text: { en: 'The payments key read from Parameter Store', pt: 'A chave de pagamentos lida do Parameter Store' },
        hint: {
          en: '`data "aws_ssm_parameter" "payments_api_key"` with `name = "/shop/payments-api-key"`, and the output reads `data.aws_ssm_parameter.payments_api_key.value`.',
          pt: '`data "aws_ssm_parameter" "payments_api_key"` com `name = "/shop/payments-api-key"`, e o output lê `data.aws_ssm_parameter.payments_api_key.value`.',
        },
        test: secretFromAws,
      },
      {
        id: 'sensitive',
        text: { en: 'The output with the key is `sensitive`', pt: 'O output com a chave é `sensitive`' },
        hint: {
          en: 'Add `sensitive = true` to it. Better still, give `db_host` an output of its own and keep only the key in the sensitive one.',
          pt: 'Acrescente `sensitive = true` a ele. Melhor ainda: dê ao `db_host` um output próprio e deixe só a chave no sensível.',
        },
        test: secretOutputsSensitive,
      },
      {
        id: 'apply',
        text: { en: 'Plan and apply: the key never shows', pt: 'Rode o plano e aplique: a chave nunca aparece' },
        hint: {
          en: '`plan` shows `(sensitive value)`, and `apply` ends with `payments_api_key = <sensitive>`.',
          pt: '`plan` mostra `(sensitive value)`, e o `apply` termina com `payments_api_key = <sensitive>`.',
        },
        test: all(ran('plan'), applied('aws_db_instance')),
      },
    ],
    teaches: ['aws_db_instance', 'data.aws_ssm_parameter'],
  },

  /* ------------------------------------------------------------ 8.4 */
  {
    slug: 'lifecycle-rules',
    code: '8.4',
    kind: 'lesson',
    mode: 'code',
    minutes: 14,
    xp: 120,
    title: { en: 'Lifecycle rules', pt: 'Regras de ciclo de vida' },
    summary: {
      en: 'Bend Terraform\'s rules where they hurt: `prevent_destroy`, `ignore_changes`, `replace_triggered_by` and `create_before_destroy`, each tried in a plan.',
      pt: 'Dobre as regras do Terraform onde elas machucam: `prevent_destroy`, `ignore_changes`, `replace_triggered_by` e `create_before_destroy`, cada uma testada num plano.',
    },
    body: [
      {
        en: 'Terraform\'s rules are simple: when the code and the cloud disagree, the code wins, and when an argument can\'t change in place, the object is destroyed and created again. Almost always, that\'s exactly right. A `lifecycle` block inside a resource bends those rules where it isn\'t. Apply the starting code, then add four rules, trying each one with `plan`.',
        pt: 'As regras do Terraform são simples: quando o código e a nuvem discordam, o código vence, e quando um argumento não pode mudar no lugar, o objeto é destruído e criado de novo. Quase sempre, é exatamente o certo. Um bloco `lifecycle` dentro de um recurso dobra essas regras onde não é. Aplique o código inicial e depois adicione quatro regras, testando cada uma com `plan`.',
      },
      {
        en: 'First, `prevent_destroy = true` on the database: any plan that would delete it becomes an error. Try it. Add `availability_zone = "us-east-1b"` to the database and run `plan`: an RDS instance can\'t move to another zone in place, so it would be replaced, and instead of `-/+` you get `Instance cannot be destroyed`. Take the line out again. Know its limit: the rule lives in the block it protects, so deleting the whole block deletes the guard with it. `deletion_protection = true` adds a second lock, on the AWS side.',
        pt: 'Primeiro, `prevent_destroy = true` no banco: qualquer plano que o excluiria vira um erro. Teste. Acrescente `availability_zone = "us-east-1b"` ao banco e rode `plan`: uma instância RDS não muda de zona no lugar, então seria substituída, e em vez de `-/+` você recebe `Instance cannot be destroyed`. Tire a linha de novo. Conheça o limite: a regra mora no bloco que ela protege, então apagar o bloco inteiro apaga a proteção junto. `deletion_protection = true` acrescenta uma segunda trava, do lado da AWS.',
      },
      {
        en: 'Next, the fleet\'s size, which belongs to autoscaling. At peak it raises `desired_capacity` to 5, and the next apply would bring it back to the 2 in the code, in the middle of the peak. `ignore_changes = [desired_capacity]` tells Terraform to set it once, at creation, and never fight over it again. Set it to 4 in the code and `plan`: no changes. That\'s the point, and also the trap: your own edits to that argument are ignored too.',
        pt: 'Depois, o tamanho da frota, que pertence ao autoscaling. No pico ele sobe o `desired_capacity` para 5, e o próximo apply o traria de volta para os 2 do código, no meio do pico. `ignore_changes = [desired_capacity]` diz ao Terraform para definir o valor uma vez, na criação, e nunca mais brigar por ele. Coloque 4 no código e rode `plan`: nenhuma mudança. Esse é o objetivo, e também a armadilha: as suas próprias edições nesse argumento também são ignoradas.',
      },
      {
        en: 'Then the image. A new version of the launch template doesn\'t touch running servers; only new ones boot from it. `replace_triggered_by = [aws_launch_template.web.latest_version]` replaces the whole group whenever the template gets a new version. On its own, that means destroy first, create after: minutes with no servers at all. Add `create_before_destroy = true` and the order flips: the new fleet comes up next to the old one, and only then does the old one go. The plan marks it `+/-` instead of `-/+`.',
        pt: 'Então, a imagem. Uma versão nova do launch template não mexe nos servidores que estão rodando; só os novos inicializam a partir dela. `replace_triggered_by = [aws_launch_template.web.latest_version]` substitui o grupo inteiro sempre que o template ganha uma versão nova. Sozinho, isso significa destruir primeiro e criar depois: minutos sem servidor nenhum. Acrescente `create_before_destroy = true` e a ordem se inverte: a frota nova sobe ao lado da antiga, e só então a antiga sai. O plano marca `+/-` em vez de `-/+`.',
      },
      {
        en: 'One catch: for a moment both groups exist, and two Auto Scaling groups can\'t share a name. Swap `name = "web"` for `name_prefix = "web-"` and AWS adds a unique ending to each. Now change the template\'s `instance_type` to `"t3.small"` and `plan` to watch the fleet roll over. Finish with an apply, so the code and the cloud agree again.',
        pt: 'Um detalhe: por um momento os dois grupos existem, e dois grupos do Auto Scaling não podem ter o mesmo nome. Troque `name = "web"` por `name_prefix = "web-"` e a AWS acrescenta um final único a cada um. Agora mude o `instance_type` do template para `"t3.small"` e rode `plan` para ver a frota ser renovada. Termine com um apply, para o código e a nuvem voltarem a concordar.',
      },
    ],
    asides: [
      {
        title: { en: 'Which rule, when', pt: 'Qual regra, quando' },
        body: [
          {
            en: '`prevent_destroy`: anything whose loss is data loss (databases, buckets with content, the state). `ignore_changes`: arguments something else owns (autoscaling, tags another tool adds).',
            pt: '`prevent_destroy`: tudo cuja perda é perda de dados (bancos, buckets com conteúdo, o estado). `ignore_changes`: argumentos que outra coisa controla (autoscaling, tags que outra ferramenta adiciona).',
          },
          {
            en: '`create_before_destroy`: what must never be missing (servers behind a load balancer, certificates). `replace_triggered_by`: what must be rebuilt when something it depends on changes, even though none of its own arguments did.',
            pt: '`create_before_destroy`: o que nunca pode faltar (servidores atrás de um balanceador de carga, certificados). `replace_triggered_by`: o que precisa ser reconstruído quando algo de que depende muda, mesmo sem nenhum argumento próprio ter mudado.',
          },
        ],
      },
    ],
    start: LIFECYCLE_START,
    solution: LIFECYCLE_SOLUTION,
    goals: [
      {
        id: 'running',
        text: { en: 'Apply the starting code', pt: 'Aplique o código inicial' },
        hint: {
          en: '`init`, `plan`, `apply`: a database, a launch template and an Auto Scaling group.',
          pt: '`init`, `plan`, `apply`: um banco, um launch template e um grupo do Auto Scaling.',
        },
        test: all(applied('aws_db_instance'), applied(ASG)),
      },
      {
        id: 'protect',
        text: { en: 'No plan can destroy the database', pt: 'Nenhum plano pode destruir o banco' },
        hint: {
          en: 'In the database, a `lifecycle` block with `prevent_destroy = true`.',
          pt: 'No banco, um bloco `lifecycle` com `prevent_destroy = true`.',
        },
        test: argIs('aws_db_instance', 'lifecycle.prevent_destroy', true),
      },
      {
        id: 'ignore',
        text: { en: 'Autoscaling owns `desired_capacity`', pt: 'O autoscaling é dono do `desired_capacity`' },
        hint: {
          en: 'In the group, a `lifecycle` block with `ignore_changes = [desired_capacity]`. No quotes: it names an argument.',
          pt: 'No grupo, um bloco `lifecycle` com `ignore_changes = [desired_capacity]`. Sem aspas: é o nome de um argumento.',
        },
        test: ignores(ASG, 'desired_capacity'),
      },
      {
        id: 'trigger',
        text: { en: 'A new template version replaces the fleet', pt: 'Uma versão nova do template substitui a frota' },
        hint: {
          en: 'In the group\'s `lifecycle`: `replace_triggered_by = [aws_launch_template.web.latest_version]`.',
          pt: 'No `lifecycle` do grupo: `replace_triggered_by = [aws_launch_template.web.latest_version]`.',
        },
        test: argRefs(ASG, 'lifecycle.replace_triggered_by', 'aws_launch_template'),
      },
      {
        id: 'before',
        text: { en: 'The new fleet comes up before the old one goes', pt: 'A frota nova sobe antes de a antiga sair' },
        hint: {
          en: '`create_before_destroy = true` in the same `lifecycle`, and `name_prefix = "web-"` in place of `name`.',
          pt: '`create_before_destroy = true` no mesmo `lifecycle`, e `name_prefix = "web-"` no lugar de `name`.',
        },
        test: all(argIs(ASG, 'lifecycle.create_before_destroy', true), argSet(ASG, 'name_prefix'), not(argSet(ASG, 'name'))),
      },
      {
        id: 'synced',
        text: { en: 'Apply, then a plan with nothing to do', pt: 'Aplique, e depois um plano sem nada a fazer' },
        hint: {
          en: 'Undo the experiments you don\'t want to keep (the database\'s zone!), run `apply`, then `plan`: `No changes.`',
          pt: 'Desfaça os experimentos que você não quer manter (a zona do banco!), rode `apply` e depois `plan`: `No changes.`',
        },
        test: all(ran('plan'), inSync),
      },
    ],
  },

  /* ------------------------------------------------------------ 8.5 */
  {
    slug: 'import-existing',
    code: '8.5',
    kind: 'lesson',
    mode: 'code',
    minutes: 12,
    xp: 110,
    title: { en: 'Import what already exists', pt: 'Importe o que já existe' },
    summary: {
      en: 'Adopt a bucket someone made by hand with an `import` block, and hand another one over with `removed`, without deleting a thing.',
      pt: 'Adote um bucket que alguém criou na mão com um bloco `import` e entregue outro com `removed`, sem excluir nada.',
    },
    body: [
      {
        en: 'Not everything starts in Terraform. Every company has a bucket someone made by hand, years ago, that everything now depends on. Here it\'s `acme-invoices-2023`, with every invoice since 2023 inside. Writing a resource block for it isn\'t enough: Terraform would try to *create* it, and AWS would answer that the name is taken.',
        pt: 'Nem tudo começa no Terraform. Toda empresa tem um bucket que alguém criou na mão, anos atrás, do qual agora tudo depende. Aqui é o `acme-invoices-2023`, com todas as notas fiscais desde 2023 dentro. Escrever um bloco de recurso para ele não basta: o Terraform tentaria *criar* o bucket, e a AWS responderia que o nome já está em uso.',
      },
      {
        en: 'An `import` block tells Terraform the object already exists: `to` is the address of the resource that will manage it, `id` is how AWS knows it (for a bucket, its name). The import happens in the plan, where you can read it, `aws_s3_bucket.invoices will be imported`, and the summary counts it apart: `1 to import`. Nothing is created and nothing is touched until you apply.',
        pt: 'Um bloco `import` avisa ao Terraform que o objeto já existe: `to` é o endereço do recurso que vai gerenciá-lo, `id` é como a AWS o conhece (para um bucket, o nome). A importação acontece no plano, onde dá para lê-la, `aws_s3_bucket.invoices will be imported`, e o resumo conta à parte: `1 to import`. Nada é criado e nada é alterado até você aplicar.',
      },
      {
        en: 'The resource block must describe the bucket as it really is. If it says something else, the plan shows the import *and* a change, and that change is your chance to catch a mistake before it reaches years of invoices. Writing the block is the tedious part, so in your real projects let Terraform write it: keep only the `import` block and run `terraform plan -generate-config-out=generated.tf`.',
        pt: 'O bloco de recurso precisa descrever o bucket como ele realmente é. Se disser outra coisa, o plano mostra a importação *e* uma mudança, e essa mudança é a sua chance de pegar um erro antes que ele chegue a anos de notas fiscais. Escrever o bloco é a parte chata, então nos seus projetos reais deixe o Terraform escrever: mantenha só o bloco `import` e rode `terraform plan -generate-config-out=generated.tf`.',
      },
      {
        en: 'The opposite move matters just as much. The reports bucket in the starting code goes to the data team, who will manage it in their own project. Deleting its block would make Terraform destroy it. A `removed` block with `lifecycle { destroy = false }` makes Terraform *forget* it instead: the bucket stays in AWS and only leaves this state.',
        pt: 'O movimento oposto importa tanto quanto. O bucket de relatórios do código inicial vai para o time de dados, que passa a gerenciá-lo no próprio projeto. Apagar o bloco dele faria o Terraform destruí-lo. Um bloco `removed` com `lifecycle { destroy = false }` faz o Terraform *esquecer* o bucket: ele continua na AWS e só sai deste estado.',
      },
      {
        en: 'Apply the starting code first. Then hand the reports bucket over, adopt the invoices one (with `prevent_destroy`: it holds years of invoices), read the plan and apply.',
        pt: 'Aplique o código inicial primeiro. Depois entregue o bucket de relatórios, adote o de notas fiscais (com `prevent_destroy`: ele guarda anos de notas fiscais), leia o plano e aplique.',
      },
    ],
    asides: [
      {
        title: { en: 'Before import blocks', pt: 'Antes dos blocos import' },
        body: [
          {
            en: '`import` blocks arrived in Terraform 1.5, `removed` in 1.7. Older guides use commands instead: `terraform import aws_s3_bucket.invoices acme-invoices-2023` and `terraform state rm`. They change the state on the spot, with no plan to review and nothing in the code to show a colleague. Prefer the blocks.',
            pt: 'Os blocos `import` chegaram no Terraform 1.5, o `removed` no 1.7. Guias antigos usam comandos no lugar: `terraform import aws_s3_bucket.invoices acme-invoices-2023` e `terraform state rm`. Eles mudam o estado na hora, sem plano para revisar e sem nada no código para mostrar a um colega. Prefira os blocos.',
          },
          {
            en: 'After the apply, the `import` block has done its job. Keeping it does no harm (later plans skip it) and it records where the bucket came from; many teams delete it in a follow-up commit.',
            pt: 'Depois do apply, o bloco `import` cumpriu seu papel. Mantê-lo não faz mal (os planos seguintes o ignoram) e ele registra de onde o bucket veio; muitos times o apagam num commit seguinte.',
          },
        ],
      },
    ],
    start: IMPORT_START,
    solution: IMPORT_SOLUTION,
    goals: [
      {
        id: 'handover',
        text: { en: 'The reports bucket handed over with `removed`', pt: 'O bucket de relatórios entregue com `removed`' },
        hint: {
          en: 'Delete `resource "aws_s3_bucket" "reports"` and write a `removed` block with `from = aws_s3_bucket.reports` and, inside it, `lifecycle { destroy = false }`.',
          pt: 'Apague o `resource "aws_s3_bucket" "reports"` e escreva um bloco `removed` com `from = aws_s3_bucket.reports` e, dentro dele, `lifecycle { destroy = false }`.',
        },
        test: removedKeeps,
      },
      {
        id: 'resource',
        text: { en: 'A resource block for `acme-invoices-2023`', pt: 'Um bloco de recurso para o `acme-invoices-2023`' },
        hint: {
          en: '`resource "aws_s3_bucket" "invoices"` with `bucket = "acme-invoices-2023"`.',
          pt: '`resource "aws_s3_bucket" "invoices"` com `bucket = "acme-invoices-2023"`.',
        },
        test: argIs('aws_s3_bucket', 'bucket', 'acme-invoices-2023'),
      },
      {
        id: 'import',
        text: { en: 'An `import` block that adopts it', pt: 'Um bloco `import` que o adota' },
        hint: {
          en: 'An `import` block with `to = aws_s3_bucket.invoices` and `id = "acme-invoices-2023"`: for a bucket, the id is its name.',
          pt: 'Um bloco `import` com `to = aws_s3_bucket.invoices` e `id = "acme-invoices-2023"`: para um bucket, o id é o nome.',
        },
        test: importsInto('aws_s3_bucket', 'bucket'),
      },
      {
        id: 'guard',
        text: { en: 'Guarded with `prevent_destroy`', pt: 'Protegido com `prevent_destroy`' },
        hint: {
          en: 'In the invoices bucket, a `lifecycle` block with `prevent_destroy = true`.',
          pt: 'No bucket de notas fiscais, um bloco `lifecycle` com `prevent_destroy = true`.',
        },
        test: argIs('aws_s3_bucket', 'lifecycle.prevent_destroy', true),
      },
      {
        id: 'apply',
        text: { en: 'Apply: invoices in the state, reports out of it', pt: 'Aplique: notas fiscais no estado, relatórios fora dele' },
        hint: {
          en: 'Read the plan first: one import, one bucket leaving the state, nothing destroyed. Then `apply`.',
          pt: 'Leia o plano antes: uma importação, um bucket saindo do estado, nada destruído. Depois `apply`.',
        },
        test: all(importsApplied, removedGone),
      },
    ],
  },

  /* ------------------------------------------------------------ 8.6 */
  {
    slug: 'reviewing-plans',
    code: '8.6',
    kind: 'lesson',
    mode: 'code',
    minutes: 14,
    xp: 120,
    title: { en: 'Read a plan like a reviewer', pt: 'Leia um plano como revisor' },
    summary: {
      en: 'Review a teammate\'s pull request through its plan, catch the two changes that would destroy data, and apply exactly what you approved.',
      pt: 'Revise o pull request de uma colega pelo plano, pegue as duas mudanças que destruiriam dados e aplique exatamente o que você aprovou.',
    },
    body: [
      {
        en: 'In a team, nobody applies alone. A change arrives as a pull request, CI runs `plan` and posts the result, and someone reviews the plan before it reaches production. The code diff shows what a person *meant*; the plan shows what Terraform *will do*. They aren\'t always the same, and the plan is what runs.',
        pt: 'Num time, ninguém aplica sozinho. Uma mudança chega como pull request, o CI roda `plan` e publica o resultado, e alguém revisa o plano antes que ele chegue à produção. O diff do código mostra o que a pessoa *quis*; o plano mostra o que o Terraform *vai fazer*. Nem sempre são a mesma coisa, e quem roda é o plano.',
      },
      {
        en: 'Read the symbols first. `+` creates, `~` updates in place, `-` destroys, `-/+` destroys and then creates a replacement, `+/-` does it the other way around, and `<=` reads a data source. Next to an argument, `# forces replacement` names the change that turned an update into a replacement. For a database, or a bucket full of files, that is the most important line in the plan.',
        pt: 'Leia os símbolos primeiro. `+` cria, `~` altera no lugar, `-` destrói, `-/+` destrói e depois cria um substituto, `+/-` faz o contrário, e `<=` lê uma fonte de dados. Ao lado de um argumento, `# forces replacement` aponta a mudança que transformou uma alteração numa substituição. Para um banco de dados, ou um bucket cheio de arquivos, essa é a linha mais importante do plano.',
      },
      {
        en: 'Now a real review. Apply the starting code: that\'s production. Then make the four changes of Ana\'s pull request, listed at the top of `main.tf`, exactly as written, and run `plan`. Two of the four look harmless in the code and are anything but in the plan. Find them.',
        pt: 'Agora uma revisão de verdade. Aplique o código inicial: essa é a produção. Depois faça as quatro mudanças do pull request da Ana, listadas no topo do `main.tf`, exatamente como estão escritas, e rode `plan`. Duas das quatro parecem inofensivas no código e são tudo menos isso no plano. Encontre as duas.',
      },
      {
        en: 'As the reviewer, keep what Ana wanted and drop the damage. A renamed block is a new address, so Terraform would destroy the bucket and create an empty one; a `moved` block, from level 5, keeps it. A new `username` can\'t be applied to an existing RDS instance, so the whole database would be replaced; that change goes back to Ana with a comment. Plan again until only `~` is left.',
        pt: 'Como revisor, mantenha o que a Ana queria e descarte o estrago. Um bloco renomeado é um endereço novo, então o Terraform destruiria o bucket e criaria um vazio; um bloco `moved`, do nível 5, o preserva. Um `username` novo não pode ser aplicado a uma instância RDS existente, então o banco inteiro seria substituído; essa mudança volta para a Ana com um comentário. Rode o plano de novo até sobrar só `~`.',
      },
      {
        en: 'Then apply exactly what you reviewed. `terraform plan -out=tfplan` saves the plan to a file, and `terraform apply tfplan` carries out that plan and nothing else, without asking again. If anything changed in between, like someone else\'s apply, Terraform refuses the stale plan instead of improvising.',
        pt: 'Depois aplique exatamente o que você revisou. `terraform plan -out=tfplan` salva o plano num arquivo, e `terraform apply tfplan` executa esse plano e nada além dele, sem perguntar de novo. Se algo mudou no meio do caminho, como o apply de outra pessoa, o Terraform recusa o plano desatualizado em vez de improvisar.',
      },
      {
        en: 'In your real projects, the same plan can be read on a canvas. `terraform show -json tfplan > plan.json` writes it as JSON; open your project in the editor, on the Build side, and drop that file on the canvas (or use the *Plan* button): every creation, update and replacement is drawn over your architecture, with the risky ones called out.',
        pt: 'Nos seus projetos reais, o mesmo plano pode ser lido num canvas. `terraform show -json tfplan > plan.json` escreve o plano em JSON; abra o seu projeto no editor, no lado Construir, e solte esse arquivo no canvas (ou use o botão *Plano*): cada criação, alteração e substituição aparece desenhada sobre a sua arquitetura, com as arriscadas em destaque.',
      },
    ],
    asides: [
      {
        title: { en: 'A reviewer\'s checklist', pt: 'O checklist do revisor' },
        body: [
          {
            en: '1. The summary line first: do `to add`, `to change` and `to destroy` match what the pull request says it does?',
            pt: '1. Primeiro a linha de resumo: `to add`, `to change` e `to destroy` batem com o que o pull request diz que faz?',
          },
          {
            en: '2. Every `-` and every `-/+`: is losing that object fine? Which `# forces replacement` caused it?',
            pt: '2. Cada `-` e cada `-/+`: tudo bem perder esse objeto? Qual `# forces replacement` causou isso?',
          },
          {
            en: '3. Every `~` nobody asked for: drift, a change made outside Terraform that this apply would undo.',
            pt: '3. Cada `~` que ninguém pediu: drift, uma mudança feita fora do Terraform que este apply desfaria.',
          },
          {
            en: '4. `(sensitive value)` hides a value from the plan, not from the state, and `(known after apply)` is only decided during the apply.',
            pt: '4. `(sensitive value)` esconde um valor do plano, não do estado, e `(known after apply)` só é decidido durante o apply.',
          },
          {
            en: '5. Apply the saved plan file, never a fresh `apply` that plans all over again.',
            pt: '5. Aplique o arquivo de plano salvo, nunca um `apply` novo que planeja tudo de novo.',
          },
        ],
      },
    ],
    start: REVIEW_START,
    solution: REVIEW_SOLUTION,
    goals: [
      {
        id: 'prod',
        text: { en: 'Production is up: apply `main.tf` as it is', pt: 'A produção está no ar: aplique o `main.tf` como está' },
        hint: {
          en: 'In the terminal: `init`, `plan`, `apply`.',
          pt: 'No terminal: `init`, `plan`, `apply`.',
        },
        test: applied('aws_db_instance'),
      },
      {
        id: 'sizing',
        text: { en: 'Ana\'s sizing is in: `db.t4g.small`, 50 GB', pt: 'O dimensionamento da Ana entrou: `db.t4g.small`, 50 GB' },
        hint: {
          en: '`instance_class = "db.t4g.small"` and `allocated_storage = 50`. Those two are the point of her pull request.',
          pt: '`instance_class = "db.t4g.small"` e `allocated_storage = 50`. Esses dois são o motivo do pull request dela.',
        },
        test: all(argIs('aws_db_instance', 'instance_class', 'db.t4g.small'), argIs('aws_db_instance', 'allocated_storage', 50)),
      },
      {
        id: 'rename',
        text: { en: 'The bucket answers to `static_assets`', pt: 'O bucket atende por `static_assets`' },
        hint: {
          en: 'Rename the block to `resource "aws_s3_bucket" "static_assets"`, as Ana did.',
          pt: 'Renomeie o bloco para `resource "aws_s3_bucket" "static_assets"`, como a Ana fez.',
        },
        test: declares('aws_s3_bucket.static_assets'),
      },
      {
        id: 'safe',
        text: { en: 'A plan that destroys and replaces nothing', pt: 'Um plano que não destrói nem substitui nada' },
        hint: {
          en: 'A `moved` block with `from = aws_s3_bucket.assets` and `to = aws_s3_bucket.static_assets`, and `username` back to `"shop"`. Then `plan`: only `~`.',
          pt: 'Um bloco `moved` com `from = aws_s3_bucket.assets` e `to = aws_s3_bucket.static_assets`, e o `username` de volta para `"shop"`. Depois `plan`: só `~`.',
        },
        test: all(applied(), ran('plan'), planDestroysNothing),
      },
      {
        id: 'shipped',
        text: { en: 'The reviewed plan applied', pt: 'O plano revisado aplicado' },
        hint: {
          en: '`terraform plan -out=tfplan`, read it one last time, then `terraform apply tfplan`.',
          pt: '`terraform plan -out=tfplan`, leia uma última vez e depois `terraform apply tfplan`.',
        },
        test: all(stateAttr('aws_db_instance', 'instance_class', 'db.t4g.small'), stateHolds('aws_s3_bucket.static_assets')),
      },
    ],
  },

  /* ------------------------------------------------------------ C8 */
  {
    slug: 'challenge-production-ready',
    code: 'C8',
    kind: 'challenge',
    mode: 'code',
    minutes: 25,
    xp: 300,
    title: { en: 'Challenge: production ready', pt: 'Desafio: pronto para produção' },
    summary: {
      en: 'Take a small stack that works on one laptop and make it fit for a team: remote state, environments, secrets, guards, an import and a clean plan.',
      pt: 'Pegue uma infraestrutura pequena que funciona num notebook e deixe-a pronta para um time: estado remoto, ambientes, segredos, proteções, uma importação e um plano limpo.',
    },
    body: [
      {
        en: 'Everything from level 8, on one small stack. It works, and it\'s a liability: its state lives on one laptop, `dev` is typed into its names, the database password and a payments key sit in the code, the media bucket was made by hand and nothing keeps a careless plan away from the database. Make it something you\'d be proud to hand to a team.',
        pt: 'Tudo do nível 8, numa infraestrutura pequena. Ela funciona, e é um risco: o estado mora num notebook, `dev` está digitado nos nomes, a senha do banco e uma chave de pagamentos estão no código, o bucket de mídia foi criado na mão e nada protege o banco de um plano descuidado. Transforme isso em algo que você teria orgulho de entregar a um time.',
      },
      {
        en: 'The list is at the top of `main.tf`. The state in S3, encrypted and locked, in `backend.tf`. One code for two environments, with their values in `dev.tfvars` and `prod.tfvars`. No secret in any file, and every output that carries one marked `sensitive`. `prevent_destroy` on the database. And the media bucket adopted with an `import` block: it was created by hand in each environment, as `acme-shop-dev-media` and `acme-shop-prod-media`.',
        pt: 'A lista está no topo do `main.tf`. O estado no S3, criptografado e com bloqueio, no `backend.tf`. Um código para dois ambientes, com os valores em `dev.tfvars` e `prod.tfvars`. Nenhum segredo em arquivo nenhum, e todo output que carrega um marcado como `sensitive`. `prevent_destroy` no banco. E o bucket de mídia adotado com um bloco `import`: ele foi criado na mão em cada ambiente, como `acme-shop-dev-media` e `acme-shop-prod-media`.',
      },
      {
        en: 'Then review it the way lesson 8.6 taught you: a plan with nothing destroyed and nothing replaced, and only then apply. Names, file layout and style are yours; the goals read the code, the variable files and the plan.',
        pt: 'Depois revise do jeito que a lição 8.6 ensinou: um plano sem nada destruído e nada substituído, e só então aplique. Nomes, organização dos arquivos e estilo ficam por sua conta; os objetivos leem o código, os arquivos de variáveis e o plano.',
      },
    ],
    start: CHALLENGE_START,
    solution: CHALLENGE_SOLUTION,
    goals: [
      {
        id: 'backend',
        text: { en: 'The state in S3, encrypted and locked', pt: 'O estado no S3, criptografado e com bloqueio' },
        hint: {
          en: 'In `backend.tf`, a `backend "s3"` inside `terraform {}` with `bucket`, `key`, `region`, `encrypt = true` and `use_lockfile = true`, all plain strings and booleans.',
          pt: 'No `backend.tf`, um `backend "s3"` dentro de `terraform {}` com `bucket`, `key`, `region`, `encrypt = true` e `use_lockfile = true`, tudo strings e booleanos simples.',
        },
        test: all(backendS3Set, backendIs('encrypt', true), backendLocked),
      },
      {
        id: 'envs',
        text: { en: 'Two environments from one code', pt: 'Dois ambientes a partir de um código' },
        hint: {
          en: 'A `variable "environment"` (and one for the database size), the names built with `${var.environment}`, and the values in `dev.tfvars` and `prod.tfvars`, which must differ in more than the name.',
          pt: 'Uma `variable "environment"` (e uma para o tamanho do banco), os nomes montados com `${var.environment}` e os valores em `dev.tfvars` e `prod.tfvars`, que precisam diferir em mais do que o nome.',
        },
        test: all(environmentVariable, varFile('dev', 2), varFile('prod', 2), varFilesDiffer(2), noneTyped(/\b(dev|prod)\b/i)),
      },
      {
        id: 'secrets',
        text: { en: 'No secret in the code, secret outputs `sensitive`', pt: 'Nenhum segredo no código, outputs secretos `sensitive`' },
        hint: {
          en: '`manage_master_user_password = true` for the database, the payments key from `data "aws_ssm_parameter"`, and `sensitive = true` on the output that returns it.',
          pt: '`manage_master_user_password = true` no banco, a chave de pagamentos vinda de `data "aws_ssm_parameter"` e `sensitive = true` no output que a devolve.',
        },
        test: all(noSecretsInCode, secretOutputsSensitive),
      },
      {
        id: 'protect',
        text: { en: 'The database protected against `destroy`', pt: 'O banco protegido contra `destroy`' },
        hint: {
          en: 'A `lifecycle` block in the database with `prevent_destroy = true`.',
          pt: 'Um bloco `lifecycle` no banco com `prevent_destroy = true`.',
        },
        test: argIs('aws_db_instance', 'lifecycle.prevent_destroy', true),
      },
      {
        id: 'import',
        text: { en: 'The media bucket adopted with `import`', pt: 'O bucket de mídia adotado com `import`' },
        hint: {
          en: 'A bucket with `bucket = "acme-shop-${var.environment}-media"` and an `import` block whose `id` is that same name: an `id` can use variables too.',
          pt: 'Um bucket com `bucket = "acme-shop-${var.environment}-media"` e um bloco `import` cujo `id` é esse mesmo nome: o `id` também pode usar variáveis.',
        },
        test: importsInto('aws_s3_bucket', 'bucket'),
      },
      {
        id: 'review',
        text: { en: 'A plan that destroys and replaces nothing, applied', pt: 'Um plano que não destrói nem substitui nada, aplicado' },
        hint: {
          en: 'Run `plan` and go through the checklist from lesson 8.6. When only `+` and `~` are left, `apply`.',
          pt: 'Rode `plan` e passe pelo checklist da lição 8.6. Quando sobrarem só `+` e `~`, `apply`.',
        },
        test: all(ran('plan'), planDestroysNothing, applied('aws_db_instance'), importsApplied),
      },
    ],
  },
];
