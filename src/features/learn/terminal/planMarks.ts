/**
 * The last plan, as the canvas draws it: each node's change (the strongest
 * among its instances) and the addresses that will be destroyed although
 * their block isn't in the code any more (so not on the canvas either).
 * The lesson's terminal fills it after `terraform plan` and empties it when
 * the code changes, after apply / destroy, and when it goes away: outside
 * a lesson it stays empty.
 */
import { create } from 'zustand';
import type { PlanAction, PlanSummary } from '@/learn/types';

export interface NodeMark {
  action: PlanAction;
  /** how many of its instances change */
  count: number;
}

interface PlanMarks {
  /** canvas node id → its change */
  nodes: Record<string, NodeMark>;
  /** addresses that will be destroyed and have no node */
  gone: string[];
}

export const usePlanMarks = create<PlanMarks>(() => ({ nodes: {}, gone: [] }));

const RANK: Record<PlanAction, number> = { create: 0, update: 1, delete: 2, replace: 3 };

/** the node an address is drawn as: `aws_subnet.a[0]` → `aws_subnet.a`, `module.net.aws_vpc.x` → `module.net` */
export function nodeOf(address: string): string {
  const module = /^module\.([^.[]+)/.exec(address)?.[1];
  return module ? `module.${module}` : address.replace(/\[[^\]]*\]$/, '');
}

/** draw `plan`; `declared` holds the node ids the code has */
export function showPlan(plan: PlanSummary, declared: Set<string>) {
  const nodes: Record<string, NodeMark> = {};
  const gone: string[] = [];
  for (const c of plan.changes) {
    const id = nodeOf(c.address);
    if (!declared.has(id)) {
      gone.push(c.address);
      continue;
    }
    const was = nodes[id];
    nodes[id] = { action: was && RANK[was.action] > RANK[c.action] ? was.action : c.action, count: (was?.count ?? 0) + 1 };
  }
  usePlanMarks.setState({ nodes, gone });
}

export function clearPlan() {
  const { nodes, gone } = usePlanMarks.getState();
  if (gone.length > 0 || Object.keys(nodes).length > 0) usePlanMarks.setState({ nodes: {}, gone: [] });
}
