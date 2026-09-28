/**
 * Round-trip property test: for every fixture (all templates, adversarial
 * snippets from the bug reports, realistic module-style code) and every op
 * kind, a canvas edit must
 *   - not add parse errors,
 *   - leave every byte outside the edited block (or attribute) identical,
 *   - keep every comment it didn't delete,
 *   - and an edit that changes nothing must change no byte.
 */
import { describe, expect, it } from 'vitest';
import { collectRefs, exprEquals, lit, ref, refTargetAddress, renameInHcl } from '@/ir/expr';
import { deriveStructure } from '@/ir/graph';
import type { Op } from '@/ir/ops';
import type { EntrySpan, Expression, IR, ResourceNode } from '@/ir/types';
import { TEMPLATES } from '@/templates';
import { emitExpression } from './emitter';
import { parseProject } from './parser';
import { applyOpsWithPatches } from './patch';

const ADVERSARIAL: Record<string, string> = {
  'sg-comments': `# Security
resource "aws_security_group" "web" {
  name        = "web"
  description = "web tier"

  ingress { # HTTPS from office
    from_port   = 443 # https
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [
      "10.0.0.0/8", # office
      "192.168.0.0/16",
    ]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port = 80
    to_port   = 80
    protocol  = "tcp"
  }

  tags = { # owning team
    Team = "platform" # ask in #platform
  }
} # end of web
`,
  heredoc: `resource "aws_instance" "web" {
  ami       = "ami-123"
  user_data = <<EOF
echo hi


echo "two blank lines above"
EOF
  # size
  instance_type = "t3.micro"
}

resource "aws_s3_bucket" "logs" {
  bucket = "logs"
}
`,
  comprehensions: `resource "aws_lb" "main" {
  name    = "main"
  subnets = [for s in aws_subnet.public : s.id]
  nested  = [[for s in aws_subnet.public : s.id]]
  by_name = {for k, v in var.things : k => v.id}
}

resource "aws_subnet" "public" {
  cidr_block = "10.0.1.0/24"
}
`,
  strings: `resource "aws_s3_bucket" "b" {
  bucket   = "\${replace(var.name, "{", "")}-logs"
  cond     = "\${var.x == "}" ? "a" : "b"}"
  escaped  = "price $\${5} and %%{ok}"
  unicode  = "\\U0001F600 \\u00e9 tab\\tq\\"uote\\\\"
  count_to = 9007199254740993
  ratio    = 1.50
  sci      = 1e3
}
`,
  'indexed-refs': `resource "aws_subnet" "private" {
  count      = 2
  cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  vpc_id     = aws_vpc.main.id
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_security_group" "sg" {
  for_each = toset(["web", "db"])
  vpc_id   = aws_vpc.main.id
}

resource "aws_instance" "app" {
  subnet_id              = aws_subnet.private[0].id
  vpc_security_group_ids = [aws_security_group.sg["web"].id]
  all_subnets            = aws_subnet.private[*].id
  name                   = "\${aws_vpc.main.id}-a"
}
`,
  layout: `resource "aws_instance" "odd" {
  ami = "x"
  tags = { Name = "web", Env = "prod" }
  cpu = 1.50


  lifecycle {
    create_before_destroy = true
  } # keep


  root_block_device { volume_size = 20 }
}
resource "aws_s3_bucket" "one_line" { bucket = "e2e-logs" }
resource aws_vpc bare_labels {
  cidr_block = "10.9.0.0/16"
}
`,
  crlf: '# CRLF file\r\nresource "aws_vpc" "main" {\r\n  cidr_block = "10.0.0.0/16"\r\n  tags = {\r\n    Name = "main"\r\n  }\r\n}\r\n\r\nresource "aws_subnet" "a" {\r\n  vpc_id     = aws_vpc.main.id\r\n  cidr_block = "10.0.1.0/24"\r\n}\r\n',
  bom: '﻿resource "aws_s3_bucket" "first" {\n  bucket = "first"\n}\n\nresource "aws_s3_bucket" "second" {\n  bucket = "second"\n}\n',
  banner: `# Networking
# @blueprint:pos=40,60,680,430
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

# @blueprint:pos=32,64,300,176
resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}


# Compute
resource "aws_instance" "web" {
  subnet_id = aws_subnet.a.id
}
`,
};

