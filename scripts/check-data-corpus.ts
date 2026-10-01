/**
 * Check data source support against a Terraform codebase on disk:
 *
 *   pnpm exec vite-node scripts/check-data-corpus.ts <dir> [--max=N] [--ignore-pins]
 *
 * Every folder with `data` blocks is read as a root module (its child
 * modules are folders of their own, read the same way). For each data block
 * it checks that the parse is clean and that canvas edits patch only what
 * they change: a move touches its position line, editing a literal argument
 * one value, a rename the label and the `data.type.name` references (no
 * `moved` block), a delete the block alone. It also runs validation with the
 * shipped provider schemas loaded and lists the data source warnings it
 * raises (to spot false positives). Prints a summary (data source types, how
 * they are read, the warnings); exits 1 when a check fails.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProject } from '@/hcl/parser';
import { applyOpsWithPatches } from '@/hcl/patch';
import { dataEdges, dataReferrers } from '@/ir/dataSources';
import { lit, renameInHcl } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import { dataAddress } from '@/ir/types';
import { validateProject } from '@/ir/validate';
import { auditSecurity } from '@/security/audit';
import { getDef } from '@/resources/registry';
import { registerSchema } from '@/schema/store';
import type { SchemaData } from '@/schema/types';

// every shipped schema, resources and data sources, as the editor has them once loaded
const SCHEMAS = fileURLToPath(new URL('../src/schema/data', import.meta.url));
for (const f of readdirSync(SCHEMAS)) registerSchema(JSON.parse(readFileSync(join(SCHEMAS, f), 'utf8')) as SchemaData);
const DATA_WARNING = /data source|data\.[\w-]+\.[\w-]+/;

const root = process.argv[2];
const max = Number(/--max=(\d+)/.exec(process.argv.join(' '))?.[1] ?? Infinity);
/** validate as if no `required_providers` pinned another version (schema warnings are off otherwise) */
const ignorePins = process.argv.includes('--ignore-pins');
if (!root) {
  process.stderr.write('usage: check-data-corpus.ts <dir> [--max=N]\n');
  process.exit(2);
}

const SKIP = /^(\.terraform|\.git|node_modules|\.claude|\.worktrees)$/;
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

const stats = {
  folders: 0,
  dataBlocks: 0,
  types: {} as Record<string, number>,
  readBy: { canvasEdge: 0, onlyLocalsOrOutputs: 0, unread: 0 },
  checks: 0,
  failures: 0,
  parseErrors: 0,
  /** data source warnings validation raises, by kind (addresses and names left out) */
  warnings: {} as Record<string, number>,
  /** IAM policy documents the security audit flags for "*" on "*" */
  iamAdmin: 0,
};
const shownWarnings: string[] = [];
const fail = (where: string, what: string) => {
  stats.failures++;
  if (stats.failures <= 40) process.stdout.write(`FAIL ${where}: ${what}\n`);
};

