/** Backup / restore text, read with `messagesFor` when a backup is written or checked. */
import { formatNumber } from '@/i18n/format';
import { defineMessages } from '@/i18n/messages';

export const backupMessages = defineMessages(
  {
    notABackup: 'This file isn’t a Cloud Blueprint backup.',
    unknownVersion: 'This backup’s manifest is damaged (unknown format version).',
    newerVersion: 'This backup was made by a newer version of Cloud Blueprint. Reload the app to update it, then try again.',
    noProjectList: 'This backup’s manifest is damaged (no project list).',
    tooManyProjects: (max: number) => `This backup lists more than ${max} projects, too many to restore at once.`,
    projectLabel: (n: number) => `Project ${n}`,
    notAProject: 'not a project entry',
    missingId: 'missing id',
    listedTwice: 'listed twice',
    damagedFileList: 'damaged file list',
    fileTooLarge: (file: string) => `${file} is too large`,
    fileMissing: (file: string) => `${file} is missing from the zip`,
    notAZip: 'This file isn’t a readable .zip archive.',
    terraformExport:
      'This zip holds Terraform files but no backup manifest: it’s an export, not a backup. Use “Import .tf” to open it as a project.',
    noManifest: 'This file isn’t a Cloud Blueprint backup. (It has no manifest.json.)',
    manifestTooLarge: 'This backup’s manifest is too large to read.',
    manifestNotJson: 'This backup’s manifest.json is damaged (it isn’t valid JSON).',
    filesUnreadable: 'This backup is damaged: its files can’t be read.',
    readme: (count: number, exportedAt: string) => `# Cloud Blueprint backup

${count} project${count === 1 ? '' : 's'}, exported ${exportedAt}.

Each folder is one project: its Terraform files, ready for \`terraform init\`.
\`manifest.json\` keeps names, ids, templates and dates so the backup can be
restored as it was.

To restore: open Cloud Blueprint → Projects → **Restore from backup…** and pick
this .zip. Nothing is overwritten without asking.
`,
  },
  {
    notABackup: 'Este arquivo não é um backup do Cloud Blueprint.',
    unknownVersion: 'O manifesto deste backup está danificado (versão de formato desconhecida).',
    newerVersion:
      'Este backup foi feito por uma versão mais nova do Cloud Blueprint. Recarregue o app para atualizá-lo e tente de novo.',
    noProjectList: 'O manifesto deste backup está danificado (sem lista de projetos).',
    tooManyProjects: (max: number) =>
      `Este backup lista mais de ${formatNumber(max, undefined, 'pt-BR')} projetos. São muitos para restaurar de uma vez.`,
    projectLabel: (n: number) => `Projeto ${n}`,
    notAProject: 'não é um projeto',
    missingId: 'sem id',
    listedTwice: 'listado duas vezes',
    damagedFileList: 'lista de arquivos danificada',
    fileTooLarge: (file: string) => `${file} é grande demais`,
    fileMissing: (file: string) => `${file} não está no zip`,
    notAZip: 'Este arquivo não é um .zip legível.',
    terraformExport:
      'Este zip tem arquivos Terraform, mas nenhum manifesto de backup: é uma exportação, não um backup. Use “Importar .tf” para abri-lo como projeto.',
    noManifest: 'Este arquivo não é um backup do Cloud Blueprint. (Ele não tem manifest.json.)',
    manifestTooLarge: 'O manifesto deste backup é grande demais para ser lido.',
    manifestNotJson: 'O manifest.json deste backup está danificado (não é um JSON válido).',
    filesUnreadable: 'Este backup está danificado: não é possível ler os arquivos.',
    readme: (count: number, exportedAt: string) => `# Backup do Cloud Blueprint

${count} projeto${count === 1 ? '' : 's'}, exportado${count === 1 ? '' : 's'} em ${exportedAt}.

Cada pasta é um projeto: os arquivos Terraform dele, prontos para \`terraform init\`.
O \`manifest.json\` guarda nomes, ids, templates e datas para que o backup possa
ser restaurado como estava.

Para restaurar: abra o Cloud Blueprint → Projetos → **Restaurar backup…** e escolha
este .zip. Nada é sobrescrito sem perguntar.
`,
  },
);
