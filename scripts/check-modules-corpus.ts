/**
 * Check module support against a Terraform codebase on disk:
 *
 *   pnpm exec vite-node scripts/check-modules-corpus.ts <dir> [--max=N]
 *
 * Every folder with `module` blocks is read as a root module. For each module
 * call it checks that the parse is clean and that canvas edits patch only
 * what they change: a move touches one line, editing a literal input one
 * value, a rename the label + references (+ a `moved` block), a delete the
 * block alone. Prints a summary; exits 1 when a check fails.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseProject } from '@/hcl/parser';
import { applyOpsWithPatches } from '@/hcl/patch';
import { lit } from '@/ir/expr';
import { moduleInputs, moduleSourceInfo } from '@/ir/modules';
import type { Op } from '@/ir/ops';

const root = process.argv[2];
const max = Number(/--max=(\d+)/.exec(process.argv.join(' '))?.[1] ?? Infinity);
if (!root) {
  process.stderr.write('usage: check-modules-corpus.ts <dir> [--max=N]\n');
  process.exit(2);
}

const SKIP = /^(\.terraform|\.git|node_modules|\.claude)$/;
const dirs: string[] = [];
const walk = (dir: string) => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  if (entries.some((e) => e.endsWith('.tf'))) dirs.push(dir);
  for (const e of entries) {
    if (SKIP.test(e)) continue;
    const p = join(dir, e);
    try {
      if (statSync(p).isDirectory()) walk(p);
    } catch {
      /* unreadable */
    }
  }
};
walk(root);

const stats = { projects: 0, modules: 0, kinds: {} as Record<string, number>, checks: 0, failures: 0, parseErrors: 0 };
const fail = (where: string, what: string) => {
  stats.failures++;
  if (stats.failures <= 40) process.stdout.write(`FAIL ${where}: ${what}\n`);
};

/** lines of `after` not in `before` (and vice versa), as a multiset diff count */
function lineDiff(before: string, after: string): { added: string[]; removed: string[] } {
  const a = before.split('\n');
  const b = after.split('\n');
  const count = new Map<string, number>();
  for (const l of a) count.set(l, (count.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of b) {
    const n = count.get(l) ?? 0;
    if (n > 0) count.set(l, n - 1);
    else added.push(l);
  }
  const removed = [...count.entries()].flatMap(([l, n]) => Array(n).fill(l) as string[]);
  return { added, removed };
}

for (const dir of dirs) {
  if (stats.projects >= max) break;
  const files: Record<string, string> = {};
  for (const e of readdirSync(dir)) if (e.endsWith('.tf')) files[e] = readFileSync(join(dir, e), 'utf8');
  if (!Object.values(files).some((t) => /^\s*module\s+"/m.test(t))) continue;
  stats.projects++;
  const where = relative(root, dir) || '.';
  const { ir, diagnostics } = parseProject(files);
  if (diagnostics.some((d) => d.severity === 'error')) {
    stats.parseErrors++;
    continue;
  }
  const declared = Object.values(files).reduce((n, t) => n + (t.match(/^module\s+"/gm)?.length ?? 0), 0);
  if (ir.modules.length !== declared) fail(where, `${declared} module blocks, ${ir.modules.length} parsed`);
  for (const m of ir.modules) {
    stats.modules++;
    const kind = moduleSourceInfo(m)?.kind ?? 'no-source';
    stats.kinds[kind] = (stats.kinds[kind] ?? 0) + 1;
    const file = m.trivia.sourceFile!;
    const check = (label: string, ops: Op[], expect: (before: string, after: string) => string | null) => {
      stats.checks++;
      const out = applyOpsWithPatches(files, ir, ops);
      if (out.refused) return fail(`${where} ${m.id}`, `${label} refused: ${out.refused.message}`);
      if (out.diagnostics.some((d) => d.severity === 'error')) return fail(`${where} ${m.id}`, `${label} broke the parse`);
      for (const [f, text] of Object.entries(files)) {
        if (f !== file && out.files[f] !== text && label !== 'rename') fail(`${where} ${m.id}`, `${label} touched ${f}`);
      }
      const problem = expect(files[file], out.files[file]);
      if (problem) fail(`${where} ${m.id}`, `${label}: ${problem}`);
    };
    check('move', [{ kind: 'move_node', nodeId: m.id, position: { x: 12345, y: 678 } }], (before, after) => {
      const d = lineDiff(before, after);
      return d.added.length === 1 && d.added[0].trim() === '# @blueprint:pos=12345,678' && d.removed.length <= 1
        ? null
        : `diff +${d.added.length} -${d.removed.length}`;
    });
    const literal = moduleInputs(m).find(([, e]) => e.kind === 'literal' && typeof e.value === 'string');
    if (literal) {
      check('set input', [{ kind: 'set_arg', nodeId: m.id, field: literal[0], value: lit('corpus-check') }], (before, after) => {
        const d = lineDiff(before, after);
        return d.added.length === 1 && d.removed.length === 1 && d.added[0].includes('"corpus-check"') ? null : `diff +${d.added.length} -${d.removed.length}`;
      });
    }
    check('rename', [{ kind: 'rename_resource', nodeId: m.id, newName: `${m.name}_renamed` }], (_before, after) => {
      if (!after.includes(`module "${m.name}_renamed"`)) return 'label not renamed';
      if (!after.includes(`to   = module.${m.name}_renamed`)) return 'no moved block';
      return null;
    });
    check('delete', [{ kind: 'remove_resource', nodeId: m.id }], (before, after) => {
      const d = lineDiff(before, after);
      if (d.added.some((l) => l.trim() !== '')) return `added ${JSON.stringify(d.added.slice(0, 2))}`;
      return after.includes(`module "${m.name}"`) ? 'still there' : null;
    });
  }
}

process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
process.exit(stats.failures > 0 ? 1 : 0);
