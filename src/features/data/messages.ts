/** "Your data" on the dashboard, its dialogs, the update prompt and folder sync. */
import { defineMessages } from '@/i18n/messages';

const s = (n: number) => (n === 1 ? '' : 's');

export const dataMessages = defineMessages(
  {
    // backing up
    nothingToBackUp: 'There are no projects to back up yet',
    backupDownloaded: (n: number) => `Backup downloaded: ${n} project${s(n)}`,
    backupFailed: 'The backup could not be created',
    restoreInput: 'Restore from backup file',

    // DataPanel — storage
    yourData: 'Your data',
    browserStorage: 'Browser storage',
    percentUsed: (percent: number) => `${percent}% used`,
    storageUsedLabel: 'Browser storage used',
    meterValue: (percent: number, used: string, total: string) => `${percent}% (${used} of ${total})`,
    projectsUsageBefore: 'Projects: ',
    projectsUsageAfter: (total: string) => ` of ~${total} this browser allows`,
    originUsed: (used: string) => `Offline app & folder links: ${used} · `,
    originFree: (free: string) => `${free} free on this device`,
    backUpAndFree: 'Back up and free space',
    protectedTitle: 'Protected storage.',
    protectedBody: ' The browser won’t clear your projects to free up disk space.',
    persistGranted: 'Storage protected: the browser won’t clear your projects',
    persistDeclined: 'The browser declined for now',
    keepMyData: 'Keep my data',
    persistDeclinedHint: 'Declined for now. Browsers usually allow it for installed apps and sites you use often.',
    persistHint: 'Asks the browser never to clear your projects when the device runs low on space.',

    // DataPanel — backup
    backup: 'Backup',
    lastBackup: (when: string) => `Last backup ${when}`,
    noBackupYet: 'No backup yet',
    backupBody:
      'Download every project as one .zip, with a folder of Terraform files per project. Restore it here or in any other browser; nothing is overwritten without asking.',
    backUpAll: 'Back up all projects',
    restoreFromBackup: 'Restore from backup…',
    offlineReady: 'Works offline: this browser keeps a copy of the app, so it opens without a connection.',
    offlineLater: 'Works offline after the first visit. Install it from the browser menu to open it like an app.',
    openFolder: 'Open folder…',
    openFolderAfter: ' links a project to Terraform files on your disk: saves go straight to the .tf files.',
    folderUnsupported:
      'Folder sync needs Chrome or Edge. Here, drop a folder on this page to import it, and use a backup or the Terraform .zip export to take files out.',
    restored: (count: number, replaced: number) =>
      `Restored ${count} project${s(count)}${replaced > 0 ? ` (${replaced} replaced)` : ''}`,
    deletedToBackup: (n: number) => `Deleted ${n} project${s(n)}. ${n === 1 ? 'It’s' : 'They’re'} in your backup`,

    // StorageNudge
    nudgeTitle: (percent: number) => `Browser storage is ${percent}% full.`,
    nudgeFull: 'New changes may stop saving. Back up your projects, then delete the ones you don’t need.',
    nudgeNear: 'Back up your projects, then delete the ones you don’t need to keep saving smoothly.',
    dismissNudge: 'Dismiss storage warning',

    // FreeSpaceDialog
    freeUpTitle: 'Free up browser storage',
    backupDone: 'Backup downloaded.',
    backupHoldsAfter: ' holds every project. Restore any of them later from the dashboard.',
    selectToDelete: 'Select the projects to delete from this browser (largest first)',
    updated: (when: string) => `Updated ${when}`,
    frees: (size: string) => `Frees about ${size}`,
    nothingSelected: 'Nothing selected',
    done: 'Done',
    deleteProjects: (n: number) => `Delete ${n || ''} project${s(n)}`,

    // UpdatePrompt
    nowOffline: 'Cloud Blueprint now works offline too',
    updateAvailable: 'Update available',
    updateHint: ': reload to get the new version.',
    reloading: 'Reloading…',
    reload: 'Reload',
    dismiss: 'Dismiss',

    // RestoreDialog
    statusNew: 'New',
    statusDuplicate: 'Already here',
    statusConflict: 'Differs',
    files: (n: number) => `${n} file${s(n)}`,
    baseDetail: (files: string, when: string) => `${files} · updated ${when}`,
    sameAs: (name: string) => `Same files as “${name}” here (skipped)`,
    sameAsCopy: 'Same files as the copy here (skipped)',
    yoursNewer: (when: string) => `Yours was changed ${when}, after this backup. Replacing loses those changes.`,
    replacesHere: (base: string) => `${base} · replaces the version here`,
    keptHere: (base: string, newer: boolean) => `${base} · the version here is kept${newer ? ' (it’s newer)' : ''}`,
    fileUnreadable: 'The file could not be read.',
    notEnoughStorage: (needs: string, free: string) =>
      `There isn’t enough browser storage for this restore (it needs about ${needs}, ` +
      `${free} is free). Nothing was changed. Deselect some projects, or delete projects you no longer need, and try again.`,
    changedMeanwhile: 'Your projects changed in another tab meanwhile. Review the list again, then restore.',
    restoreTitle: 'Restore from backup',
    backupSummary: (n: number, exported: string | null) =>
      ` · ${n} project${s(n)}${exported ? ` · exported ${exported}` : ''}`,
    readingBackup: 'Reading the backup…',
    cantRestore: 'This backup can’t be restored',
    close: 'Close',
    summary: 'Summary',
    countNew: (n: number) => `${n} new`,
    countDuplicate: (n: number) => `${n} already here`,
    countConflict: (n: number) => `${n} differ${n === 1 ? 's' : ''} from yours`,
    conflictLegend: 'For projects that differ from the ones in this browser',
    addAsCopies: 'Add as copies',
    addAsCopiesHint: 'Keep yours; the backup’s version is added next to it.',
    replaceExisting: 'Replace existing',
    replaceExistingHint: (n: number) =>
      `Overwrite ${n === 1 ? 'the project' : `the ${n} projects`} here with the backup’s version.`,
    inTheBackup: 'Projects in the backup',
    selected: (n: number) => `${n} selected`,
    replacesYours: 'Replaces yours',
    addedAsCopy: 'Added as a copy',
    cantBeRestored: (reason: string) => `Can’t be restored: ${reason}`,
    mayNotFit: (needs: string, free: string) =>
      `This needs about ${needs}, and only ${free} of browser storage is free. It may not fit: deselect some projects, or delete projects you no longer need.`,
    adds: (n: number) => `Adds ${n}`,
    replaces: (n: number, first: boolean) => `${first ? 'Replaces' : 'replaces'} ${n}`,
    about: (size: string) => ` · about ${size}`,
    cancel: 'Cancel',
    restoreAndReplace: (n: number) => `Restore and replace ${n}`,
    restoreProjects: (n: number) => `Restore ${n} project${s(n)}`,

    // folder sync: the indicator and its dialogs
    sideAdded: 'added',
    sideChanged: 'changed',
    sideDeleted: 'deleted',
    sideSame: 'unchanged',
    conflictSides: (here: string, there: string) => `${here} here · ${there} in the folder`,
    filesGone: (label: string) => `The Terraform files are gone from “${label}”`,
    bothChanged: (label: string) => `“${label}” and the editor both changed`,
    filesGoneBody:
      'The folder may have been moved or emptied. Nothing was changed here. Write the project back to the folder, or take its (empty) state into the project.',
    bothChangedBody:
      'These files changed in the folder and in Cloud Blueprint since the last sync. Nothing is written until you choose which version to keep.',
    later: 'Later',
    laterHint: 'Syncing waits until you choose',
    emptyProject: 'Empty the project',
    useFolderVersion: 'Use folder version',
    writeToFolder: 'Write project to folder',
    keepEditorVersion: 'Keep editor version',
    writeSummary: (overwrites: string[], deletes: string[]) => {
      const parts = [
        overwrites.length > 0 ? `overwrites ${overwrites.join(', ')}` : '',
        deletes.length > 0 ? `deletes ${deletes.join(', ')}` : '',
      ].filter(Boolean);
      const text = `${parts.join(' and ')} in the folder.`;
      return text[0]!.toUpperCase() + text.slice(1);
    },
    alreadyHasTerraform: (label: string) => `“${label}” already has Terraform files`,
    differBody: 'They differ from this project. Choose which side the folder sync starts from.',
    listDifferent: 'Different',
    listFolderOnly: 'Only in the folder',
    listProjectOnly: 'Only in this project',
    listIdentical: 'Identical',
    loadFolder: 'Load the folder into the project',
    loadFolderHint: 'The project’s files are replaced by the folder’s. Nothing on disk changes.',
    writeProject: 'Write this project to the folder',
    needsChromium: 'Folder sync needs Chrome or Edge',
    needsChromiumBody:
      'Keeping a project in sync with a folder on your disk uses the File System Access API, which this browser doesn’t offer. You can still download the project as Terraform files, and import a folder by dropping it on the dashboard.',
    downloadZipInstead: 'Download .zip instead',
    zipDownloaded: 'Terraform zip downloaded',
    syncedToFolder: (label: string) => `Synced to folder ${label}`,
    savesGoTo: (label: string, when: string | null) =>
      `Saves go to the .tf files in “${label}”${when ? ` · last synced ${when}` : ''}`,
    syncedTo: (label: string) => `Synced to ${label}`,
    allowAgain: (label: string) => `Allow Cloud Blueprint to edit “${label}” again to keep it in sync`,
    reconnectFolder: (label: string) => `Reconnect folder ${label}`,
    reconnect: (label: string) => `Reconnect ${label}`,
    conflictLabel: (label: string) => `Folder ${label}: changed on both sides. Choose a version`,
    conflictTitle: 'The folder and the editor both changed. Choose which to keep',
    syncConflict: 'Sync conflict',
    pausedLabel: (error: string) => `Folder sync paused: ${error}`,
    error: 'error',
    syncPaused: 'Sync paused',
    folderSync: 'Folder sync',
    syncNow: 'Sync now',
    tryAgain: 'Try again',
    linkAnother: 'Link another folder…',
    stopSyncing: 'Stop syncing',

    // folder sync: what happens while it runs
    theFolder: 'the folder',
    deleteOneFromFolder: (name: string, label: string) => `Delete “${name}” from “${label}”?`,
    deleteManyFromFolder: (n: number, label: string) => `Delete ${n} files from “${label}”?`,
    deleteFromFolderBody: (names: string[]) =>
      `${names.length === 1 ? 'It was' : `${names.join(', ')} were`} removed from the project, but Cloud Blueprint ` +
      'didn’t create it on disk. Cancel keeps the file in the folder (it just stops syncing).',
    deleteFromFolder: 'Delete from folder',
    needsPermission: (label: string) => `Cloud Blueprint needs permission to edit “${label}” to keep it in sync`,
    stoppedSyncing: (label: string) => `Stopped syncing with “${label}”. Its files stay as they are`,
    linkNotRemembered: 'The folder link can’t be remembered in this browser. It lasts until you reload',
    syncedToast: (label: string) => `Synced to “${label}”`,
    cantOpenFolder: 'That folder can’t be opened here',
    linkedElsewhere: (folder: string, owner: string) => `“${folder}” is linked to “${owner}”`,
    linkInstead: (owner: string) =>
      `Link it to this project instead? “${owner}” stops syncing with the folder (nothing is deleted).`,
    linkHere: 'Link to this project',
    cantRead: (folder: string) => `“${folder}” can’t be read`,

    // Open folder… on the dashboard
    alreadyLinked: 'This folder is already linked. Opening its project',
    noTfIn: (folder: string) => `No .tf files found in “${folder}”`,
    labelAlreadyLinked: (label: string) => `“${label}” is already linked. Opening its project`,
    syncedWith: (label: string) => `Synced with the folder “${label}” on this computer.`,
    linkNotSaved: 'Imported, but the folder link couldn’t be saved in this browser',
    openedFolder: (label: string) => `Opened “${label}”: saves go straight to its .tf files`,
    openFolderTitle: 'Open a Terraform folder on your disk and keep it in sync',
  },
  {
    nothingToBackUp: 'Ainda não há projetos para fazer backup',
    backupDownloaded: (n: number) => `Backup baixado: ${n} projeto${s(n)}`,
    backupFailed: 'Não foi possível criar o backup',
    restoreInput: 'Arquivo de backup para restaurar',

    yourData: 'Seus dados',
    browserStorage: 'Armazenamento do navegador',
    percentUsed: (percent: number) => `${percent}% usado`,
    storageUsedLabel: 'Armazenamento do navegador em uso',
    meterValue: (percent: number, used: string, total: string) => `${percent}% (${used} de ${total})`,
    projectsUsageBefore: 'Projetos: ',
    projectsUsageAfter: (total: string) => ` de ~${total} que este navegador permite`,
    originUsed: (used: string) => `App offline e vínculos com pastas: ${used} · `,
    originFree: (free: string) => `${free} livres neste dispositivo`,
    backUpAndFree: 'Fazer backup e liberar espaço',
    protectedTitle: 'Armazenamento protegido.',
    protectedBody: ' O navegador não vai apagar seus projetos para liberar espaço em disco.',
    persistGranted: 'Armazenamento protegido: o navegador não vai apagar seus projetos',
    persistDeclined: 'O navegador recusou por enquanto',
    keepMyData: 'Proteger meus dados',
    persistDeclinedHint:
      'Recusado por enquanto. Os navegadores costumam permitir isso para apps instalados e sites que você usa com frequência.',
    persistHint: 'Pede ao navegador que nunca apague seus projetos quando o dispositivo estiver com pouco espaço.',

    backup: 'Backup',
    lastBackup: (when: string) => `Último backup: ${when}`,
    noBackupYet: 'Nenhum backup ainda',
    backupBody:
      'Baixe todos os projetos em um único .zip, com uma pasta de arquivos Terraform por projeto. Restaure aqui ou em qualquer outro navegador; nada é sobrescrito sem perguntar.',
    backUpAll: 'Fazer backup de todos os projetos',
    restoreFromBackup: 'Restaurar backup…',
    offlineReady: 'Funciona offline: este navegador guarda uma cópia do app, então ele abre sem conexão.',
    offlineLater:
      'Funciona offline depois da primeira visita. Instale pelo menu do navegador para abrir como um app.',
    openFolder: 'Abrir pasta…',
    openFolderAfter:
      ' vincula um projeto a arquivos Terraform no seu disco: as alterações salvas vão direto para os arquivos .tf.',
    folderUnsupported:
      'A sincronização com pasta precisa do Chrome ou do Edge. Aqui, solte uma pasta nesta página para importá-la e use um backup ou a exportação .zip do Terraform para levar os arquivos para fora.',
    restored: (count: number, replaced: number) =>
      `${count} projeto${s(count)} restaurado${s(count)}${replaced > 0 ? ` (${replaced} substituído${s(replaced)})` : ''}`,
    deletedToBackup: (n: number) =>
      n === 1 ? '1 projeto excluído. Ele está no seu backup' : `${n} projetos excluídos. Eles estão no seu backup`,

    nudgeTitle: (percent: number) => `O armazenamento do navegador está ${percent}% cheio.`,
    nudgeFull:
      'Novas alterações podem deixar de ser salvas. Faça backup dos seus projetos e exclua os que você não usa mais.',
    nudgeNear: 'Faça backup dos seus projetos e exclua os que você não usa mais para continuar salvando sem problemas.',
    dismissNudge: 'Dispensar aviso de armazenamento',

    freeUpTitle: 'Liberar armazenamento do navegador',
    backupDone: 'Backup baixado.',
    backupHoldsAfter: ' guarda todos os projetos. Restaure qualquer um deles depois, no painel inicial.',
    selectToDelete: 'Selecione os projetos a excluir deste navegador (os maiores primeiro)',
    updated: (when: string) => `Atualizado ${when}`,
    frees: (size: string) => `Libera cerca de ${size}`,
    nothingSelected: 'Nada selecionado',
    done: 'Concluir',
    deleteProjects: (n: number) => (n === 0 ? 'Excluir projetos' : `Excluir ${n} projeto${s(n)}`),

    nowOffline: 'O Cloud Blueprint agora também funciona offline',
    updateAvailable: 'Atualização disponível',
    updateHint: ': recarregue para usar a nova versão.',
    reloading: 'Recarregando…',
    reload: 'Recarregar',
    dismiss: 'Dispensar',

    statusNew: 'Novo',
    statusDuplicate: 'Já está aqui',
    statusConflict: 'Diferente',
    files: (n: number) => `${n} arquivo${s(n)}`,
    baseDetail: (files: string, when: string) => `${files} · atualizado ${when}`,
    sameAs: (name: string) => `Mesmos arquivos de “${name}”, que já está aqui (ignorado)`,
    sameAsCopy: 'Mesmos arquivos da cópia que já está aqui (ignorado)',
    yoursNewer: (when: string) =>
      `O seu foi alterado ${when}, depois deste backup. Substituir perde essas alterações.`,
    replacesHere: (base: string) => `${base} · substitui a versão daqui`,
    keptHere: (base: string, newer: boolean) => `${base} · a versão daqui é mantida${newer ? ' (ela é mais nova)' : ''}`,
    fileUnreadable: 'Não foi possível ler o arquivo.',
    notEnoughStorage: (needs: string, free: string) =>
      `Não há espaço suficiente no armazenamento do navegador para esta restauração (ela precisa de cerca de ${needs} ` +
      `e há ${free} livres). Nada foi alterado. Desmarque alguns projetos ou exclua os que você não usa mais e tente de novo.`,
    changedMeanwhile: 'Seus projetos mudaram em outra aba enquanto isso. Revise a lista de novo e depois restaure.',
    restoreTitle: 'Restaurar backup',
    backupSummary: (n: number, exported: string | null) =>
      ` · ${n} projeto${s(n)}${exported ? ` · exportado em ${exported}` : ''}`,
    readingBackup: 'Lendo o backup…',
    cantRestore: 'Não é possível restaurar este backup',
    close: 'Fechar',
    summary: 'Resumo',
    countNew: (n: number) => `${n} novo${s(n)}`,
    countDuplicate: (n: number) => (n === 1 ? '1 já está aqui' : `${n} já estão aqui`),
    countConflict: (n: number) => (n === 1 ? '1 difere do seu' : `${n} diferem dos seus`),
    conflictLegend: 'Para projetos diferentes dos que estão neste navegador',
    addAsCopies: 'Adicionar como cópias',
    addAsCopiesHint: 'Mantém o seu; a versão do backup é adicionada ao lado.',
    replaceExisting: 'Substituir os existentes',
    replaceExistingHint: (n: number) =>
      `Sobrescreve ${n === 1 ? 'o projeto daqui' : `os ${n} projetos daqui`} com a versão do backup.`,
    inTheBackup: 'Projetos no backup',
    selected: (n: number) => `${n} selecionado${s(n)}`,
    replacesYours: 'Substitui o seu',
    addedAsCopy: 'Adicionado como cópia',
    cantBeRestored: (reason: string) => `Não pode ser restaurado: ${reason}`,
    mayNotFit: (needs: string, free: string) =>
      `Isto precisa de cerca de ${needs}, e só há ${free} livres no armazenamento do navegador. Pode não caber: desmarque alguns projetos ou exclua os que você não usa mais.`,
    adds: (n: number) => `Adiciona ${n}`,
    replaces: (n: number, first: boolean) => `${first ? 'Substitui' : 'substitui'} ${n}`,
    about: (size: string) => ` · cerca de ${size}`,
    cancel: 'Cancelar',
    restoreAndReplace: (n: number) => `Restaurar e substituir ${n}`,
    restoreProjects: (n: number) => `Restaurar ${n} projeto${s(n)}`,

    sideAdded: 'adicionado',
    sideChanged: 'alterado',
    sideDeleted: 'excluído',
    sideSame: 'inalterado',
    conflictSides: (here: string, there: string) => `${here} aqui · ${there} na pasta`,
    filesGone: (label: string) => `Os arquivos Terraform sumiram de “${label}”`,
    bothChanged: (label: string) => `“${label}” e o editor mudaram ao mesmo tempo`,
    filesGoneBody:
      'A pasta pode ter sido movida ou esvaziada. Nada foi alterado aqui. Grave o projeto de volta na pasta ou traga o estado dela (vazio) para o projeto.',
    bothChangedBody:
      'Estes arquivos mudaram na pasta e no Cloud Blueprint desde a última sincronização. Nada é salvo até você escolher qual versão manter.',
    later: 'Depois',
    laterHint: 'A sincronização espera até você escolher',
    emptyProject: 'Esvaziar o projeto',
    useFolderVersion: 'Usar a versão da pasta',
    writeToFolder: 'Gravar o projeto na pasta',
    keepEditorVersion: 'Manter a versão do editor',
    writeSummary: (overwrites: string[], deletes: string[]) => {
      const parts = [
        overwrites.length > 0 ? `sobrescreve ${overwrites.join(', ')}` : '',
        deletes.length > 0 ? `exclui ${deletes.join(', ')}` : '',
      ].filter(Boolean);
      const text = `${parts.join(' e ')} na pasta.`;
      return text[0]!.toUpperCase() + text.slice(1);
    },
    alreadyHasTerraform: (label: string) => `“${label}” já tem arquivos Terraform`,
    differBody: 'Eles são diferentes dos deste projeto. Escolha de qual lado a sincronização com a pasta começa.',
    listDifferent: 'Diferentes',
    listFolderOnly: 'Só na pasta',
    listProjectOnly: 'Só neste projeto',
    listIdentical: 'Idênticos',
    loadFolder: 'Carregar a pasta no projeto',
    loadFolderHint: 'Os arquivos do projeto são substituídos pelos da pasta. Nada muda no disco.',
    writeProject: 'Gravar este projeto na pasta',
    needsChromium: 'A sincronização com pasta precisa do Chrome ou do Edge',
    needsChromiumBody:
      'Manter um projeto sincronizado com uma pasta do seu disco usa a File System Access API, que este navegador não oferece. Você ainda pode baixar o projeto como arquivos Terraform e importar uma pasta soltando-a no painel inicial.',
    downloadZipInstead: 'Baixar o .zip',
    zipDownloaded: '.zip do Terraform baixado',
    syncedToFolder: (label: string) => `Sincronizado com a pasta ${label}`,
    savesGoTo: (label: string, when: string | null) =>
      `As alterações salvas vão para os arquivos .tf em “${label}”${when ? ` · última sincronização: ${when}` : ''}`,
    syncedTo: (label: string) => `Sincronizado com ${label}`,
    allowAgain: (label: string) => `Permita que o Cloud Blueprint edite “${label}” de novo para manter a sincronização`,
    reconnectFolder: (label: string) => `Reconectar a pasta ${label}`,
    reconnect: (label: string) => `Reconectar ${label}`,
    conflictLabel: (label: string) => `Pasta ${label}: mudou dos dois lados. Escolha uma versão`,
    conflictTitle: 'A pasta e o editor mudaram. Escolha qual versão manter',
    syncConflict: 'Conflito na pasta',
    pausedLabel: (error: string) => `Sincronização com a pasta pausada: ${error}`,
    error: 'erro',
    syncPaused: 'Sincronização pausada',
    folderSync: 'Sincronização com pasta',
    syncNow: 'Sincronizar agora',
    tryAgain: 'Tentar de novo',
    linkAnother: 'Vincular outra pasta…',
    stopSyncing: 'Parar de sincronizar',

    theFolder: 'a pasta',
    deleteOneFromFolder: (name: string, label: string) => `Excluir “${name}” de “${label}”?`,
    deleteManyFromFolder: (n: number, label: string) => `Excluir ${n} arquivos de “${label}”?`,
    deleteFromFolderBody: (names: string[]) =>
      names.length === 1
        ? 'Ele foi removido do projeto, mas não foi o Cloud Blueprint que o criou no disco. Cancelar mantém o arquivo na pasta (ele só deixa de sincronizar).'
        : `${names.join(', ')} foram removidos do projeto, mas não foi o Cloud Blueprint que os criou no disco. Cancelar mantém os arquivos na pasta (eles só deixam de sincronizar).`,
    deleteFromFolder: 'Excluir da pasta',
    needsPermission: (label: string) =>
      `O Cloud Blueprint precisa de permissão para editar “${label}” e manter a sincronização`,
    stoppedSyncing: (label: string) => `A sincronização com “${label}” foi encerrada. Os arquivos continuam como estão`,
    linkNotRemembered: 'Este navegador não consegue guardar o vínculo com a pasta. Ele dura até você recarregar',
    syncedToast: (label: string) => `Sincronizado com “${label}”`,
    cantOpenFolder: 'Essa pasta não pode ser aberta aqui',
    linkedElsewhere: (folder: string, owner: string) => `“${folder}” está vinculada a “${owner}”`,
    linkInstead: (owner: string) =>
      `Vincular a este projeto em vez disso? “${owner}” deixa de sincronizar com a pasta (nada é excluído).`,
    linkHere: 'Vincular a este projeto',
    cantRead: (folder: string) => `Não foi possível ler “${folder}”`,

    alreadyLinked: 'Esta pasta já está vinculada. Abrindo o projeto dela',
    noTfIn: (folder: string) => `Nenhum arquivo .tf encontrado em “${folder}”`,
    labelAlreadyLinked: (label: string) => `“${label}” já está vinculada. Abrindo o projeto dela`,
    syncedWith: (label: string) => `Sincronizado com a pasta “${label}” deste computador.`,
    linkNotSaved: 'Importado, mas não foi possível salvar o vínculo com a pasta neste navegador',
    openedFolder: (label: string) => `“${label}” aberta: as alterações salvas vão direto para os arquivos .tf dela`,
    openFolderTitle: 'Abrir uma pasta Terraform do seu disco e mantê-la em sincronia',
  },
);
