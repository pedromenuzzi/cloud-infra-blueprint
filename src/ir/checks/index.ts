/**
 * In-browser checks for mistakes the cloud would reject at apply time:
 * CIDR plans, cloud-side names, regions and cross-VPC wiring. Each finding
 * is a warning on the resource, marked at the argument, and says what to fix.
 */
import type { ResourceDef } from '@/resources/types';
import type { Diagnostic, IR } from '../types';
import { cidrChecks } from './cidr';
import { nameChecks } from './names';
import { networkModel } from './network';
import { regionChecks } from './regions';
import type { CheckContext, MarkerAt } from './types';
import { wiringChecks } from './wiring';

export type { MarkerAt } from './types';

export function runChecks(
  ir: IR,
  getDef: (type: string) => ResourceDef | undefined,
  markerAt: MarkerAt,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const ctx: CheckContext = {
    ir,
    getDef,
    warn(node, field, message) {
      out.push({
        file: node.trivia.sourceFile ?? 'main.tf',
        severity: 'warning',
        message: `${node.id}: ${message}`,
        nodeId: node.id,
        ...markerAt(node, field),
      });
    },
  };
  cidrChecks(ctx, networkModel(ir));
  nameChecks(ctx);
  regionChecks(ctx);
  wiringChecks(ctx);
  return out;
}
