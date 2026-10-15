/**
 * Write every learning-map lesson's solution to <outDir>/<slug>/ so CI can run
 * `terraform fmt -check` and `terraform validate` against the real providers.
 *
 *   pnpm lessons:emit .tf-lessons
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ALL_LESSONS } from '@/learn/lessons';

const outDir = resolve(process.argv[2] ?? '.tf-lessons');
rmSync(outDir, { recursive: true, force: true });
for (const lesson of ALL_LESSONS) {
  for (const [name, content] of Object.entries(lesson.solution)) {
    // a child module's file sits in its folder (`modules/net/main.tf`)
    const file = join(outDir, lesson.slug, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}
process.stdout.write(`Wrote ${ALL_LESSONS.length} lesson solution${ALL_LESSONS.length === 1 ? '' : 's'} to ${outDir}\n`);
