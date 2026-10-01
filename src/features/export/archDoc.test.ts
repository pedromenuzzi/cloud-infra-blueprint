import { describe, expect, it } from 'vitest';
import { computeAbsoluteRects } from '@/components/ProjectThumbnail';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import type { IR, IREdge } from '@/ir/types';
import { textWidth } from '@/lib/pdf/metrics';
import { parseSvgPath } from '@/lib/pdf/svgPath';
import { expectWellFormed, latin1, pdfLayout, pdfPages, pdfText } from '@/lib/pdf/testing';
import { allDefs, getDef, isContainerType } from '@/resources/registry';
import { CATEGORY_ORDER } from '@/resources/types';
import { auditSecurity } from '@/security/audit';
import { analyzeSecurity } from '@/security/topology';
import { TEMPLATES } from '@/templates';
import {
  BOTTOM_SPACE,
  buildArchitecturePdf,
  buildArchitecturePdfAsync,
  FOOTER_BASELINE,
  keySettings,
  MIN_TILE_SCALE,
  providerSummary,
  redactSecrets,
  sourceLines,
  type ArchDocInput,
  type DocSections,
} from './archDoc';
import { LIGHT_PALETTE, type DiagramVector } from './diagramVector';

const ALL: DocSections = { inventory: true, connections: true, security: true, code: true };
const WHEN = new Date(2026, 8, 28, 9, 5);
const MARGIN = 40;

