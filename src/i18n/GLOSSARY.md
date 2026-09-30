# pt-BR glossary

One word per idea across the whole app. Tone: natural Brazilian Portuguese,
"você", short and direct (like the English). Sentence case, as in English.

**Never translate:** Terraform code and snippets, argument and attribute names
(`cidr_block`, `db_subnet_group_name`), resource type addresses
(`aws_instance.web`), provider and product names (AWS, Azure, GCP, EC2, S3,
RDS, Lambda, VPC, Cloud Run, Monaco), file names, keyboard shortcuts, CIS /
FSBP control IDs, port and protocol names (SSH, HTTPS, TCP). Key names keep
their keyboard spelling (Enter, Esc, Del, Ctrl, ⌘); the gestures around them
are words ("Clique duplo", "Botão direito", "Espaço", "Arrastar").

`e2e/i18n-sweep.spec.ts` fails when a visible text, `aria-label`, `title`,
`placeholder` or `alt` reads the same in both languages and isn't one of the
tokens above — add a word here before adding it to the sweep's allowlist.

## UI

| English | pt-BR |
|---|---|
| project | projeto |
| resource | recurso |
| canvas | canvas (o canvas) |
| code / code editor / code pane | código / editor de código / painel de código |
| resource palette / resources panel | paleta de recursos / painel de recursos |
| command palette | paleta de comandos |
| inspector | inspetor |
| panel / drawer | painel / gaveta |
| docked / floating (inspector) | fixo / flutuante |
| layout / preset | layout / predefinição |
| template | template (o template) |
| blank canvas | canvas em branco |
| dashboard | painel inicial (only where "Dashboard" names the page: "Projetos") |
| tidy up / auto-arrange | organizar / organizar automaticamente |
| fit view | ajustar à tela |
| zoom in / out | aproximar / afastar |
| minimap | minimapa |
| project overview | visão geral do projeto |
| export / import | exportar / importar |
| as PNG / SVG | em PNG / SVG |
| share / share link | compartilhar / link de compartilhamento |
| view link (read-only) | link de visualização |
| embed code | código de incorporação |
| (view) | (visualização) |
| make a copy | fazer uma cópia |
| undo / redo | desfazer / refazer |
| delete / remove | excluir / remover (excluir a resource or project, remover an item, tag or connection — never "deletar" or "apagar") |
| rename / duplicate | renomear / duplicar |
| save / saved | salvar / salvo (never "gravado") |
| untitled | sem nome ("Projeto sem nome") |
| search | buscar (never "pesquisar" or "procurar") |
| toggle a panel | mostrar ou ocultar … |
| toggle the lens | ativar ou desativar … |
| double-click / right-click | clique duas vezes (in a sentence) / "Clique duplo", "Botão direito" (as a key) |
| settings / preferences | configurações / preferências |
| tag | tag |
| connect / connection | conectar / conexão |
| select / selection | selecionar / seleção |
| align / distribute | alinhar / distribuir |
| backup / restore | backup / restaurar ("Restaurar backup…") |
| sync / sync with folder | sincronização / sincronizar com pasta |
| folder link | vínculo com a pasta |
| browser storage | armazenamento do navegador |
| offline | offline |
| update available — reload | atualização disponível — recarregar |
| dismiss | dispensar |
| tutorial / lesson / step | tutorial / lição / passo |
| warning / error | aviso / erro |
| required / optional | obrigatório / opcional |
| deprecated | obsoleto |
| did you mean | você quis dizer |
| underscore / hyphen / mixed | sublinhado / hífen / misto |
| read-only | somente leitura |
| light / dark / system theme | claro / escuro / sistema |
| quick start / quick actions | início rápido / ações rápidas |
| features (marketing) | funcionalidades |
| Multi-cloud | Multicloud |
| personal access token | token de acesso pessoal |
| rate limit / requests | limite de requisições / requisições |

## Cloud and security

| English | pt-BR |
|---|---|
| cloud provider (AWS, Azure, GCP) | provedor de nuvem ("recursos AWS") |
| Terraform provider / provider schema | provider / schema |
| root / child module | módulo raiz / filho |
| subnet | sub-rede (in prose too — `subnet_id` stays code) |
| public / private subnet | sub-rede pública / privada |
| security group | grupo de segurança |
| network ACL | ACL de rede |
| route table / main route table | tabela de rotas / tabela de rotas principal |
| internet gateway | internet gateway |
| NAT gateway | NAT gateway |
| load balancer | balanceador de carga |
| target group | grupo de destino |
| listener | listener |
| instance / virtual machine | instância / máquina virtual |
| IAM role | perfil do IAM (the AWS console's pt-BR term — never "role do IAM" or "função do IAM") |
| bucket | bucket |
| function | função |
| serverless | sem servidor |
| container (canvas box, Azure blob container) / containers (category) | contêiner / contêineres |
| database | banco de dados |
| DB subnet group | grupo de sub-redes do banco (DB subnet group) |
| resource group / storage account / subscription | grupo de recursos / conta de armazenamento / assinatura |
| stage / edge | estágio / borda |
| peering | peering |
| workload | carga de trabalho |
| task definition | definição de tarefa |
| launch template / launch configuration | launch template / launch configuration |
| outputs | outputs |
| repeat (a resource's `count` / `for_each`) / repeated | repetição / repetido |
| instance (of a repeated resource) / key (of `for_each`) | instância / chave |
| keep the state / moved block | manter o estado / bloco moved (`moved {}` is code) |
| availability zone | zona de disponibilidade |
| region | região |
| tenancy | locação |
| CIDR range / usable addresses / address plan / host bits | intervalo / endereços utilizáveis / plano de endereços / bits de host |
| public address | endereço público |
| computed / sensitive / write-only | calculado / sensível / somente escrita |
| ingress / egress (inbound / outbound) | entrada / saída |
| rule / priority | regra / prioridade |
| allow / deny | permitir / negar |
| source / destination | origem / destino |
| stateful / stateless | com estado / sem estado |
| service tag / target tags | tag de serviço / tags de destino |
| ephemeral ports | portas efêmeras |
| open to the internet / internet-facing | aberto para a internet / exposto à internet |
| reachable / way in | acessível / entrada |
| placement | localização |
| security lens | lente de segurança |
| lens chips: Public / Private / No inbound / Review / At risk / Unverified | Público / Privado / Sem entrada / Revisar / Em risco / Não verificado (canvas and PDF alike) |
| a subnet's lens badge: public / private | pública / privada |
| finding / issue | achado / problema |
| fix / fix all | corrigir / corrigir tudo |
| severity: critical / high / medium / low | crítica / alta / média / baixa (a label, feminine); "2 críticos" (a count of achados, masculine) |
| grade / score | nota / pontuação |
| compliance control / failed control / requirement | controle de conformidade / controle não atendido / requisito |
| cost estimate / per month | estimativa de custo / por mês ("/mês") |
| on-demand price / usage-based / not estimated | preço sob demanda / por uso / sem estimativa |
| no charge of its own | sem cobrança própria |
| free tier / quote | nível gratuito / cotação |
| assumption | premissa |
| money | "US$ 27,40", "~US$ 12,3 mil" (prices stay in US dollars) |

Resource display names follow the AWS / Azure / Google consoles in
Portuguese: "EC2 Instance" → "Instância EC2", "S3 Bucket" → "Bucket S3",
"Lambda Function" → "Função Lambda", "Subnet" → "Sub-rede",
"Security Group" → "Grupo de segurança", "Route Table" → "Tabela de rotas",
"IAM Role" → "Perfil do IAM",
"Application Load Balancer" → "Application Load Balancer" (product name).
