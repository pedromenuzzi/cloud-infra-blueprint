/** The editor's top bar: breadcrumb, save status, search, panels, share, export and the ⋯ menu. */
import { defineMessages } from '@/i18n/messages';

type SaveError = 'quota' | 'conflict' | 'deleted';
type Theme = 'light' | 'dark' | 'system';

export const topbarMessages = defineMessages(
  {
    backToDashboard: 'Back to dashboard',
    breadcrumb: 'Breadcrumb',
    projects: 'Projects',
    projectName: 'Project name',
    saved: 'Saved',
    saving: 'Saving',
    notSaved: 'Not saved',
    notSavedFull: 'Not saved: storage full',
    saveError: {
      quota: 'Browser storage is full. Export or delete projects; your edits are kept in this tab until then',
      conflict: 'This project changed in another tab. Choose which version to keep',
      deleted: 'This project was deleted in another tab. Restore it or keep it as a new project',
    } satisfies Record<SaveError, string>,
    search: 'Search or run a command',
    searchPlaceholder: 'Search or run a command…',
    searchShortcut: (mod: string) => `Search or run a command (${mod}K)`,
    /* security badge */
    security: 'Security',
    securityAudit: 'Security audit',
    securityLabel: (grade: string | null, urgent: number) =>
      `Security${grade ? ` grade ${grade}` : ''}${urgent ? `, ${urgent} urgent issues` : ''}`,
    /* panel toggles */
    panels: 'Panels',
    palette: (mod: string) => `Resource palette (${mod}B)`,
    code: (mod: string) => `Code editor (${mod}J)`,
    inspector: (mod: string) => `Inspector (${mod}I)`,
    /* actions */
    undo: 'Undo',
    redo: 'Redo',
    undoShortcut: (mod: string) => `Undo (${mod}Z)`,
    redoShortcut: (mod: string) => `Redo (${mod}⇧Z)`,
    share: 'Share',
    copyViewLink: 'Copy view link',
    copyViewLinkTitle: 'Copy a read-only view link',
    export: 'Export',
    moreActions: 'More actions',
    commandPalette: 'Command palette…',
    copyShareLink: 'Copy share link',
    copyViewLinkReadOnly: 'Copy view link (read-only)',
    inspectorEntry: 'Inspector',
    theme: {
      light: 'Light theme',
      dark: 'Dark theme',
      system: 'System theme',
    } satisfies Record<Theme, string>,
    /* export menu */
    pdf: 'PDF document to share…',
    zip: 'Terraform files (.zip)',
    folder: 'Sync with folder…',
    png: 'Diagram as PNG',
    svg: 'Diagram as SVG',
    /* toasts */
    zipDownloaded: 'Terraform zip downloaded',
    viewCopied: 'View link copied: anyone can look, nobody can edit',
    shareCopied: 'Share link copied: anyone can open this project',
    copyFailed: 'Could not copy the link',
  },
  {
    backToDashboard: 'Voltar aos projetos',
    breadcrumb: 'Trilha de navegação',
    projects: 'Projetos',
    projectName: 'Nome do projeto',
    saved: 'Salvo',
    saving: 'Salvando',
    notSaved: 'Não salvo',
    notSavedFull: 'Não salvo: armazenamento cheio',
    saveError: {
      quota:
        'O armazenamento do navegador está cheio. Exporte ou exclua projetos; suas alterações ficam nesta aba até lá',
      conflict: 'Este projeto foi alterado em outra aba. Escolha qual versão manter',
      deleted: 'Este projeto foi excluído em outra aba. Restaure-o ou guarde-o como um novo projeto',
    },
    search: 'Buscar ou executar um comando',
    searchPlaceholder: 'Buscar ou executar um comando…',
    searchShortcut: (mod: string) => `Buscar ou executar um comando (${mod}K)`,
    security: 'Segurança',
    securityAudit: 'Auditoria de segurança',
    securityLabel: (grade: string | null, urgent: number) =>
      `Segurança${grade ? `, nota ${grade}` : ''}${
        urgent ? `, ${urgent} ${urgent === 1 ? 'problema urgente' : 'problemas urgentes'}` : ''
      }`,
    panels: 'Painéis',
    palette: (mod: string) => `Paleta de recursos (${mod}B)`,
    code: (mod: string) => `Editor de código (${mod}J)`,
    inspector: (mod: string) => `Inspetor (${mod}I)`,
    undo: 'Desfazer',
    redo: 'Refazer',
    undoShortcut: (mod: string) => `Desfazer (${mod}Z)`,
    redoShortcut: (mod: string) => `Refazer (${mod}⇧Z)`,
    share: 'Compartilhar',
    copyViewLink: 'Copiar link de visualização',
    copyViewLinkTitle: 'Copiar um link de visualização (somente leitura)',
    export: 'Exportar',
    moreActions: 'Mais ações',
    commandPalette: 'Paleta de comandos…',
    copyShareLink: 'Copiar link de compartilhamento',
    copyViewLinkReadOnly: 'Copiar link de visualização',
    inspectorEntry: 'Inspetor',
    theme: {
      light: 'Tema claro',
      dark: 'Tema escuro',
      system: 'Tema do sistema',
    },
    pdf: 'Documento PDF para compartilhar…',
    zip: 'Arquivos Terraform (.zip)',
    folder: 'Sincronizar com pasta…',
    png: 'Diagrama em PNG',
    svg: 'Diagrama em SVG',
    zipDownloaded: '.zip do Terraform baixado',
    viewCopied: 'Link de visualização copiado: quem tiver o link pode ver, ninguém pode editar',
    shareCopied: 'Link de compartilhamento copiado: quem tiver o link pode abrir este projeto',
    copyFailed: 'Não foi possível copiar o link',
  },
);
