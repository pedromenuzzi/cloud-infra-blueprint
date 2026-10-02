/**
 * Monaco wiring: HCL language (Monarch tokenizer), blueprint themes,
 * catalog-aware completion and hover. Loaded lazily with the editor route.
 */
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import './contribs';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { messagesFor } from '@/i18n/messages';
import { exprPreview, literalString } from '@/ir/expr';
import type { IR } from '@/ir/types';
import { emptyIR } from '@/ir/types';
import { fieldHelp, resourceDescription, resourceName } from '@/resources/i18n';
import { allDefs, getDef } from '@/resources/registry';
import { codeMessages } from '../CodePane.messages';
import {
  dataReferenceSuggestions,
  dataTypeHover,
  dataTypeSuggestions,
  schemaBodySuggestions,
  schemaEntryAt,
  schemaHoverContents,
  schemaReferenceSuggestions,
  schemaTypeHover,
} from '@/schema/monaco';
import { dataTypeLabelBefore } from '@/schema/context';
import { schemaProviderOf, usualDataAttribute } from '@/schema/store';
import type { SchemaProvider } from '@/schema/types';

export { monaco };

let installed = false;
let irSource: () => IR = () => emptyIR();

export function setCompletionSource(fn: () => IR) {
  irSource = fn;
}

