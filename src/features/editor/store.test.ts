import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToasts } from '@/components/Toast';
import { createProject } from '@/lib/storage';
import { useEditor } from './store';

const MAIN = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
`;

// storage falls back to memory outside the browser
function load(files: Record<string, string> = { 'main.tf': MAIN }) {
  useEditor.getState().load(createProject({ name: 'test', files }));
}

const move = { kind: 'move_node' as const, nodeId: 'aws_vpc.main', position: { x: 120, y: 80, w: 400, h: 300 } };

beforeEach(() => {
  vi.useFakeTimers();
  useToasts.setState({ toasts: [] });
  load();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('editor store', () => {
  it('refuses canvas ops while the code has errors, leaving the text alone', () => {
    const broken = `@@@ oops\n${MAIN}`;
    useEditor.getState().onCodeChange('main.tf', broken);
    vi.advanceTimersByTime(400);
    expect(useEditor.getState().codeErrored).toBe(true);

    useEditor.getState().applyCanvasOps([move]);
    expect(useEditor.getState().files['main.tf']).toBe(broken);
    expect(useToasts.getState().toasts.at(-1)?.message).toMatch(/Fix the errors in the code first/);
  });

  it('parses pending typing before a canvas op instead of patching stale ranges', () => {
    // typed but not parsed yet: the IR still has the old block ranges
    useEditor.getState().onCodeChange('main.tf', `# header\n${MAIN}`);
    useEditor.getState().applyCanvasOps([move]);
    const text = useEditor.getState().files['main.tf'];
    expect(text).toContain('# header');
    expect(text).toContain('@blueprint:pos=120,80');
    expect(text).toMatch(/resource "aws_vpc" "main" \{\n\s+cidr_block\s+= "10.0.0.0\/16"\n\}/);
  });

  it('undo reverts a code edit, and a canvas edit, one step each', () => {
    const typed = `${MAIN}resource "aws_sqs_queue" "jobs" {\n}\n`;
    useEditor.getState().onCodeChange('main.tf', typed);
    vi.advanceTimersByTime(400);
    useEditor.getState().applyCanvasOps([move]);
    expect(useEditor.getState().past).toHaveLength(2);

    useEditor.getState().undo();
    expect(useEditor.getState().files['main.tf']).toBe(typed);
    useEditor.getState().undo();
    expect(useEditor.getState().files['main.tf']).toBe(MAIN);
    expect(useEditor.getState().ir.resources.map((r) => r.id)).toEqual(['aws_vpc.main']);

    useEditor.getState().redo();
    expect(useEditor.getState().files['main.tf']).toBe(typed);
  });

  it('undo right after typing (before the parse) returns to the text before it', () => {
    useEditor.getState().onCodeChange('main.tf', `${MAIN}# half-typed`);
    expect(useEditor.getState().past).toHaveLength(1);
    useEditor.getState().undo();
    vi.advanceTimersByTime(400);
    expect(useEditor.getState().files['main.tf']).toBe(MAIN);
  });

  it('a burst of typing is one undo step, even across parse errors', () => {
    useEditor.getState().onCodeChange('main.tf', `${MAIN}resource "aws_sqs_queue" "q" {`);
    vi.advanceTimersByTime(400); // errored: the burst goes on
    useEditor.getState().onCodeChange('main.tf', `${MAIN}resource "aws_sqs_queue" "q" {\n}\n`);
    vi.advanceTimersByTime(400);
    expect(useEditor.getState().past).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().files['main.tf']).toBe(MAIN);
  });
});
