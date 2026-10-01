/**
 * The words of the security audit (audit.ts): what a risky rule opens, each
 * finding's title and explanation, and the one-click fixes. Resource names,
 * argument names, CIDRs and control IDs are passed in as written.
 */
import { defineMessages } from '@/i18n/messages';

/** what a rule open to the internet lets in — the structure behind a risk's words */
export type RiskWhat =
  | { kind: 'every-port' }
  | { kind: 'all-tcp' }
  | { kind: 'all-udp' }
  /** admin / database ports: [port, service] */
  | { kind: 'ports'; hits: Array<[number, string]> }
  | { kind: 'wide'; from: number; to: number }
  /** ports written as an expression */
  | { kind: 'unverified'; expr: string | undefined }
  /** a network ACL allowing SSH / RDP */
  | { kind: 'nacl'; hits: Array<[number, string]> };

/** how a rule finding's explanation ends */
export type RuleTail = { kind: 'nacl' } | { kind: 'reachable'; names: string } | { kind: 'unused' };

function joinWith(names: string[], and: string, more: (n: number) => string): string {
  const shown = names.length > 3 ? [...names.slice(0, 3), more(names.length - 3)] : names;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} ${and} ${shown[shown.length - 1]}`;
}

// ------------------------------------------------------------------ English

const joinEn = (names: string[]) => joinWith(names, 'and', (n) => `${n} more`);

function riskEn(w: RiskWhat): string {
  switch (w.kind) {
    case 'every-port':
      return 'Every port is open to the internet';
    case 'all-tcp':
      return 'All TCP ports are open to the internet';
    case 'all-udp':
      return 'All UDP ports are open to the internet';
    case 'ports':
      return w.hits.length === 1
        ? `${w.hits[0][1]} (port ${w.hits[0][0]}) is open to the internet`
        : `${joinEn(w.hits.map(([p, n]) => `${n} (${p})`))} are open to the internet`;
    case 'wide':
      return `Wide port range ${w.from}–${w.to} is open to the internet`;
    case 'unverified':
      return `Port that can't be verified (${w.expr}) is open to the internet`;
    case 'nacl':
      return `Network ACL allows ${joinEn(w.hits.map(([p, n]) => `${n} (port ${p})`))} from the internet`;
  }
}

const titleEn = (w: RiskWhat, v6: boolean) => (v6 ? `${riskEn(w)} over IPv6` : riskEn(w));

// ------------------------------------------------------------------ Portuguese

const joinPt = (names: string[]) => joinWith(names, 'e', (n) => `mais ${n}`);

/** service names are product / protocol names, except the one that is a description */
const servicePt = (name: string) => (name === 'Docker API' ? 'API do Docker' : name);
/** "aberto" / "aberta": a service is masculine ("o SSH"), "a API do Docker" feminine */
const openPt = (name: string) => (servicePt(name).startsWith('API ') ? 'aberta' : 'aberto');

function riskPt(w: RiskWhat): string {
  switch (w.kind) {
    case 'every-port':
      return 'Todas as portas abertas para a internet';
    case 'all-tcp':
      return 'Todas as portas TCP abertas para a internet';
    case 'all-udp':
      return 'Todas as portas UDP abertas para a internet';
    case 'ports':
      return w.hits.length === 1
        ? `${servicePt(w.hits[0][1])} (porta ${w.hits[0][0]}) ${openPt(w.hits[0][1])} para a internet`
        : `${joinPt(w.hits.map(([p, n]) => `${servicePt(n)} (${p})`))} abertos para a internet`;
    case 'wide':
      return `Faixa ampla de portas ${w.from}–${w.to} aberta para a internet`;
    case 'unverified':
      return `Porta não verificável (${w.expr}) aberta para a internet`;
    case 'nacl':
      return `ACL de rede permite ${joinPt(w.hits.map(([p, n]) => `${n} (porta ${p})`))} a partir da internet`;
  }
}

