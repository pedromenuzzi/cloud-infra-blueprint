/**
 * Regenerate the provider schemas the editor ships (src/schema/data/*.json).
 *
 * For each provider it writes a scratch project with the templates' version
 * pin, runs `terraform init` + `terraform providers schema -json`, and trims
 * the output (src/schema/trim.ts) into two lazy chunks: the resources
 * (`<provider>.json`) and the data sources (`<provider>.data.json`); see
 * src/schema/README.md.
 *
 *   pnpm schema:generate                  latest versions matching the pins
 *   pnpm schema:generate --check          regenerate at the versions recorded in the
 *                                         committed files; exit 1 if they differ
 *   pnpm schema:generate --from dump.json trim an existing `providers schema -json`
 *                                         dump (versions from --lock <.terraform.lock.hcl>)
 *
 * TERRAFORM overrides the binary; set TF_PLUGIN_CACHE_DIR to reuse downloads.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { providerOfSourceName } from '@/ir/types';
import { allDefs } from '@/resources/registry';
import { DATA_SOURCES_WITH_HELP, GOOGLE_WITH_HELP } from '@/schema/popular';
import { serializeSchema } from '@/schema/serialize';
import { providerEntry, trimProviderSchema, type RawSchemas } from '@/schema/trim';
import { SCHEMA_PROVIDERS, type SchemaData, type SchemaProvider } from '@/schema/types';
import { scratchProject } from '@/templates';

const DATA_DIR = fileURLToPath(new URL('../src/schema/data', import.meta.url));
const terraform = process.env.TERRAFORM ?? 'terraform';
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const say = (text: string) => process.stdout.write(`${text}\n`);

/** the templates' `version = "~> 6.0"` constraint for a provider */
function templatePin(provider: SchemaProvider): string {
  const versions = scratchProject(providerOfSourceName(provider), 'schema')['versions.tf'];
  const pin = /version\s*=\s*"([^"]+)"/.exec(versions)?.[1];
  if (!pin) throw new Error(`no version pin for ${provider} in the templates`);
  return pin;
}

/** `aws.json` (resources) or `aws.data.json` (data sources) */
const fileName = (provider: SchemaProvider, data: boolean) => `${provider}${data ? '.data' : ''}.json`;

function committedText(provider: SchemaProvider, data = false): string | undefined {
  try {
    return readFileSync(join(DATA_DIR, fileName(provider, data)), 'utf8');
  } catch {
    return undefined;
  }
}

function run(cwd: string, command: string[], attempts = 2): string {
  for (let i = 1; ; i++) {
    try {
      return execFileSync(terraform, [`-chdir=${cwd}`, ...command], {
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TF_IN_AUTOMATION: '1' },
      });
    } catch (e) {
      // registry downloads of the ~900 MB AWS plugin sometimes end early
      if (i >= attempts) throw e;
    }
  }
}

