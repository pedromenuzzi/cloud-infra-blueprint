/** The app shell's own text: rail, dialogs, banners, error screen, thumbnails. */
import { defineMessages } from '@/i18n/messages';

const s = (n: number) => (n === 1 ? '' : 's');

export const shellMessages = defineMessages(
  {
    // ui.tsx
    close: 'Close',
    // Confirm
    cancel: 'Cancel',
    confirm: 'Confirm',
    // ThemeToggle
    theme: 'Theme',
    themeIs: (name: string) => `Theme: ${name}`,
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    // AppRail
    primaryNav: 'Primary',
    home: 'Cloud Blueprint home',
    projects: 'Projects',
    tutorials: 'Tutorials',
    templates: 'Templates',
    githubRepo: 'GitHub repository',
    // AppErrorScreen
    somethingWrong: 'Something went wrong',
    appUpdated: 'Cloud Blueprint was updated',
    chunkOffline: 'Part of the app could not be downloaded: you seem to be offline. Reconnect, then reload.',
    chunkStale:
      'Part of the app could not be downloaded, usually because a new version was just published. Reload to get it.',
    crashed: 'The page hit an unexpected error. Your projects are saved in this browser. Reloading usually fixes it.',
    reload: 'Reload',
    backToProjects: 'Back to projects',
    errorDetails: 'Error details',
    unknownError: 'Unknown error',
    // StorageNotices
    storageBlocked: 'Your browser blocks storage: changes won’t persist after you close this tab.',
    storageFullBanner: 'Storage is full: changes aren’t being saved. Export or delete projects to free space.',
    storageFullToast: 'Storage is full: export or delete projects',
    storageNearlyFull: (percent: number) =>
      `Browser storage is ${percent}% full. Export or delete old projects to keep saving`,
    storageBackupKept: 'Some saved projects were unreadable. A backup copy was kept in this browser',
    dismiss: 'Dismiss',
    // ShareLinkHost
    shareInvalid: 'This share link is damaged or incomplete. Ask for a new one',
    shareTooLarge: 'This share link is too large to open safely',
    shareVersion: 'This share link needs a newer version of Cloud Blueprint. Reload and try again',
    importedFromShare: 'Imported from a share link.',
    importedToast: (name: string) => `Imported “${name}” from share link`,
    importCopyLabel: (name: string) => `Import a copy of ${name}?`,
    importCopyTitle: (name: string) => `Import a copy of “${name}”?`,
    shareFiles: (n: number) =>
      `${n} Terraform file${s(n)} from a share link. The copy is saved in this browser only.`,
    alreadyImported: (name: string) => `You already imported this link as “${name}”.`,
    reviewCode:
      'Review the code before running `terraform apply`: shared Terraform can run commands on your machine (e.g. `local-exec` provisioners).',
    importAnotherCopy: 'Import another copy',
    openExistingCopy: 'Open existing copy',
    importCopy: 'Import copy',
    // ProjectConflictHost
    deletedElsewhere: (name: string) => `“${name}” was deleted in another tab`,
    changedElsewhere: (name: string) => `“${name}” was changed in another tab`,
    deletedBody:
      'This tab still has your latest changes. Put the project back, keep them as a new project, or let it go.',
    changedBody:
      'This tab has changes that aren’t saved yet. Load the other tab’s version (your recent changes here are dropped) or keep yours (the other tab’s changes are overwritten).',
    discard: 'Discard',
    keepAsNew: 'Keep as new project',
    restoreProject: 'Restore project',
    loadOther: 'Load other version',
    keepMine: 'Keep mine',
    // ProjectThumbnail / HclSnippet
    emptyCanvas: 'Empty canvas',
    architecturePreview: 'Architecture preview',
    newLine: 'new',
  },
  {
    close: 'Fechar',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    theme: 'Tema',
    themeIs: (name: string) => `Tema: ${name}`,
    light: 'Claro',
    dark: 'Escuro',
    system: 'Sistema',
    primaryNav: 'Principal',
    home: 'Página inicial do Cloud Blueprint',
    projects: 'Projetos',
    tutorials: 'Tutoriais',
    templates: 'Templates',
    githubRepo: 'Repositório no GitHub',
    somethingWrong: 'Algo deu errado',
    appUpdated: 'O Cloud Blueprint foi atualizado',
    chunkOffline: 'Parte do app não pôde ser baixada: parece que você está offline. Reconecte e recarregue.',
    chunkStale:
      'Parte do app não pôde ser baixada, geralmente porque uma nova versão acabou de ser publicada. Recarregue para obtê-la.',
    crashed:
      'A página encontrou um erro inesperado. Seus projetos estão salvos neste navegador. Recarregar costuma resolver.',
    reload: 'Recarregar',
    backToProjects: 'Voltar aos projetos',
    errorDetails: 'Detalhes do erro',
    unknownError: 'Erro desconhecido',
    storageBlocked: 'Seu navegador bloqueia o armazenamento: as alterações se perdem quando você fechar esta aba.',
    storageFullBanner:
      'O armazenamento está cheio: as alterações não estão sendo salvas. Exporte ou exclua projetos para liberar espaço.',
    storageFullToast: 'O armazenamento está cheio: exporte ou exclua projetos',
    storageNearlyFull: (percent: number) =>
      `O armazenamento do navegador está ${percent}% cheio. Exporte ou exclua projetos antigos para continuar salvando`,
    storageBackupKept: 'Alguns projetos salvos estavam ilegíveis. Uma cópia de segurança foi guardada neste navegador',
    dismiss: 'Dispensar',
    shareInvalid: 'Este link de compartilhamento está danificado ou incompleto. Peça um novo',
    shareTooLarge: 'Este link de compartilhamento é grande demais para abrir com segurança',
    shareVersion:
      'Este link de compartilhamento precisa de uma versão mais nova do Cloud Blueprint. Recarregue e tente de novo',
    importedFromShare: 'Importado de um link de compartilhamento.',
    importedToast: (name: string) => `“${name}” importado do link de compartilhamento`,
    importCopyLabel: (name: string) => `Importar uma cópia de ${name}?`,
    importCopyTitle: (name: string) => `Importar uma cópia de “${name}”?`,
    shareFiles: (n: number) =>
      `${n} arquivo${s(n)} Terraform de um link de compartilhamento. A cópia fica salva só neste navegador.`,
    alreadyImported: (name: string) => `Você já importou este link como “${name}”.`,
    reviewCode:
      'Revise o código antes de rodar `terraform apply`: um Terraform compartilhado pode executar comandos na sua máquina (por exemplo, provisioners `local-exec`).',
    importAnotherCopy: 'Importar outra cópia',
    openExistingCopy: 'Abrir a cópia existente',
    importCopy: 'Importar cópia',
    deletedElsewhere: (name: string) => `“${name}” foi excluído em outra aba`,
    changedElsewhere: (name: string) => `“${name}” foi alterado em outra aba`,
    deletedBody:
      'Esta aba ainda tem suas últimas alterações. Restaure o projeto, guarde-as como um novo projeto ou descarte-as.',
    changedBody:
      'Esta aba tem alterações que ainda não foram salvas. Carregue a versão da outra aba (suas alterações recentes aqui são descartadas) ou mantenha a sua (as alterações da outra aba são sobrescritas).',
    discard: 'Descartar',
    keepAsNew: 'Guardar como novo projeto',
    restoreProject: 'Restaurar projeto',
    loadOther: 'Carregar a outra versão',
    keepMine: 'Manter a minha',
    emptyCanvas: 'Canvas vazio',
    architecturePreview: 'Prévia da arquitetura',
    newLine: 'novo',
  },
);
