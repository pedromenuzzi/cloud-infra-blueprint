import type { ResourceDef } from '@/resources/types';
import type { Diagnostic, IR, ResourceNode } from '../types';

/** Where a warning points (validate.ts's `markerAt`: the argument's key, else the block header). */
export type MarkerAt = (node: ResourceNode, field?: string) => Pick<Diagnostic, 'start' | 'end'>;

export interface CheckContext {
  ir: IR;
  getDef: (type: string) => ResourceDef | undefined;
  /** report `message` on `node`, marked at `field` */
  warn(node: ResourceNode, field: string | undefined, message: string): void;
}
