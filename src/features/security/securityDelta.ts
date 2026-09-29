/**
 * Security delta toast: after an edit that makes the design less safe — the
 * grade drops, or a new critical / high finding appears — say so once, with a
 * "Show" action and the undo shortcut.
 *
 * Edits are canvas / inspector ops and code that parses; loading a project,
 * undo and redo are not (they only go back to something the user already had).
 * A burst of edits is judged once, against the state before it began.
 */
import { useEffect } from 'react';
import { showToast } from '@/components/Toast';
import { MOD } from '@/features/command/paletteStore';
import { canvasApi } from '@/features/editor/canvasApi';
import { useEditor } from '@/features/editor/store';
import { messagesFor } from '@/i18n/messages';
import type { AuditResult } from '@/security/audit';
import { securityDelta, type SecurityDelta } from '@/security/delta';
import { securityUiMessages } from './messages';
import { getAudit, useSecurityUi } from './securityStore';

/** how long the edits have to settle before they are judged */
export const DELTA_SETTLE_MS = 900;

type EditorSlice = Pick<ReturnType<typeof useEditor.getState>, 'ir' | 'files' | 'past' | 'future' | 'projectId'>;

/** What moved the IR from `prev` to `next` (the store's own bookkeeping tells them apart). */
export function editKind(prev: EditorSlice, next: EditorSlice): 'edit' | 'undo' | 'redo' | 'load' | 'none' {
  if (next.ir === prev.ir) return 'none';
  if (next.projectId !== prev.projectId) return 'load';
  // undo / redo put back the very snapshot they took off the stack
  if (prev.past.length > 0 && next.files === prev.past[prev.past.length - 1]) return 'undo';
  if (prev.future.length > 0 && next.files === prev.future[0]) return 'redo';
  // every edit leaves a step to undo; a (re)load starts a fresh history
  if (next.past.length === 0) return 'load';
  return 'edit';
}

function show(delta: SecurityDelta) {
  const ui = useSecurityUi.getState();
  ui.openRules(null);
  ui.setSpotlight(delta.lead?.id ?? null);
  ui.setPanel(true);
  const target = delta.target;
  if (target && useEditor.getState().ir.resources.some((r) => r.id === target)) {
    useEditor.getState().setSelection(target, 'canvas');
    requestAnimationFrame(() => canvasApi()?.focusNode(target));
  }
}

/** Watch the editor; returns the function that stops watching. */
export function startSecurityDelta(): () => void {
  let baseline: AuditResult | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    clearTimeout(timer);
    timer = undefined;
    baseline = null;
  };
  const settle = () => {
    const before = baseline;
    reset();
    if (!before) return;
    // `before` may be worded in another language (a switch mid-burst): findings compare by their English key
    const delta = securityDelta(before, getAudit(useEditor.getState().ir));
    if (!delta) return;
    const m = messagesFor(securityUiMessages);
    showToast(delta.message, 'warning', {
      hint: m.undoHint(MOD),
      ...(delta.target ? { action: { label: m.show, onClick: () => show(delta) } } : {}),
    });

  };
  const unsubscribe = useEditor.subscribe((state, prev) => {
    const kind = editKind(prev, state);
    if (kind === 'none') return;
    if (kind !== 'edit') {
      reset();
      return;
    }
    baseline ??= getAudit(prev.ir);
    clearTimeout(timer);
    timer = setTimeout(settle, DELTA_SETTLE_MS);
  });
  return () => {
    unsubscribe();
    reset();
  };
}

/** Mount once in the editor page. */
export function useSecurityDelta() {
  useEffect(() => startSecurityDelta(), []);
}
