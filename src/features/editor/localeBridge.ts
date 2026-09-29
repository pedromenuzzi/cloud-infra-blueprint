/**
 * Keeps the editor's stored messages in the UI language. Validation warnings
 * and parse errors are text produced when the code is checked (in the
 * language in effect then), and the store keeps them — so on a language
 * switch they're produced again from the same IR and files: the canvas
 * badges, the overview and the code pane's markers change language in
 * place. Nothing else is touched: no new IR, no undo step, no save.
 */
import { parseProject } from '@/hcl/parser';
import { useLocale } from '@/i18n/locale';
import { validateProject } from '@/ir/validate';
import { getDef } from '@/resources/registry';
import { useEditor } from './store';

/** produce the stored warnings and parse errors again, in the language in effect */
export function relocalizeEditorMessages() {
  const { ir, files, parseDiagnostics } = useEditor.getState();
  useEditor.setState({
    warnings: validateProject(ir, getDef),
    // nothing to translate when the code parsed cleanly
    ...(parseDiagnostics.length > 0 ? { parseDiagnostics: parseProject(files).diagnostics } : {}),
  });
}

let installed = false;

/** relocalize whenever the UI language changes (installed once, by the inspector's schema section) */
export function installLocaleBridge() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  useLocale.subscribe((state, prev) => {
    if (state.locale !== prev.locale) relocalizeEditorMessages();
  });
}
