/**
 * Parse errors (./parser.ts) and refused canvas edits (./patch.ts) as people
 * read them — in the code pane's markers and in toasts. Produced in the UI
 * language in effect when the code is parsed.
 */
import { defineMessages } from '@/i18n/messages';

/** why the text no longer matches the last parse (./patch.ts `staleness`) */
export type StaleReason = 'gone' | 'moved' | 'between' | 'changed' | 'after';

export const hclMessages = defineMessages(
  {
    unterminatedComment: 'Unterminated comment',
    unterminatedString: 'Unterminated string',
    missingHeredocTerminator: (tag: string) => `Missing heredoc terminator "${tag}"`,
    expectedClose: (close: string, open: string) => `Expected "${close}" to close "${open}"`,
    expectedListClose: 'Expected "]" to close this list',
    expectedObjectClose: 'Expected "}" to close this object',
    commaAfter: (key: string) => `Unexpected "," after "${key}": arguments in a block go on separate lines`,
    newlineAfter: (key: string) => `Missing newline after "${key}": each argument or block goes on its own line`,
    duplicateArgument: (key: string) => `Duplicate argument "${key}": each argument may be set only once`,
    argumentAndBlock: (key: string) => `"${key}" is set both as an argument and as a block`,
    expectedAttributeOrBlock: 'Expected attribute name or block',
    expectedValue: (key: string) => `Expected a value after "${key} ="`,
    unexpectedString: (key: string) => `Unexpected string after "${key}"`,
    expectedEqualsOrBrace: (key: string) => `Expected "=" or "{" after "${key}"`,
    unexpectedCharacter: (c: string) => `Unexpected character "${c}"`,
    expectedHeaderBrace: (keyword: string) => `Expected "{" after "${keyword}" block header`,
    /** `usage`: `resource "type" "name"` */
    expectedUsage: (usage: string) => `Expected ${usage} { … }`,
    missingBlockClose: (keyword: string) => `Missing "}" to close this "${keyword}" block`,
    duplicateResource: (id: string, file: string, line: number) =>
      `Duplicate resource "${id}" (already declared at ${file}:${line}): Terraform requires unique addresses — rename one of them`,
    duplicateModule: (name: string, file: string, line: number) =>
      `Duplicate module "${name}" (already declared at ${file}:${line}): Terraform requires unique module names — rename one of them`,

    stale: (file: string, reason: StaleReason) =>
      `Canvas edit not applied: ${file} changed since it was last parsed (${
        {
          gone: 'the file is gone',
          moved: 'a block moved',
          between: 'text between blocks changed',
          changed: 'a block changed',
          after: 'text after the last block changed',
        }[reason]
      }). Fix the code errors first.`,
    wrongBlocks: 'Canvas edit not applied: the patched code would not declare the expected blocks.',
    wouldBreak: (file: string, error: string) => `Canvas edit not applied: it would break ${file} (${error}).`,
    conflicting: 'Canvas edit not applied: conflicting edits.',
  },
  {
    unterminatedComment: 'Comentário sem fechamento',
    unterminatedString: 'String sem fechamento',
    missingHeredocTerminator: (tag) => `Falta o terminador do heredoc "${tag}"`,
    expectedClose: (close, open) => `Esperado "${close}" para fechar "${open}"`,
    expectedListClose: 'Esperado "]" para fechar esta lista',
    expectedObjectClose: 'Esperado "}" para fechar este objeto',
    commaAfter: (key) => `"," inesperada depois de "${key}": os argumentos de um bloco ficam em linhas separadas`,
    newlineAfter: (key) => `Falta uma quebra de linha depois de "${key}": cada argumento ou bloco fica na própria linha`,
    duplicateArgument: (key) => `Argumento duplicado "${key}": cada argumento só pode ser definido uma vez`,
    argumentAndBlock: (key) => `"${key}" está definido como argumento e também como bloco`,
    expectedAttributeOrBlock: 'Esperado um nome de atributo ou um bloco',
    expectedValue: (key) => `Esperado um valor depois de "${key} ="`,
    unexpectedString: (key) => `String inesperada depois de "${key}"`,
    expectedEqualsOrBrace: (key) => `Esperado "=" ou "{" depois de "${key}"`,
    unexpectedCharacter: (c) => `Caractere inesperado "${c}"`,
    expectedHeaderBrace: (keyword) => `Esperado "{" depois do cabeçalho do bloco "${keyword}"`,
    expectedUsage: (usage) => `Esperado ${usage} { … }`,
    missingBlockClose: (keyword) => `Falta "}" para fechar este bloco "${keyword}"`,
    duplicateResource: (id, file, line) =>
      `Recurso duplicado "${id}" (já declarado em ${file}:${line}): o Terraform exige endereços únicos — renomeie um deles`,
    duplicateModule: (name, file, line) =>
      `Módulo duplicado "${name}" (já declarado em ${file}:${line}): o Terraform exige nomes de módulo únicos — renomeie um deles`,

    stale: (file, reason) =>
      `Edição do canvas não aplicada: ${file} mudou desde a última análise (${
        {
          gone: 'o arquivo sumiu',
          moved: 'um bloco mudou de lugar',
          between: 'o texto entre os blocos mudou',
          changed: 'um bloco mudou',
          after: 'o texto depois do último bloco mudou',
        }[reason]
      }). Corrija primeiro os erros do código.`,
    wrongBlocks: 'Edição do canvas não aplicada: o código alterado não declararia os blocos esperados.',
    wouldBreak: (file, error) => `Edição do canvas não aplicada: ela quebraria ${file} (${error}).`,
    conflicting: 'Edição do canvas não aplicada: edições conflitantes.',
  },
);
