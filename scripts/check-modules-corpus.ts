/**
 * Check module support against a Terraform codebase on disk:
 *
 *   pnpm exec vite-node scripts/check-modules-corpus.ts <dir> [--max=N]
 *
 * Every folder with `module` blocks is read as a root module. For each module
 * call it checks that the parse is clean and that canvas edits patch only
 * what they change: a move touches one line, editing a literal input one
 * value, a rename the label + references (+ a `moved` block), a delete the
 * block alone.
 *
 * Then, for the local modules those roots call (read like an import reads
 * them: `../../modules/x` stored at `modules/x`), what the editor does
 * inside an opened module: the same four edits patched through the scope
 * (only the module's own file changes; a rename's `moved` block is in
 * module-relative addresses, inside the module), the cost estimate and the
 * security audit of every call (no crash), and a Terraform zip that keeps
 * the nesting and imports back to the same project. Prints a summary;
 * exits 1 when a check fails.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { estimateWithModules } from '@/cost/modules';
import { PRICE_BOOK } from '@/cost/prices/prices';
import { renameOps } from '@/features/editor/repeatOps';
import { applyOpsInScope, parseFolder } from '@/features/modules/scopedPatch';
import { parseProject } from '@/hcl/parser';
import { applyOpsWithPatches } from '@/hcl/patch';
import { lit } from '@/ir/expr';
import { flattenInstances, moduleInstances } from '@/ir/moduleInstance';
import { moduleInputs, moduleSourceInfo, resolveModuleDir } from '@/ir/modules';
import { moduleMoveOps } from '@/ir/moduleMoved';
import type { Op } from '@/ir/ops';
import type { IR, ResourceNode } from '@/ir/types';
import { assembleProject, localModuleSources, pickRootDir } from '@/lib/importTf';
import { zipLayout } from '@/lib/zipLayout';
import { auditModules } from '@/security/modules';

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
    const renameOps: Op[] = [
      { kind: 'rename_resource', nodeId: m.id, newName: `${m.name}_renamed` },
      ...moduleMoveOps(ir, m.id, `module.${m.name}_renamed`),
    ];
    check('rename', renameOps, (_before, after) => {
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

// ------------------------------------------------------------ inside local modules

const inside = { projects: 0, calls: 0, folders: 0, edits: 0, priced: 0, findings: 0, zips: 0, failures: 0 };
const failInside = (where: string, what: string) => {
  inside.failures++;
  stats.failures++;
  if (inside.failures <= 40) process.stdout.write(`FAIL ${where}: ${what}\n`);
};

const tfIn = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  try {
    for (const e of readdirSync(dir)) if (e.endsWith('.tf')) out[e] = readFileSync(join(dir, e), 'utf8');
  } catch {
    /* unreadable */
  }
  return out;
};

/** the project an import of `dir` makes: its files flat, the local modules it calls in their stored folders */
function projectOf(dir: string): Record<string, string> {
  const files: Record<string, string> = { ...tfIn(dir) };
  const queue: Array<{ real: string; stored: string }> = [{ real: dir, stored: '' }];
  const seen = new Set([dir]);
  while (queue.length > 0) {
    const { real, stored } = queue.shift()!;
    const texts = Object.values(stored === '' ? tfIn(real) : tfIn(real));
    for (const text of texts) {
      for (const source of localModuleSources(text)) {
        const target = resolve(real, source);
        const at = resolveModuleDir(stored, source);
        if (seen.has(target) || at === '' || !existsSync(target)) continue;
        seen.add(target);
        for (const [name, t] of Object.entries(tfIn(target))) files[`${at}/${name}`] = t;
        queue.push({ real: target, stored: at });
      }
    }
  }
  return files;
}

const checkedFolders = new Set<string>();

/** the four edits inside an opened module, through the scope: only the module's own file changes */
function checkFolder(files: Record<string, string>, dir: string, where: string) {
  const parsed = parseFolder(files, dir);
  if (!parsed || parsed.diagnostics.some((d) => d.severity === 'error')) return;
  inside.folders++;
  // every resource of the module (at most 40), each edit on its own
  for (const r of parsed.ir.resources.slice(0, 40)) checkResource(files, dir, parsed.ir, r, where);
}

