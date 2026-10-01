import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { repeatOf } from '@/ir/repeat';
import { repeatLabel } from './repeatLabel';

const label = (meta: string, locale: 'en' | 'pt-BR' = 'en') => {
  const { ir } = parseProject({ 'main.tf': `resource "aws_instance" "web" {\n  ${meta}\n}\n` });
  return repeatLabel(repeatOf(ir.resources[0], ir)!, locale);
};

describe('repeat labels', () => {
  it('say how many, or why it is not known', () => {
    expect(label('count = 3')).toMatchObject({ text: '×3', aria: '3 instances', stack: true });
    expect(label('count = 3').title).toBe('count = 3 · 3 instances');
    expect(label('count = 1')).toMatchObject({ text: '×1', stack: false });
    expect(label('count = var.on ? 1 : 0')).toMatchObject({ text: '×0–1', aria: 'optional', stack: false });
    expect(label('count = local.n')).toMatchObject({ text: '×?', aria: 'repeated', stack: true });
    expect(label('for_each = toset(["a", "b"])')).toMatchObject({ text: '×2', title: 'for_each = toset(["a", "b"]) · 2 instances · Keys: a, b' });
    expect(label('for_each = var.availability_zones_for_the_app')).toMatchObject({ text: 'for_each: var.availability_zone…' });
  });

  it('in Portuguese — the badge itself is code and reads the same', () => {
    expect(label('count = 3', 'pt-BR')).toMatchObject({ text: '×3', aria: '3 instâncias', title: 'count = 3 · 3 instâncias' });
    expect(label('count = var.on ? 1 : 0', 'pt-BR').title).toBe('count = var.on ? 1 : 0 · 0 ou 1 instância, criada só quando a condição vale');
  });
});
