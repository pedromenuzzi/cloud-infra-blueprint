import type { Provider } from '@/ir/types';
import { AWS_RESOURCES } from './aws';
import { AZURE_RESOURCES } from './azure';
import { GCP_RESOURCES } from './gcp';
import { CATEGORY_ORDER, type Category, type ResourceDef } from './types';

const registry = new Map<string, ResourceDef>();
for (const def of [...AWS_RESOURCES, ...AZURE_RESOURCES, ...GCP_RESOURCES]) {
  registry.set(def.type, def);
}

export function getDef(type: string): ResourceDef | undefined {
  return registry.get(type);
}

export function allDefs(): ResourceDef[] {
  return [...registry.values()];
}

export function isContainerType(type: string): boolean {
  return registry.get(type)?.container === true;
}

export function defsByProvider(provider: Provider): Array<{ category: Category; defs: ResourceDef[] }> {
  const defs = allDefs().filter((d) => d.provider === provider);
  return CATEGORY_ORDER.map((category) => ({
    category,
    defs: defs.filter((d) => d.category === category),
  })).filter((g) => g.defs.length > 0);
}
