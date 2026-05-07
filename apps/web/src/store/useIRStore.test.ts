import { lit, newResource } from '@blueprint/ir';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useIRStore } from './useIRStore';

/**
 * Behavioural tests for the IR store's undo/redo. Mirrors the invariants
 * verified by `packages/ir/src/invert.test.ts` but exercises the actual
 * Zustand wiring so the canvas/inspector contract is also tested.
 */
describe('useIRStore — undo/redo', () => {
  beforeEach(() => {
    useIRStore.getState().reset();
  });
  afterEach(() => {
    useIRStore.getState().reset();
  });

  it('starts empty with both stacks empty', () => {
    const s = useIRStore.getState();
    expect(s.ir.resources).toHaveLength(0);
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });

  it('apply pushes an inverse onto past and clears future', () => {
    const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });
    useIRStore.getState().apply([{ kind: 'add_resource', node: ec2 }]);
    const s = useIRStore.getState();
    expect(s.ir.resources).toHaveLength(1);
    expect(s.canUndo()).toBe(true);
    expect(s.canRedo()).toBe(false);
  });

  it('undo restores previous state and enables redo', () => {
    const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });
    const store = useIRStore;
    store.getState().apply([{ kind: 'add_resource', node: ec2 }]);
    store.getState().undo();
    expect(store.getState().ir.resources).toHaveLength(0);
    expect(store.getState().canUndo()).toBe(false);
    expect(store.getState().canRedo()).toBe(true);
  });

  it('redo re-applies the undone batch', () => {
    const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });
    const store = useIRStore;
    store.getState().apply([{ kind: 'add_resource', node: ec2 }]);
    store.getState().undo();
    store.getState().redo();
    expect(store.getState().ir.resources).toHaveLength(1);
    expect(store.getState().ir.resources[0]!.id).toBe(ec2.id);
  });

  it('apply after undo discards the redo stack (text-editor semantics)', () => {
    const a = newResource('aws_instance', 'a', {});
    const b = newResource('aws_instance', 'b', {});
    const store = useIRStore;
    store.getState().apply([{ kind: 'add_resource', node: a }]);
    store.getState().undo();
    expect(store.getState().canRedo()).toBe(true);
    store.getState().apply([{ kind: 'add_resource', node: b }]);
    expect(store.getState().canRedo()).toBe(false);
    expect(store.getState().ir.resources).toHaveLength(1);
    expect(store.getState().ir.resources[0]!.name).toBe('b');
  });

  it('chains multiple undos in reverse order', () => {
    const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });
    const store = useIRStore;
    store.getState().apply([{ kind: 'add_resource', node: ec2 }]);
    store.getState().apply([
      {
        kind: 'set_arg',
        nodeId: ec2.id,
        field: 'instance_type',
        value: lit('t3.large'),
      },
    ]);
    store.getState().apply([{ kind: 'rename_resource', nodeId: ec2.id, newName: 'web2' }]);

    store.getState().undo(); // un-rename
    expect(store.getState().ir.resources[0]!.name).toBe('web');

    store.getState().undo(); // revert instance_type
    expect(store.getState().ir.resources[0]!.args.instance_type).toEqual(lit('t3.micro'));

    store.getState().undo(); // remove resource
    expect(store.getState().ir.resources).toHaveLength(0);
  });

  it('setIR clears history', () => {
    const ec2 = newResource('aws_instance', 'web', {});
    useIRStore.getState().apply([{ kind: 'add_resource', node: ec2 }]);
    useIRStore.getState().setIR({
      version: 1,
      providers: {},
      variables: {},
      outputs: {},
      modules: [],
      resources: [],
      edges: [],
    });
    const s = useIRStore.getState();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });

  it('apply with empty ops list is a no-op', () => {
    useIRStore.getState().apply([]);
    expect(useIRStore.getState().canUndo()).toBe(false);
  });
});
