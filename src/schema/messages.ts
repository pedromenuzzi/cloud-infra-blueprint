/**
 * Our own text around the provider schemas: validation findings (with the
 * "did you mean"), the one-line entry details and hover labels. The schema's
 * descriptions and deprecation notes are upstream English and stay as they
 * are; only the words we add around them are translated.
 */
import { defineMessages } from '@/i18n/messages';

/** what a value should have been, for a type finding */
export type Wanted = { kind: 'bool' } | { kind: 'number' } | { kind: 'type'; name: string };
/** what was written instead */
export type Got = { kind: 'literal'; text: string } | { kind: 'list' } | { kind: 'object' } | { kind: 'value' };

export const schemaMessages = defineMessages(
  {
    /** ` in ingress.cidr_blocks` */
    where: (path: string) => ` in ${path}`,
    didYouMean: (name: string) => ` — did you mean "${name}"?`,
    /** a deprecation note from the provider, after the finding */
    note: (text: string) => ` — ${text}`,
    unknown: (what: 'argument' | 'block' | 'block type', name: string, where: string, hint: string) =>
      `unknown ${what} "${name}"${where}${hint}`,
    blockDeprecated: (name: string, where: string, note: string) => `block "${name}"${where} is deprecated${note}`,
    deprecated: (key: string, where: string, note: string) => `"${key}"${where} is deprecated${note}`,
    readOnly: (key: string, where: string) => `"${key}"${where} is read-only — the provider computes it`,
    notABlock: (key: string, where: string) => `"${key}"${where} is an argument — write ${key} = …, not a block`,
    notAnArgument: (key: string, where: string) => `"${key}"${where} is a block — write ${key} { … }, not ${key} = …`,
    /** `problem`: from `typeProblem` */
    typeProblem: (key: string, where: string, problem: string) => `"${key}"${where} ${problem}`,
    tooMany: (name: string, where: string, max: number, found: number) =>
      `block "${name}"${where} may appear at most ${max === 1 ? 'once' : `${max} times`}, found ${found}`,
    missingArgument: (name: string, where: string) => `required argument "${name}"${where} is missing`,
    missingBlock: (name: string, where: string) => `required block "${name}"${where} is missing`,
    unknownType: (type: string, provider: string, version: string, hint: string) =>
      `resource type "${type}" is not in the ${provider} provider ${version}${hint}`,
    typeDeprecated: (type: string, note: string) => `resource type "${type}" is deprecated${note}`,

    /* type findings: `expects a number, got "x"`, nested `expects list(number): an item should be a number, got "x"` */
    expects: 'expects',
    shouldBe: 'should be',
    wanted: (w: Wanted) => (w.kind === 'bool' ? 'a bool' : w.kind === 'number' ? 'a number' : w.name),
    got: (g: Got) => (g.kind === 'literal' ? g.text : g.kind === 'list' ? 'a list' : g.kind === 'object' ? 'an object' : 'this value'),
    mismatch: (lead: string, wanted: string, got: string) => `${lead} ${wanted}, got ${got}`,
    /** `inner` already starts with `shouldBe` */
    itemMismatch: (lead: string, type: string, inner: string) => `${lead} ${type}: an item ${inner}`,
    entryMismatch: (lead: string, type: string, key: string, inner: string) => `${lead} ${type}: "${key}" ${inner}`,

    /* entry details: `list(string) · required · sensitive` */
    required: 'required',
    optional: 'optional',
    readOnlyDetail: 'read-only',
    computed: 'computed',
    sensitive: 'sensitive',
    writeOnly: 'write-only',
    deprecatedDetail: 'deprecated',
    /** nesting mode names (list, set, map) are Terraform's */
    block: 'block',
    blockMap: 'block map',
    blockNesting: (nesting: string, max: number) => `block ${nesting}${max > 1 ? ` (max ${max})` : ''}`,
    /** hovers and completion docs */
    deprecatedHeading: (note?: string) => `**Deprecated**${note ? ` — ${note}` : ''}`,
    providerVersion: (provider: string, version: string) => `${provider} provider ${version}`,
    argumentCount: (n: number) => `${n} arguments and blocks — type inside the block to see them`,
  },
  {
    where: (path) => ` em ${path}`,
    didYouMean: (name) => ` — você quis dizer "${name}"?`,
    note: (text) => ` — ${text}`,
    unknown: (what, name, where, hint) =>
      `${what === 'argument' ? 'argumento' : what === 'block' ? 'bloco' : 'tipo de bloco'} desconhecido "${name}"${where}${hint}`,
    blockDeprecated: (name, where, note) => `o bloco "${name}"${where} está obsoleto${note}`,
    deprecated: (key, where, note) => `"${key}"${where} está obsoleto${note}`,
    readOnly: (key, where) => `"${key}"${where} é somente leitura — o provider calcula o valor`,
    notABlock: (key, where) => `"${key}"${where} é um argumento — escreva ${key} = …, não um bloco`,
    notAnArgument: (key, where) => `"${key}"${where} é um bloco — escreva ${key} { … }, não ${key} = …`,
    typeProblem: (key, where, problem) => `"${key}"${where} ${problem}`,
    tooMany: (name, where, max, found) =>
      `o bloco "${name}"${where} pode aparecer no máximo ${max === 1 ? 'uma vez' : `${max} vezes`}, mas aparece ${found}`,
    missingArgument: (name, where) => `o argumento obrigatório "${name}"${where} está faltando`,
    missingBlock: (name, where) => `o bloco obrigatório "${name}"${where} está faltando`,
    unknownType: (type, provider, version, hint) => `o tipo de recurso "${type}" não existe no provider ${provider} ${version}${hint}`,
    typeDeprecated: (type, note) => `o tipo de recurso "${type}" está obsoleto${note}`,

    expects: 'espera',
    shouldBe: 'deveria ser',
    wanted: (w) => (w.kind === 'bool' ? 'um booleano' : w.kind === 'number' ? 'um número' : w.name),
    got: (g) => (g.kind === 'literal' ? g.text : g.kind === 'list' ? 'uma lista' : g.kind === 'object' ? 'um objeto' : 'este valor'),
    mismatch: (lead, wanted, got) => `${lead} ${wanted}, mas recebeu ${got}`,
    itemMismatch: (lead, type, inner) => `${lead} ${type}: um item ${inner}`,
    entryMismatch: (lead, type, key, inner) => `${lead} ${type}: "${key}" ${inner}`,

    required: 'obrigatório',
    optional: 'opcional',
    readOnlyDetail: 'somente leitura',
    computed: 'calculado',
    sensitive: 'sensível',
    writeOnly: 'somente escrita',
    deprecatedDetail: 'obsoleto',
    block: 'bloco',
    blockMap: 'bloco map',
    blockNesting: (nesting, max) => `bloco ${nesting}${max > 1 ? ` (máx. ${max})` : ''}`,
    deprecatedHeading: (note) => `**Obsoleto**${note ? ` — ${note}` : ''}`,
    providerVersion: (provider, version) => `provider ${provider} ${version}`,
    argumentCount: (n) => `${n} argumentos e blocos — digite dentro do bloco para vê-los`,
  },
);

export type SchemaText = (typeof schemaMessages)['en'];