const MODULE_STYLE = `locals {
  name = "ex-\${basename(path.cwd)}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 3)
  tags = {
    Example = local.name # who
  }
}

data "aws_availability_zones" "available" {}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
}

resource "aws_vpc" "this" {
  count = var.create_vpc ? 1 : 0

  cidr_block           = var.cidr
  enable_dns_hostnames = var.enable_dns_hostnames # DNS names

  tags = merge(
    { "Name" = var.name },
    var.tags,
  )
}

resource "aws_subnet" "public" {
  count = length(var.public_subnets)

  vpc_id            = aws_vpc.this[0].id
  cidr_block        = element(concat(var.public_subnets, [""]), count.index)
  availability_zone = length(regexall("^[a-z]{2}-", element(local.azs, count.index))) > 0 ? element(local.azs, count.index) : null

  tags = merge(
    {
      Name = format("\${var.name}-public-%s", element(local.azs, count.index))
    },
    var.tags,
  )
}

resource "aws_security_group" "this" {
  name_prefix = "\${local.name}-"
  vpc_id      = aws_vpc.this[0].id

  dynamic "ingress" {
    for_each = var.ingress_rules
    content {
      from_port   = ingress.value.from_port
      to_port     = ingress.value.to_port
      protocol    = "tcp"
      cidr_blocks = ingress.value.cidrs
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_instance" "web" {
  for_each = toset(["a", "b"])

  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.this.id]
  user_data              = <<-EOT
    #!/bin/bash
    echo "Hello, World \${each.key}" > index.html


    nohup busybox httpd -f -p 8080 &
  EOT

  provisioner "local-exec" {
    command = "echo \${self.private_ip} >> ips.txt"
  }

  tags = { Name = "web-\${each.key}", Env = "prod" }
}

module "db" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.0"

  identifier             = "\${local.name}-db"
  vpc_security_group_ids = [aws_security_group.this.id]
}

output "vpc_id" {
  description = "The ID of the VPC"
  value       = try(aws_vpc.this[0].id, null)
}
`;

const CORPUS: Array<[string, Record<string, string>]> = [
  ...TEMPLATES.map((t): [string, Record<string, string>] => [`template ${t.slug}`, t.build('demo')]),
  ...Object.entries(ADVERSARIAL).map(([name, src]): [string, Record<string, string>] => [name, { 'main.tf': src }]),
  ['module-style', { 'main.tf': MODULE_STYLE }],
];

// ------------------------------------------------------------------ helpers

const errorCount = (d: Array<{ severity: string }>) => d.filter((x) => x.severity === 'error').length;

/** `#` / `//` comment tokens, one per line (skips quoted text on the line; heredoc bodies may count) */
function comments(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\') i++;
      else if (line[i] === '"') quoted = !quoted;
      else if (!quoted && (line[i] === '#' || line.startsWith('//', i))) {
        const c = line.slice(i).trim();
        if (!c.startsWith('# @blueprint:pos')) out.push(c);
        break;
      }
    }
  }
  return out;
}

function expectSubMultiset(expected: string[], actual: string[], label: string) {
  const pool = [...actual];
  for (const c of expected) {
    const i = pool.indexOf(c);
    expect(i, `${label}: comment ${JSON.stringify(c)} survives`).not.toBe(-1);
    pool.splice(i, 1);
  }
}

/** first and last differing offsets between two texts (old coordinates) */
function changedRegion(before: string, after: string): { start: number; endOld: number } | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endOld = before.length;
  let endNew = after.length;
  while (endOld > start && endNew > start && before[endOld - 1] === after[endNew - 1]) {
    endOld--;
    endNew--;
  }
  return { start, endOld };
}

/** the block range widened over the blank lines around it (what a removal may consume) */
function widened(text: string, start: number, end: number) {
  let s = start;
  while (s > 0 && /^[ \t\r]*\n$/.test(text.slice(text.lastIndexOf('\n', s - 2) + 1, s))) {
    s = text.lastIndexOf('\n', s - 2) + 1;
  }
  let e = end;
  while (e < text.length) {
    const nl = text.indexOf('\n', e);
    const next = nl === -1 ? text.length : nl + 1;
    if (!/^[ \t\r]*\n?$/.test(text.slice(e, next)) || next === e) break;
    e = next;
  }
  return { start: s, end: e };
}

function attrSpans(node: ResourceNode): EntrySpan[] {
  return node.trivia.spans?.body.entries.filter((e) => e.kind === 'attr') ?? [];
}

function freshValue(e: Expression): Expression {
  if (e.kind === 'literal' && typeof e.value === 'number') return lit(e.value + 7);
  if (e.kind === 'literal' && typeof e.value === 'boolean') return lit(!e.value);
  return lit('fuzzed-value');
}

interface Case {
  label: string;
  node: ResourceNode;
  file: string;
  ops: Op[];
  check(before: string, after: string, next: IR): void;
}