/** `terraform providers schema -json` for one provider at `constraint`, plus the version picked */
function dumpSchema(provider: SchemaProvider, constraint: string): { raw: RawSchemas; version: string } {
  const dir = mkdtempSync(join(tmpdir(), `cb-schema-${provider}-`));
  try {
    writeFileSync(
      join(dir, 'versions.tf'),
      `terraform {\n  required_providers {\n    ${provider} = {\n      source  = "hashicorp/${provider}"\n      version = "${constraint}"\n    }\n  }\n}\n`,
    );
    run(dir, ['init', '-backend=false', '-input=false', '-no-color']);
    const raw = JSON.parse(run(dir, ['providers', 'schema', '-json'])) as RawSchemas;
    const selections = JSON.parse(run(dir, ['version', '-json'])) as { provider_selections?: Record<string, string> };
    const version = selections.provider_selections?.[`registry.terraform.io/hashicorp/${provider}`];
    if (!version) throw new Error(`terraform did not report the ${provider} version`);
    return { raw, version };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** provider versions from a lock file (`provider "registry.terraform.io/hashicorp/aws" { version = "6.66.0"`) */
function lockVersions(file: string): Partial<Record<SchemaProvider, string>> {
  const text = readFileSync(file, 'utf8');
  const out: Partial<Record<SchemaProvider, string>> = {};
  for (const m of text.matchAll(/provider\s+"registry\.terraform\.io\/hashicorp\/([\w-]+)"\s*\{\s*version\s*=\s*"([^"]+)"/g)) {
    if ((SCHEMA_PROVIDERS as readonly string[]).includes(m[1])) out[m[1] as SchemaProvider] = m[2];
  }
  return out;
}

/** which resource types keep their descriptions (see src/schema/popular.ts) */
function helpFilter(provider: SchemaProvider): ((type: string) => boolean) | undefined {
  if (provider !== 'google') return undefined;
  const keep = new Set([...GOOGLE_WITH_HELP, ...allDefs().map((d) => d.type)]);
  return (type) => keep.has(type);
}

/** which data sources keep their descriptions: all of them, but Google's long tail ships structure only */
function dataHelpFilter(provider: SchemaProvider): ((type: string) => boolean) | undefined {
  if (provider !== 'google') return undefined;
  const keep = new Set(DATA_SOURCES_WITH_HELP);
  return (type) => keep.has(type);
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

const check = flag('--check');
const from = option('--from');
const only = option('--provider') as SchemaProvider | undefined;
const providers = SCHEMA_PROVIDERS.filter((p) => !only || p === only);
const fromDump = from ? (JSON.parse(readFileSync(from, 'utf8')) as RawSchemas) : undefined;
const locked = option('--lock') ? lockVersions(option('--lock')!) : {};

mkdirSync(DATA_DIR, { recursive: true });
let stale = 0;
for (const provider of providers) {
  const current = committedText(provider);
  const recorded = current ? (JSON.parse(current) as SchemaData) : undefined;
  let raw: RawSchemas;
  let version: string;
  if (fromDump) {
    raw = fromDump;
    version = locked[provider] ?? recorded?.version ?? 'unknown';
  } else {
    const constraint = check ? `= ${recorded?.version ?? templatePin(provider)}` : templatePin(provider);
    say(`${provider}: terraform init (${constraint})…`);
    ({ raw, version } = dumpSchema(provider, constraint));
  }
  const entry = providerEntry(raw, provider);
  if (!entry) throw new Error(`the schema dump has no ${provider} provider`);
  const missing = provider === 'google' ? GOOGLE_WITH_HELP.filter((t) => !entry.resource_schemas?.[t]) : [];
  if (missing.length) say(`warning: not in the google schema any more: ${missing.join(', ')}`);
  const missingData = DATA_SOURCES_WITH_HELP.filter((t) => t.startsWith(`${provider}_`) && !entry.data_source_schemas?.[t]);
  if (missingData.length) say(`warning: data sources not in the ${provider} schema any more: ${missingData.join(', ')}`);

  const chunks = [
    {
      data: false,
      count: `${Object.keys(entry.resource_schemas ?? {}).length} resources`,
      text: serializeSchema(trimProviderSchema(entry, { provider, version, help: helpFilter(provider) })),
    },
    {
      data: true,
      count: `${Object.keys(entry.data_source_schemas ?? {}).length} data sources`,
      text: serializeSchema(trimProviderSchema(entry, { provider, version, section: 'data', help: dataHelpFilter(provider) })),
    },
  ];
  for (const { data, count, text } of chunks) {
    const file = `src/schema/data/${fileName(provider, data)}`;
    const summary = `${provider} ${version}: ${count}, ${kb(text.length)} (${kb(gzipSync(text, { level: 9 }).length)} gzip)`;
    if (check) {
      if (committedText(provider, data) !== text) {
        stale++;
        say(`${summary}: STALE, ${file} differs from what the generator writes`);
      } else {
        say(`${summary}: up to date`);
      }
      continue;
    }
    writeFileSync(join(DATA_DIR, fileName(provider, data)), text);
    say(`${summary} → ${file}`);
  }
}

if (stale) {
  say(`\n${stale} schema file(s) are stale — run \`pnpm schema:generate\` (see src/schema/README.md)`);
  process.exit(1);
}
