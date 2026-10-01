/**
 * Security UI state + a shared, memoized audit of the IR on the canvas (an
 * opened module read as its call makes it) and of the local modules it calls.
 */
import { create } from 'zustand';
import { showToast } from '@/components/Toast';
import { shortcut } from '@/lib/keys';
import { useEditor } from '@/features/editor/store';
import { useModuleView } from '@/features/modules/moduleViewStore';
import { analysisIr } from '@/features/modules/viewAnalysis';
import { currentLocale, useLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import type { IR } from '@/ir/types';
import { auditSecurity, planFixAll, type AuditResult } from '@/security/audit';
import type { FrameworkId } from '@/security/compliance';
import { projectAudit, type ProjectAudit } from '@/security/modules';
import { analyzeSecurity } from '@/security/topology';
import { securityUiMessages } from './messages';

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

let cache: { ir: IR; locale: Locale; result: AuditResult } | null = null;

/**
 * The audit of what the canvas shows. An opened module is read as its call
 * makes it (its literal inputs put in), but offers only the fixes its own
 * code takes: a fix never writes a call's value over a `var.x`.
 */
function auditView(ir: IR, locale: Locale): AuditResult {
  const read = analysisIr(ir);
  const result = auditSecurity(read, analyzeSecurity(read, locale));
  if (read === ir) return result;
  const own = new Map(auditSecurity(ir, analyzeSecurity(ir, locale)).findings.map((f) => [f.id, f.fix] as const));
  return { ...result, findings: result.findings.map((f) => (own.get(f.id) === f.fix ? f : { ...f, fix: own.get(f.id) })) };
}

/**
 * Audit of an IR, computed once per IR object and language (every panel /
 * node shares it). A language switch re-words it — findings, paths, reasons —
 * without touching the IR or its history.
 */
export function getAudit(ir: IR, locale: Locale = currentLocale()): AuditResult {
  if (cache?.ir !== ir || cache.locale !== locale) cache = { ir, locale, result: auditView(ir, locale) };
  return cache.result;
}

/** The open project's audit, in the UI language; re-renders on an edit or a language switch. */
export function useAudit(): AuditResult {
  const ir = useEditor((s) => s.ir);
  const locale = useLocale((s) => s.locale);
  return getAudit(ir, locale);
}

let projectCache: { own: AuditResult; files: Record<string, string>; key: string; result: ProjectAudit } | null = null;

/** getAudit of `ir`, with the findings inside the local modules it calls and the grade of both. */
export function getProjectAudit(
  ir: IR,
  files: Record<string, string>,
  steps: Array<{ dir: string; name: string }> = [],
  locale: Locale = currentLocale(),
): ProjectAudit {
  const own = getAudit(ir, locale);
  const key = steps.map((x) => `${x.dir}:${x.name}`).join('/');
  if (projectCache?.own !== own || projectCache.files !== files || projectCache.key !== key) {
    projectCache = { own, files, key, result: projectAudit(own, analysisIr(ir), files, steps) };
  }
  return projectCache.result;
}

/** The canvas's audit with what's inside its local modules (the security panel). */
export function useProjectAudit(): ProjectAudit {
  const ir = useEditor((s) => s.ir);
  const files = useEditor((s) => s.files);
  const scoped = useEditor((s) => s.scope !== null);
  const path = useModuleView((s) => s.path);
  const locale = useLocale((s) => s.locale);
  return getProjectAudit(ir, files, scoped ? path.map(({ dir, name }) => ({ dir, name })) : [], locale);
}

/** Apply every one-click fix as one undo step; the toast counts the findings that actually went away. */
export function fixAllFindings() {
  const { ops, fixed } = planFixAll(useEditor.getState().ir);
  if (ops.length) useEditor.getState().applyCanvasOps(ops);
  const m = messagesFor(securityUiMessages);
  if (fixed > 0) showToast(m.fixedCount(fixed, shortcut('mod', 'Z')), 'success');
  else showToast(m.nothingFixed, 'info');
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
