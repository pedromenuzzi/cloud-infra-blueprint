/**
 * Real-world round-trip, on a local Terraform corpus (never committed: it is
 * someone's infrastructure). Opt in with the corpus root:
 *
 *   TF_CORPUS=~/projects/terraform-avel pnpm exec vitest run src/hcl/corpus.test.ts
 *
 * On a sample of files that use `count` / `for_each`: they parse, their
 * repetition derives, and every canvas op touches only the lines it must —
 * a move its position comment; a rename the label, the references and the
 * `moved {}` block it writes; adding / removing repetition the argument, the
 * re-keyed references and the moved block.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repeatChange, renameOps } from '@/features/editor/repeatOps';
import { lit } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import { repeatOf } from '@/ir/repeat';
import type { IR, ResourceNode } from '@/ir/types';
import { parseProject } from './parser';
import { applyOpsWithPatches } from './patch';

const ROOT = process.env.TF_CORPUS;
const SAMPLE = Number(process.env.TF_CORPUS_SAMPLE ?? 300);
const REPEAT_RE = /^\s*(count|for_each)\s*=/m;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    // tool caches and working copies of the same files
    if (['.terraform', '.worktrees', '.claude', '.git', 'node_modules'].includes(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (name.endsWith('.tf')) out.push(path);
  }
}

function sample(): string[] {
  const all: string[] = [];
  walk(ROOT!, all);
  const repeated = all.filter((f) => REPEAT_RE.test(readFileSync(f, 'utf8'))).sort();
  const step = Math.max(1, Math.floor(repeated.length / SAMPLE));
  return repeated.filter((_, i) => i % step === 0).slice(0, SAMPLE);
}

/** lines in `b` that aren't in `a` (as a multiset) */
function added(a: string, b: string): string[] {
  const pool = new Map<string, number>();
  for (const l of a.split('\n')) pool.set(l, (pool.get(l) ?? 0) + 1);
  const out: string[] = [];
  for (const l of b.split('\n')) {
    const n = pool.get(l) ?? 0;
    if (n > 0) pool.set(l, n - 1);
    else out.push(l);
  }
  return out;
}

const MOVED_LINE = /^\s*(moved \{|from = .+|to {3}= .+|\}|)$/;
const errors = (files: Record<string, string>) => parseProject(files).diagnostics.filter((d) => d.severity === 'error').length;

function apply(files: Record<string, string>, ir: IR, ops: Op[]) {
  const out = applyOpsWithPatches(files, ir, ops);
  expect(out.refused?.message, 'the patch is applied').toBeUndefined();
  expect(errors(out.files), 'no new parse errors').toBeLessThanOrEqual(errors(files));
  return out.files['main.tf'];
}

describe.skipIf(!ROOT)('corpus: count / for_each round-trip', () => {
  const files = ROOT ? sample() : [];
  const stats = { files: 0, skipped: 0, resources: 0, count: 0, forEach: 0, known: 0, optional: 0, renames: 0, adds: 0, removes: 0 };

  it(`samples files that repeat (${files.length})`, () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const path of files) {
    it(relative(ROOT!, path), () => {
      const text = readFileSync(path, 'utf8');
      const project = { 'main.tf': text };
      const { ir, diagnostics } = parseProject(project);
      if (diagnostics.some((d) => d.severity === 'error') || ir.resources.length === 0) {
        stats.skipped++;
        return;
      }
      stats.files++;
      const byId = (id: string) => ir.resources.find((r) => r.id === id)!;
      const repeated: ResourceNode[] = [];
      const single: ResourceNode[] = [];
      for (const r of ir.resources) {
        stats.resources++;
        const rep = repeatOf(r, ir);
        if (!rep) {
          single.push(r);
          continue;
        }
        repeated.push(r);
        if (rep.kind === 'count') stats.count++;
        else stats.forEach++;
        if (rep.size !== undefined) stats.known++;
        if (rep.optional) stats.optional++;
      }

      // a move rewrites one comment line
      const first = ir.resources[0];
      const moved = apply(project, ir, [{ kind: 'move_node', nodeId: first.id, position: { x: 7, y: 9 } }]);
      expect(added(text, moved)).toEqual([expect.stringMatching(/@blueprint:pos=7,9/)]);
      expect(added(moved, text).every((l) => /@blueprint:pos=/.test(l))).toBe(true);

      // a rename (keeping the state): the label, the references, one moved block
      const target = repeated[0] ?? first;
      const newName = `${target.name}_renamed`;
      const to = `${target.type}.${newName}`;
      const renamed = apply(project, ir, renameOps(ir, target, newName, { keepState: true, isHistory: () => true }));
      stats.renames++;
      for (const l of added(text, renamed)) {
        expect(l.includes(to) || l.includes(`"${newName}"`) || MOVED_LINE.test(l), `rename added: ${l}`).toBe(true);
      }
      for (const l of added(renamed, text)) expect(l.includes(target.id) || l.includes(`"${target.name}"`), `rename removed: ${l}`).toBe(true);

      // adding count: the argument, [0] on the references, a moved block
      const plain = single.find((r) => !/^\s*(dynamic|lifecycle)/m.test(r.trivia.sourceText ?? ''));
      if (plain) {
        const c = repeatChange(ir, byId(plain.id), { kind: 'count', expr: lit(2) }, { keepState: true, isHistory: () => true });
        const counted = apply(project, ir, c.ops);
        stats.adds++;
        for (const l of added(text, counted)) {
          expect(/^\s*count = 2$/.test(l) || l.includes(`${plain.id}[0]`) || MOVED_LINE.test(l) || l.includes(plain.id), `count added: ${l}`).toBe(true);
        }
        for (const l of added(counted, text)) expect(l.includes(plain.id) || l.trim() === '', `count removed: ${l}`).toBe(true);
      }

      // removing repetition: the argument goes, instance keys go, a moved block
      if (repeated[0]) {
        const r = repeated[0];
        const c = repeatChange(ir, r, null, { keepState: true, isHistory: () => true });
        const single2 = apply(project, ir, c.ops);
        stats.removes++;
        for (const l of added(text, single2)) expect(l.includes(r.id) || MOVED_LINE.test(l), `remove added: ${l}`).toBe(true);
      }
    });
  }

  it('reports', () => {
    // numbers for whoever runs the corpus (TF_CORPUS_REPORT=path.json)
    if (process.env.TF_CORPUS_REPORT) writeFileSync(process.env.TF_CORPUS_REPORT, JSON.stringify(stats, null, 2));
    expect(stats.files + stats.skipped).toBe(files.length);
  });
});
