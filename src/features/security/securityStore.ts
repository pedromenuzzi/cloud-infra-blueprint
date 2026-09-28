/** Security UI state + a shared, memoized audit of the current IR. */
import { create } from 'zustand';
import type { IR } from '@/ir/types';
import { auditSecurity, type AuditResult } from '@/security/audit';

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
  setLens(on: boolean): void;
  toggleLens(): void;
  setPanel(open: boolean): void;
  openRules(owner: string | null): void;
}

export const useSecurityUi = create<SecurityUiState>((set, get) => ({
  lens: readLens(),
  panelOpen: false,
  editing: null,
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
  openRules(editing) {
    set({ editing });
  },
}));

let cache: { ir: IR; result: AuditResult } | null = null;

/** Audit of an IR, computed once per IR object (every panel / node shares it). */
export function getAudit(ir: IR): AuditResult {
  if (cache?.ir !== ir) cache = { ir, result: auditSecurity(ir) };
  return cache.result;
}

export const GRADE_COLORS: Record<string, string> = {
  A: '#10b981',
  B: '#84cc16',
  C: '#f59e0b',
  D: '#f97316',
  F: '#ef4444',
};

export const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#64748b',
};
