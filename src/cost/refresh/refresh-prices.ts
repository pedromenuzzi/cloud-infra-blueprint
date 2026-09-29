/**
 * Refresh the static price tables in src/cost/prices/*.json from the
 * providers' public price lists — no credentials, no API keys. The app never
 * fetches prices; it ships these files.
 *
 *   pnpm exec vite-node src/cost/refresh/refresh-prices.ts            # all three
 *   pnpm exec vite-node src/cost/refresh/refresh-prices.ts aws azure  # some
 *
 * Every requested SKU must be found (and match exactly one price): otherwise
 * the run fails and no file is written. See src/cost/README.md.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshAws } from './aws';
import { refreshAzure } from './azure';
import { refreshGcp } from './gcp';
import { log, PriceError } from './shared';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prices');

const PROVIDERS = {
  aws: refreshAws,
  azure: refreshAzure,
  gcp: refreshGcp,
} as const;

type Name = keyof typeof PROVIDERS;

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !(a in PROVIDERS));
  if (unknown.length) {
    process.stderr.write(`Unknown provider: ${unknown.join(', ')} (expected ${Object.keys(PROVIDERS).join(', ')})\n`);
    process.exit(2);
  }
  const names = (args.length ? args : Object.keys(PROVIDERS)) as Name[];
  // fetch everything first: one failure writes nothing
  const results: Array<[Name, unknown]> = [];
  for (const name of names) {
    log(`\n${name.toUpperCase()}`);
    results.push([name, await PROVIDERS[name]()]);
  }
  for (const [name, data] of results) {
    const file = join(OUT_DIR, `${name}.json`);
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    log(`wrote ${file}`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\nPrice refresh failed${err instanceof PriceError ? '' : ' unexpectedly'}: ${(err as Error).message}\nNo file was written.\n`);
  process.exit(1);
});
