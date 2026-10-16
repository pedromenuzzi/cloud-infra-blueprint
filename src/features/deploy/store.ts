/**
 * The plan and the state opened in the editor: in this tab's memory only.
 * Nothing here is ever written to storage or sent anywhere; leaving the
 * editor forgets both (DeployHost). A state can follow the project created
 * from it (`projectId`), so its new canvas opens already marked deployed.
 */
import { create } from 'zustand';
import { showToast } from '@/components/Toast';
import { useLayout } from '@/features/editor/layoutStore';
import { useEditor } from '@/features/editor/store';
import { useSecurityUi } from '@/features/security/securityStore';
import { messagesFor } from '@/i18n/messages';
import type { IR } from '@/ir/types';
import { readJsonFile, readJsonText, type ReadResult } from '@/deploy/json';
import { isNoteworthy, parsePlan, type RealPlan } from '@/deploy/plan';
import { samplePlan } from '@/deploy/sample';
import { parseState, stateByNode, type ParsedState, type StateResource } from '@/deploy/state';
import { errorText, pickFile, PLAN_ACCEPT, STATE_ACCEPT } from './files';
import { deployMessages } from './messages';

export interface LoadedPlan {
  plan: RealPlan;
  name: string;
  sample: boolean;
  /** the code it was opened on (codeFingerprint): another one means the code changed since */
  baseline: string;
}

export interface LoadedState {
  state: ParsedState;
  name: string;
  /** canvas node → its managed resources */
  byNode: Map<string, StateResource[]>;
}

export type DeployTab = 'plan' | 'state';

interface DeployState {
  panelOpen: boolean;
  tab: DeployTab;
  plan: LoadedPlan | null;
  state: LoadedState | null;
  /** the project both belong to */
  projectId: string | null;
  /** the change the panel opens and scrolls to (the inspector's "Show in the plan") */
  focus: string | null;
  /** a file is being read */
  busy: boolean;
}

export const useDeploy = create<DeployState>(() => ({ panelOpen: false, tab: 'plan', plan: null, state: null, projectId: null, focus: null, busy: false }));

// one panel on the canvas's left at a time: the security panel opening closes this one
useSecurityUi.subscribe((s, prev) => {
  if (s.panelOpen && !prev.panelOpen && useDeploy.getState().panelOpen) useDeploy.setState({ panelOpen: false });
});

export function setDeployPanel(open: boolean, tab?: DeployTab) {
  if (open) {
    useSecurityUi.getState().setPanel(false);
    // waiting as a tab beside the inspector: its turn now
    useLayout.getState().setFloatFront('tool');
  }
  useDeploy.setState({ panelOpen: open, ...(tab ? { tab } : {}) });
}

/** The plan viewer's stable entry point (lesson links, the command palette): the panel on its Plan tab. */
export function openPlanViewer() {
  setDeployPanel(true, 'plan');
}

/** What the code says, positions aside: moving a node doesn't make a plan stale, editing a value does. */
export function codeFingerprint(ir: IR): string {
  const blocks = [...ir.resources, ...ir.modules, ...ir.data].map((b) => [b.id, b.args]);
  let h = 0;
  for (const ch of JSON.stringify(blocks)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return `${blocks.length}:${h}`;
}

const project = () => useEditor.getState().projectId;

/** Show a parsed plan; returns false (and says why) when it isn't one. */
export function loadPlan(value: unknown, name: string, sample = false): boolean {
  const result = parsePlan(value);
  if (!result.ok) {
    showToast(errorText(result.error), 'error');
    return false;
  }
  const { rootIr } = useEditor.getState();
  useDeploy.setState({ plan: { plan: result.plan, name, sample, baseline: codeFingerprint(rootIr) }, projectId: project(), focus: null });
  setDeployPanel(true, 'plan');
  const shown = result.plan.changes.filter(isNoteworthy).length;
  const m = messagesFor(deployMessages);
  showToast(shown ? m.planOpened(shown) : m.planEmpty, 'success');
  return true;
}

/** Keep a parsed state for `projectId` (the open project unless given); false (and why) when it isn't one. */
export function loadState(value: unknown, name: string, projectId: string | null = project(), quiet = false): ParsedState | null {
  const result = parseState(value);
  if (!result.ok) {
    showToast(errorText(result.error), 'error');
    return null;
  }
  useDeploy.setState({ state: { state: result.state, name, byNode: stateByNode(result.state) }, projectId });
  if (!quiet) {
    setDeployPanel(true, 'state');
    const n = result.state.resources.filter((r) => r.mode === 'managed').length;
    showToast(messagesFor(deployMessages).stateOpened(n), 'success');
  }
  return result.state;
}

/** Open a picked or dropped file as what it turns out to be: a plan or a state. */
export async function openDeployFile(file: File): Promise<void> {
  useDeploy.setState({ busy: true });
  try {
    openRead(await readJsonFile(file), file.name);
  } finally {
    useDeploy.setState({ busy: false });
  }
}

function openRead(read: ReadResult, name: string) {
  if (!read.ok) {
    showToast(errorText(read.error), 'error');
    return;
  }
  if (read.kind === 'plan') loadPlan(read.value, name);
  else if (read.kind === 'state') loadState(read.value, name);
  else showToast(errorText(read.kind === 'state-json' ? 'state-json' : 'unknown'), 'error');
}

export async function pickAndOpen(kind: DeployTab) {
  const file = await pickFile(kind === 'plan' ? PLAN_ACCEPT : STATE_ACCEPT);
  if (file) await openDeployFile(file);
}

export function loadSamplePlan() {
  const read = readJsonText(JSON.stringify(samplePlan(useEditor.getState().rootIr)));
  if (read.ok) loadPlan(read.value, 'sample-plan.json', true);
}

export function clearPlan() {
  useDeploy.setState({ plan: null, focus: null });
}

export function clearState() {
  useDeploy.setState({ state: null });
}

/** the code changed since the plan was opened: take the code as it is now as the plan's */
export function keepPlan() {
  const plan = useDeploy.getState().plan;
  if (plan) useDeploy.setState({ plan: { ...plan, baseline: codeFingerprint(useEditor.getState().rootIr) } });
}

/** forget both (leaving the editor, another project) */
export function forgetDeploy() {
  useDeploy.setState({ plan: null, state: null, projectId: null, focus: null, panelOpen: false });
}
