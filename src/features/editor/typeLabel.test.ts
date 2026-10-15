/**
 * Type labels outside the catalog: every resource and data source type of the
 * three providers' schemas, as the canvas names it, takes two lines of the
 * node header at most, with an ellipsis when it had to be cut.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHIP, fitTypeLabel, labelWidth, TEXT_COLUMN } from './typeLabel';

/**
 * The browser's greedy wrap: the first line beside the chip, the others as wide
 * as the column; a soft hyphen breaks there, with a hyphen. Null when a line
 * is wider than its room.
 */
function lines(label: string, chip: number): string[] | null {
  const [head, tail] = label.includes('­') ? label.split('­') : [undefined, label];
  const out = head === undefined ? [] : [`${head}-`];
  let line = '';
  for (const word of tail.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (labelWidth(candidate) <= (out.length === 0 ? TEXT_COLUMN - chip : TEXT_COLUMN)) line = candidate;
    else {
      out.push(line);
      line = word;
    }
  }
  out.push(line);
  return out.every((l, i) => labelWidth(l) <= (i === 0 ? TEXT_COLUMN - chip : TEXT_COLUMN)) ? out : null;
}

const SCHEMAS = [
  ['aws', 'aws'],
  ['azurerm', 'azure'],
  ['google', 'gcp'],
] as const;

describe('fitTypeLabel', () => {
  it('keeps a label that fits, and names a type by its words', () => {
    expect(fitTypeLabel('Security Group', CHIP.aws)).toBe('Security Group');
    expect(fitTypeLabel('Grupo de segurança', CHIP.aws)).toBe('Grupo de segurança');
    expect(fitTypeLabel('cloudwatch_metric_alarm', CHIP.aws)).toBe('cloudwatch metric alarm');
  });

  it('cuts what would take a third line, on the second', () => {
    const label = fitTypeLabel('s3_bucket_server_side_encryption_configuration', CHIP.aws);
    expect(label).toMatch(/^s3 bucket server side .+…$/);
    expect(lines(label, CHIP.aws)).toHaveLength(2);
  });

  it('hyphenates a first word too long to sit beside the chip', () => {
    const label = fitTypeLabel('networkfirewall_firewall_policy', CHIP.aws);
    expect(label).toMatch(/^networkfire\w*­\w+ firewall/);
    expect(label.replace('­', '')).toMatch(/^networkfirewall firewall/);
    expect(lines(label, CHIP.aws)).toHaveLength(2);
  });

  for (const [file, provider] of SCHEMAS) {
    it(`fits every ${provider} schema type in two lines`, () => {
      const problems: string[] = [];
      for (const kind of ['', '.data']) {
        const schema = JSON.parse(readFileSync(`src/schema/data/${file}${kind}.json`, 'utf8')) as { resources: object };
        for (const type of Object.keys(schema.resources)) {
          const chip = kind ? CHIP.data : CHIP[provider];
          const label = fitTypeLabel(type.replace(/^(aws|azurerm|google)_/, ''), chip);
          const wrapped = lines(label, chip);
          if (!wrapped || wrapped.length > 2) problems.push(`${type}: ${label}`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
