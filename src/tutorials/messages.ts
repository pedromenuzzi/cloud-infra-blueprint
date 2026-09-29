/**
 * Lesson prose in Portuguese. English is the source and lives next to each
 * step's files in ./index.ts; the Terraform (comments included) is never
 * translated, and `backtick` code spans stay exactly as in English — a test
 * checks that, and that every step and paragraph has its translation.
 * Read through ./i18n.ts.
 */
import type { TutorialSlug } from './index';

export interface TutorialText {
  title: string;
  description: string;
  steps: Array<{ title: string; body: string[] }>;
}

export const TUTORIAL_TEXT_PT: Record<TutorialSlug, TutorialText> = {
  'first-vpc-ec2': {
    title: 'Sua primeira VPC + EC2',
    description: 'Monte do zero a stack clássica para começar: rede, sub-rede, servidor e firewall.',
    steps: [
      {
        title: 'Providers e versões',
        body: [
          'Todo projeto Terraform começa declarando com qual nuvem ele conversa. O bloco `provider "aws"` define a região; o bloco `terraform` fixa a versão do provider para que o projeto seja montado do mesmo jeito daqui a um ano.',
          'O canvas ainda está vazio — esses dois blocos configuram o projeto, mas não criam nenhuma infraestrutura. Por isso nada foi desenhado ainda.',
        ],
      },
      {
        title: 'A VPC',
        body: [
          'Uma VPC é a sua fatia privada da rede da AWS. `cidr_block = "10.0.0.0/16"` reserva 65.536 endereços IP privados para tudo o que você vai construir dentro dela.',
          'No blueprint, uma VPC é um *contêiner*: a caixa tracejada. Tudo o que fizer referência a ela é desenhado dentro dela — o aninhamento neste canvas nunca é enfeite, ele vem de referências reais no código.',
        ],
      },
      {
        title: 'Uma sub-rede dentro',
        body: [
          'Sub-redes dividem a VPC em redes menores, uma por zona de disponibilidade. Veja a linha destacada `vpc_id = aws_vpc.main.id` — essa referência é o *único* motivo de a sub-rede aparecer dentro da caixa da VPC.',
          '`map_public_ip_on_launch = true` torna esta uma sub-rede pública: as instâncias criadas aqui recebem um IP exposto à internet.',
        ],
      },
      {
        title: 'O servidor web',
        body: [
          'O `aws_instance` é a máquina virtual de fato. `ami` escolhe a imagem de disco (esta é o Amazon Linux 2), `instance_type` escolhe o hardware — `t3.micro` entra no nível gratuito.',
          'A referência `subnet_id` o aninha dois níveis abaixo: instância → sub-rede → VPC. No editor, você chega ao mesmo resultado arrastando um EC2 da paleta e soltando-o dentro da sub-rede.',
        ],
      },
      {
        title: 'Proteja o acesso',
        body: [
          'Um grupo de segurança é um firewall com estado. O bloco `ingress` libera HTTP na porta 80 vindo de qualquer lugar; o bloco `egress` deixa o servidor acessar o exterior livremente.',
          'A instância o associa via `vpc_security_group_ids = [...]` — uma *lista* de referências. No canvas, essa referência é a conexão laranja tracejada. Exclua a conexão e a referência some do código; exclua a linha e a conexão some do canvas.',
          'Essa é a stack completa. Abra este passo no editor e experimente os dois sentidos você mesmo.',
        ],
      },
    ],
  },
  'static-site-cdn': {
    title: 'Site estático com S3 + CloudFront',
    description: 'Hospede arquivos em um bucket, faça cache na borda e coloque um domínio na frente.',
    steps: [
      {
        title: 'O bucket',
        body: [
          'Um bucket S3 é uma pasta sem fundo na nuvem — seu HTML, CSS e imagens ficam aqui. Nomes de bucket são únicos no mundo todo, então escolha algo específico.',
          '`force_destroy = true` permite que `terraform destroy` exclua o bucket mesmo que ele ainda tenha arquivos — prático para demos, perigoso em produção.',
        ],
      },
      {
        title: 'Cache na borda',
        body: [
          'O CloudFront replica seus arquivos em centenas de pontos de presença na borda da rede. O bloco `origin` aponta para o bucket — essa referência é a linha que você vê entre os dois nós.',
          'Blocos aninhados como `default_cache_behavior` configuram como as requisições são guardadas em cache e sempre redirecionadas para HTTPS. Blocos dentro de blocos são HCL normal — o canvas os mantém intactos mesmo quando você edita o recurso visualmente.',
        ],
      },
      {
        title: 'Um domínio de verdade',
        body: [
          'O Route 53 hospeda a zona DNS; o bloco `alias` dentro do registro aponta `www.example.com` direto para a distribuição. Registros alias são mágica da AWS — funcionam como CNAMEs, mas também no apex da zona.',
          'Siga as setas no diagrama: registro → zona, registro → distribuição → bucket. Todo o caminho da requisição fica visível de relance.',
        ],
      },
      {
        title: 'Outputs',
        body: [
          'Outputs são o que o Terraform mostra depois de `terraform apply` — os valores de que você realmente precisa, como o endereço do CDN para abrir no navegador.',
          'Por convenção, eles ficam em `outputs.tf`. Exporte o projeto como .zip e a estrutura de arquivos é exatamente a que você vê nestas abas.',
        ],
      },
    ],
  },
  'refs-become-connections': {
    title: 'Como as referências viram o diagrama',
    description: 'O modelo mental por trás da sincronia: aninhamento e conexões são derivados, nunca desenhados.',
    steps: [
      {
        title: 'Três recursos soltos',
        body: [
          'Repare na ordem do arquivo: a sub-rede é declarada *antes* da VPC que ela referencia. O Terraform não se importa — ele monta um grafo de dependências a partir das referências, não da ordem das linhas. O canvas lê o mesmo grafo.',
          'A instância ainda não tem referências, então ela flutua fora da caixa da VPC, desconectada.',
        ],
      },
      {
        title: 'Uma linha move um nó',
        body: [
          'Só uma linha destacada mudou: `subnet_id = aws_subnet.a.id`. Isso basta para a instância pular para dentro da sub-rede no diagrama.',
          'O inverso também funciona — no editor, arrastar a instância para dentro da sub-rede *escreve exatamente esta linha* para você. Não existe estado escondido no diagrama: o código é o diagrama.',
        ],
      },
      {
        title: 'Listas criam conexões',
        body: [
          'Grupos de segurança se associam por meio de uma lista: `vpc_security_group_ids = [aws_security_group.web.id]`. Referências dentro de listas (ou de blocos aninhados, ou até de chamadas de função) também são encontradas — cada uma vira uma conexão.',
          'Conexões laranja tracejadas são relações de segurança; as azuis contínuas são referências simples. Excluir a conexão no canvas remove o item da lista — e remove o argumento quando a lista fica vazia.',
        ],
      },
    ],
  },
  'azure-nesting': {
    title: 'Azure: grupos de recursos e aninhamento',
    description: 'O Azure organiza por nome, não por id — veja como o canvas acompanha.',
    steps: [
      {
        title: 'O grupo de recursos',
        body: [
          'O Azure exige que todo recurso pertença a um *grupo de recursos* — uma pasta com uma localização. Excluir o grupo exclui tudo o que está dentro, o que torna a limpeza deliciosamente fácil.',
          'No blueprint, o grupo é o contêiner tracejado mais externo. Tudo o que você adicionar a seguir fica aninhado dentro dele.',
        ],
      },
      {
        title: 'Rede dentro, sub-rede mais fundo',
        body: [
          'Onde a AWS vincula por id, o Azure vincula por *nome*: `resource_group_name = azurerm_resource_group.main.name`. Mesma ideia, atributo diferente — e o canvas aninha a partir dele do mesmo jeito.',
          'A sub-rede desce mais um nível via `virtual_network_name`. Repare que `location` também é uma referência: mude a localização do grupo uma vez e todo o resto acompanha.',
        ],
      },
      {
        title: 'Conta de armazenamento',
        body: [
          'Nomes de conta de armazenamento são rígidos: de 3 a 24 caracteres, só letras minúsculas e dígitos, únicos no mundo todo — sem hífens. O inspetor avisa quando falta um campo obrigatório.',
          '`LRS` mantém três cópias em um único datacenter; `GRS` replica para uma região pareada, para recuperação de desastres.',
        ],
      },
      {
        title: 'SQL Server + banco de dados',
        body: [
          'O banco de dados se liga ao servidor via `server_id` — desta vez uma referência por id, desenhada como conexão em vez de aninhamento (conceitualmente, um banco de dados não fica *dentro* da caixa do servidor; ele pertence a ele).',
          'A senha vem de `var.sql_admin_password`, declarada como `sensitive` em variables.tf — nunca coloque segredos direto no código. Abra a aba de variáveis para ver a declaração.',
        ],
      },
    ],
  },
};
