/**
 * Write every starter template to <outDir>/<slug>/*.tf so CI can run
 * `terraform fmt -check` and `terraform validate` against the real providers.
 *
 *   pnpm templates:emit .tf-templates
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TEMPLATES } from '@/templates';

const outDir = resolve(process.argv[2] ?? '.tf-templates');
rmSync(outDir, { recursive: true, force: true });
for (const t of TEMPLATES) {
  const dir = join(outDir, t.slug);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(t.build('demo'))) writeFileSync(join(dir, name), content);
}
console.log(`Wrote ${TEMPLATES.length} templates to ${outDir}`);
