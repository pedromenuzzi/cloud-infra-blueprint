import { beforeAll, describe, expect, it } from 'vitest';
import { block, blocks, lit, list, ref } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { Expression, IR } from '@/ir/types';
import { parseProject } from './parser';
import { applyOpsWithPatches } from './patch';

function patch(src: string, ops: Op[] | ((ir: IR) => Op[]), file = 'main.tf') {
  const files = { [file]: src };
  const { ir } = parseProject(files);
  const out = applyOpsWithPatches(files, ir, typeof ops === 'function' ? ops(ir) : ops);
  return { ...out, text: out.files[file], errors: out.diagnostics.filter((d) => d.severity === 'error') };
}

const move = (nodeId: string, x = 10, y = 20): Op => ({ kind: 'move_node', nodeId, position: { x, y } });
const set = (nodeId: string, field: string, value: Expression): Op => ({ kind: 'set_arg', nodeId, field, value });

const SG = `resource "aws_security_group" "web" {
  name = "web"

  ingress { # HTTPS from office
    from_port   = 443 # https
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [
      "10.0.0.0/8", # office
    ]
  }

  egress {
    from_port = 0
  }

  ingress {
    from_port = 80
  }

  tags = { # owning team
    Team = "platform"
  }
  price  = 1.50
  inline = { Name = "web", Env = "prod" }
} # end
`;

