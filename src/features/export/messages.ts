/** The "Export PDF document" dialog and its toasts (the document's own words: archDoc.messages.ts). */
import { defineMessages } from '@/i18n/messages';

export const exportMessages = defineMessages(
  {
    nothingToExport: 'Nothing to export yet — add a resource first',
    sections: {
      inventory: { title: 'Resource inventory', hint: 'Every resource with its key settings, plus variables and outputs' },
      connections: { title: 'Connections & traffic', hint: 'Dependencies and the network flows the rules allow' },
      security: { title: 'Security review', hint: '' },
      cost: { title: 'Cost estimate', hint: 'Monthly on-demand estimate per resource, with its assumptions' },
      code: { title: 'Terraform source', hint: 'Every .tf file as an appendix — check it for secrets before sharing' },
    },
    securityHint: (grade: string | null, findings: number) =>
      grade
        ? `Grade ${grade} · ${findings === 0 ? 'no findings' : `${findings} finding${findings === 1 ? '' : 's'}`}`
        : 'Exposure, firewall rules and misconfigurations',
    reading: 'Reading the diagram…',
    writing: 'Writing PDF…',
    canvasClosed: 'the canvas is not open',
    canvasEmpty: 'the canvas is empty',
    downloaded: 'PDF downloaded — ready to share',
    downloadedNoDiagram: (reason: string) => `PDF downloaded, but the diagram could not be rendered (${reason})`,
    failed: (message: string) => `Couldn't create the PDF: ${message}`,
    cancelled: 'PDF export cancelled',
    title: 'Export PDF document',
    intro:
      'A document you can send to anyone: the diagram, then a plain-language summary of what it contains. It is built in your browser — nothing is uploaded.',
    docTitle: 'Title',
    notes: 'Notes for the reader',
    notesHint: 'Optional — the goal of this design, open questions, who to talk to.',
    notesPlaceholder: 'Proposed architecture for…',
    unsupported: (chars: string, more: boolean) =>
      `The PDF's fonts can't show ${chars}${more ? ' …' : ''} — they will print as “?”. Western European text (accents included) is fine.`,
    include: 'Include',
    alwaysIncluded: 'The diagram and an overview are always included.',
    paper: 'Paper size',
    letter: 'Letter',
    cancel: 'Cancel',
    download: 'Download PDF',
    /** the file name's last part: "payments-architecture.pdf" */
    fileSuffix: 'architecture',
  },
  {
    nothingToExport: 'Nada para exportar ainda — adicione um recurso primeiro',
    sections: {
      inventory: { title: 'Inventário de recursos', hint: 'Cada recurso com as configurações principais, mais variáveis e outputs' },
      connections: { title: 'Conexões e tráfego', hint: 'Dependências e os fluxos de rede que as regras permitem' },
      security: { title: 'Revisão de segurança', hint: '' },
      cost: { title: 'Estimativa de custo', hint: 'Estimativa mensal sob demanda por recurso, com as premissas' },
      code: { title: 'Código Terraform', hint: 'Todos os arquivos .tf como anexo — confira se há segredos antes de compartilhar' },
    },
    securityHint: (grade: string | null, findings: number) =>
      grade
        ? `Nota ${grade} · ${findings === 0 ? 'nenhum achado' : `${findings} ${findings === 1 ? 'achado' : 'achados'}`}`
        : 'Exposição, regras de firewall e erros de configuração',
    reading: 'Lendo o diagrama…',
    writing: 'Gerando o PDF…',
    canvasClosed: 'o canvas não está aberto',
    canvasEmpty: 'o canvas está vazio',
    downloaded: 'PDF baixado — pronto para compartilhar',
    downloadedNoDiagram: (reason: string) => `PDF baixado, mas não foi possível desenhar o diagrama (${reason})`,
    failed: (message: string) => `Não foi possível criar o PDF: ${message}`,
    cancelled: 'Exportação do PDF cancelada',
    title: 'Exportar documento PDF',
    intro:
      'Um documento que você pode enviar para qualquer pessoa: o diagrama e um resumo em linguagem simples do que ele contém. Ele é gerado no seu navegador — nada é enviado.',
    docTitle: 'Título',
    notes: 'Notas para o leitor',
    notesHint: 'Opcional — o objetivo desta arquitetura, dúvidas em aberto, com quem falar.',
    notesPlaceholder: 'Arquitetura proposta para…',
    unsupported: (chars: string, more: boolean) =>
      `As fontes do PDF não conseguem mostrar ${chars}${more ? ' …' : ''} — eles sairão como “?”. Textos em idiomas da Europa Ocidental (com acentos) funcionam.`,
    include: 'Incluir',
    alwaysIncluded: 'O diagrama e uma visão geral sempre são incluídos.',
    paper: 'Tamanho do papel',
    letter: 'Carta',
    cancel: 'Cancelar',
    download: 'Baixar PDF',
    fileSuffix: 'arquitetura',
  },
);
