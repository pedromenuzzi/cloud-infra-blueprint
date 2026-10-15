/**
 * Monaco's own words, in the widgets this app loads (monaco/contribs.ts): the
 * find widget, suggestions, hovers, the context menu and the problems peek.
 * Monaco 0.52 ships no Portuguese; each English value here is Monaco's text
 * exactly as it calls `localize` with it (vite.config.ts makes that look the
 * text up in the table ./nls.ts builds from these), placeholders and all.
 * nls.test.ts checks every one still exists in Monaco.
 */
import { defineMessages } from '@/i18n/messages';

export const monacoMessages = defineMessages(
  {
    // find widget
    findReplace: 'Find / Replace',
    find: 'Find',
    replace: 'Replace',
    previousMatch: 'Previous Match',
    nextMatch: 'Next Match',
    findInSelection: 'Find in Selection',
    close: 'Close',
    replaceAll: 'Replace All',
    toggleReplace: 'Toggle Replace',
    matchCase: 'Match Case',
    wholeWord: 'Match Whole Word',
    regex: 'Use Regular Expression',
    preserveCase: 'Preserve Case',
    matchesLocation: '{0} of {1}',
    noResults: 'No results',
    matchesLimit: 'Only the first {0} results are highlighted, but all find operations work on the entire text.',
    ariaFound: '{0} found',
    ariaFoundFor: "{0} found for '{1}'",
    ariaFoundAt: "{0} found for '{1}', at {2}",
    // suggestions
    suggest: 'Suggest',
    loading: 'Loading...',
    noSuggestions: 'No suggestions.',
    readDocs: '{0}, docs: {1}',
    insert: 'Insert',
    showMore: 'Show More',
    showLess: 'Show Less',
    readMore: 'Read More',
    // hovers
    viewProblem: 'View Problem',
    noQuickFixes: 'No quick fixes available',
    checkingQuickFixes: 'Checking for quick fixes...',
    quickFix: 'Quick Fix...',
    // context menu
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    changeAll: 'Change All Occurrences',
    formatDocument: 'Format Document',
    formatSelection: 'Format Selection',
    // the problems peek (F8, "View Problem")
    problems: '{0} of {1} problems',
    problem: '{0} of {1} problem',
    nextProblem: 'Go to Next Problem (Error, Warning, Info)',
    previousProblem: 'Go to Previous Problem (Error, Warning, Info)',
    error: 'Error',
    warning: 'Warning',
    info: 'Info',
    hint: 'Hint',
    markerAt: '{0} at {1}. ',
    // the editor itself, for screen readers
    editorContent: 'Editor content',
  },
  {
    findReplace: 'Buscar e substituir',
    find: 'Buscar',
    replace: 'Substituir',
    previousMatch: 'Resultado anterior',
    nextMatch: 'Próximo resultado',
    findInSelection: 'Buscar na seleção',
    close: 'Fechar',
    replaceAll: 'Substituir tudo',
    toggleReplace: 'Mostrar ou ocultar a substituição',
    matchCase: 'Diferenciar maiúsculas e minúsculas',
    wholeWord: 'Só palavras inteiras',
    regex: 'Usar expressão regular',
    preserveCase: 'Preservar maiúsculas e minúsculas',
    matchesLocation: '{0} de {1}',
    noResults: 'Nenhum resultado',
    matchesLimit: 'Só os primeiros {0} resultados estão destacados, mas a busca vale para o texto inteiro.',
    ariaFound: '{0}',
    ariaFoundFor: "'{1}': {0}",
    ariaFoundAt: "'{1}': {0}, em {2}",
    suggest: 'Sugestões',
    loading: 'Carregando…',
    noSuggestions: 'Nenhuma sugestão.',
    readDocs: '{0}, documentação: {1}',
    insert: 'Inserir',
    showMore: 'Mostrar mais',
    showLess: 'Mostrar menos',
    readMore: 'Ler mais',
    viewProblem: 'Ver problema',
    noQuickFixes: 'Nenhuma correção rápida disponível',
    checkingQuickFixes: 'Buscando correções rápidas…',
    quickFix: 'Correção rápida…',
    cut: 'Recortar',
    copy: 'Copiar',
    paste: 'Colar',
    changeAll: 'Alterar todas as ocorrências',
    formatDocument: 'Formatar documento',
    formatSelection: 'Formatar seleção',
    problems: '{0} de {1} problemas',
    problem: '{0} de {1} problema',
    nextProblem: 'Ir para o próximo problema (erro, aviso, informação)',
    previousProblem: 'Ir para o problema anterior (erro, aviso, informação)',
    error: 'Erro',
    warning: 'Aviso',
    info: 'Informação',
    hint: 'Dica',
    markerAt: '{0} em {1}. ',
    editorContent: 'Conteúdo do editor',
  },
);

/** a language switch once Monaco is loaded: what it already worded waits for a reload */
export const monacoReloadMessages = defineMessages(
  {
    reloadToSwitch: 'The code editor’s own menus (find, suggestions) switch language after a reload',
    reload: 'Reload',
  },
  {
    reloadToSwitch: 'Os menus do próprio editor de código (busca, sugestões) mudam de idioma depois de recarregar',
    reload: 'Recarregar',
  },
);
