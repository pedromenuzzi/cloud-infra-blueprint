/**
 * Monaco wiring: HCL language (Monarch tokenizer), blueprint themes,
 * catalog-aware completion and hover. Loaded lazily with the editor route.
 */
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import type { IR } from '@/ir/types';
import { emptyIR } from '@/ir/types';
import { allDefs, getDef } from '@/resources/registry';

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
      { token: 'comment', foreground: '94a3b8', fontStyle: 'italic' },
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
      'editorLineNumber.foreground': '#cbd5e1',
      'editorLineNumber.activeForeground': '#64748b',
      'editorIndentGuide.background1': '#f1f5f9',
    },
  });

  monaco.editor.defineTheme('blueprint-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
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
      'editorLineNumber.foreground': '#334155',
      'editorLineNumber.activeForeground': '#94a3b8',
      'editorIndentGuide.background1': '#1e293b',
    },
  });

  /** find the resource type of the block enclosing `lineNumber` (rough brace scan) */
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
        depth = 0; // inside a nested block — keep walking outward
      }
    }
    return undefined;
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
            detail: def.displayName,
            documentation: def.description,
            range,
          });
        }
        return { suggestions };
      }

      // value position → references to existing resources / variables
      if (/=\s*[\w.]*$/.test(line)) {
        const ir = irSource();
        for (const r of ir.resources) {
          suggestions.push({
            label: `${r.id}.id`,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: `${r.id}.id`,
            detail: getDef(r.type)?.displayName,
            range,
          });
        }
        for (const v of ir.variables) {
          suggestions.push({
            label: `var.${v.name}`,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: `var.${v.name}`,
            range,
          });
        }
        return { suggestions };
      }

      // attribute names inside a known resource block
      if (/^\s*[\w-]*$/.test(line)) {
        const type = enclosingResourceType(model, position.lineNumber);
        const def = type ? getDef(type) : undefined;
        if (def) {
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
              detail: `${f.type}${f.required ? ' · required' : ''}`,
              documentation: f.doc,
              range,
              sortText: f.required ? `0${f.name}` : `1${f.name}`,
            });
          }
        }
        suggestions.push({
          label: 'res — resource block',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'resource "${1:aws_instance}" "${2:main}" {\n  ${0}\n}',
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
      const def = getDef(word.word);
      if (def) {
        return {
          contents: [
            { value: `**${def.displayName}** · \`${def.type}\`` },
            { value: def.description ?? '' },
            {
              value: `Category: ${def.category} · Provider: ${def.provider.toUpperCase()}`,
            },
          ],
        };
      }
      const type = enclosingResourceType(model, position.lineNumber);
      const parentDef = type ? getDef(type) : undefined;
      const field = parentDef?.fields.find((f) => f.name === word.word);
      if (field) {
        return {
          contents: [
            { value: `**${field.name}** · ${field.type}${field.required ? ' · required' : ''}` },
            { value: field.doc ?? '' },
          ],
        };
      }
      return null;
    },
  });
}
