/**
 * No dash used as punctuation in the text written for people (Pedro, Oct
 * 2026: "não quero - em meio de frases"): a sentence goes on with a comma, a
 * colon, a period or parentheses instead. Checked here, in both languages:
 * every message module of the security, cost, validation, parser, schema,
 * catalog, import / backup / share and PDF code, the catalog, the templates
 * (and the Terraform they write), the tutorials and the PDF document itself.
 * The rendered screens are checked by e2e/i18n-sweep.spec.ts.
 *
 * Fine, and not flagged: hyphens inside words (sub-rede, read-only), numeric
 * ranges (×0–1, 5.1–5.4, pages 3–5), `code spans`, a character list
 * ("letters, digits and - _ ."), and a lone "—" standing for an empty cell.
 */
import { describe, expect, it } from 'vitest';
import { buildArchitecturePdf, type DocSections } from '@/features/export/archDoc';
import { docMessages } from '@/features/export/archDoc.messages';
import { exportMessages } from '@/features/export/messages';
import { parseProject } from '@/hcl/parser';
import { hclMessages } from '@/hcl/messages';
import type { Locale } from '@/i18n/locale';
import type { Messages } from '@/i18n/messages';
import { costMessages } from '@/cost/messages';
import { serviceMessages } from '@/cost/services/messages';
import { deriveStructure } from '@/ir/graph';
import { instanceCheckMessages } from '@/ir/checks/instances.messages';
import { checkMessages } from '@/ir/checks/messages';
import { validateMessages } from '@/ir/messages';
import { moduleCheckMessages } from '@/ir/modules.messages';
import { backupMessages } from '@/lib/backup.messages';
import { githubMessages } from '@/lib/githubImport.messages';
import { libMessages } from '@/lib/messages';
import { CATALOG_PROVIDERS, catalogProject } from '@/resources/catalogProject';
import { reasonMessages } from '@/resources/dropReasons';
import { categoryLabel, fieldHelp, resourceDescription, resourceName, resourceShortName } from '@/resources/i18n';
import { resourceMessages } from '@/resources/messages';
import { allDefs, getDef } from '@/resources/registry';
import { CATEGORY_ORDER } from '@/resources/types';
import { schemaMessages } from '@/schema/messages';
import { accessMessages } from '@/security/access.messages';
import { auditSecurity } from '@/security/audit';
import { auditMessages, type RiskWhat, type RuleTail } from '@/security/audit.messages';
import { complianceMessages } from '@/security/compliance.messages';
import { deltaMessages } from '@/security/delta.messages';
import { editMessages } from '@/security/edit.messages';
import { instanceMessages } from '@/security/instances.messages';
import { modelMessages } from '@/security/model.messages';
import { moduleAuditMessages } from '@/security/modules.messages';
import { analyzeSecurity } from '@/security/topology';
import { scratchProject, TEMPLATES } from '@/templates';
import { templateDescription, templateName, templateTagLabel } from '@/templates/i18n';
import { TUTORIALS } from '@/tutorials';
import { tutorialText } from '@/tutorials/i18n';
import { pdfText } from './pdf/testing';
import { defaultTitle, pageTitle } from './useDocumentTitle';

const LOCALES: Locale[] = ['en', 'pt-BR'];

