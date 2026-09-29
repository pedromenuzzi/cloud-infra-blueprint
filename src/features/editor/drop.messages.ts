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
      `Created ${id} with ${formatList(subnets, 'conjunction', 'en')} — ${member} is drawn inside it`,
    oneZone: 'AWS needs subnets in two availability zones — add a subnet in another zone to this group',
    movedInto: (name: string, group: string) => `${name} is now in ${group}`,
    connected: (name: string, target: string) => `Connected ${name} to ${target}`,
    undoHint: (mod: string) => `${mod} Z to undo`,
    fixGone: 'That changed in the meantime — drag it again',
    /** dragged out of the container its argument pointed at */
    detached: (arg: string, id: string, parent: string, mod: string) =>
      `Removed ${arg} from ${id} — it's no longer in ${parent} (${mod} Z to undo)`,
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
      `${id} criado com ${formatList(subnets, 'conjunction', 'pt-BR')} — ${member} aparece dentro dele`,
    oneZone: 'A AWS exige sub-redes em duas zonas de disponibilidade — adicione ao grupo uma sub-rede de outra zona',
    movedInto: (name: string, group: string) => `${name} agora está em ${group}`,
    connected: (name: string, target: string) => `${name} conectado a ${target}`,
    undoHint: (mod: string) => `${mod} Z para desfazer`,
    fixGone: 'Isso mudou nesse meio-tempo — arraste de novo',
    detached: (arg: string, id: string, parent: string, mod: string) =>
      `${arg} removido de ${id} — ele não está mais em ${parent} (${mod} Z para desfazer)`,
  },
);