describe('stale IR (code edited after the last successful parse)', () => {
  const good = `resource "aws_security_group" "sg" {
  cidr_blocks = ["0.0.0.0/0"]
}

# Compute
resource "aws_instance" "web" {
  ami = "x"
}
`;
  for (const broken of ['@@@ oops\n', 'resource "aws_s3_bucket" "half" { bucket = \n']) {
    it(`refuses to splice when line 1 became ${JSON.stringify(broken.trim())}`, () => {
      const { ir } = parseProject({ 'main.tf': good });
      const edited = { 'main.tf': broken + good };
      const out = applyOpsWithPatches(edited, ir, [move('aws_instance.web')]);
      expect(out.refused?.file).toBe('main.tf');
      expect(out.refused?.message).toMatch(/not applied/);
      expect(out.files).toBe(edited);
      expect(out.ir).toBe(ir);
      expect(out.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    });
  }

  it('refuses when text between blocks changed, even if every block is intact', () => {
    const { ir } = parseProject({ 'main.tf': good });
    const edited = { 'main.tf': good.replace('# Compute', 'oops!!!!!') };
    expect(applyOpsWithPatches(edited, ir, [move('aws_instance.web')]).refused).toBeDefined();
  });

  it('refuses a patch that would add parse errors (duplicate address)', () => {
    const out = patch(good, [{ kind: 'rename_resource', nodeId: 'aws_instance.web', newName: 'web' }, set('aws_instance.web', 'ami', lit('y'))]);
    expect(out.refused).toBeUndefined();
    const dup = patch(good, (ir) => [
      { kind: 'add_resource', node: { ...ir.resources[1], trivia: { leadingComments: [] } } },
    ]);
    expect(dup.refused?.message).toMatch(/Duplicate resource/);
    expect(dup.text).toBe(good);
  });

  it('applies normally once the code parses again', () => {
    const { ir } = parseProject({ 'main.tf': good });
    const out = applyOpsWithPatches({ 'main.tf': good }, ir, [move('aws_instance.web')]);
    expect(out.refused).toBeUndefined();
    expect(out.files['main.tf']).toContain('# Compute\n# @blueprint:pos=10,20\nresource "aws_instance" "web"');
  });
});

describe('patches touch only what changed', () => {
  it('a move rewrites or inserts only the position line', () => {
    const moved = patch(SG, [move('aws_security_group.web')]);
    expect(moved.text).toBe(`# @blueprint:pos=10,20\n${SG}`);
    const again = patch(moved.text, [move('aws_security_group.web', 5, 6)]);
    expect(again.text).toBe(`# @blueprint:pos=5,6\n${SG}`);
  });

  it('a move keeps a position comment written inside the body where it is', () => {
    const src = 'resource "aws_s3_bucket" "b" {\n  # @blueprint:pos=1,2\n  bucket = "b"\n}\n';
    expect(patch(src, [move('aws_s3_bucket.b', 3, 4)]).text).toBe(src.replace('1,2', '3,4'));
  });

  it('set_arg replaces only the value (comments, lists, objects, numbers, order, `} # end` intact)', () => {
    const out = patch(SG, [set('aws_security_group.web', 'name', lit('web-2'))]);
    expect(out.text).toBe(SG.replace('name = "web"', 'name = "web-2"'));
  });

  it('set_arg of a new attribute adds one line after the last attribute', () => {
    const out = patch(SG, [set('aws_security_group.web', 'vpc_id', ref('aws_vpc.main.id'))]);
    expect(out.text).toBe(SG.replace('} # end', '  vpc_id = aws_vpc.main.id\n} # end'));
  });

  it('unset_arg removes the attribute lines and nothing else', () => {
    const out = patch(SG, [{ kind: 'unset_arg', nodeId: 'aws_security_group.web', field: 'tags' }]);
    expect(out.text).toBe(SG.replace('  tags = { # owning team\n    Team = "platform"\n  }\n', ''));
  });

  it('editing one rule of repeated blocks keeps the others byte-identical and in order', () => {
    const out = patch(SG, (ir) => {
      const sg = ir.resources[0];
      const rules = sg.args.ingress as Extract<Expression, { kind: 'blocks' }>;
      return [set(sg.id, 'ingress', blocks([rules.items[0], { ...rules.items[1], from_port: lit(8080) }]))];
    });
    expect(out.text).toBe(SG.replace('from_port = 80\n', 'from_port = 8080\n'));
  });

  it('adding a rule appends it after the last block of that kind', () => {
    const out = patch(SG, (ir) => {
      const sg = ir.resources[0];
      const rules = sg.args.ingress as Extract<Expression, { kind: 'blocks' }>;
      return [set(sg.id, 'ingress', blocks([...rules.items, { from_port: lit(22) }]))];
    });
    expect(out.text).toBe(
      SG.replace('    from_port = 80\n  }\n', '    from_port = 80\n  }\n\n  ingress {\n    from_port = 22\n  }\n'),
    );
  });

  it('removing a rule removes only its lines', () => {
    const out = patch(SG, (ir) => {
      const rules = ir.resources[0].args.ingress as Extract<Expression, { kind: 'blocks' }>;
      return [set('aws_security_group.web', 'ingress', block(rules.items[0]))];
    });
    expect(out.text).toBe(SG.replace('  ingress {\n    from_port = 80\n  }\n\n', ''));
  });

  it('a new nested block goes at the end of the body', () => {
    const src = 'resource "aws_instance" "web" {\n  ami = "x"\n}\n';
    const out = patch(src, [set('aws_instance.web', 'lifecycle', block({ create_before_destroy: lit(true) }))]);
    expect(out.text).toBe(
      'resource "aws_instance" "web" {\n  ami = "x"\n\n  lifecycle {\n    create_before_destroy = true\n  }\n}\n',
    );
  });

  it('re-aligns `=` only in the run the new attribute joins, and only if it was aligned', () => {
    const src = `resource "aws_instance" "web" {
  ami  = "x"
  type = "t3"

  lifecycle {
    create_before_destroy = true
  }
}
`;
    const out = patch(src, [set('aws_instance.web', 'subnet_id', ref('aws_subnet.a.id'))]);
    expect(out.text).toBe(src.replace('  ami  = "x"\n  type = "t3"\n', '  ami       = "x"\n  type      = "t3"\n  subnet_id = aws_subnet.a.id\n'));

    const unaligned = src.replace('ami  =', 'ami =');
    const out2 = patch(unaligned, [set('aws_instance.web', 'subnet_id', ref('aws_subnet.a.id'))]);
    expect(out2.text).toBe(unaligned.replace('  type = "t3"\n', '  type = "t3"\n  subnet_id = aws_subnet.a.id\n'));

    const removed = patch(out.text, [{ kind: 'unset_arg', nodeId: 'aws_instance.web', field: 'subnet_id' }]);
    expect(removed.text).toBe(src);
  });

  it('connecting to a one-item-per-line list adds a line and keeps the comments', () => {
    const src = `resource "aws_instance" "web" {
  vpc_security_group_ids = [
    aws_security_group.a.id, # main
  ]
}
`;
    const out = patch(src, [
      set('aws_instance.web', 'vpc_security_group_ids', list([ref('aws_security_group.a.id'), ref('aws_security_group.b.id')])),
    ]);
    expect(out.text).toBe(src.replace('# main\n', '# main\n    aws_security_group.b.id,\n'));
    const back = patch(out.text, [set('aws_instance.web', 'vpc_security_group_ids', list([ref('aws_security_group.a.id')]))]);
    expect(back.text).toBe(src);
  });

  it('a single-line block is re-emitted when it has to grow', () => {
    const src = 'resource "aws_s3_bucket" "logs" { bucket = "logs" }\n';
    const out = patch(src, [set('aws_s3_bucket.logs', 'acl', lit('private'))]);
    expect(out.text).toBe('resource "aws_s3_bucket" "logs" {\n  bucket = "logs"\n  acl    = "private"\n}\n');
    expect(patch(src, [set('aws_s3_bucket.logs', 'bucket', lit('x'))]).text).toBe(src.replace('"logs" }', '"x" }'));
  });

  it('renames rewrite the label and reference tokens in place', () => {
    const src = `resource "aws_subnet" "a" {
  vpc_id = aws_vpc.main.id
  ids    = [
    aws_vpc.main.id, # the vpc
    aws_vpc.main2.id,
  ]
}

resource aws_vpc main {
  cidr_block = "10.0.0.0/16"
}
`;
    const out = patch(src, [{ kind: 'rename_resource', nodeId: 'aws_vpc.main', newName: 'core' }]);
    expect(out.text).toBe(
      src
        .replace('vpc_id = aws_vpc.main.id', 'vpc_id = aws_vpc.core.id')
        .replace('aws_vpc.main.id, # the vpc', 'aws_vpc.core.id, # the vpc')
        .replace('resource aws_vpc main {', 'resource aws_vpc core {'),
    );
  });
});

describe('heredocs, comprehensions and literals survive edits', () => {
  it('a comment line after a heredoc stays on its own line', () => {
    const src = 'resource "aws_instance" "web" {\n  user_data = <<EOF\necho hi\nEOF\n  # size\n  instance_type = "t3.micro"\n}\n';
    const out = patch(src, [move('aws_instance.web')]);
    expect(out.errors).toEqual([]);
    expect(out.text).toBe(`# @blueprint:pos=10,20\n${src}`);
    expect(out.ir.resources[0].trivia.argComments?.instance_type).toEqual(['# size']);
  });

  it('comprehensions are kept verbatim', () => {
    const src = 'resource "aws_lb" "x" {\n  subnets = [for s in aws_subnet.public : s.id]\n  nested  = [[for s in aws_subnet.public : s.id]]\n  by_key  = {for k, v in var.m : k => v}\n}\n';
    const out = patch(src, [move('aws_lb.x'), set('aws_lb.x', 'name', lit('x'))]);
    expect(out.text).toBe(`# @blueprint:pos=10,20\n${src.replace('\n}', '\n  name    = "x"\n}')}`);
  });

  it('literal text with ${ or %{ is escaped, and reads back as the same text', () => {
    const src = 'resource "aws_s3_bucket" "b" {\n  bucket = "x"\n}\n';
    const out = patch(src, [set('aws_s3_bucket.b', 'bucket', lit('price ${')), set('aws_s3_bucket.b', 'note', lit('Hello ${var.env} %{if}'))]);
    expect(out.text).toContain('bucket = "price $${"');
    expect(out.text).toContain('note   = "Hello $${var.env} %%{if}"');
    expect(out.errors).toEqual([]);
    expect(out.ir.resources[0].args.bucket).toEqual(lit('price ${'));
    expect(out.ir.resources[0].args.note).toEqual(lit('Hello ${var.env} %{if}'));
  });

  it('keeps number spellings (1.50, 1e3, integers beyond 2^53)', () => {
    const src = 'resource "x" "a" {\n  n = 9007199254740993\n  f = 1.50\n}\n';
    const out = patch(src, [set('x.a', 'e', { ...lit(1000), text: '1e3' } as Expression)]);
    expect(out.text).toBe('resource "x" "a" {\n  n = 9007199254740993\n  f = 1.50\n  e = 1e3\n}\n');
  });
});

describe('whitespace is normalized only at the seams', () => {
  it('blank lines inside a heredoc and between blocks survive an unrelated move', () => {
    const src = '\n\nresource "aws_instance" "web" {\n  user_data = <<EOF\na\n\n\nb\nEOF\n}\n\n\n\nresource "aws_s3_bucket" "b" {\n  bucket = "x"\n}\n';
    const out = patch(src, [move('aws_s3_bucket.b')]);
    expect(out.text).toBe(src.replace('resource "aws_s3_bucket"', '# @blueprint:pos=10,20\nresource "aws_s3_bucket"'));
  });

  it('removing a block collapses the blank lines it leaves', () => {
    const src = 'resource "a" "one" {\n}\n\nresource "a" "two" {\n}\n\nresource "a" "three" {\n}\n';
    expect(patch(src, [{ kind: 'remove_resource', nodeId: 'a.two' }]).text).toBe('resource "a" "one" {\n}\n\nresource "a" "three" {\n}\n');
    expect(patch(src, [{ kind: 'remove_resource', nodeId: 'a.one' }]).text).toBe('resource "a" "two" {\n}\n\nresource "a" "three" {\n}\n');
    expect(patch(src, [{ kind: 'remove_resource', nodeId: 'a.three' }]).text).toBe('resource "a" "one" {\n}\n\nresource "a" "two" {\n}\n');
  });

  it('appending leaves exactly one blank line after the existing text', () => {
    const add: Op = {
      kind: 'add_resource',
      node: { id: 'a.new', provider: 'other', type: 'a', name: 'new', args: {}, trivia: { leadingComments: [] } },
    };
    for (const tail of ['}', '}\n', '}\n\n\n\n']) {
      expect(patch(`resource "a" "one" {\n${tail}`, [add]).text).toBe('resource "a" "one" {\n}\n\nresource "a" "new" {}\n');
    }
  });
});

describe('duplicate addresses', () => {
  const src = 'resource "aws_s3_bucket" "a" {\n  bucket = "one"\n}\n\nresource "aws_s3_bucket" "a" {\n  bucket = "two"\n}\n';

  it('are reported as an error', () => {
    const { diagnostics } = parseProject({ 'main.tf': src });
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', start: { line: 5, col: 1 }, message: expect.stringMatching(/Duplicate resource "aws_s3_bucket.a".*main.tf:1/) }),
    ]);
  });

  it('edits go to the block the IR op targets (the first)', () => {
    expect(patch(src, [set('aws_s3_bucket.a', 'bucket', lit('ONE'))]).text).toBe(src.replace('"one"', '"ONE"'));
    const removed = patch(src, [{ kind: 'remove_resource', nodeId: 'aws_s3_bucket.a' }]);
    expect(removed.text).toBe('resource "aws_s3_bucket" "a" {\n  bucket = "two"\n}\n');
    expect(removed.ir.resources.map((r) => r.args.bucket)).toEqual([lit('two')]);
  });
});

