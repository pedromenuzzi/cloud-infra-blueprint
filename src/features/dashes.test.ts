/**
 * No dash as punctuation in the UI's own words (src/i18n/dashes.ts), in
 * English and Portuguese: every message module of the app shell, the routes
 * and the features (the PDF's, under features/export, has its own check) is
 * walked, its strings read and its functions called with sample arguments.
 * e2e/i18n-sweep.spec.ts checks what actually ends up on screen.
 */
import { describe, expect, it } from 'vitest';
import { sentenceDash } from '@/i18n/dashes';

const MODULES = import.meta.glob(
  [
    '/src/components/**/messages.ts',
    '/src/components/**/*.messages.ts',
    '/src/routes/**/messages.ts',
    '/src/routes/**/*.messages.ts',
    '/src/features/**/messages.ts',
    '/src/features/**/*.messages.ts',
    '!/src/features/export/**',
  ],
  { eager: true },
) as Record<string, Record<string, unknown>>;

/** one value per argument shape the messages take: counts, names, lists, flags, the unions they switch on, a drop-hint noun */
const SAMPLES: unknown[] = [
  2,
  1,
  0,
  'web',
  ['a', 'b'],
  true,
  false,
  null,
  'sg',
  'nacl',
  'critical',
  'inbound',
  'left',
  'palette',
  'code',
  'aws',
  'default',
  { en: 'subnet', pt: 'sub-rede', f: true },
];

type Fn = (...args: unknown[]) => unknown;

/** every string a message value can produce: itself, its items, or what it returns for each sample */
function texts(value: unknown, path: string, out: { path: string; text: string }[], calls: { path: string; ok: boolean }[], depth = 0): void {
  if (depth > 4) return;
  if (typeof value === 'string') out.push({ path, text: value });
  else if (typeof value === 'function') {
    let ok = false;
    for (const sample of SAMPLES) {
      try {
        const result = (value as Fn)(...Array.from({ length: Math.max(1, value.length) }, () => sample));
        if (result !== undefined && result !== null) ok = true;
        texts(result, `${path}()`, out, calls, depth + 1);
      } catch {
        // not this argument shape
      }
    }
    calls.push({ path, ok });
  } else if (Array.isArray(value)) value.forEach((v, i) => texts(v, `${path}[${i}]`, out, calls, depth + 1));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) texts(v, `${path}.${k}`, out, calls, depth + 1);
  }
}

function scan() {
  const strings: { path: string; text: string }[] = [];
  const calls: { path: string; ok: boolean }[] = [];
  for (const [file, mod] of Object.entries(MODULES)) {
    for (const [name, value] of Object.entries(mod)) {
      if (!value || typeof value !== 'object' || !('en' in value) || !('pt-BR' in value)) continue;
      for (const locale of ['en', 'pt-BR'] as const) {
        texts((value as Record<string, unknown>)[locale], `${file.replace('/src/', '')} ${name} ${locale}`, strings, calls);
      }
    }
  }
  return { strings, calls };
}

describe('dash punctuation', () => {
  it('is caught, and hyphens, ranges and a lone "no value" dash are not', () => {
    for (const bad of [
      'Deleted 3 resources — Ctrl Z to undo',
      'Read-only – fix the errors first',
      'Not saved - storage full',
      'Pasta infra: mudou—escolha uma versão',
      '— none —',
      ' — only child modules',
      'Backup downloaded —',
    ]) {
      expect(sentenceDash(bad), bad).not.toBeNull();
    }
    for (const fine of [
      'Read-only: fix the errors in the code pane.',
      'sub-rede pública, multi-cloud, e-mail, pt-BR, us-east-1a, auto-arrange',
      '×0–1',
      'Remember to allow return traffic on ephemeral ports (1024–65535).',
      '10.0.1.4 – 10.0.1.254',
      'CIS 5.1–5.4, 1–3 AZs',
      'Enter a number from 1 to 65535',
      '—',
      'production-web · Cloud Blueprint',
    ]) {
      expect(sentenceDash(fine), fine).toBeNull();
    }
  });

  it('is not used in the UI’s message modules, in English or Portuguese', () => {
    const { strings, calls } = scan();
    // the walk reaches the modules and their functions
    expect(Object.keys(MODULES).length).toBeGreaterThan(20);
    expect(strings.length).toBeGreaterThan(1500);
    expect(calls.filter((c) => !c.ok).map((c) => c.path), 'functions no sample argument could call').toEqual([]);

    // one line per message (its first offending output), not one per sample argument
    const offenders = new Map<string, string>();
    for (const { path, text } of strings) if (!offenders.has(path) && sentenceDash(text)) offenders.set(path, `${path}: ${JSON.stringify(text)}`);
    expect([...offenders.values()]).toEqual([]);
  });
});
