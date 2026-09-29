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
import type { Op } from '@/ir/ops';
import type { IR } from '@/ir/types';
import { alignBlocker, alignOps, distributeOps } from './align';

export interface AlignAction {
  id: string;
  label: string;
  icon: LucideIcon;
  /** fewest resources the action needs */
  min: number;
  ops(ir: IR, ids: string[]): Op[];
}

export const ALIGN_ACTIONS: AlignAction[] = [
  { id: 'align-left', label: 'Align left', icon: AlignStartVertical, min: 2, ops: (ir, ids) => alignOps(ir, ids, 'left') },
  { id: 'align-center', label: 'Align centers', icon: AlignCenterVertical, min: 2, ops: (ir, ids) => alignOps(ir, ids, 'center') },
  { id: 'align-right', label: 'Align right', icon: AlignEndVertical, min: 2, ops: (ir, ids) => alignOps(ir, ids, 'right') },
  { id: 'align-top', label: 'Align top', icon: AlignStartHorizontal, min: 2, ops: (ir, ids) => alignOps(ir, ids, 'top') },
  { id: 'align-middle', label: 'Align middles', icon: AlignCenterHorizontal, min: 2, ops: (ir, ids) => alignOps(ir, ids, 'middle') },
  { id: 'align-bottom', label: 'Align bottom', icon: AlignEndHorizontal, min: 2, ops: (ir, ids) => alignOps(ir, ids, 'bottom') },
  {
    id: 'distribute-horizontal',
    label: 'Distribute horizontally',
    icon: AlignHorizontalDistributeCenter,
    min: 3,
    ops: (ir, ids) => distributeOps(ir, ids, 'horizontal'),
  },
  {
    id: 'distribute-vertical',
    label: 'Distribute vertically',
    icon: AlignVerticalDistributeCenter,
    min: 3,
    ops: (ir, ids) => distributeOps(ir, ids, 'vertical'),
  },
];

/** Why `action` can't run on this selection, or null. */
export function alignActionBlocker(action: AlignAction, ir: IR, ids: string[]): string | null {
  return alignBlocker(ir, ids, action.min);
}