export function ensureMonacoSetup() {
  if (installed) return;
  installed = true;

  if (import.meta.env.DEV) {
    (window as unknown as { __monaco: unknown }).__monaco = monaco;
  }

  (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };

  monaco.languages.register({ id: 'hcl', extensions: ['.tf'], aliases: ['HCL', 'Terraform'] });

  monaco.languages.setLanguageConfiguration('hcl', {
    comments: { lineComment: '#', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider('hcl', {
    defaultToken: '',
    tokenPostfix: '.hcl',
    keywords: [
      'resource',
      'variable',
      'output',
      'provider',
      'module',
      'data',
      'locals',
      'terraform',
      'dynamic',
      'lifecycle',
      'for_each',
      'for',
      'in',
      'if',
      'depends_on',
      'count',
    ],
    constants: ['true', 'false', 'null'],
    typeKeywords: ['string', 'number', 'bool', 'list', 'map', 'set', 'object', 'tuple', 'any'],
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"/, 'string', '@string'],
        [/<<-?([A-Za-z_][A-Za-z0-9_]*)/, { token: 'string.heredoc', next: '@heredoc.$1' }],
        [/\d+(\.\d+)?/, 'number'],
        [
          /[a-zA-Z_][\w-]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@constants': 'constant',
              '@typeKeywords': 'type',
              '@default': 'identifier',
            },
          },
        ],
        [/[{}()[\]]/, '@brackets'],
        [/[=,.:?]/, 'delimiter'],
      ],
      comment: [
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment'],
      ],
      string: [
        [/\$\{/, { token: 'delimiter.interpolation', next: '@interp' }],
        [/[^"\\$]+/, 'string'],
        [/\\./, 'string.escape'],
        [/\$/, 'string'],
        [/"/, 'string', '@pop'],
      ],
      interp: [
        [/\}/, { token: 'delimiter.interpolation', next: '@pop' }],
        [/[^{}]+/, 'variable'],
        [/[{}]/, 'delimiter.interpolation'],
      ],
      heredoc: [
        [
          /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/,
          { cases: { '$1==$S2': { token: 'string.heredoc', next: '@pop' }, '@default': 'string' } },
        ],
        [/.*$/, 'string'],
      ],
    },
  });

  monaco.editor.defineTheme('blueprint-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5f6e84', fontStyle: 'italic' },
      { token: 'string', foreground: '047857' },
      { token: 'string.heredoc', foreground: '047857' },
      { token: 'keyword', foreground: '2563eb' },
      { token: 'constant', foreground: 'b45309' },
      { token: 'number', foreground: 'b45309' },
      { token: 'type', foreground: '7c3aed' },
      { token: 'identifier', foreground: '0f172a' },
      { token: 'variable', foreground: 'be185d' },
      { token: 'delimiter.interpolation', foreground: 'be185d' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.lineHighlightBackground': '#f8fafc',
      // line numbers are text: ≥ 4.5:1 on the editor and the current-line highlight
      'editorLineNumber.foreground': '#64748b',
      'editorLineNumber.activeForeground': '#1e293b',
      'editorIndentGuide.background1': '#f1f5f9',
    },
  });

  monaco.editor.defineTheme('blueprint-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8a99af', fontStyle: 'italic' },
      { token: 'string', foreground: '34d399' },
      { token: 'string.heredoc', foreground: '34d399' },
      { token: 'keyword', foreground: '60a5fa' },
      { token: 'constant', foreground: 'fbbf24' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'type', foreground: 'a78bfa' },
      { token: 'identifier', foreground: 'e2e8f0' },
      { token: 'variable', foreground: 'f472b6' },
      { token: 'delimiter.interpolation', foreground: 'f472b6' },
    ],
    colors: {
      'editor.background': '#0f172a',
      'editor.lineHighlightBackground': '#16233b',
      'editorLineNumber.foreground': '#7c8ba1',
      'editorLineNumber.activeForeground': '#e2e8f0',
      'editorIndentGuide.background1': '#1e293b',
    },
  });

  /**
   * find the resource type of the block enclosing `lineNumber` (rough brace
   * scan); undefined inside a `data` block, which the catalog's resource
   * fields don't describe (`data "aws_vpc"` is not a VPC to create)
   */
  const enclosingResourceType = (model: monaco.editor.ITextModel, lineNumber: number) => {
    let depth = 0;
    for (let ln = lineNumber; ln >= 1; ln--) {
      const text = model.getLineContent(ln);
      const scanned = ln === lineNumber ? text : text;
      const opens = (scanned.match(/\{/g) ?? []).length;
      const closes = (scanned.match(/\}/g) ?? []).length;
      depth += closes - opens;
      if (depth < 0) {
        const m = /^\s*resource\s+"([\w-]+)"/.exec(text);
        if (m) return m[1];
        if (/^\s*data\s+"/.test(text)) return undefined;
        depth = 0; // inside a nested block — keep walking outward
      }
    }
    return undefined;
  };

  /** providers the project uses (resources and data blocks): whose data sources `data "` offers */
  const projectProviders = (): SchemaProvider[] => {
    const ir = irSource();
    const found = new Set<SchemaProvider>();
    for (const b of [...ir.resources, ...ir.data]) {
      const p = schemaProviderOf(b.type);
      if (p) found.add(p);
    }
    return [...found];
  };

  monaco.languages.registerCompletionItemProvider('hcl', {
    triggerCharacters: ['"', '.', '=', ' '],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      const suggestions: monaco.languages.CompletionItem[] = [];

      // resource "aws_… → resource types
      if (/resource\s+"[\w-]*$/.test(line)) {
        for (const def of allDefs()) {
          suggestions.push({
            label: def.type,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: def.type,
            detail: resourceName(def.type),
            documentation: resourceDescription(def.type),
            range,
          });
        }
        return { suggestions };
      }

      // data "aws_… → data source types (the provider's data sources, once loaded)
      const dataLabel = dataTypeLabelBefore(line);
      if (dataLabel !== undefined) {
        return { suggestions: dataTypeSuggestions(monaco, dataLabel, range, projectProviders()) };
      }

      // `data.aws_ami.ubuntu.` → the attributes that data source exposes
      const exposed = dataReferenceSuggestions(monaco, model, position);
      if (exposed) return { suggestions: exposed };

      // `aws_instance.web.` → the attributes it exports (provider schema, once loaded)
      const assigned = /^\s*([\w-]+)\s*=/.exec(line)?.[1];
      const assignedField = assigned ? getDef(enclosingResourceType(model, position.lineNumber) ?? '')?.fields.find((f) => f.name === assigned) : undefined;
      const exported = schemaReferenceSuggestions(monaco, model, position, (t) =>
        assignedField?.refTo?.includes(t) ? (assignedField.refAttr ?? 'id') : undefined,
      );
      if (exported) return { suggestions: exported };

      // value position → what fits this argument: its options, references of
      // the types it takes (with the right attribute), variables
      const value = /^\s*([\w-]+)\s*=\s*(\[[^\]]*?)?([\w.]*)$/.exec(line);
      if (value) {
        const [, arg, inList, token] = value;
        const tokenRange = new monaco.Range(
          position.lineNumber,
          position.column - token.length,
          position.lineNumber,
          position.column,
        );
        const ir = irSource();
        const type = enclosingResourceType(model, position.lineNumber);
        const field = type ? getDef(type)?.fields.find((f) => f.name === arg) : undefined;
        if (field?.options && !inList) {
          for (const option of field.options) {
            suggestions.push({
              label: `"${option}"`,
              kind: monaco.languages.CompletionItemKind.EnumMember,
              insertText: `"${option}"`,
              range: tokenRange,
              sortText: `0${option}`,
            });
          }
        }
        if (field?.type === 'boolean') {
          for (const b of ['true', 'false']) {
            suggestions.push({ label: b, kind: monaco.languages.CompletionItemKind.Value, insertText: b, range: tokenRange });
          }
        }
        // plain values (instance_type, cidr_block…) don't take resource references
        if (!field || field.refTo) {
          const attr = field?.refAttr ?? 'id';
          for (const r of ir.resources) {
            if (field?.refTo && !field.refTo.includes(r.type)) continue;
            suggestions.push({
              label: `${r.id}.${attr}`,
              kind: monaco.languages.CompletionItemKind.Reference,
              insertText: `${r.id}.${attr}`,
              detail: getDef(r.type) ? resourceName(r.type) : undefined,
              range: tokenRange,
              sortText: `1${r.id}`,
            });
          }
        }
        // the project's data sources, through the attribute they're usually read by
        for (const d of ir.data) {
          const text = `${d.id}.${usualDataAttribute(d.type)}`;
          suggestions.push({
            label: text,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: text,
            range: tokenRange,
            sortText: `1~${d.id}`,
          });
        }
        for (const v of ir.variables) {
          suggestions.push({
            label: `var.${v.name}`,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: `var.${v.name}`,
            detail: v.args.type ? exprPreview(v.args.type) : undefined,
            documentation: literalString(v.args.description),
            range: tokenRange,
            sortText: `2${v.name}`,
          });
        }
        return { suggestions };
      }

      // attribute names inside a known resource block
      if (/^\s*[\w-]*$/.test(line)) {
        const m = messagesFor(codeMessages);
        const type = enclosingResourceType(model, position.lineNumber);
        const def = type ? getDef(type) : undefined;
        // provider schema: every other argument and block — nested blocks get only their own
        const schemaItems = schemaBodySuggestions(monaco, model, position, range, new Set(def?.fields.map((f) => f.name)));
        if (def && !schemaItems?.nested) {
          for (const f of def.fields) {
            const insert = f.options
              ? `${f.name} = "\${1|${f.options.join(',')}|}"`
              : f.type === 'boolean'
                ? `${f.name} = \${1|true,false|}`
                : f.type === 'number'
                  ? `${f.name} = \${1:0}`
                  : f.type === 'list'
                    ? `${f.name} = [\${1}]`
                    : f.type === 'tags'
                      ? `${f.name} = {\n  \${1:Name} = "\${2}"\n}`
                      : `${f.name} = "\${1}"`;
            suggestions.push({
              label: f.name,
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: insert,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: `${f.type}${f.required ? m.required : ''}`,
              documentation: fieldHelp(def.type, f.name).doc,
              range,
              sortText: f.required ? `0${f.name}` : `1${f.name}`,
            });
          }
        }
        if (schemaItems) suggestions.push(...schemaItems.suggestions);
        suggestions.push({
          label: m.resourceSnippet,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'resource "${1:aws_instance}" "${2:main}" {\n  ${0}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        });
        suggestions.push({
          label: m.dataSnippet,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'data "${1:aws_ami}" "${2:main}" {\n  ${0}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        });
        return { suggestions };
      }

      return { suggestions };
    },
  });

  monaco.languages.registerHoverProvider('hcl', {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const m = messagesFor(codeMessages);
      // a data source type: `data "aws_ami" …` or `data.aws_ami.ubuntu…` (not the resource of that name)
      const lineText = model.getLineContent(position.lineNumber);
      const before = lineText.slice(0, word.startColumn - 1);
      if (/^\s*data\s+"$/.test(before) || /(^|[^\w.-])data\.$/.test(before)) {
        const dataHover = dataTypeHover(word.word);
        return dataHover ? { contents: dataHover } : null;
      }
      const def = getDef(word.word);
      if (def) {
        return {
          contents: [
            { value: `**${resourceName(def.type)}** · \`${def.type}\`` },
            { value: resourceDescription(def.type) ?? '' },
            { value: m.hoverMeta(def.category, def.provider.toUpperCase()) },
          ],
        };
      }
      const typeHover = schemaTypeHover(word.word);
      if (typeHover) return { contents: typeHover };
      const type = enclosingResourceType(model, position.lineNumber);
      const parentDef = type ? getDef(type) : undefined;
      const field = parentDef?.fields.find((f) => f.name === word.word);
      const doc = field && type ? fieldHelp(type, field.name).doc : undefined;
      // provider schema: any argument or block (nested too) and `aws_x.name.<attr>`
      const hit = schemaEntryAt(model, position);
      if (hit) return { contents: schemaHoverContents(hit.entry, hit.argument ? doc : undefined) };
      if (field) {
        return {
          contents: [
            { value: `**${field.name}** · ${field.type}${field.required ? m.required : ''}` },
            { value: doc ?? '' },
          ],
        };
      }
      return null;
    },
  });
}
