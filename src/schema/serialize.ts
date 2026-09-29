import type { SchemaData } from './types';

/**
 * Stable JSON for a schema file: one resource and one block per line, so a
 * provider bump reviews as a readable diff (the bundle re-minifies it anyway).
 */
export function serializeSchema(data: SchemaData): string {
  const lines: string[] = ['{'];
  lines.push(`  "format": ${JSON.stringify(data.format)},`);
  lines.push(`  "provider": ${JSON.stringify(data.provider)},`);
  lines.push(`  "version": ${JSON.stringify(data.version)},`);
  const record = (name: string, entries: Record<string, unknown>) => {
    const keys = Object.keys(entries);
    lines.push(`  ${JSON.stringify(name)}: {`);
    keys.forEach((k, i) => lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(entries[k])}${i < keys.length - 1 ? ',' : ''}`));
    lines.push('  },');
  };
  record('resources', data.resources);
  if (data.deprecatedResources) record('deprecatedResources', data.deprecatedResources);
  lines.push('  "blocks": [');
  data.blocks.forEach((b, i) => lines.push(`    ${JSON.stringify(b)}${i < data.blocks.length - 1 ? ',' : ''}`));
  lines.push('  ]');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
