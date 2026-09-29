/** Security UI state + a shared, memoized audit of the current IR. */
import { create } from 'zustand';
import { showToast } from '@/components/Toast';
import { MOD } from '@/features/command/paletteStore';
import { useEditor } from '@/features/editor/store';
import type { IR } from '@/ir/types';
import { auditSecurity, planFixAll, type AuditResult } from '@/security/audit';
import type { FrameworkId } from '@/security/compliance';

const LENS_KEY = 'cb-security-lens';

function readLens(): boolean {
  try {
    return localStorage.getItem(LENS_KEY) === '1';
  } catch {
    return false;
  }
}

interface SecurityUiState {
  /** overlay exposure + allowed traffic on the canvas */
  lens: boolean;
  panelOpen: boolean;
  /** owner resource whose rules are open in the full editor */
  editing: string | null;
  /** the row the rules editor brings into view and focuses */
  focusRule: string | null;
  /** exposed resource whose access paths the panel shows open */
  explaining: string | null;
  /** finding the panel opens and scrolls to */
  spotlight: string | null;
  /** the panel lists only findings mapped to this framework */
  framework: FrameworkId | 'all';
  setLens(on: boolean): void;
  toggleLens(): void;
  setPanel(open: boolean): void;
  /** open the rules editor on `owner`, at the row of `rule` when given */
  openRules(owner: string | null, rule?: string): void;
  /** open the panel with this resource's "why is it reachable?" expanded */
  explain(resource: string | null): void;
  setSpotlight(finding: string | null): void;
  setFramework(framework: FrameworkId | 'all'): void;
}

export const useSecurityUi = create<SecurityUiState>((set, get) => ({
  lens: readLens(),
  panelOpen: false,
  editing: null,
  focusRule: null,
  explaining: null,
  spotlight: null,
  framework: 'all',
  setLens(lens) {
    set({ lens });
    try {
      localStorage.setItem(LENS_KEY, lens ? '1' : '0');
    } catch {
      /* private mode */
    }
  },
  toggleLens() {
    get().setLens(!get().lens);
  },
  setPanel(panelOpen) {
    set({ panelOpen });
  },
  openRules(editing, rule) {
    set({ editing, focusRule: editing && rule ? rule : null });
  },
  explain(explaining) {
    set({ explaining, ...(explaining ? { panelOpen: true } : {}) });
  },
  setSpotlight(spotlight) {
    set({ spotlight });
  },
  setFramework(framework) {
    set({ framework });
  },
}));

let cache: { ir: IR; result: AuditResult } | null = null;

/** Audit of an IR, computed once per IR object (every panel / node shares it). */
export function getAudit(ir: IR): AuditResult {
  if (cache?.ir !== ir) cache = { ir, result: auditSecurity(ir) };
  return cache.result;
}

/** Apply every one-click fix as one undo step; the toast counts the findings that actually went away. */
export function fixAllFindings() {
  const { ops, fixed } = planFixAll(useEditor.getState().ir);
  if (ops.length) useEditor.getState().applyCanvasOps(ops);
  if (fixed > 0) showToast(`Fixed ${fixed} issue${fixed === 1 ? '' : 's'} — ${MOD} Z to undo`, 'success');
  else showToast('Nothing could be fixed automatically', 'info');
}

export const GRADE_COLORS: Record<string, string> = {
  A: '#10b981',
  B: '#84cc16',
  C: '#f59e0b',
  D: '#f97316',
  F: '#ef4444',
};

/** severity as text: AA contrast in both themes (SEVERITY_COLORS are for dots, tints and borders) */
export const SEVERITY_TEXT: Record<string, string> = {
  critical: 'text-danger',
  high: 'text-[#c2410c] dark:text-[#fb923c]',
  medium: 'text-warning',
  low: 'text-muted',
};

export const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#64748b',
};