/** every place a dash joins two parts of a sentence, with the text around it */
function sentenceDashes(text: string): string[] {
  const prose = text
    .replace(/`[^`\n]*`/g, '`code`') // inline code is code
    .replace(/^[ \t]*[—–][ \t]*$/gm, ''); // a lone dash: an empty cell
  const dash = /\s[—–]\s|^[—–]\s|\s[—–]$|[\p{L})”"]—[\p{L}(“"]|\s--?\s(?=[\p{L}\p{N}(“"'‘])/gmu;
  return [...prose.matchAll(dash)].map((m) =>
    prose.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' '),
  );
}

/**
 * Stands in for any argument a message reads: a string, a number, a list, a
 * record or a noun ("an x" / "um x"), so most message functions can be called
 * without knowing their parameters.
 */
const ANY: unknown = new Proxy(function sample() {}, {
  get(_target, key) {
    if (key === Symbol.toPrimitive) return (hint: string) => (hint === 'number' ? 2 : 'x');
    if (key === Symbol.iterator)
      return function* () {
        yield ANY;
        yield ANY;
      };
    if (key === 'length') return 2;
    if (key === 'map') return (fn: (v: unknown, i: number) => unknown) => [fn(ANY, 0), fn(ANY, 1)];
    if (key === 'join') return (sep = ',') => `x${sep}x`;
    if (key === 'then') return undefined;
    return ANY;
  },
  apply: () => 'x',
});
/** each function is called with every argument set; the ones it can't take just throw */
const ARGUMENT_SETS: unknown[] = [ANY, 1, 'x', 'high', false, 0];
/** functions of a tagged union the samples can't build: called by hand below */
const BY_HAND = ['auditMessages[en].risk', 'auditMessages[pt-BR].risk'];

interface Found {
  path: string;
  text: string;
}

/** every string reachable from `value`, calling functions with the sample arguments; `uncalled` gets the functions that never produced one */
function collect(value: unknown, path: string, out: Found[], uncalled: string[], seen = new Set<unknown>()) {
  if (typeof value === 'string') {
    out.push({ path, text: value });
  } else if (typeof value === 'function') {
    if (value === ANY) return;
    const before = out.length;
    for (const arg of ARGUMENT_SETS) {
      let result: unknown;
      try {
        result = (value as (...args: unknown[]) => unknown)(...Array(8).fill(arg));
      } catch {
        continue;
      }
      collect(result === ANY ? 'x' : result, `${path}()`, out, uncalled, seen);
    }
    if (out.length === before) uncalled.push(path);
  } else if (value && typeof value === 'object') {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, v] of Object.entries(value)) collect(v, `${path}.${key}`, out, uncalled, seen);
  }
}

const offenders = (found: Found[]) =>
  found.flatMap(({ path, text }) => {
    return sentenceDashes(text).map((hit) => `${path}: …${hit}…`);
  });

describe('sentence dashes: the detector', () => {
  it('flags a dash between words, and nothing else', () => {
    for (const bad of ['Storage is full — export', 'a – b', 'on—off', 'foo - bar', 'No region —', '— and more', 'go -- now'])
      expect(sentenceDashes(bad), bad).toHaveLength(1);
    for (const fine of [
      'sub-rede, read-only, pt-BR, multi-cloud',
      '×0–1, CIS 5.1–5.4, pages 3–5, 3–24 characters',
      'use letters, digits and - _ . ~ + %',
      'use letters, digits and + = , . @ _ -',
      'the `a - b` expression',
      'Resource\n—\nPlacement',
      '—',
      '(xn--, sthree-)',
    ])
      expect(sentenceDashes(fine), fine).toEqual([]);
  });
});

describe('sentence dashes: messages', () => {
  const MODULES: Record<string, Messages<object>> = {
    accessMessages,
    docMessages,
    auditMessages,
    backupMessages,
    checkMessages,
    complianceMessages,
    costMessages,
    deltaMessages,
    editMessages,
    exportMessages,
    githubMessages,
    hclMessages,
    instanceCheckMessages,
    instanceMessages,
    validateMessages,
    libMessages,
    modelMessages,
    moduleCheckMessages,
    moduleAuditMessages,
    reasonMessages,
    resourceMessages,
    schemaMessages,
    serviceMessages,
  };

  it('covers every message module in these folders', () => {
    const sources = import.meta.glob<string>(
      [
        '/src/{security,cost,ir,hcl,resources,schema,lib,templates,tutorials}/**/*.ts',
        '/src/features/export/**/*.ts',
        '!**/*.test.ts',
        '!/src/cost/refresh/**',
      ],
      { query: '?raw', import: 'default', eager: true },
    );
    const declared = Object.entries(sources).flatMap(([file, text]) =>
      [...text.matchAll(/export const (\w+) = defineMessages\b/g)].map((m) => `${file}: ${m[1]}`),
    );
    expect(declared.length).toBeGreaterThan(20);
    expect(declared.filter((d) => !(d.split(': ')[1] in MODULES))).toEqual([]);
  });

  for (const [name, module] of Object.entries(MODULES)) {
    it(name, () => {
      const found: Found[] = [];
      const uncalled: string[] = [];
      for (const locale of LOCALES) collect(module[locale], `${name}[${locale}]`, found, uncalled);
      expect(found.length).toBeGreaterThan(0);
      expect(offenders(found)).toEqual([]);
      // the samples reach every message function
      expect(uncalled.filter((path) => !BY_HAND.includes(path))).toEqual([]);
    });
  }

  it('the audit, for every kind of risk and every way a finding ends', () => {
    const risks: RiskWhat[] = [
      { kind: 'every-port' },
      { kind: 'all-tcp' },
      { kind: 'all-udp' },
      { kind: 'ports', hits: [[22, 'SSH']] },
      { kind: 'ports', hits: [[2375, 'Docker API']] },
      { kind: 'ports', hits: [[22, 'SSH'], [3389, 'RDP'], [5432, 'PostgreSQL'], [6379, 'Redis']] },
      { kind: 'wide', from: 1000, to: 2000 },
      { kind: 'unverified', expr: 'var.port' },
      { kind: 'nacl', hits: [[22, 'SSH']] },
    ];
    const tails: RuleTail[] = [{ kind: 'nacl' }, { kind: 'reachable', names: 'aws_instance.web' }, { kind: 'unused' }];
    const found: Found[] = [];
    for (const locale of LOCALES) {
      const m = auditMessages[locale];
      for (const w of risks) {
        found.push({ path: `${locale} risk ${w.kind}`, text: m.risk(w) });
        for (const v6 of [false, true]) {
          found.push({ path: `${locale} ruleTitle ${w.kind}`, text: m.ruleTitle(w, v6) });
          found.push({ path: `${locale} ruleAlert ${w.kind}`, text: m.ruleAlert(w, v6) });
        }
        const what = w.kind === 'unverified' ? m.unverifiedWhat(w.expr) : 'SSH';
        for (const tail of tails)
          found.push({ path: `${locale} ruleDetail ${w.kind} ${tail.kind}`, text: m.ruleDetail('aws_security_group.web', what, '0.0.0.0/0', tail) });
      }
    }
    expect(offenders(found)).toEqual([]);
  });
});

describe('sentence dashes: page titles', () => {
  it('a page and the app are joined by " · ", as in index.html', () => {
    for (const locale of LOCALES) {
      expect(pageTitle('Projects', locale)).toBe('Projects · Cloud Blueprint');
      expect(defaultTitle(locale)).toMatch(/^Cloud Blueprint · /);
      expect(offenders([{ path: locale, text: defaultTitle(locale) }])).toEqual([]);
    }
  });
});

describe('sentence dashes: catalog, templates and tutorials', () => {
  it('resource names, descriptions and field help', () => {
    const found: Found[] = [];
    for (const locale of LOCALES) {
      for (const c of CATEGORY_ORDER) found.push({ path: `${locale} category ${c}`, text: categoryLabel(c, locale) });
      for (const def of allDefs()) {
        const at = `${locale} ${def.type}`;
        found.push({ path: `${at} name`, text: resourceName(def.type, locale) });
        found.push({ path: `${at} shortName`, text: resourceShortName(def.type, locale) });
        found.push({ path: `${at} description`, text: resourceDescription(def.type, locale) ?? '' });
        for (const field of def.fields) {
          const help = fieldHelp(def.type, field.name, locale);
          for (const [k, v] of Object.entries(help)) if (v) found.push({ path: `${at}.${field.name} ${k}`, text: v });
        }
      }
    }
    expect(found.length).toBeGreaterThan(500);
    expect(offenders(found)).toEqual([]);
  });

  it('template names, descriptions and tags', () => {
    const found: Found[] = [];
    for (const locale of LOCALES)
      for (const t of TEMPLATES) {
        found.push({ path: `${locale} ${t.slug} name`, text: templateName(t, locale) });
        found.push({ path: `${locale} ${t.slug} description`, text: templateDescription(t, locale) });
        for (const tag of t.tags) found.push({ path: `${locale} ${t.slug} tag`, text: templateTagLabel(tag, locale) });
      }
    expect(offenders(found)).toEqual([]);
  });

  it('tutorial lessons', () => {
    const found: Found[] = [];
    for (const locale of LOCALES)
      for (const t of TUTORIALS) {
        const text = tutorialText(t, locale);
        found.push({ path: `${locale} ${t.slug} title`, text: text.title }, { path: `${locale} ${t.slug} description`, text: text.description });
        text.steps.forEach((s, i) => {
          found.push({ path: `${locale} ${t.slug} step ${i + 1}`, text: s.title });
          s.body.forEach((p, j) => found.push({ path: `${locale} ${t.slug} step ${i + 1} ¶${j + 1}`, text: p }));
        });
      }
    expect(found.length).toBeGreaterThan(80);
    expect(offenders(found)).toEqual([]);
  });

  it('the comments and descriptions the app writes into Terraform', () => {
    const projects: Array<[string, Record<string, string>]> = [
      ...TEMPLATES.map((t) => [`template ${t.slug}`, t.build('demo')] as [string, Record<string, string>]),
      ...CATALOG_PROVIDERS.map((p) => [`catalog ${p}`, catalogProject(p)] as [string, Record<string, string>]),
      ...CATALOG_PROVIDERS.map((p) => [`blank ${p}`, scratchProject(p, 'demo')] as [string, Record<string, string>]),
      ...TUTORIALS.flatMap((t) => t.steps.map((s, i) => [`tutorial ${t.slug} step ${i + 1}`, s.files] as [string, Record<string, string>])),
    ];
    const found: Found[] = [];
    for (const [project, files] of projects)
      for (const [file, text] of Object.entries(files))
        text.split('\n').forEach((line, i) => {
          const at = `${project} ${file}:${i + 1}`;
          const comment = /^\s*(?:#|\/\/)(.*)$/.exec(line);
          if (comment && !comment[1].startsWith(' @blueprint:')) found.push({ path: at, text: comment[1] });
          for (const d of line.matchAll(/\bdescription\s*=\s*"((?:[^"\\]|\\.)*)"/g)) found.push({ path: at, text: d[1] });
        });
    expect(found.length).toBeGreaterThan(50);
    expect(offenders(found)).toEqual([]);
  });
});

describe('sentence dashes: the PDF document', () => {
  const SECTIONS: DocSections = { inventory: true, connections: true, security: true, code: false, cost: true };
  /** a web app with SSH open to the internet and a port written as an expression, so the security pages have findings to explain */
  const risky = () => {
    const files = TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('demo');
    return {
      ...files,
      'main.tf': files['main.tf'].replace(
        '  egress {',
        '  ingress {\n    from_port   = 22\n    to_port     = 22\n    protocol    = "tcp"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n\n' +
          '  ingress {\n    from_port   = var.port\n    to_port     = var.port\n    protocol    = "tcp"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n\n  egress {',
      ),
    };
  };
  const projects: Array<[string, Record<string, string>]> = [
    ['aws-web-app with risks', risky()],
    ...TEMPLATES.map((t) => [t.slug, t.build('demo')] as [string, Record<string, string>]),
  ];

  for (const locale of LOCALES) {
    it(`every template, in ${locale}`, () => {
      const found: Found[] = [];
      for (const [name, files] of projects) {
        const { ir } = parseProject(files);
        const bytes = buildArchitecturePdf({
          title: 'Review',
          ir,
          edges: deriveStructure(ir, getDef),
          files: Object.entries(files),
          audit: auditSecurity(ir, analyzeSecurity(ir, locale)),
          diagram: null,
          sections: SECTIONS,
          paper: 'a4',
          generatedAt: new Date(2026, 9, 1, 9, 0),
          compress: false,
          locale,
        });
        found.push({ path: `${name} (${locale})`, text: pdfText(bytes) });
      }
      // the risky project's security pages are there to be read
      expect(found[0].text).toContain(locale === 'en' ? 'SSH (port 22) is open to the internet' : 'SSH (porta 22) aberto para a internet');
      expect(offenders(found)).toEqual([]);
    });
  }
});
