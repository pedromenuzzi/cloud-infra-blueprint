import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToasts } from '@/components/Toast';
import { useEditor } from '@/features/editor/store';
import { createProject } from '@/lib/storage';
import { addRuleOps } from '@/security/edit';
import { getTemplate } from '@/templates';
import { DELTA_SETTLE_MS, editKind, startSecurityDelta } from './securityDelta';
import { useSecurityUi } from './securityStore';

// the seed project: an instance behind a web SG (HTTP + HTTPS), grade A
const SEED = getTemplate('aws-web-app')!.build('production-web');

function open(files: Record<string, string> = SEED) {
  useEditor.getState().load(createProject({ name: 'delta', files }));
}

/** SSH from anywhere on the web SG, as the rules editor adds it */
function addSsh() {
  const { ir } = useEditor.getState();
  const sg = ir.resources.find((r) => r.id === 'aws_security_group.web')!;
  const draft = { protocol: 'tcp' as const, fromPort: 22, toPort: 22, peers: [{ kind: 'any' as const, value: '0.0.0.0/0' }], description: 'SSH', action: 'allow' as const };
  useEditor.getState().applyCanvasOps(addRuleOps(ir, sg, 'inbound', draft));
}

const toasts = () => useToasts.getState().toasts.filter((t) => t.kind === 'warning');
const settle = () => vi.advanceTimersByTime(DELTA_SETTLE_MS + 10);

let stop: () => void = () => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0));
  useToasts.setState({ toasts: [] });
  open();
  stop = startSecurityDelta();
});

afterEach(() => {
  stop();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('security delta toast', () => {
  it('an edit that opens SSH to the internet: one toast with the grade change, a Show action and the undo hint', () => {
    addSsh();
    expect(toasts()).toEqual([]); // not before the edits settle
    settle();
    expect(toasts()).toHaveLength(1);
    const [t] = toasts();
    expect(t.message).toBe('Security grade A → C: SSH (22) is now open to the internet on aws_instance.web');
    expect(t.hint).toBe('Ctrl Z to undo');
    expect(t.action?.label).toBe('Show');

    // Show: select the resource, open the panel on the finding
    t.action!.onClick();
    expect(useEditor.getState().selection).toBe('aws_instance.web');
    expect(useSecurityUi.getState()).toMatchObject({ panelOpen: true, spotlight: expect.stringMatching(/^rule:aws_security_group\.web:ingress:/) });
  });

  it('never on load, undo or redo — and not for improvements', () => {
    addSsh();
    settle();
    expect(toasts()).toHaveLength(1);

    useEditor.getState().undo();
    settle();
    // redo brings the risk back: still not an edit
    useEditor.getState().redo();
    settle();
    expect(toasts()).toHaveLength(1);
    // nor is opening a project that is worse still
    open({ 'main.tf': `${useEditor.getState().files['main.tf']}\nresource "aws_s3_bucket" "logs" {\n  bucket = "logs"\n}\nresource "aws_db_instance" "public" {\n  engine              = "postgres"\n  instance_class      = "db.t3.micro"\n  publicly_accessible = true\n}\n` });
    settle();
    expect(toasts()).toHaveLength(1);

    // an improvement: encrypt the database
    useEditor.getState().applyCanvasOps([{ kind: 'set_arg', nodeId: 'aws_db_instance.main', field: 'storage_encrypted', value: { kind: 'literal', value: true } }]);
    settle();
    expect(toasts()).toHaveLength(1);
  });

  it('a burst of edits is judged once, against where it started', () => {
    addSsh();
    vi.advanceTimersByTime(DELTA_SETTLE_MS / 2);
    // a second worsening edit in the same burst
    useEditor.getState().applyCanvasOps([{ kind: 'set_arg', nodeId: 'aws_db_instance.main', field: 'publicly_accessible', value: { kind: 'literal', value: true } }]);
    settle();
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toMatch(/^Security grade A → [DF]: SSH \(22\)/);
  });

  it('an edit undone before it settles says nothing', () => {
    addSsh();
    useEditor.getState().undo();
    settle();
    expect(toasts()).toEqual([]);
  });

  it('code that parses counts as an edit', () => {
    const main = useEditor.getState().files['main.tf'];
    const typed = main.replace(
      '  egress {',
      '  ingress {\n    from_port   = 3389\n    to_port     = 3389\n    protocol    = "tcp"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n\n  egress {',
    );
    useEditor.getState().onCodeChange('main.tf', typed);
    vi.advanceTimersByTime(400); // the store's parse debounce
    settle();
    expect(toasts().map((t) => t.message)).toEqual(['Security grade A → C: RDP (3389) is now open to the internet on aws_instance.web']);
  });
});

describe('editKind', () => {
  it('tells edits from undo, redo and loads by the history the store keeps', () => {
    const s0 = useEditor.getState();
    addSsh();
    const s1 = useEditor.getState();
    expect(editKind(s0, s1)).toBe('edit');
    useEditor.getState().undo();
    const s2 = useEditor.getState();
    expect(editKind(s1, s2)).toBe('undo');
    useEditor.getState().redo();
    expect(editKind(s2, useEditor.getState())).toBe('redo');
    expect(editKind(s1, s1)).toBe('none');
    const before = useEditor.getState();
    open();
    expect(editKind(before, useEditor.getState())).toBe('load');
  });
});
