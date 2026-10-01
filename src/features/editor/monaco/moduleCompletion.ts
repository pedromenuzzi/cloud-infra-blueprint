/**
 * Monaco and local modules: what a file can reference depends on the module
 * it belongs to. In a module's file `var.` lists that module's variables
 * (and references its own resources); `module.<name>.` lists the outputs a
 * local module declares, with their descriptions; hovering
 * `module.x.out` says what the output is and what it's set to.
 */
import { messagesFor } from '@/i18n/messages';
import { exprPreview } from '@/ir/expr';
import { moduleTarget, readLocalModule } from '@/ir/localModules';
import { dirOfPath } from '@/ir/modules';
import type { IR } from '@/ir/types';
import { codeMessages } from '../CodePane.messages';
import { useEditor } from '../store';
import { monaco } from './setup';

/** The blocks a project file is part of: its local module's, or the root module's. */
export function irForFile(file: string): IR {
  const { files, rootIr } = useEditor.getState();
  const dir = dirOfPath(file);
  return dir === '' ? rootIr : (readLocalModule(files, dir)?.ir ?? rootIr);
}

/** What the completion of the file being edited reads: the IR of the module it belongs to. */
export const completionIr = (): IR => irForFile(useEditor.getState().activeFile);

/** project path of a model (`inmemory://blueprint/<project>/<path>`) */
const fileOf = (model: monaco.editor.ITextModel) => decodeURIComponent(model.uri.path.split('/').slice(2).join('/'));

/** The value regex of setup.ts's provider: where it already offers `var.…` (without descriptions). */
const VALUE_POSITION = /^\s*([\w-]+)\s*=\s*(\[[^\]]*?)?([\w.]*)$/;

/** the local module a `module "<name>"` call of `file`'s module points at */
function calledModule(file: string, name: string) {
  const call = irForFile(file).modules.find((m) => m.name === name);
  if (!call) return null;
  const target = moduleTarget(useEditor.getState().files, call);
  return target.kind === 'local' && target.module && !target.module.broken ? { call, child: target.module } : null;
}

let installed = false;

export function ensureModuleCompletion() {
  if (installed) return;
  installed = true;

  monaco.languages.registerCompletionItemProvider('hcl', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const file = fileOf(model);
      const out: monaco.languages.CompletionItem[] = [];
      const range = (typed: string) =>
        new monaco.Range(position.lineNumber, position.column - typed.length, position.lineNumber, position.column);

      // module.<name>.<output>
      const mod = /\bmodule\.([A-Za-z_][\w-]*)(?:\[[^\]]*\])*\.([\w-]*)$/.exec(line);
      if (mod) {
        const target = calledModule(file, mod[1]);
        if (!target) return { suggestions: [] };
        const m = messagesFor(codeMessages);
        for (const o of target.child.outputs) {
          const decl = target.child.ir.outputs.find((x) => x.name === o.name);
          out.push({
            label: o.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: o.name,
            detail: m.moduleOutput(target.child.dir),
            documentation: { value: [o.description ?? '', decl?.args.value ? `\`= ${exprPreview(decl.args.value)}\`` : ''].filter(Boolean).join('\n\n') },
            range: range(mod[2]),
            sortText: `0${o.name}`,
          });
        }
        return { suggestions: out };
      }

      // var.<name>: the variables of the module this file belongs to
      const v = /\bvar\.([\w-]*)$/.exec(line);
      if (v && !VALUE_POSITION.test(line)) {
        for (const decl of irForFile(file).variables) {
          const type = decl.args.type ? exprPreview(decl.args.type) : undefined;
          const description = decl.args.description?.kind === 'literal' ? String(decl.args.description.value) : undefined;
          out.push({
            label: decl.name,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: decl.name,
            detail: type,
            documentation: description,
            range: range(v[1]),
            sortText: `0${decl.name}`,
          });
        }
      }
      return { suggestions: out };
    },
  });

  monaco.languages.registerHoverProvider('hcl', {
    provideHover(model, position) {
      const text = model.getLineContent(position.lineNumber);
      const col = position.column - 1;
      for (const m of text.matchAll(/\bmodule\.([A-Za-z_][\w-]*)(?:\[[^\]]*\])*\.([A-Za-z_][\w-]*)/g)) {
        const start = m.index ?? 0;
        if (col < start || col > start + m[0].length) continue;
        const target = calledModule(fileOf(model), m[1]);
        const output = target?.child.outputs.find((o) => o.name === m[2]);
        if (!target || !output) return null;
        const decl = target.child.ir.outputs.find((x) => x.name === output.name);
        const t = messagesFor(codeMessages);
        return {
          range: new monaco.Range(position.lineNumber, start + 1, position.lineNumber, start + m[0].length + 1),
          contents: [
            { value: `**module.${m[1]}.${output.name}** · ${t.moduleOutput(target.child.dir)}` },
            ...(output.description ? [{ value: output.description }] : []),
            ...(decl?.args.value ? [{ value: `\`\`\`hcl\nvalue = ${exprPreview(decl.args.value)}\n\`\`\`` }] : []),
          ],
        };
      }
      return null;
    },
  });
}
