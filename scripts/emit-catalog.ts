/**
 * Write one project per provider to <outDir>/catalog-<provider>/*.tf holding
 * every palette resource with its buildNewNode defaults, wired through its
 * connection rules — CI runs `terraform validate` on them so a catalog entry
 * that can't validate fails the build.
 *
 *   pnpm exec vite-node scripts/emit-catalog.ts .tf-catalog
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATALOG_PROVIDERS, catalogProject } from '@/resources/catalogProject';

const outDir = resolve(process.argv[2] ?? '.tf-catalog');
rmSync(outDir, { recursive: true, force: true });
for (const provider of CATALOG_PROVIDERS) {
  const dir = join(outDir, `catalog-${provider}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(catalogProject(provider))) writeFileSync(join(dir, name), content);
}
process.stdout.write(`Wrote ${CATALOG_PROVIDERS.length} catalog projects to ${outDir}\n`);