describe('file conventions', () => {
  it('keeps CRLF line endings in edited and new text', () => {
    const src = 'resource "aws_s3_bucket" "a" {\r\n  bucket = "one"\r\n}\r\n';
    const out = patch(src, [
      set('aws_s3_bucket.a', 'tags', { kind: 'object', fields: { Name: lit('a'), Team: lit('b') } }),
      move('aws_s3_bucket.a'),
      { kind: 'add_resource', node: { id: 'a.b', provider: 'other', type: 'a', name: 'b', args: { x: lit(1) }, trivia: { leadingComments: [] } } },
    ]);
    expect(out.text).not.toMatch(/(^|[^\r])\n/);
    expect(out.text).toContain('# @blueprint:pos=10,20\r\nresource');
    expect(out.errors).toEqual([]);
  });

  it('keeps a leading BOM in front of the file', () => {
    const src = '﻿resource "aws_s3_bucket" "a" {\n  bucket = "one"\n}\n';
    expect(patch(src, [move('aws_s3_bucket.a')]).text).toBe(`﻿# @blueprint:pos=10,20\n${src.slice(1)}`);
    expect(patch(src, [{ kind: 'remove_resource', nodeId: 'aws_s3_bucket.a' }]).text).toBe('﻿');
  });
});

describe('removing a block and its comments', () => {
  it('keeps a section banner that heads the blocks after it', () => {
    const src = `# Networking
# @blueprint:pos=40,60
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

# @blueprint:pos=32,64
resource "aws_subnet" "a" {
  vpc_id = aws_vpc.main.id
}
`;
    const out = patch(src, [{ kind: 'remove_resource', nodeId: 'aws_vpc.main' }]);
    expect(out.text).toBe('# Networking\n\n# @blueprint:pos=32,64\nresource "aws_subnet" "a" {\n  vpc_id = aws_vpc.main.id\n}\n');
  });

  it('removes the comments of a block that is followed by another commented block (or none)', () => {
    const src = '# Compute\nresource "aws_instance" "web" {\n}\n\n# Database\nresource "aws_db_instance" "db" {\n}\n';
    expect(patch(src, [{ kind: 'remove_resource', nodeId: 'aws_instance.web' }]).text).toBe('# Database\nresource "aws_db_instance" "db" {\n}\n');
    expect(patch(src, [{ kind: 'remove_resource', nodeId: 'aws_db_instance.db' }]).text).toBe('# Compute\nresource "aws_instance" "web" {\n}\n');
  });
});

