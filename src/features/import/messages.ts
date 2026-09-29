/** The "Import from GitHub" dialog (the errors themselves come from lib/githubImport). */
import { formatNumber } from '@/i18n/format';
import { defineMessages } from '@/i18n/messages';

const s = (n: number) => (n === 1 ? '' : 's');

export const importMessages = defineMessages(
  {
    title: 'Import from GitHub',
    subtitle: 'A repository, folder, .tf file or gist',
    addToken: 'Add a token',
    tryAgain: 'Try again',
    requestsAnHour: (token: boolean) => `${token ? '5,000' : '60'} GitHub requests an hour`,
    rateTitle: (time: string) => `GitHub API rate limit — resets at ${time}`,
    rateReached: (time: string) => `Rate limit reached · resets ${time}`,
    requestsLeft: (remaining: number, limit: number) =>
      `${formatNumber(remaining, undefined, 'en')} of ${formatNumber(limit, undefined, 'en')} requests left`,
    token: 'Personal access token',
    optional: '(optional)',
    forgetToken: 'Forget token',
    tokenHint:
      'Memory only: never saved, never put in a link, gone when you reload. Sent only to api.github.com — for private repositories or a higher limit.',
    createToken: 'Create a read-only token',
    somethingWrong: 'Something went wrong while talking to GitHub — try again.',
    theGist: 'the gist',
    noRootModule: (where: string) => `No Terraform root module found in ${where}`,
    onlyChildModules:
      " — only child modules (modules/…), which aren't supported yet. Link to the folder of one to import it anyway.",
    tooLargeToList:
      ' — the repository is too large to list completely; link straight to the folder that holds your Terraform.',
    storageFull: 'Browser storage is full — export or delete a project, then import again.',
    imported: (name: string) => `Imported “${name}” from GitHub`,
    linkLabel: 'GitHub link or owner/repo',
    linkHint:
      '`owner/repo`, a folder link (`…/tree/‹branch›/‹folder›`), a `.tf` file link or a gist. One root module is imported — never state or the lock file.',
    useToken: 'Private repository or rate-limited? Use a token',
    cancel: 'Cancel',
    findTerraform: 'Find Terraform',
    looking: (label: string) => `Looking for Terraform in ${label}…`,
    findingBranch: 'Finding the default branch',
    listingFiles: 'Listing the files',
    back: 'Back',
    importFiles: (n: number) => `Import ${n} file${s(n)}`,
    importing: 'Importing…',
    importAnotherCopy: 'Import another copy',
    openExistingCopy: 'Open existing copy',
    oneModule: 'One Terraform root module found — import it:',
    manyModules: (n: number) => `${n} Terraform root modules found — pick the one to import:`,
    filterPlaceholder: 'Filter folders…',
    filterLabel: 'Filter folders',
    repositoryRoot: 'Repository root',
    files: (n: number) => `${n} file${s(n)}`,
    fromYourLink: ' · from your link',
    noFolderMatch: (filter: string) => `No folder matches “${filter}”.`,
    childModulesLeftOut: (n: number) =>
      `${n} .tf file${s(n)} in \`modules/\` folders ${n === 1 ? 'is' : 'are'} left out — modules aren’t supported yet.`,
    repoTruncated:
      'This repository is too large to list completely — some folders may be missing. Link straight to a folder to see all of it.',
    downloading: (done: number, total: number) => `Downloading ${done} of ${total} file${s(total)}…`,
    downloadProgress: 'Download progress',
    alreadyImported: (name: string) => `You already imported this exact version as “${name}”.`,
  },
  {
    title: 'Importar do GitHub',
    subtitle: 'Um repositório, pasta, arquivo .tf ou gist',
    addToken: 'Adicionar um token',
    tryAgain: 'Tentar de novo',
    requestsAnHour: (token: boolean) => `${token ? '5.000' : '60'} requisições por hora`,
    rateTitle: (time: string) => `Limite de requisições da API do GitHub — renova às ${time}`,
    rateReached: (time: string) => `Limite atingido até ${time}`,
    requestsLeft: (remaining: number, limit: number) =>
      `${formatNumber(remaining, undefined, 'pt-BR')} de ${formatNumber(limit, undefined, 'pt-BR')} restantes`,
    token: 'Token de acesso pessoal',
    optional: '(opcional)',
    forgetToken: 'Esquecer o token',
    tokenHint:
      'Só na memória: nunca é salvo nem colocado em um link, e some quando você recarrega. Enviado apenas para api.github.com — para repositórios privados ou um limite maior.',
    createToken: 'Criar um token somente leitura',
    somethingWrong: 'Algo deu errado na comunicação com o GitHub — tente de novo.',
    theGist: 'o gist',
    noRootModule: (where: string) => `Nenhum módulo raiz de Terraform encontrado em ${where}`,
    onlyChildModules:
      ' — só módulos filhos (modules/…), que ainda não são suportados. Aponte o link para a pasta de um deles para importá-lo mesmo assim.',
    tooLargeToList:
      ' — o repositório é grande demais para listar por completo; aponte o link direto para a pasta que tem o seu Terraform.',
    storageFull: 'O armazenamento do navegador está cheio — exporte ou exclua um projeto e importe de novo.',
    imported: (name: string) => `“${name}” importado do GitHub`,
    linkLabel: 'Link do GitHub ou owner/repo',
    linkHint:
      '`owner/repo`, um link de pasta (`…/tree/‹branch›/‹pasta›`), um link de arquivo `.tf` ou um gist. Um único módulo raiz é importado — nunca o state nem o lock file.',
    useToken: 'Repositório privado ou limite atingido? Use um token',
    cancel: 'Cancelar',
    findTerraform: 'Procurar Terraform',
    looking: (label: string) => `Procurando Terraform em ${label}…`,
    findingBranch: 'Descobrindo o branch padrão',
    listingFiles: 'Listando os arquivos',
    back: 'Voltar',
    importFiles: (n: number) => `Importar ${n} arquivo${s(n)}`,
    importing: 'Importando…',
    importAnotherCopy: 'Importar outra cópia',
    openExistingCopy: 'Abrir a cópia existente',
    oneModule: 'Um módulo raiz de Terraform encontrado — importe-o:',
    manyModules: (n: number) => `${n} módulos raiz de Terraform encontrados — escolha qual importar:`,
    filterPlaceholder: 'Filtrar pastas…',
    filterLabel: 'Filtrar pastas',
    repositoryRoot: 'Raiz do repositório',
    files: (n: number) => `${n} arquivo${s(n)}`,
    fromYourLink: ' · do seu link',
    noFolderMatch: (filter: string) => `Nenhuma pasta corresponde a “${filter}”.`,
    childModulesLeftOut: (n: number) =>
      n === 1
        ? '1 arquivo .tf em pastas `modules/` ficou de fora — módulos ainda não são suportados.'
        : `${n} arquivos .tf em pastas \`modules/\` ficaram de fora — módulos ainda não são suportados.`,
    repoTruncated:
      'Este repositório é grande demais para listar por completo — algumas pastas podem estar faltando. Aponte o link direto para uma pasta para ver tudo.',
    downloading: (done: number, total: number) => `Baixando ${done} de ${total} arquivo${s(total)}…`,
    downloadProgress: 'Progresso do download',
    alreadyImported: (name: string) => `Você já importou exatamente esta versão como “${name}”.`,
  },
);