/** the geometry the canvas would report for `ir` (what captureDiagram reads off React Flow) */
function fakeDiagram(ir: IR, edges: IREdge[], lens = false): DiagramVector {
  const rects = computeAbsoluteRects(ir);
  const all = [...rects.values()];
  const minX = Math.min(...all.map((r) => r.x));
  const minY = Math.min(...all.map((r) => r.y));
  const maxX = Math.max(...all.map((r) => r.x + r.w));
  const maxY = Math.max(...all.map((r) => r.y + r.h));
  const center = (id: string) => {
    const r = rects.get(id)!;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  return {
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    nodes: [...all]
      .sort((a, b) => a.depth - b.depth)
      .map((r) => {
        const def = getDef(r.node.type);
        return {
          id: r.node.id,
          kind: isContainerType(r.node.type) ? ('container' as const) : ('resource' as const),
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          title: r.node.name,
          subtitle: def?.subtitle?.(r.node.args) ?? def?.displayName,
          typeLabel: def?.shortName ?? r.node.type,
          category: def?.category ?? 'compute',
          provider: r.node.provider,
          glyph: 'g',
          warn: false,
          security: lens ? { exposure: { level: 'internet' as const, ports: ['80', '443'] }, risk: 'high' as const } : undefined,
        };
      }),
    edges: edges
      .filter((e) => rects.has(e.source) && rects.has(e.target))
      .map((e) => {
        const a = center(e.source);
        const b = center(e.target);
        return {
          id: e.id,
          kind: e.kind === 'security' ? ('security' as const) : ('ref' as const),
          path: parseSvgPath(`M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`),
        };
      }),
    glyphs: { g: { strokeWidth: 2, parts: [{ path: parseSvgPath('M4,4 L20,20 M20,4 L4,20'), fill: false, stroke: true }] } },
    palette: LIGHT_PALETTE,
    lens,
  };
}

function inputFor(files: Record<string, string>, overrides: Partial<ArchDocInput> = {}): ArchDocInput {
  const { ir } = parseProject(files);
  const edges = deriveStructure(ir, getDef);
  return {
    title: 'Payments platform',
    ir,
    edges,
    files: Object.entries(files),
    audit: auditSecurity(ir),
    diagram: ir.resources.length ? fakeDiagram(ir, edges) : null,
    sections: ALL,
    paper: 'a4',
    generatedAt: WHEN,
    compress: false,
    ...overrides,
  };
}

/** pages holding the diagram (they clip the drawing to the diagram box) */
function diagramPageSet(bytes: Uint8Array): Set<number> {
  const out = new Set<number>([0]);
  for (const p of pdfPages(bytes)) if (p.content.split('\n').some((l) => l.endsWith(' W n'))) out.add(p.index);
  return out;
}

/** nothing runs past the right margin or into the footer */
function expectLaidOut(bytes: Uint8Array, label: string) {
  const { pages, runs, shapes } = pdfLayout(bytes);
  const diagram = diagramPageSet(bytes);
  for (const r of runs) {
    if (r.clipped) continue;
    const page = pages[r.page];
    const where = `${label}: page ${r.page + 1} "${r.text}"`;
    expect(r.x, where).toBeGreaterThanOrEqual(MARGIN - 0.5);
    expect(r.x + r.width, where).toBeLessThanOrEqual(page.width - MARGIN + 0.5);
    const fromBottom = page.height - r.y;
    if (Math.abs(fromBottom - FOOTER_BASELINE) < 0.01) continue;
    expect(fromBottom, where).toBeGreaterThanOrEqual(diagram.has(r.page) ? FOOTER_BASELINE + 8 : BOTTOM_SPACE - 0.01);
  }
  for (const s of shapes) {
    if (s.clipped) continue;
    const page = pages[s.page];
    const where = `${label}: shape on page ${s.page + 1}`;
    expect(s.minX, where).toBeGreaterThanOrEqual(MARGIN - 1);
    expect(s.maxX, where).toBeLessThanOrEqual(page.width - MARGIN + 1);
    expect(page.height - s.maxY, where).toBeGreaterThanOrEqual(diagram.has(s.page) ? FOOTER_BASELINE + 8 : BOTTOM_SPACE - 1);
  }
}

const COLUMN_TITLES = new Set(
  [
    ...['Resource', 'Service', 'Configuration', 'Placement', 'Name', 'Type', 'Default', 'Description', 'Value', 'From', 'To', 'Ports', 'Reach', 'Uses', 'Through'],
    ...['Recurso', 'Serviço', 'Configuração', 'Localização', 'Nome', 'Tipo', 'Padrão', 'Descrição', 'Valor', 'De', 'Para', 'Portas', 'Alcance', 'Usa', 'Por meio de'],
  ].map((t) => t.toUpperCase()),
);

/** headings, section titles and table headers always have content under them on their page */
function expectNoStrandedHeadings(bytes: Uint8Array, label: string) {
  const { pages, runs } = pdfLayout(bytes);
  const content = runs.filter((r) => !r.clipped && Math.abs(pages[r.page].height - r.y - FOOTER_BASELINE) > 0.01);
  const isSection = (r: (typeof runs)[number]) => r.font === 'bold' && r.size === 16;
  const isHeading = (r: (typeof runs)[number]) => r.font === 'bold' && r.size === 10.5;
  const isColumn = (r: (typeof runs)[number]) => r.font === 'bold' && r.size === 6.8 && COLUMN_TITLES.has(r.text);
  const sections = content.filter(isSection);
  const isSubtitle = (r: (typeof runs)[number]) => sections.some((s) => s.page === r.page && r.y > s.y && r.y - s.y < 20);
  for (const h of content.filter((r) => isSection(r) || isHeading(r) || isColumn(r))) {
    const body = content.filter(
      (r) => r.page === h.page && r.y > h.y + 1 && !isSection(r) && !isHeading(r) && !isColumn(r) && !isSubtitle(r),
    );
    expect(body.length, `${label}: "${h.text}" is alone at the bottom of page ${h.page + 1}`).toBeGreaterThan(0);
  }
}

/** one resource of every category, plus one the catalog doesn't know */
function everyCategory(): string {
  const picks = CATEGORY_ORDER.map((c) => allDefs().find((d) => d.category === c && !d.container && d.provider === 'aws') ?? allDefs().find((d) => d.category === c)!);
  return [
    ...picks.map((d, i) => `resource "${d.type}" "r${i}" {\n  name = "r${i}"\n}\n`),
    'resource "aws_unknown_widget" "x" {\n  name = "x"\n}\n',
  ].join('\n');
}

const notesOf = (lines: number) => Array.from({ length: lines }, (_, i) => `Note line ${i + 1}: keep this design in review.`).join('\n');

describe('architecture document', () => {
  for (const t of TEMPLATES) {
    it(`${t.slug}: a well-formed PDF that names every resource`, { timeout: 20_000 }, () => {
      const input = inputFor(t.build('demo'));
      const bytes = buildArchitecturePdf(input);
      expectWellFormed(bytes);
      const text = pdfText(bytes);
      expect(text).toContain('Payments platform');
      for (const heading of ['Overview', 'Resource inventory', 'Connections & traffic', 'Security review', 'Terraform source']) {
        expect(text, heading).toContain(heading);
      }
      for (const r of input.ir.resources) expect(text, r.id).toContain(r.name);
      expect(text).toMatch(/Page 1 of \d+/);
      expectLaidOut(bytes, t.slug);
      expectNoStrandedHeadings(bytes, t.slug);
    });
  }

  it('security review: the way in for each exposed port, and the benchmark controls the findings fail', () => {
    const files = TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('demo');
    const open = files['main.tf'].replace(
      '  egress {',
      '  ingress {\n    from_port   = 22\n    to_port     = 22\n    protocol    = "tcp"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n\n  egress {',
    );
    const bytes = buildArchitecturePdf(inputFor({ ...files, 'main.tf': open }));
    expectWellFormed(bytes);
    const text = pdfText(bytes);
    expect(text).toMatch(/:22\s+via Internet gateway igw › Route 0\.0\.0\.0\/0 -> igw › Subnet public_a › Security group web ingress #4/);
    expect(text).toContain('Controls: CIS AWS 5.2, FSBP EC2.13, FSBP EC2.18, FSBP EC2.19');
    expect(text).toContain('Compliance controls');
    expect(text).toContain('Ensure no security groups allow ingress from 0.0.0.0/0');
    expect(text).toContain('EC2 instances should use Instance Metadata');
    expectLaidOut(bytes, 'security review');
    expectNoStrandedHeadings(bytes, 'security review');
  });

  it('leaves out the sections that are switched off', () => {
    const input = inputFor(TEMPLATES[0].build('demo'), {
      sections: { inventory: false, connections: false, security: false, code: false },
    });
    const text = pdfText(buildArchitecturePdf(input));
    expect(text).toContain('Overview');
    for (const heading of ['Resource inventory', 'Connections & traffic', 'Security review', 'Terraform source']) {
      expect(text).not.toContain(heading);
    }
    expect(text).toContain('Page 2 of 2');
  });

  it('lists a repeated resource once, saying how many instances it stands for', () => {
    const main = `resource "aws_instance" "app" {\n  count         = 3\n  instance_type = "t3.micro"\n}\n\nresource "aws_instance" "bastion" {\n  count = var.on ? 1 : 0\n}\n\nresource "aws_s3_bucket" "logs" {\n  for_each = toset(["raw", "clean"])\n}\n\nresource "aws_sqs_queue" "jobs" {\n  for_each = var.queues\n}\n`;
    const bytes = buildArchitecturePdf(inputFor({ 'main.tf': main }));
    expectWellFormed(bytes);
    const text = pdfText(bytes);
    for (const name of ['app ×3', 'bastion ×0–1', 'logs ×2', 'jobs for_each: var.queues']) expect(text).toContain(name);
    expect(text.match(/app ×3/g)).toHaveLength(1);
  });

  it('renders without a diagram and with notes from the author', () => {
    const input = inputFor(TEMPLATES[0].build('demo'), { diagram: null, notes: 'Proposta para revisão — versão 2.' });
    const bytes = buildArchitecturePdf(input);
    expectWellFormed(bytes);
    const text = pdfText(bytes);
    expect(text).toContain('The diagram could not be rendered.');
    expect(text).toContain('Proposta para revisão — versão 2.');
  });

  it('draws the diagram as searchable vectors in the light palette', () => {
    const input = inputFor(TEMPLATES[0].build('demo'));
    const bytes = buildArchitecturePdf(input);
    const [first] = pdfPages(bytes);
    const { runs } = pdfLayout(bytes);
    const onDiagram = runs.filter((r) => r.page === 0 && r.clipped).map((r) => r.text);
    for (const r of input.ir.resources) expect(onDiagram, r.id).toContain(r.name);
    // node cards: white fill, light border (#d5deea) — never the dark theme's #243a5c
    expect(first.content).toContain('0.835 0.871 0.918 RG');
    expect(first.content).not.toContain('0.141 0.227 0.361');
    expect(latin1(bytes)).not.toContain('/Subtype /Image');
  });

  describe('secrets', () => {
    const planted = `
variable "db_password" {
  default = "S3cret-var-default"
}
variable "api_token" {
  type    = string
  default = "S3cret-token-default"
}
variable "settings" {
  default = { admin_password = "S3cret-nested", region = "us-east-1" }
}
variable "dsn" {
  default = "postgres://admin:S3cret-url-default@db:5432/app"
}
variable "env" {
  default = "prod"
}
resource "aws_db_instance" "db" {
  engine          = "postgres"
  instance_class  = "db.t3.micro"
  username        = "admin"
  password        = "p-\${var.env}-S3cret-interpolated"
  master_password = ["S3cret-list"]
  manage_master_user_password = true
}
resource "aws_db_instance" "replica" {
  engine   = "postgres"
  password = var.db_password
}
resource "aws_ssm_parameter" "plain" {
  name  = "/app/db"
  type  = "String"
  value = "S3cret-ssm-string"
}
resource "aws_ssm_parameter" "secure" {
  name  = "/app/key"
  type  = "SecureString"
  value = "S3cret-ssm-secure"
}
resource "azurerm_key_vault_secret" "kv" {
  name         = "db"
  value        = "S3cret-key-vault"
  key_vault_id = "vault"
}
resource "google_secret_manager_secret_version" "v" {
  secret      = "projects/p/secrets/db"
  secret_data = "S3cret-gsm"
}
resource "aws_secretsmanager_secret_version" "sm" {
  secret_id     = "db"
  secret_string = "S3cret-sm"
}
resource "aws_instance" "web" {
  ami           = "ami-123"
  instance_type = "t3.micro"
  user_data     = <<-EOT
    #!/bin/bash
    export DB_PASS=S3cret-user-data
  EOT
}
resource "azurerm_linux_virtual_machine" "vm" {
  name           = "vm"
  custom_data    = "S3cret-custom-data"
  admin_password = "S3cret-admin"
}
resource "google_compute_instance" "gce" {
  name                    = "gce"
  metadata_startup_script = "echo S3cret-startup"
}
resource "aws_elasticache_replication_group" "cache" {
  description = "cache"
  auth_token  = "S3cret-auth-token"
}
resource "aws_mq_broker" "mq" {
  broker_name = "mq"
  endpoint    = "amqp://guest:S3cret-amqp@mq.internal:5671"
}
resource "aws_glue_connection" "glue" {
  name       = "glue"
  jdbc       = "Server=db;User Id=app;Password=S3cret-conn;"
  query      = "https://api.example.com/v1?token=S3cret-query&x=1"
}
output "db_url" {
  value = "postgres://admin:S3cret-output-url@db/app"
}
output "admin_password" {
  value = aws_db_instance.db.password
}
output "conn" {
  value = "Server=x;Password=S3cret-output-inline"
}
`;

    it('never prints a planted secret, whatever the expression looks like', () => {
      const input = inputFor({ 'main.tf': planted }, { sections: { ...ALL, code: false } });
      const text = pdfText(buildArchitecturePdf(input));
      const leaks = text.split('\n').filter((line) => /S3cret/i.test(line));
      expect(leaks).toEqual([]);
      // what is still shown
      expect(text).toContain('engine: postgres');
      expect(text).toContain('password: ••••••');
      expect(text).toContain('master_password: ••••••');
      expect(text).toContain('value: ••••••');
      expect(text).toContain('user_data: (script hidden)');
      expect(text).toContain('manage_master_user_password: true');
      expect(text).toContain('postgres://admin:••••••@db/app');
      expect(text).toContain('(sensitive)');
      expect(text).toContain('us-east-1');
    });

    it('masks secrets inside values', () => {
      expect(redactSecrets('https://bob:hunter2@example.com/x')).toBe('https://bob:••••••@example.com/x');
      expect(redactSecrets('Server=db;Password=abc;Timeout=3')).toBe('Server=db;Password=••••••;Timeout=3');
      expect(redactSecrets('export DB_PASS=abc && run')).toBe('export DB_PASS=•••••• && run');
      expect(redactSecrets('size: t3.micro')).toBe('size: t3.micro');
      // prose keeps its words
      expect(redactSecrets('The admin password: at least 16 characters', false)).toBe('The admin password: at least 16 characters');
    });
  });

  it('summarizes key settings without references to other resources', () => {
    const { ir } = parseProject({
      'main.tf': `
resource "aws_instance" "web" {
  ami           = "ami-123"
  instance_type = var.size
  subnet_id     = aws_subnet.a.id
  tags = { Name = "web" }
}
`,
    });
    const settings = keySettings(ir.resources[0]);
    expect(settings).toContain('ami: ami-123');
    expect(settings).toContain('instance_type: var.size');
    expect(settings.some((s) => s.startsWith('subnet_id'))).toBe(false);
    expect(settings.some((s) => s.startsWith('tags'))).toBe(false);
  });

  it('cuts a huge setting to a few lines so the ones after it still show', () => {
    const input = inputFor(
      { 'main.tf': `resource "aws_instance" "web" {\n  ami           = "${'ami-0123456789abcdef-'.repeat(100)}"\n  instance_type = "t3.large"\n}\n` },
      { sections: { ...ALL, code: false } },
    );
    const bytes = buildArchitecturePdf(input);
    const text = pdfText(bytes);
    expect(text).toContain('instance_type: t3.large');
    const amiLines = text.split('\n').filter((l) => l.includes('ami-0123456789abcdef'));
    expect(amiLines.length).toBeLessThanOrEqual(3);
    expect(amiLines[amiLines.length - 1].endsWith('…')).toBe(true);
    expectLaidOut(bytes, 'huge setting');
  });

  it('resolves provider regions through variable defaults', () => {
    const { ir } = parseProject(TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('demo'));
    const aws = providerSummary(ir).find((p) => p.provider === 'aws');
    expect(aws?.regions).toEqual(['us-east-1']);
  });

  describe('layout', () => {
    it('keeps every page inside its margins and above the footer, and no heading alone at a page bottom', { timeout: 60_000 }, () => {
      const files = { 'main.tf': everyCategory() };
      for (const paper of ['a4', 'letter'] as const) {
        for (let lines = 0; lines <= 60; lines += 3) {
          const input = inputFor(files, { paper, notes: notesOf(lines) });
          const bytes = buildArchitecturePdf(input);
          const label = `${paper}, ${lines} note lines`;
          expectLaidOut(bytes, label);
          expectNoStrandedHeadings(bytes, label);
        }
      }
    });

    it('lays out every template on both papers, with notes of several lengths', { timeout: 60_000 }, () => {
      for (const t of TEMPLATES) {
        for (const paper of ['a4', 'letter'] as const) {
          for (const lines of [0, 14, 29]) {
            const bytes = buildArchitecturePdf(inputFor(t.build('demo'), { paper, notes: notesOf(lines) }));
            const label = `${t.slug}, ${paper}, ${lines} note lines`;
            expectLaidOut(bytes, label);
            expectNoStrandedHeadings(bytes, label);
          }
        }
      }
    });

    it('flows long notes across pages instead of cutting them', () => {
      const bytes = buildArchitecturePdf(inputFor(TEMPLATES[0].build('demo'), { notes: notesOf(150) }));
      const text = pdfText(bytes);
      for (let i = 1; i <= 150; i++) expect(text).toContain(`Note line ${i}:`);
      expect(text).toContain('NOTES (CONTINUED)');
      expectLaidOut(bytes, '150 note lines');
    });

    it('wraps a long list of regions', () => {
      const regions = ['eastus', 'westus', 'westeurope', 'northeurope', 'brazilsouth', 'japaneast', 'uksouth', 'francecentral', 'germanywestcentral', 'australiaeast', 'canadacentral', 'koreacentral', 'southindia', 'swedencentral', 'norwayeast', 'switzerlandnorth'];
      const files = { 'main.tf': regions.map((r, i) => `resource "azurerm_resource_group" "g${i}" {\n  name     = "g${i}"\n  location = "${r}"\n}\n`).join('\n') };
      const bytes = buildArchitecturePdf(inputFor(files));
      expect(pdfText(bytes)).toContain('switzerlandnorth');
      expectLaidOut(bytes, '16 regions');
    });

    it('wraps the legend on a portrait page with the security lens on', () => {
      // a tall diagram picks a portrait page
      const tall = Array.from({ length: 12 }, (_, i) => `# @blueprint:pos=0,${i * 110}\nresource "aws_instance" "i${i}" {\n  ami = "ami-1"\n}\n`).join('\n');
      const input = inputFor({ 'main.tf': tall });
      const bytes = buildArchitecturePdf({ ...input, diagram: fakeDiagram(input.ir, input.edges, true) });
      const [first] = pdfPages(bytes);
      expect(first.width).toBeLessThan(first.height);
      expect(pdfText(bytes)).toContain('Allowed traffic (security lens)');
      expectLaidOut(bytes, 'portrait lens legend');
    });

    it('fits long appendix file names and resource names', () => {
      const long = `${'very-long-module-directory-name/'.repeat(6)}main.tf`;
      const files = { [long]: `resource "aws_instance" "${'x'.repeat(120)}" {\n  ami = "ami-1"\n}\n` };
      const bytes = buildArchitecturePdf(inputFor(files));
      expectLaidOut(bytes, 'long names');
    });
  });

  describe('Terraform source appendix', () => {
    it('keeps the line numbers of the file when layout comments are left out', () => {
      const text = '# @blueprint:pos=0,0\nresource "aws_s3_bucket" "b" {\n  bucket = "b"\n}\n# @blueprint:pos=10,10\nresource "aws_sqs_queue" "q" {}\n';
      expect(sourceLines(text).map((l) => l.no)).toEqual([2, 3, 4, 6]);
      const bytes = buildArchitecturePdf(inputFor({ 'main.tf': text }));
      const { runs } = pdfLayout(bytes);
      const code = runs.filter((r) => r.font === 'mono' && r.size === 7);
      const numberOf = (line: string) => {
        const run = code.find((r) => r.text === line)!;
        return code.find((r) => r.page === run.page && Math.abs(r.y - run.y) < 0.01 && r.x < run.x)?.text;
      };
      expect(numberOf('resource "aws_s3_bucket" "b" {')).toBe('2');
      expect(numberOf('resource "aws_sqs_queue" "q" {}')).toBe('6');
    });

    it('splits long lines by printed width and widens the gutter for 5-digit line numbers', () => {
      const long = `  description = "${'a → b ≥ c 😀 '.repeat(30)}"`;
      const text = `${'# @blueprint:pos=0,0\n'.repeat(10_000)}resource "aws_s3_bucket" "b" {\n${long}\n}\n`;
      const bytes = buildArchitecturePdf(inputFor({ 'main.tf': text }));
      const { runs } = pdfLayout(bytes);
      const at = runs.findIndex((r) => r.text === '10002');
      const end = runs.findIndex((r) => r.text === '10003');
      expect(at).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(at);
      const chunks = runs.slice(at + 1, end);
      expect(chunks.length).toBeGreaterThan(1);
      expectLaidOut(bytes, 'long code lines');
      // the chunks put back together are the whole line, as printed
      expect(chunks.map((r) => r.text).join('')).toBe(long.replace(/→/g, '->').replace(/≥/g, '>=').replace(/😀/g, '?'));
    });
  });

  it('links the table of contents to where each section starts, like its bookmark', () => {
    const bytes = buildArchitecturePdf(inputFor(TEMPLATES[0].build('demo')));
    const text = latin1(bytes);
    const bookmarks = new Map<string, { page: number; top: number }>();
    const pages = pdfPages(bytes);
    const pageIds = /\/Type \/Pages \/Kids \[([^\]]*)\]/.exec(text)![1].match(/\d+(?= 0 R)/g)!.map(Number);
    for (const m of text.matchAll(/\/Title <FEFF([0-9a-f]*)> \/Parent \d+ 0 R[^/]*(?:\/(?:Prev|Next) \d+ 0 R )*\/Dest \[(\d+) 0 R \/XYZ 0 ([-\d.]+) null\]/g)) {
      const title = String.fromCharCode(...(m[1].match(/..../g) ?? []).map((h) => parseInt(h, 16)));
      bookmarks.set(title, { page: pageIds.indexOf(Number(m[2])), top: Number(m[3]) });
    }
    const overview = pages[1];
    const tocLinks = overview.links.filter((l) => l.dest);
    expect(tocLinks.length).toBeGreaterThanOrEqual(5);
    for (const title of ['Resource inventory', 'Connections & traffic', 'Security review', 'Terraform source']) {
      const mark = bookmarks.get(title)!;
      expect(mark, title).toBeDefined();
      expect(tocLinks.some((l) => l.dest!.page === mark.page && Math.abs(l.dest!.top - mark.top) < 0.01), title).toBe(true);
    }
  });

  describe('large diagrams', () => {
    function grid(n: number): string {
      return Array.from({ length: n }, (_, i) => `# @blueprint:pos=${(i % 16) * 240},${Math.floor(i / 16) * 120}\nresource "aws_instance" "node${i}" {\n  ami           = "ami-${i}"\n  instance_type = "t3.micro"\n}\n`).join('\n');
    }

    it('tiles a diagram too big for one page, keeping node text readable', { timeout: 30_000 }, () => {
      const input = inputFor({ 'main.tf': grid(250) });
      const t0 = performance.now();
      const bytes = buildArchitecturePdf(input);
      expect(performance.now() - t0).toBeLessThan(5_000);
      expectWellFormed(bytes);
      const { pages, runs } = pdfLayout(bytes);
      const tileIndexes = new Set(runs.filter((r) => /^Diagram: area \d+ of \d+$/.test(r.text)).map((r) => r.page));
      const tiles = pages.filter((p) => tileIndexes.has(p.index));
      expect(tiles.length).toBeGreaterThan(1);
      const onTiles = runs.filter((r) => tileIndexes.has(r.page) && r.clipped);
      // every node shows on at least one area page, at ≥ ~5 pt
      for (const r of input.ir.resources) expect(onTiles.some((t) => t.text === r.name), r.name).toBe(true);
      for (const t of onTiles) expect(t.size, t.text).toBeGreaterThanOrEqual(9 * MIN_TILE_SCALE - 0.01);
      // the overview page links each numbered area to its page
      expect(pages[0].links.filter((l) => l.dest && tileIndexes.has(l.dest.page))).toHaveLength(tiles.length);
      expectLaidOut(bytes, '250 nodes');
    });

    it('builds step by step, and can be cancelled', { timeout: 30_000 }, async () => {
      const input = inputFor({ 'main.tf': grid(60) });
      const stages: string[] = [];
      const bytes = await buildArchitecturePdfAsync(input, { onStage: (s) => stages.push(s) });
      expect(bytes).toEqual(buildArchitecturePdf(input));
      expect(stages[0]).toBe('Drawing the diagram…');
      expect(stages.length).toBeGreaterThan(3);

      const controller = new AbortController();
      const run = buildArchitecturePdfAsync(input, { signal: controller.signal, onStage: () => controller.abort() });
      await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    });
  });
});

describe('in Portuguese', () => {
  /** the document as the dialog builds it with the UI in Portuguese: the audit worded in it too */
  function ptInput(files: Record<string, string>, overrides: Partial<ArchDocInput> = {}): ArchDocInput {
    const input = inputFor(files, overrides);
    return { ...input, audit: auditSecurity(input.ir, analyzeSecurity(input.ir, 'pt-BR')), locale: 'pt-BR', ...overrides };
  }
  const withSsh = () => {
    const files = TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('demo');
    return {
      ...files,
      'main.tf': files['main.tf'].replace(
        '  egress {',
        '  ingress {\n    from_port   = 22\n    to_port     = 22\n    protocol    = "tcp"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n\n  egress {',
      ),
    };
  };

  it('every heading, finding, path and control in Portuguese, accents intact', { timeout: 20_000 }, () => {
    const bytes = buildArchitecturePdf(ptInput(withSsh(), { notes: 'Revisão pendente — não compartilhar.' }));
    expectWellFormed(bytes);
    const text = pdfText(bytes);
    for (const s of [
      'Visão geral',
      'Gerado em 28 de set. de 2026, 09:05 com o Cloud Blueprint.',
      'NOTAS',
      'Revisão pendente — não compartilhar.',
      'Inventário de recursos',
      'CONFIGURAÇÃO',
      'LOCALIZAÇÃO',
      'Conexões e tráfego',
      'Tráfego de rede permitido',
      'Revisão de segurança',
      'SSH (porta 22) aberto para a internet',
      'CRÍTICA',
      'Controles de conformidade',
      'Garantir que nenhum grupo de segurança permita entrada de 0.0.0.0/0',
      'As instâncias EC2 devem usar o Instance Metadata',
      'Código Terraform',
      'Neste documento',
    ]) {
      expect(text, s).toContain(s);
    }
    expect(text).toMatch(/Correção sugerida: Restringir a 10\.0\.0\.0\/16/);
    expect(text).toMatch(/:22\s+via Internet gateway igw › Rota 0\.0\.0\.0\/0 -> igw › Sub-rede public_a › Grupo de segurança web ingress #4/);
    expect(text).toMatch(/Página 1 de \d+/);
    // the Terraform itself is never translated
    expect(text).toContain('resource "aws_security_group" "web" {');
    expect(text).not.toMatch(/\b(Overview|Findings|Security review|Page \d+ of)\b/);
    // the accented letters went out as their WinAnsi codes (ç = E7, ã = E3), not as '?'
    expect(latin1(bytes)).toMatch(/<[0-9a-f]*e7e36f[0-9a-f]*> Tj/);
    expectLaidOut(bytes, 'pt-BR security review');
    expectNoStrandedHeadings(bytes, 'pt-BR security review');
  });

  it('measures accented text with the real glyph widths (Adobe core-14 AFM)', () => {
    // á ã â ç é ê í ó õ ô ú in Helvetica: 556 556 556 500 556 556 278 556 556 556 556
    expect(textWidth('áãâçéêíóõôú', 'regular', 1000)).toBe(556 * 3 + 500 + 556 * 2 + 278 + 556 * 4);
    // Á Ç É Í Ó Ú in Helvetica-Bold: 722 722 667 278 778 722
    expect(textWidth('ÁÇÉÍÓÚ', 'bold', 1000)).toBe(722 + 722 + 667 + 278 + 778 + 722);
    expect(textWidth('Configuração', 'regular', 10)).toBeCloseTo(textWidth('Configuracao', 'regular', 10), 5);
  });

  it('stays inside the margins on both papers, for every template', { timeout: 60_000 }, () => {
    for (const t of TEMPLATES) {
      for (const paper of ['a4', 'letter'] as const) {
        const bytes = buildArchitecturePdf(ptInput(t.build('demo'), { paper, notes: notesOf(14), sections: { ...ALL, cost: true } }));
        const label = `pt-BR ${t.slug}, ${paper}`;
        expectLaidOut(bytes, label);
        expectNoStrandedHeadings(bytes, label);
      }
    }
    const every = buildArchitecturePdf(ptInput({ 'main.tf': everyCategory() }));
    expectLaidOut(every, 'pt-BR every category');
    expectNoStrandedHeadings(every, 'pt-BR every category');
  });

  it('diagram legend, lens chips, tiles and stages', { timeout: 30_000 }, async () => {
    const tall = Array.from({ length: 12 }, (_, i) => `# @blueprint:pos=0,${i * 110}\nresource "aws_instance" "i${i}" {\n  ami = "ami-1"\n}\n`).join('\n');
    const input = ptInput({ 'main.tf': tall });
    const lens = buildArchitecturePdf({ ...input, diagram: fakeDiagram(input.ir, input.edges, true) });
    const text = pdfText(lens);
    for (const s of ['Limite de rede (VPC, sub-rede, grupo)', 'Tráfego permitido (lente de segurança)', 'PÚBLICO :80, :443']) expect(text, s).toContain(s);
    expectLaidOut(lens, 'pt-BR lens legend');

    const grid = Array.from({ length: 250 }, (_, i) => `# @blueprint:pos=${(i % 16) * 240},${Math.floor(i / 16) * 120}\nresource "aws_instance" "node${i}" {\n  ami = "ami-${i}"\n}\n`).join('\n');
    const big = ptInput({ 'main.tf': grid });
    const stages: string[] = [];
    const bytes = await buildArchitecturePdfAsync(big, { onStage: (s) => stages.push(s) });
    expect(stages[0]).toBe('Desenhando o diagrama…');
    expect(stages).toContain('Salvando…');
    expect(pdfText(bytes)).toMatch(/Diagrama: área 1 de \d+/);
    expectLaidOut(bytes, 'pt-BR tiles');
  });

  it('names resources and categories as the catalog does in Portuguese', () => {
    const input = ptInput(TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('demo'));
    const text = pdfText(buildArchitecturePdf(input));
    for (const s of ['Instância EC2', 'Instância RDS', 'Perfil do IAM', 'Sub-rede', 'Grupo de segurança', 'Computação', 'Rede', 'Banco de dados']) {
      expect(text, s).toContain(s);
    }
    expect(text).not.toContain('EC2 Instance');
  });

  it("a subnet's lens badge", () => {
    const files = {
      'main.tf': 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n\nresource "aws_subnet" "a" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.0.1.0/24"\n}\n',
    };
    const input = ptInput(files);
    const diagram = { ...fakeDiagram(input.ir, input.edges), lens: true };
    diagram.nodes = diagram.nodes.map((n) => (n.id === 'aws_subnet.a' ? { ...n, security: { subnet: 'public' as const } } : n));
    expect(pdfText(buildArchitecturePdf({ ...input, diagram }))).toContain('PÚBLICA');
    const english = inputFor(files);
    expect(pdfText(buildArchitecturePdf({ ...english, diagram }))).toContain('PUBLIC');
  });
});