function casesFor(ir: IR): Case[] {
  const out: Case[] = [];
  for (const node of ir.resources) {
    const file = node.trivia.sourceFile!;
    const range = node.trivia.rawTextRange!;
    const outsideBlockUntouched = (before: string, after: string) => {
      const region = changedRegion(before, after);
      if (!region) return;
      expect(region.start, 'no byte before the block changes').toBeGreaterThanOrEqual(range.start);
      expect(region.endOld, 'no byte after the block changes').toBeLessThanOrEqual(range.end);
    };
    const others = ir.resources.filter((r) => r.id !== node.id);

    out.push({
      label: `move ${node.id}`,
      node,
      file,
      ops: [{ kind: 'move_node', nodeId: node.id, position: { x: 123, y: 456 } }],
      check(before, after, next) {
        outsideBlockUntouched(before, after);
        // only the position line changes
        const withoutPos = (t: string) => t.replace(/^﻿?[ \t]*# @blueprint:pos=.*\r?\n/gm, (m) => (m.startsWith('﻿') ? '﻿' : ''));
        expect(withoutPos(after)).toBe(withoutPos(before));
        expect(next.resources.find((r) => r.id === node.id)?.position).toEqual({ x: 123, y: 456 });
      },
    });

    const attrs = attrSpans(node).filter((s) => node.args[s.key] !== undefined);
    const literal = attrs.find((s) => node.args[s.key].kind === 'literal');
    if (literal) {
      const value = freshValue(node.args[literal.key]);
      out.push({
        label: `set ${node.id}.${literal.key}`,
        node,
        file,
        ops: [{ kind: 'set_arg', nodeId: node.id, field: literal.key, value }],
        check(before, after, next) {
          // exactly the value's bytes are replaced
          const eol = before.includes('\r\n') ? '\r\n' : '\n';
          const emitted = emitExpression(value, '  ').replace(/\n/g, eol);
          expect(after).toBe(before.slice(0, literal.valueStart) + emitted + before.slice(literal.valueEnd));
          expect(exprEquals(next.resources.find((r) => r.id === node.id)!.args[literal.key], value)).toBe(true);
        },
      });
    }

    out.push({
      label: `add arg to ${node.id}`,
      node,
      file,
      ops: [{ kind: 'set_arg', nodeId: node.id, field: 'fuzz_new', value: lit('v') }],
      check(before, after, next) {
        outsideBlockUntouched(before, after);
        expect(next.resources.find((r) => r.id === node.id)?.args.fuzz_new).toEqual(lit('v'));
      },
    });

    const removable = attrs[attrs.length - 1];
    if (removable) {
      out.push({
        label: `unset ${node.id}.${removable.key}`,
        node,
        file,
        ops: [{ kind: 'unset_arg', nodeId: node.id, field: removable.key }],
        check(before, after, next) {
          outsideBlockUntouched(before, after);
          const gone = comments(before.slice(removable.start, removable.end));
          const kept = comments(before);
          for (const c of gone) kept.splice(kept.indexOf(c), 1);
          expectSubMultiset(kept, comments(after), 'unset');
          expect(next.resources.find((r) => r.id === node.id)?.args[removable.key]).toBeUndefined();
        },
      });
    }

    const target = others[0];
    if (target) {
      out.push({
        label: `connect ${node.id} → ${target.id}`,
        node,
        file,
        ops: [{ kind: 'set_arg', nodeId: node.id, field: 'fuzz_ref', value: ref(`${target.id}.id`) }],
        check(before, after, next) {
          outsideBlockUntouched(before, after);
          const edges = deriveStructure(next, () => undefined);
          expect(edges.some((e) => e.source === node.id && e.target === target.id)).toBe(true);
        },
      });
    }

    const list = attrs.find((s) => node.args[s.key].kind === 'list');
    if (list && target) {
      const current = node.args[list.key] as Extract<Expression, { kind: 'list' }>;
      const value: Expression = { kind: 'list', items: [...current.items, ref(`${target.id}.id`)] };
      out.push({
        label: `append to ${node.id}.${list.key}`,
        node,
        file,
        ops: [{ kind: 'set_arg', nodeId: node.id, field: list.key, value }],
        check(before, after) {
          // only the list's own bytes change
          expect(after.slice(0, list.valueStart)).toBe(before.slice(0, list.valueStart));
          const tail = before.slice(list.valueEnd);
          expect(after.endsWith(tail)).toBe(true);
        },
      });
    }

    out.push({
      label: `rename ${node.id}`,
      node,
      file,
      ops: [{ kind: 'rename_resource', nodeId: node.id, newName: `${node.name}_renamed` }],
      check(before, after, next) {
        const to = `${node.type}.${node.name}_renamed`;
        const label = node.trivia.spans!.labels[1];
        // exactly: the name label, plus every reference to the old address
        const relabeled =
          before.slice(0, label.start) +
          (label.quoted ? `"${node.name}_renamed"` : `${node.name}_renamed`) +
          before.slice(label.end);
        expect(after).toBe(renameInHcl(relabeled, node.id, to));
        for (const r of next.resources) {
          const refs: Array<{ field: string; path: string }> = [];
          for (const [f, e] of Object.entries(r.args)) collectRefs(e, f, refs);
          expect(refs.some((x) => refTargetAddress(x.path) === node.id), `${r.id} still points at ${node.id}`).toBe(false);
        }
        expect(next.resources.some((r) => r.id === to)).toBe(true);
      },
    });

    out.push({
      label: `remove ${node.id}`,
      node,
      file,
      ops: [{ kind: 'remove_resource', nodeId: node.id }],
      check(before, after, next) {
        // `after` is `before` minus one contiguous chunk that lies within the block (+ blank lines around it)
        const w = widened(before, range.start, range.end);
        const cut = before.length - after.length;
        let found = false;
        for (let at = w.start; at + cut <= w.end && !found; at++) {
          found = before.slice(0, at) === after.slice(0, at) && before.slice(at + cut) === after.slice(at);
        }
        expect(found, 'only the block and its seam are removed').toBe(true);
        const kept = comments(before);
        for (const c of comments(before.slice(range.start, range.end))) kept.splice(kept.indexOf(c), 1);
        expectSubMultiset(kept, comments(after), 'remove');
        expect(next.resources.filter((r) => r.id === node.id)).toHaveLength(
          ir.resources.filter((r) => r.id === node.id).length - 1,
        );
      },
    });
  }

  out.push({
    label: 'add a resource',
    node: ir.resources[0],
    file: 'main.tf',
    ops: [
      {
        kind: 'add_resource',
        node: {
          id: 'aws_s3_bucket.fuzz_added',
          provider: 'aws',
          type: 'aws_s3_bucket',
          name: 'fuzz_added',
          args: { bucket: lit('fuzz') },
          position: { x: 1, y: 2 },
          trivia: { leadingComments: [] },
        },
      },
    ],
    check(before, after, next) {
      const eol = before.includes('\r\n') ? '\r\n' : '\n';
      expect(after.startsWith(before.replace(/\s+$/, ''))).toBe(true);
      expect(after.endsWith(`}${eol}`)).toBe(true);
      expect(next.resources.some((r) => r.id === 'aws_s3_bucket.fuzz_added')).toBe(true);
    },
  });
  return out;
}

describe('round-trip property: canvas ops patch only what they touch', () => {
  for (const [name, files] of CORPUS) {
    it(name, () => {
      const { ir, diagnostics } = parseProject(files);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

      // the untouched parse → patch path is byte-identical
      expect(applyOpsWithPatches(files, ir, []).files).toEqual(files);
      for (const node of ir.resources) {
        const noops: Op[] = [
          ...Object.entries(node.args).map(
            ([field, value]): Op => ({ kind: 'set_arg', nodeId: node.id, field, value }),
          ),
          ...(node.trivia.spans?.pos && node.position
            ? [{ kind: 'move_node', nodeId: node.id, position: { ...node.position } } as Op]
            : []),
        ];
        const out = applyOpsWithPatches(files, ir, noops);
        expect(out.refused).toBeUndefined();
        expect(out.files, `no-op edits of ${node.id}`).toEqual(files);
      }

      for (const c of casesFor(ir)) {
        const out = applyOpsWithPatches(files, ir, c.ops);
        expect(out.refused, c.label).toBeUndefined();
        expect(errorCount(out.diagnostics), `${c.label}: no new parse errors`).toBe(0);
        // the incremental re-parse must be indistinguishable from parsing the output from scratch
        const full = parseProject(out.files);
        expect(out.ir, `${c.label}: IR equals a full parse`).toEqual(full.ir);
        expect(out.diagnostics).toEqual(full.diagnostics);
        for (const [file, text] of Object.entries(files)) {
          const after = out.files[file];
          if (file !== c.file) {
            // a rename only rewrites the references in other files
            const op = c.ops[0];
            const expected =
              op.kind === 'rename_resource'
                ? renameInHcl(text, c.node.id, `${c.node.type}.${op.newName}`)
                : text;
            expect(after, `${c.label}: ${file}`).toBe(expected);
          }
          if (text.includes('\r\n')) {
            expect(/(^|[^\r])\n/.test(after), `${c.label}: ${file} keeps CRLF line endings`).toBe(false);
          }
          if (c.ops[0].kind === 'move_node' || c.ops[0].kind === 'set_arg' || c.ops[0].kind === 'rename_resource') {
            expectSubMultiset(comments(text), comments(after), c.label);
          }
        }
        try {
          c.check(files[c.file] ?? '', out.files[c.file] ?? '', out.ir);
        } catch (e) {
          throw new Error(`${name} / ${c.label}: ${(e as Error).message}`);
        }
      }
    });
  }
});