/** lines of `after` not in `before` (and vice versa), as a multiset diff */
function lineDiff(before: string, after: string): { added: string[]; removed: string[] } {
  const count = new Map<string, number>();
  for (const l of before.split('\n')) count.set(l, (count.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of after.split('\n')) {
    const n = count.get(l) ?? 0;
    if (n > 0) count.set(l, n - 1);
    else added.push(l);
  }
  const removed = [...count.entries()].flatMap(([l, n]) => Array(n).fill(l) as string[]);
  return { added, removed };
}

for (const dir of dirs) {
  if (stats.folders >= max) break;
  const files: Record<string, string> = {};
  for (const e of readdirSync(dir)) if (e.endsWith('.tf')) files[e] = readFileSync(join(dir, e), 'utf8');
  if (!Object.values(files).some((t) => /^\s*data\s+"/m.test(t))) continue;
  stats.folders++;
  const where = relative(root, dir) || '.';
  const { ir, diagnostics } = parseProject(files);
  if (diagnostics.some((d) => d.severity === 'error')) {
    stats.parseErrors++;
    continue;
  }
  const declared = Object.values(files).reduce((n, t) => n + (t.match(/^data\s+"/gm)?.length ?? 0), 0);
  if (ir.data.length !== declared) fail(where, `${declared} data blocks, ${ir.data.length} parsed`);
  const unchanged = applyOpsWithPatches(files, ir, []);
  for (const [f, text] of Object.entries(files)) if (unchanged.files[f] !== text) fail(where, `round-trip changed ${f}`);
  const checked = ignorePins
    ? parseProject(Object.fromEntries(Object.entries(files).map(([f, t]) => [f, t.replace(/version\s*=\s*"[^"]*"/g, 'version = ">= 0"')]))).ir
    : ir;
  for (const w of validateProject(checked, getDef)) {
    if (!DATA_WARNING.test(w.message)) continue;
    const kind = w.message.replace(/^[^:]+: /, '').replace(/"[^"]*"/g, '"…"').replace(/data\.[\w.[\]"-]+/g, 'data.…');
    stats.warnings[kind] = (stats.warnings[kind] ?? 0) + 1;
    if (shownWarnings.length < 40) shownWarnings.push(`${where}: ${w.message}`);
  }
  // IAM policy documents granting "*" on "*" (src/security/iamDocuments.ts)
  for (const f of auditSecurity(ir).findings) {
    if (!f.id.startsWith('iam-admin:')) continue;
    stats.iamAdmin++;
    if (shownWarnings.length < 40) shownWarnings.push(`${where}: ${f.title} (${f.resource})`);
  }
  const edges = dataEdges(ir);
  for (const d of ir.data) {
    stats.dataBlocks++;
    stats.types[d.type] = (stats.types[d.type] ?? 0) + 1;
    const readers = dataReferrers(ir, d.id);
    if (edges.some((e) => e.target === d.id)) stats.readBy.canvasEdge++;
    else if (readers.length > 0) stats.readBy.onlyLocalsOrOutputs++;
    else stats.readBy.unread++;

    const file = d.trivia.sourceFile!;
    const check = (label: string, ops: Op[], expect: (out: Record<string, string>) => string | null) => {
      stats.checks++;
      const out = applyOpsWithPatches(files, ir, ops);
      if (out.refused) return fail(`${where} ${d.id}`, `${label} refused: ${out.refused.message}`);
      if (out.diagnostics.some((x) => x.severity === 'error')) return fail(`${where} ${d.id}`, `${label} broke the parse`);
      if (label !== 'rename') {
        for (const [f, text] of Object.entries(files)) if (f !== file && out.files[f] !== text) fail(`${where} ${d.id}`, `${label} touched ${f}`);
      }
      const problem = expect(out.files);
      if (problem) fail(`${where} ${d.id}`, `${label}: ${problem}`);
    };
    check('move', [{ kind: 'move_node', nodeId: d.id, position: { x: 12345, y: 678 } }], (out) => {
      const diff = lineDiff(files[file], out[file]);
      return diff.added.length === 1 && diff.added[0].trim() === '# @blueprint:pos=12345,678' && diff.removed.length <= 1
        ? null
        : `diff +${diff.added.length} -${diff.removed.length}`;
    });
    const literal = Object.entries(d.args).find(([, e]) => e.kind === 'literal' && typeof e.value === 'string');
    if (literal) {
      check('set arg', [{ kind: 'set_arg', nodeId: d.id, field: literal[0], value: lit('corpus-check') }], (out) => {
        const diff = lineDiff(files[file], out[file]);
        return diff.added.length === 1 && diff.removed.length === 1 && diff.added[0].includes('"corpus-check"')
          ? null
          : `diff +${diff.added.length} -${diff.removed.length}`;
      });
    }
    const to = dataAddress(d.type, `${d.name}_renamed`);
    check('rename', [{ kind: 'rename_resource', nodeId: d.id, newName: `${d.name}_renamed` }], (out) => {
      for (const [f, text] of Object.entries(files)) {
        // the label in the block's own file (a string: the rewrite below leaves it), then every reference
        let source = text;
        if (f === file) {
          const label = d.trivia.spans!.labels[1];
          const name = label.quoted ? `"${d.name}_renamed"` : `${d.name}_renamed`;
          source = `${text.slice(0, label.start)}${name}${text.slice(label.end)}`;
        }
        const expected = renameInHcl(source, d.id, to);
        if (out[f] !== expected) {
          const diff = lineDiff(expected, out[f]);
          return `${f}: unexpected +${JSON.stringify(diff.added.slice(0, 2))} -${JSON.stringify(diff.removed.slice(0, 2))}`;
        }
      }
      return Object.values(out).some((t) => /^\s*moved\s*\{[^}]*data\./m.test(t)) ? 'wrote a moved block' : null;
    });
    check('delete', [{ kind: 'remove_resource', nodeId: d.id }], (out) => {
      const diff = lineDiff(files[file], out[file]);
      if (diff.added.some((l) => l.trim() !== '')) return `added ${JSON.stringify(diff.added.slice(0, 2))}`;
      return out[file].includes(`data "${d.type}" "${d.name}"`) ? 'still there' : null;
    });
  }
}

for (const w of shownWarnings) process.stdout.write(`WARN ${w}\n`);
process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
process.exit(stats.failures > 0 ? 1 : 0);
