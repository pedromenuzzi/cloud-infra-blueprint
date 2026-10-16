/**
 * The plan and state commands of the command palette (in the editor). The
 * palette renders each with its own item component, like the layout ones.
 */
import { FileDiff, FileJson, FolderPlus, Sparkles, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMessages } from '@/i18n/messages';
import { openFromState } from './fromStateStore';
import { deployMessages } from './messages';
import { clearPlan, clearState, loadSamplePlan, openPlanViewer, pickAndOpen, useDeploy } from './store';

export interface DeployCommand {
  value: string;
  icon: LucideIcon;
  label: string;
  keywords: string[];
  run(): void;
}

export function DeployCommands({ render }: { render(command: DeployCommand): ReactNode }) {
  const m = useMessages(deployMessages);
  const plan = useDeploy((s) => s.plan);
  const state = useDeploy((s) => s.state);
  const kw = m.keywords;
  const commands: DeployCommand[] = [
    { value: 'deploy-panel', icon: FileDiff, label: m.showPanel, keywords: kw, run: openPlanViewer },
    { value: 'deploy-open-plan', icon: FileJson, label: m.openPlan, keywords: kw, run: () => void pickAndOpen('plan') },
    { value: 'deploy-sample-plan', icon: Sparkles, label: m.trySample, keywords: kw, run: loadSamplePlan },
    { value: 'deploy-open-state', icon: FileJson, label: m.openState, keywords: kw, run: () => void pickAndOpen('state') },
    ...(state ? [{ value: 'deploy-from-this-state', icon: FolderPlus, label: m.fromThisState, keywords: kw, run: () => void openFromState(state.state, state.name) }] : []),
    ...(plan ? [{ value: 'deploy-clear-plan', icon: X, label: m.clearPlan, keywords: kw, run: clearPlan }] : []),
    ...(state ? [{ value: 'deploy-clear-state', icon: X, label: m.clearState, keywords: kw, run: clearState }] : []),
  ];
  return <>{commands.map(render)}</>;
}