/** the same risk as news, for the toast after an edit */
function alertPt(w: RiskWhat): string {
  switch (w.kind) {
    case 'every-port':
      return 'Todas as portas agora estão abertas para a internet';
    case 'all-tcp':
      return 'Todas as portas TCP agora estão abertas para a internet';
    case 'all-udp':
      return 'Todas as portas UDP agora estão abertas para a internet';
    case 'ports':
      return w.hits.length === 1
        ? `${servicePt(w.hits[0][1])} (${w.hits[0][0]}) agora está ${openPt(w.hits[0][1])} para a internet`
        : `${joinPt(w.hits.map(([p, n]) => `${servicePt(n)} (${p})`))} agora estão abertos para a internet`;
    case 'wide':
      return `A faixa ampla de portas ${w.from}–${w.to} agora está aberta para a internet`;
    case 'unverified':
      return `A porta não verificável (${w.expr}) agora está aberta para a internet`;
    case 'nacl':
      return `ACL de rede permite ${joinPt(w.hits.map(([p, n]) => `${n} (${p})`))} a partir da internet`;
  }
}

export const auditMessages = defineMessages(
  {
    join: joinEn,
    risk: riskEn,
    /** a rule finding's title: the risk, over IPv6 only for a rule that admits only ::/0 */
    ruleTitle: titleEn,
    /** the title as news: "SSH (22) is now open to the internet" */
    ruleAlert: (w: RiskWhat, v6: boolean) =>
      titleEn(w, v6)
        .replace(/\(port (\d+)\)/g, '($1)')
        .replace(/ (is|are) open to the internet/, ' $1 now open to the internet'),
    implicitSources: 'no source ranges, so 0.0.0.0/0',
    unverifiedWhat: (expr: string | undefined) => `ports set by an expression (${expr}, so the audit can't tell which are open)`,
    ruleDetail: (owner: string, what: string, sources: string, tail: RuleTail) =>
      `${owner} allows ${what} from anywhere (${sources}).` +
      (tail.kind === 'nacl'
        ? ' Security groups still apply, but the network ACL adds no protection for these ports.'
        : tail.kind === 'reachable'
          ? ` Reachable right now on ${tail.names}.`
          : ' Nothing public uses it yet, but the next resource that does will be exposed.'),
    removeFromRule: (services: string) => `Remove ${services} from this rule`,
    naclOpenTitle: 'Network ACL allows all inbound traffic',
    naclOpenDetail: (owner: string) => `${owner} lets every protocol in from anywhere, so it adds no protection beyond the security groups.`,
    unverifiedTitle: "Some inbound rules can't be verified",
    unverifiedDetail: (owner: string, reasons: string) =>
      `${owner} defines inbound rules with ${reasons}, so the audit can't evaluate them. Check what they open in code.`,
    rdsPublicTitle: 'Database is publicly accessible',
    rdsPublicDetail: (name: string) => `${name} gets a public endpoint. Keep databases private and reach them from inside the VPC.`,
    rdsPublicFix: 'Make it private',
    rdsEncryptionTitle: 'Database storage is not encrypted',
    rdsEncryptionDetail: (name: string) =>
      `${name} doesn't set storage_encrypted = true. Encryption at rest is free and can't be enabled later without a restore.`,
    rdsEncryptionFix: 'Encrypt storage',
    imdsTitle: (what: 'instance' | 'template') => `${what === 'instance' ? 'Instance metadata' : 'Launch template'} allows IMDSv1`,
    imdsDetail: (name: string) =>
      `${name} accepts token-less metadata requests, the classic SSRF path to stealing instance credentials. Require IMDSv2.`,
    imdsFix: 'Require IMDSv2',
    lbHttpTitle: 'Load balancer only serves plain HTTP',
    lbHttpDetail: (name: string) =>
      `${name} has no HTTPS listener, so traffic from users travels unencrypted. Add an HTTPS listener with an ACM certificate.`,
    s3PublicTitle: 'Bucket has no public access block',
    s3PublicDetail: (name: string) =>
      `${name} relies on account defaults. A public access block makes "never public" explicit and prevents accidental exposure.`,
    s3PublicFix: 'Block public access',
    defaultSgTitle: 'Default security group allows traffic',
    defaultSgDetail: (name: string, count: number) =>
      `${name} keeps ${count} rule${count === 1 ? '' : 's'}. Leave the VPC's default group empty (no ingress or egress blocks) and give each workload a group of its own.`,
    unusedTitle: 'Security group is not attached to anything',
    unusedDetail: (name: string) =>
      `${name} protects no resource. Attach it (connect it to an instance, load balancer or database) or remove it.`,
  },
  {
    join: joinPt,
    risk: riskPt,
    ruleTitle: (w: RiskWhat, v6: boolean) => (v6 ? `${riskPt(w)} via IPv6` : riskPt(w)),
    ruleAlert: (w: RiskWhat, v6: boolean) => (v6 ? `${alertPt(w)} via IPv6` : alertPt(w)),
    implicitSources: 'sem intervalos de origem, então 0.0.0.0/0',
    unverifiedWhat: (expr: string | undefined) =>
      `portas definidas por uma expressão (${expr}, então a auditoria não consegue saber quais estão abertas)`,
    ruleDetail: (owner: string, what: string, sources: string, tail: RuleTail) =>
      `${owner} permite ${what} de qualquer lugar (${sources}).` +
      (tail.kind === 'nacl'
        ? ' Os grupos de segurança continuam valendo, mas a ACL de rede não acrescenta proteção para essas portas.'
        : tail.kind === 'reachable'
          ? ` Acessível agora em ${tail.names}.`
          : ' Nada público usa esta regra ainda, mas o próximo recurso que usar ficará exposto.'),
    removeFromRule: (services: string) => `Remover ${services} desta regra`,
    naclOpenTitle: 'ACL de rede permite todo o tráfego de entrada',
    naclOpenDetail: (owner: string) =>
      `${owner} deixa entrar qualquer protocolo de qualquer lugar, então não acrescenta proteção além dos grupos de segurança.`,
    unverifiedTitle: 'Algumas regras de entrada não podem ser verificadas',
    unverifiedDetail: (owner: string, reasons: string) =>
      `${owner} define regras de entrada com ${reasons}, então a auditoria não consegue avaliá-las. Confira no código o que elas liberam.`,
    rdsPublicTitle: 'Banco de dados com acesso público',
    rdsPublicDetail: (name: string) =>
      `${name} recebe um endpoint público. Mantenha os bancos de dados privados e acesse-os de dentro da VPC.`,
    rdsPublicFix: 'Tornar privado',
    rdsEncryptionTitle: 'Armazenamento do banco de dados sem criptografia',
    rdsEncryptionDetail: (name: string) =>
      `${name} não define storage_encrypted = true. A criptografia em repouso é gratuita e não pode ser ativada depois sem uma restauração.`,
    rdsEncryptionFix: 'Ativar criptografia',
    imdsTitle: (what: 'instance' | 'template') =>
      what === 'instance' ? 'Metadados da instância aceitam IMDSv1' : 'Launch template aceita IMDSv1',
    imdsDetail: (name: string) =>
      `${name} aceita requisições de metadados sem token, o caminho clássico de SSRF para roubar as credenciais da instância. Exija IMDSv2.`,
    imdsFix: 'Exigir IMDSv2',
    lbHttpTitle: 'Balanceador de carga só atende HTTP sem criptografia',
    lbHttpDetail: (name: string) =>
      `${name} não tem listener HTTPS, então o tráfego dos usuários passa sem criptografia. Adicione um listener HTTPS com um certificado do ACM.`,
    s3PublicTitle: 'Bucket sem bloqueio de acesso público',
    s3PublicDetail: (name: string) =>
      `${name} depende dos padrões da conta. Um bloqueio de acesso público deixa explícito que ele nunca será público e evita exposição acidental.`,
    s3PublicFix: 'Bloquear acesso público',
    defaultSgTitle: 'Grupo de segurança padrão permite tráfego',
    defaultSgDetail: (name: string, count: number) =>
      `${name} mantém ${count} regra${count === 1 ? '' : 's'}. Deixe o grupo padrão da VPC vazio (sem blocos ingress ou egress) e dê a cada carga de trabalho um grupo próprio.`,
    unusedTitle: 'Grupo de segurança não está associado a nada',
    unusedDetail: (name: string) =>
      `${name} não protege nenhum recurso. Associe-o (conecte-o a uma instância, um balanceador de carga ou um banco de dados) ou remova-o.`,
  },
);

export type AuditMessages = (typeof auditMessages)['en'];