describe('performance', () => {
  const bigProject = (n: number) =>
    Array.from(
      { length: n },
      (_, i) =>
        `# @blueprint:pos=${i},${i}\nresource "aws_instance" "i${i}" {\n  ami           = "ami-123"\n  instance_type = "t3.micro"\n  subnet_id     = aws_subnet.s${i % 10}.id\n  tags = {\n    Name = "i${i}"\n  }\n\n  ingress {\n    from_port = 443\n  }\n}\n`,
    ).join('\n');
  /** best of `runs` after a warm-up, so JIT and GC noise don't count */
  const best = (f: () => void, runs = 8) => {
    f();
    let min = Infinity;
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      f();
      min = Math.min(min, performance.now() - t);
    }
    return min;
  };
  const files = { 'main.tf': bigProject(2000) };
  let ir: IR;
  // Budgets are absolute on an idle machine (a 2k-resource move takes a few ms: untouched
  // blocks are re-used, not re-parsed). On a loaded box everything slows alike, so they are
  // also accepted relative to a bare parse timed alongside: what must never come back is the
  // whole-project re-emission and per-edit re-slicing that made a move cost 4+ parses.
  let parseTime: number;
  beforeAll(() => {
    ir = parseProject(files).ir;
    parseTime = best(() => parseProject(files));
  });

  it('moves one node of a 2k-resource project in < 30 ms (less than one full parse)', () => {
    const moveTime = best(() => applyOpsWithPatches(files, ir, [move('aws_instance.i1000')]));
    expect(moveTime).toBeLessThan(Math.max(30, 1.2 * parseTime));
    expect(moveTime).toBeLessThan(250);
  });

  it('moves every node of a 2k-resource project (tidy) in a few re-parses', () => {
    const ops = ir.resources.map((r, i) => move(r.id, i, 0));
    const out = applyOpsWithPatches(files, ir, ops);
    expect(out.ir.resources[1999].position).toEqual({ x: 1999, y: 0 });
    const tidyTime = best(() => applyOpsWithPatches(files, ir, ops), 3);
    expect(tidyTime).toBeLessThan(Math.max(150, 5 * parseTime));
    expect(tidyTime).toBeLessThan(1000);
  });
});
