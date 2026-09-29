import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { useLocale } from '@/i18n/locale';
import { createProject } from '@/lib/storage';
import { alignBlocker } from './align';
import { ALIGN_ACTIONS } from './alignActions';
import { addSubnetOps, networkPlan, splitAcrossZonesOps } from './cidrPlan';
import { relocalizeEditorMessages, useEditor } from './store';

const MAIN = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.1.0.0/24"
}

resource "aws_instance" "x" {
  subnet_id = var.subnet
}
`;

beforeEach(() => {
  vi.useFakeTimers();
  useEditor.getState().load(createProject({ name: 'i18n', files: { 'main.tf': MAIN } }));
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  useLocale.getState().setLocale('en');
});

describe('editor messages follow the UI language', () => {
  it('re-produces the stored warnings in the new language, keeping the IR and undo history', () => {
    const before = useEditor.getState();
    expect(before.warnings.map((w) => w.message)).toEqual(["aws_subnet.a: cidr_block 10.1.0.0/24 is outside aws_vpc.main's range (10.0.0.0/16)"]);
    useEditor.getState().applyCanvasOps([{ kind: 'move_node', nodeId: 'aws_instance.x', position: { x: 40, y: 40 } }]);
    const { ir, files, past } = useEditor.getState();

    useLocale.getState().setLocale('pt-BR');
    relocalizeEditorMessages();
    const after = useEditor.getState();
    expect(after.warnings.map((w) => w.message)).toEqual([
      'aws_subnet.a: cidr_block 10.1.0.0/24 está fora do intervalo de aws_vpc.main (10.0.0.0/16)',
    ]);
    expect(after.warnings[0].start).toEqual(before.warnings[0].start);
    expect(after.ir).toBe(ir);
    expect(after.files).toBe(files);
    expect(after.past).toBe(past);
  });

  it('does it on its own when the language changes (no inspector needed)', () => {
    const { ir, past } = useEditor.getState();
    useLocale.getState().setLocale('pt-BR');
    expect(useEditor.getState().warnings.map((w) => w.message)).toEqual([
      'aws_subnet.a: cidr_block 10.1.0.0/24 está fora do intervalo de aws_vpc.main (10.0.0.0/16)',
    ]);
    expect(useEditor.getState().ir).toBe(ir);
    expect(useEditor.getState().past).toBe(past);
  });

  it('re-produces parse errors too', () => {
    useEditor.getState().onCodeChange('main.tf', `${MAIN}resource "aws_vpc" "b" {\n`);
    vi.advanceTimersByTime(400);
    expect(useEditor.getState().parseDiagnostics.map((d) => d.message)).toEqual(['Missing "}" to close this "resource" block']);
    useLocale.getState().setLocale('pt-BR');
    relocalizeEditorMessages();
    expect(useEditor.getState().parseDiagnostics.map((d) => d.message)).toEqual(['Falta "}" para fechar este bloco "resource"']);
    expect(useEditor.getState().codeErrored).toBe(true);
  });

  it('align labels and blockers', () => {
    const { ir } = useEditor.getState();
    expect(ALIGN_ACTIONS[0].label).toBe('Align left');
    expect(alignBlocker(ir, ['aws_instance.x'])).toBe('Select at least 2 resources');
    useLocale.getState().setLocale('pt-BR');
    expect(ALIGN_ACTIONS.map((a) => a.label)).toEqual([
      'Alinhar à esquerda',
      'Centralizar na horizontal',
      'Alinhar à direita',
      'Alinhar ao topo',
      'Centralizar na vertical',
      'Alinhar à base',
      'Distribuir na horizontal',
      'Distribuir na vertical',
    ]);
    expect(alignBlocker(ir, ['aws_instance.x'])).toBe('Selecione pelo menos 2 recursos');
  });

  it('planner errors and row labels', () => {
    const { ir } = useEditor.getState();
    useLocale.getState().setLocale('pt-BR');
    expect(splitAcrossZonesOps(ir, 'aws_vpc.main', 24, 3)).toEqual({
      error: 'Defina a região do provider AWS para espalhar as sub-redes entre as zonas dela',
    });
    expect(addSubnetOps(ir, 'aws_vpc.nope', 24)).toEqual({ error: 'aws_vpc.nope não é uma rede que o planejador conheça' });
    expect(networkPlan(ir, 'aws_vpc.main')!.rows[0].label).toBe('10.1.0.0/24');
    const half = parseProject({ 'main.tf': MAIN.replace('10.1.0.0/24', '10.0.0.0/17') }).ir;
    expect(addSubnetOps(half, 'aws_vpc.main', 16)).toEqual({ error: 'Não há mais espaço para uma /16 em aws_vpc.main' });
    const unset = parseProject({ 'main.tf': MAIN.replace('  cidr_block = "10.1.0.0/24"\n', '') }).ir;
    expect(networkPlan(unset, 'aws_vpc.main')!.rows[0].label).toBe('sem intervalo');
  });
});
