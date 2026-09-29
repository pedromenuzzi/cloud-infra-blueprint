/**
 * Text produced in src/lib (outside React): read with `messagesFor(...)` at
 * the moment it is produced. The GitHub import and backup messages have their
 * own modules, so they load with those lazy features.
 */
import { formatNumber } from '@/i18n/format';
import { defineMessages } from '@/i18n/messages';

const s = (n: number) => (n === 1 ? '' : 's');

export const libMessages = defineMessages(
  {
    // page titles
    appTagline: 'Design cloud infrastructure visually. Ship Terraform instantly.',

    // storage
    untitledProject: 'Untitled project',
    copyOf: (name: string) => `${name} copy`,
    storageFull: 'Storage is full — export or delete projects',
    demoDescription: 'Demo project — a classic VPC + EC2 + RDS web stack. Safe to edit or delete.',

    // share links
    sharedProject: 'Shared project',
    shareTooLarge: 'This project is too large to share as a link — export a Terraform zip instead.',
    shareLong: (kb: number) =>
      `This link is ${kb} KB — links over 32 KB can get cut off by chat apps and browsers. For big projects, share a Terraform zip.`,

    // importing .tf files
    importedRootModule: (where: string, skipped: number) =>
      `Imported the root module${where ? ` (${where}/)` : ''}; ${skipped} file${s(skipped)} in modules/ ` +
      `${skipped === 1 ? 'was' : 'were'} skipped (modules aren't supported yet)`,
    importOversized: (n: number) => `${n} file${n === 1 ? ' was' : 's were'} too large to import`,

    // the README inside a Terraform zip
    exportReadme: (name: string, repo: string, files: string) => `# ${name}

Terraform project exported from [Cloud Blueprint](${repo}) —
the free, in-browser visual editor for cloud architecture.

## Files

${files}

## Usage

\`\`\`bash
terraform init
terraform plan
terraform apply
\`\`\`

> Review variables (e.g. passwords marked \`sensitive\`) before applying.
`,

    // folder sync
    folderRevoked: 'Permission to the folder was revoked',
    diskFull: 'The disk is full',
    fileLocked: 'A file is locked by another program',
    folderUnreadable: 'The folder could not be read or written',
    projectNotSaved: 'The project could not be saved in this browser',
    folderMissing: 'The folder was moved, renamed or deleted',
  },
  {
    appTagline: 'Desenhe sua infraestrutura em nuvem. Gere o Terraform na hora.',

    untitledProject: 'Projeto sem nome',
    copyOf: (name: string) => `${name} (cópia)`,
    storageFull: 'O armazenamento está cheio — exporte ou exclua projetos',
    demoDescription:
      'Projeto de demonstração — uma stack web clássica com VPC + EC2 + RDS. Pode editar ou excluir à vontade.',

    sharedProject: 'Projeto compartilhado',
    shareTooLarge: 'Este projeto é grande demais para compartilhar por link — exporte um .zip do Terraform.',
    shareLong: (kb: number) =>
      `Este link tem ${formatNumber(kb, undefined, 'pt-BR')} KB — links acima de 32 KB podem ser cortados por apps de chat e navegadores. Para projetos grandes, compartilhe um .zip do Terraform.`,

    importedRootModule: (where: string, skipped: number) =>
      `Módulo raiz importado${where ? ` (${where}/)` : ''}; ${skipped} arquivo${s(skipped)} em modules/ ` +
      `${skipped === 1 ? 'foi ignorado' : 'foram ignorados'} (módulos ainda não são suportados)`,
    importOversized: (n: number) =>
      n === 1 ? '1 arquivo era grande demais para importar' : `${n} arquivos eram grandes demais para importar`,

    exportReadme: (name: string, repo: string, files: string) => `# ${name}

Projeto Terraform exportado do [Cloud Blueprint](${repo}) —
o editor visual de arquitetura em nuvem, gratuito e no navegador.

## Arquivos

${files}

## Como usar

\`\`\`bash
terraform init
terraform plan
terraform apply
\`\`\`

> Revise as variáveis (por exemplo, senhas marcadas como \`sensitive\`) antes de aplicar.
`,

    folderRevoked: 'A permissão para a pasta foi revogada',
    diskFull: 'O disco está cheio',
    fileLocked: 'Um arquivo está bloqueado por outro programa',
    folderUnreadable: 'Não foi possível ler ou gravar a pasta',
    projectNotSaved: 'Não foi possível salvar o projeto neste navegador',
    folderMissing: 'A pasta foi movida, renomeada ou excluída',
  },
);
