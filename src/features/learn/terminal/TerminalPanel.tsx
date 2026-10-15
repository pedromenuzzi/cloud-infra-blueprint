/**
 * The simulated Terraform terminal of a lesson. Placeholder with the agreed
 * props: the simulator front builds it. It reads and records the lesson's
 * runs and state through `useLearn` (recordRun) by itself, and publishes the
 * plan for the canvas to draw.
 */
import type { Files } from '@/learn/types';

export interface TerminalPanelProps {
  /** the lesson whose runs and simulated state this terminal keeps */
  slug: string;
  /** the lesson's code as it is now */
  files: Files;
  className?: string;
}

export function TerminalPanel(_props: TerminalPanelProps) {
  return null;
}
