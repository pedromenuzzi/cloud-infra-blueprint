/** Align / distribute actions shared by the multi-select panel, the canvas menu and ⌘K. */
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  type LucideIcon,
} from 'lucide-react';
import { messagesFor } from '@/i18n/messages';
import type { Op } from '@/ir/ops';
import type { IR } from '@/ir/types';
import { alignBlocker, alignOps, distributeOps } from './align';
import { alignMessages, type AlignText } from './align.messages';

export interface AlignAction {
  id: string;
  /** in the UI language in effect when read (a component re-rendering on a switch reads the new one) */
  readonly label: string;
  icon: LucideIcon;
  /** fewest resources the action needs */
  min: number;
  ops(ir: IR, ids: string[]): Op[];
}

function action(
  id: string,
  text: (m: AlignText) => string,
  icon: LucideIcon,
  min: number,
  ops: (ir: IR, ids: string[]) => Op[],
): AlignAction {
  return {
    id,
    get label() {
      return text(messagesFor(alignMessages));
    },
    icon,
    min,
    ops,
  };
}

export const ALIGN_ACTIONS: AlignAction[] = [
  action('align-left', (m) => m.left, AlignStartVertical, 2, (ir, ids) => alignOps(ir, ids, 'left')),
  action('align-center', (m) => m.center, AlignCenterVertical, 2, (ir, ids) => alignOps(ir, ids, 'center')),
  action('align-right', (m) => m.right, AlignEndVertical, 2, (ir, ids) => alignOps(ir, ids, 'right')),
  action('align-top', (m) => m.top, AlignStartHorizontal, 2, (ir, ids) => alignOps(ir, ids, 'top')),
  action('align-middle', (m) => m.middle, AlignCenterHorizontal, 2, (ir, ids) => alignOps(ir, ids, 'middle')),
  action('align-bottom', (m) => m.bottom, AlignEndHorizontal, 2, (ir, ids) => alignOps(ir, ids, 'bottom')),
  action('distribute-horizontal', (m) => m.horizontal, AlignHorizontalDistributeCenter, 3, (ir, ids) =>
    distributeOps(ir, ids, 'horizontal'),
  ),
  action('distribute-vertical', (m) => m.vertical, AlignVerticalDistributeCenter, 3, (ir, ids) =>
    distributeOps(ir, ids, 'vertical'),
  ),
];

/** Why `action` can't run on this selection (in the UI language in effect), or null. */
export function alignActionBlocker(action: AlignAction, ir: IR, ids: string[]): string | null {
  return alignBlocker(ir, ids, action.min);
}
