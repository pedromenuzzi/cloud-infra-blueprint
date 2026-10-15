/** Drag-and-drop feedback on the canvas: hints while dragging, notices and fixes after a drop. */
import { formatList } from '@/i18n/format';
import { defineMessages } from '@/i18n/messages';
import { phrase, type Noun } from '@/resources/dropReasons';

const { em, de, ao, o, um } = phrase;

export const dropMessages = defineMessages(
  {
    /** while dragging over a container it can go in */
    into: (c: Noun, name: string) => `Into ${c.en} ${name}`,
    /** …over one it can't */
    cant: (c: Noun, name: string) => `Can't go in ${c.en} ${name}`,
    /** …over one whose container takes it instead (a security group over a subnet) */
    goes: (p: Noun, name: string) => `Goes in ${p.en} ${name}`,
    stays: (p: Noun, name: string) => `Stays in ${p.en} ${name}`,
    leaves: (p: Noun, name: string, arg: string) => `Leaves ${p.en} ${name} (removes ${arg})`,
    releaseForFix: 'Release to see a fix',
    /** after a drop */
    placedIn: (p: Noun, name: string) => `Placed in ${p.en} ${name}`,
    placedBeside: (c: Noun, name: string) => `Placed beside ${c.en} ${name}`,
    // fixes offered with the explanation
    createGroup: (group: Noun, vpc: string) => `Create a ${group.en} in ${vpc}`,
    useGroup: (group: Noun, name: string) => `Use ${group.en} ${name}`,
    connectTo: (c: Noun, name: string) => `Connect to ${c.en} ${name}`,
    createdGroup: (id: string, subnets: string[], member: string) =>
      `Created ${id} with ${formatList(subnets, 'conjunction', 'en')}. ${member} is drawn inside it`,
    oneZone: 'AWS needs subnets in two availability zones: add a subnet in another zone to this group',
    // a database now in a VPC's subnets, and its security groups
    noSecurityGroup: (id: string, vpc: string) => `${id} has no security group of its own, so it gets the default group of ${vpc}`,
    securityGroupElsewhere: (ids: string[], vpc: string) =>
      `${formatList(ids, 'conjunction', 'en')} ${ids.length > 1 ? 'are' : 'is'} in another VPC, and AWS only takes security groups of ${vpc}, the database's VPC`,
    useSecurityGroup: (name: string) => `Use security group ${name}`,
    createSecurityGroup: (vpc: string) => `Create a security group in ${vpc}`,
    usedSecurityGroup: (id: string, group: string) => `${id} now uses ${group}`,
    createdSecurityGroup: (group: string, vpc: string, id: string) => `Created ${group} in ${vpc} for ${id}`,
    securityGroupsDropped: (ids: string[]) => `It no longer lists ${formatList(ids, 'conjunction', 'en')} (another VPC)`,
    noInboundYet: 'It lets nothing in yet: add an inbound rule for what connects to the database',
    movedInto: (name: string, group: string) => `${name} is now in ${group}`,
    connected: (name: string, target: string) => `Connected ${name} to ${target}`,
    undoHint: (undo: string) => `${undo} to undo`,
    fixGone: 'That changed in the meantime. Drag it again',
    /** dragged out of the container its argument pointed at */
    detached: (arg: string, id: string, parent: string, undo: string) =>
      `Removed ${arg} from ${id}: it's no longer in ${parent} (${undo} to undo)`,
  },
  {
    into: (c: Noun, name: string) => `Para ${o(c)} ${name}`,
    cant: (c: Noun, name: string) => `Não pode ficar ${em(c)} ${name}`,
    goes: (p: Noun, name: string) => `Vai para ${o(p)} ${name}`,
    stays: (p: Noun, name: string) => `Continua ${em(p)} ${name}`,
    leaves: (p: Noun, name: string, arg: string) => `Sai ${de(p)} ${name} (remove ${arg})`,
    releaseForFix: 'Solte para ver uma correção',
    placedIn: (p: Noun, name: string) => `Foi para ${o(p)} ${name}`,
    placedBeside: (c: Noun, name: string) => `Ficou ao lado ${de(c)} ${name}`,
    createGroup: (group: Noun, vpc: string) => `Criar ${um(group)} em ${vpc}`,
    useGroup: (group: Noun, name: string) => `Usar ${o(group)} ${name}`,
    connectTo: (c: Noun, name: string) => `Conectar ${ao(c)} ${name}`,
    createdGroup: (id: string, subnets: string[], member: string) =>
      `${id} criado com ${formatList(subnets, 'conjunction', 'pt-BR')}. ${member} aparece dentro dele`,
    oneZone: 'A AWS exige sub-redes em duas zonas de disponibilidade: adicione ao grupo uma sub-rede de outra zona',
    noSecurityGroup: (id: string, vpc: string) => `${id} não tem grupo de segurança próprio, então fica com o grupo padrão de ${vpc}`,
    securityGroupElsewhere: (ids: string[], vpc: string) =>
      `${formatList(ids, 'conjunction', 'pt-BR')} ${ids.length > 1 ? 'estão' : 'está'} em outra VPC, e a AWS só aceita grupos de segurança de ${vpc}, a VPC do banco`,
    useSecurityGroup: (name: string) => `Usar o grupo de segurança ${name}`,
    createSecurityGroup: (vpc: string) => `Criar um grupo de segurança em ${vpc}`,
    usedSecurityGroup: (id: string, group: string) => `${id} agora usa ${group}`,
    createdSecurityGroup: (group: string, vpc: string, id: string) => `${group} criado em ${vpc} para ${id}`,
    securityGroupsDropped: (ids: string[]) => `Ele não lista mais ${formatList(ids, 'conjunction', 'pt-BR')} (outra VPC)`,
    noInboundYet: 'Ele ainda não deixa nada entrar: adicione uma regra de entrada para o que se conecta ao banco',
    movedInto: (name: string, group: string) => `${name} agora está em ${group}`,
    connected: (name: string, target: string) => `${name} conectado a ${target}`,
    undoHint: (undo: string) => `${undo} para desfazer`,
    fixGone: 'Isso mudou nesse meio-tempo. Arraste de novo',
    detached: (arg: string, id: string, parent: string, undo: string) =>
      `${arg} removido de ${id}: ele não está mais em ${parent} (${undo} para desfazer)`,
  },
);