function checkResource(files: Record<string, string>, dir: string, ir: IR, r: ResourceNode, where: string) {
  const file = r.trivia.sourceFile!;
  const edit = (label: string, ops: Op[], expect: (before: string, after: string) => string | null) => {
    inside.edits++;
    const out = applyOpsInScope(files, dir, ir, ops);
    if (!out.ok) return failInside(`${where} ${dir} ${r.id}`, `${label} refused: ${out.message ?? ''}`);
    for (const [f, text] of Object.entries(files)) {
      if (f !== file && out.files[f] !== text && !(label === 'rename' && f.startsWith(`${dir}/`))) {
        failInside(`${where} ${dir} ${r.id}`, `${label} touched ${f}`);
      }
    }
    const problem = expect(files[file], out.files[file]);
    if (problem) failInside(`${where} ${dir} ${r.id}`, `${label}: ${problem}`);
  };
  edit('move', [{ kind: 'move_node', nodeId: r.id, position: { x: 4321, y: 87 } }], (before, after) => {
    const d = lineDiff(before, after);
    return d.added.length === 1 && d.added[0].trim() === '# @blueprint:pos=4321,87' && d.removed.length <= 1 ? null : `diff +${d.added.length} -${d.removed.length}`;
  });
  const literal = Object.entries(r.args).find(([, e]) => e.kind === 'literal' && typeof e.value === 'string');
  if (literal) {
    edit('set arg', [{ kind: 'set_arg', nodeId: r.id, field: literal[0], value: lit('corpus-check') }], (before, after) => {
      const d = lineDiff(before, after);
      return d.added.length === 1 && d.removed.length === 1 && d.added[0].includes('"corpus-check"') ? null : `diff +${d.added.length} -${d.removed.length}`;
    });
  }
  edit('rename', renameOps(ir, r, `${r.name}_renamed`, { keepState: true }), (_before, after) => {
    if (!after.includes(`resource "${r.type}" "${r.name}_renamed"`)) return 'label not renamed';
    if (!after.includes(`moved {\n  from = ${r.id}\n  to   = ${r.type}.${r.name}_renamed\n}`)) return 'no module-relative moved block';
    return null;
  });
  edit('delete', [{ kind: 'remove_resource', nodeId: r.id }], (before, after) => {
    const d = lineDiff(before, after);
    if (d.added.some((l) => l.trim() !== '')) return `added ${JSON.stringify(d.added.slice(0, 2))}`;
    return after.includes(`resource "${r.type}" "${r.name}"`) ? 'still there' : null;
  });
}

for (const dir of dirs) {
  if (inside.projects >= max) break;
  const own = tfIn(dir);
  if (!Object.values(own).some((t) => localModuleSources(t).length > 0)) continue;
  // a module folder isn't a root of its own
  if (/(^|\/)modules(\/|$)/.test(relative(root, dir))) continue;
  const files = projectOf(dir);
  if (Object.keys(files).every((f) => !f.includes('/'))) continue;
  const where = relative(root, dir) || '.';
  const { ir, diagnostics } = parseProject(files);
  if (diagnostics.some((d) => d.severity === 'error')) continue;
  inside.projects++;
  try {
    const calls = flattenInstances(moduleInstances(ir, files));
    inside.calls += calls.length;
    const cost = estimateWithModules(ir, files, PRICE_BOOK, 'en');
    inside.priced += cost.counts.fixed;
    inside.findings += auditModules(ir, files, 'en').findings.length;
    auditModules(ir, files, 'pt-BR');
    for (const m of calls) {
      if (checkedFolders.has(m.dir)) continue;
      checkedFolders.add(m.dir);
      checkFolder(files, m.dir, where);
    }
  } catch (err) {
    failInside(where, `analysis crashed: ${(err as Error).stack ?? err}`);
  }
  // the zip keeps the nesting, and imports back to the same project
  inside.zips++;
  const layout = zipLayout(files, { rootPath: relative(root, dir), name: where });
  const sources = Object.entries(layout.entries).map(([path, text]) => ({ path, text }));
  const back = assembleProject(sources, pickRootDir(sources)).files;
  const same = Object.keys(files).length === Object.keys(back).length && Object.entries(files).every(([f, t]) => back[f] === t);
  if (!same) failInside(where, `zip round trip: ${Object.keys(files).length} files, ${Object.keys(back).length} back (root ${layout.root || '.'})`);
}

process.stdout.write(`${JSON.stringify({ ...stats, inside }, null, 2)}\n`);
process.exit(stats.failures > 0 ? 1 : 0);
