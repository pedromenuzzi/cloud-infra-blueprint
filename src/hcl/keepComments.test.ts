/**
 * Comments written inside list and object values survive the edits the
 * canvas and the inspector make to those values — or the edit is refused.
 */
import { describe, expect, it } from 'vitest';
import { lit, list, obj, raw, ref } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { Expression } from '@/ir/types';
import { hasComments, keepComments, lostComments } from './keepComments';
import { parseProject } from './parser';
import { applyOpsWithPatches } from './patch';

function patch(src: string, ops: Op[], file = 'main.tf') {
  const files = { [file]: src };
  const { ir } = parseProject(files);
  const out = applyOpsWithPatches(files, ir, ops);
  return { ...out, text: out.files[file], errors: out.diagnostics.filter((d) => d.severity === 'error') };
}

const set = (nodeId: string, field: string, value: Expression): Op => ({ kind: 'set_arg', nodeId, field, value });

/** the patch applied, the file still parses, and the argument now reads back as `value` */
function expectApplied(out: ReturnType<typeof patch>, nodeId: string, field: string, value: Expression) {
  expect(out.refused).toBeUndefined();
  expect(out.errors).toEqual([]);
  expect(out.ir.resources.find((r) => r.id === nodeId)?.args[field]).toEqual(value);
}

const CIDRS = `resource "aws_security_group" "web" {
  name = "web"

  cidr_blocks = [ # who may connect
    # the office
    "10.0.0.0/8",     # HQ
    "192.168.0.0/16", # VPN
  ]
}
`;

describe('lists with comments inside', () => {
  it('replacing an item keeps every comment and the layout', () => {
    const value = list([lit('10.0.0.0/8'), lit('172.16.0.0/12')]);
    const out = patch(CIDRS, [set('aws_security_group.web', 'cidr_blocks', value)]);
    expectApplied(out, 'aws_security_group.web', 'cidr_blocks', value);
    expect(out.text).toBe(CIDRS.replace('"192.168.0.0/16", # VPN', '"172.16.0.0/12", # VPN'));
  });

  it('removing an item takes its line (and the comment on it); the others stay', () => {
    const value = list([lit('192.168.0.0/16')]);
    const out = patch(CIDRS, [set('aws_security_group.web', 'cidr_blocks', value)]);
    expectApplied(out, 'aws_security_group.web', 'cidr_blocks', value);
    expect(out.text).toBe(CIDRS.replace('    "10.0.0.0/8",     # HQ\n', ''));
  });

  it('adding after an item without a trailing comma gives it one, and keeps its comment', () => {
    const src = `resource "aws_db_subnet_group" "db" {
  subnet_ids = [
    aws_subnet.a.id, # zone a
    aws_subnet.b.id  # zone b
  ]
}
`;
    const value = list([ref('aws_subnet.a.id'), ref('aws_subnet.b.id'), ref('aws_subnet.c.id')]);
    const out = patch(src, [set('aws_db_subnet_group.db', 'subnet_ids', value)]);
    expectApplied(out, 'aws_db_subnet_group.db', 'subnet_ids', value);
    expect(out.text).toBe(src.replace('aws_subnet.b.id  # zone b\n', 'aws_subnet.b.id,  # zone b\n    aws_subnet.c.id,\n'));
  });

  it('an item kept keeps its own comment, even when its neighbours change', () => {
    const src = `resource "aws_db_subnet_group" "db" {
  subnet_ids = [
    aws_subnet.a.id, # zone a
    aws_subnet.b.id, # zone b
  ]
}
`;
    const value = list([ref('aws_subnet.b.id'), ref('aws_subnet.c.id')]);
    const out = patch(src, [set('aws_db_subnet_group.db', 'subnet_ids', value)]);
    expectApplied(out, 'aws_db_subnet_group.db', 'subnet_ids', value);
    expect(out.text).toBe(src.replace('    aws_subnet.a.id, # zone a\n', '').replace('# zone b\n', '# zone b\n    aws_subnet.c.id,\n'));
  });

  it('adding in the middle, and in front of the first item', () => {
    const middle = list([lit('10.0.0.0/8'), lit('10.1.0.0/16'), lit('192.168.0.0/16')]);
    const out = patch(CIDRS, [set('aws_security_group.web', 'cidr_blocks', middle)]);
    expectApplied(out, 'aws_security_group.web', 'cidr_blocks', middle);
    expect(out.text).toBe(CIDRS.replace('# HQ\n', '# HQ\n    "10.1.0.0/16",\n'));

    const first = list([lit('10.9.0.0/16'), lit('10.0.0.0/8'), lit('192.168.0.0/16')]);
    const front = patch(CIDRS, [set('aws_security_group.web', 'cidr_blocks', first)]);
    expectApplied(front, 'aws_security_group.web', 'cidr_blocks', first);
    expect(front.text).toContain('[ # who may connect\n    "10.9.0.0/16",\n    # the office\n');
  });

  it('emptying the list keeps the comments that weren’t on the items’ lines', () => {
    const out = patch(CIDRS, [set('aws_security_group.web', 'cidr_blocks', list([]))]);
    expectApplied(out, 'aws_security_group.web', 'cidr_blocks', list([]));
    expect(out.text).toContain('cidr_blocks = [ # who may connect\n    # the office\n  ]');
  });

  it('a list of objects: a field changed in the second object, comments in both stay', () => {
    const src = `resource "aws_security_group" "web" {
  ingress = [
    {
      # HTTPS for everyone
      from_port = 443
      to_port   = 443
    },
    {
      from_port = 22 # SSH
      to_port   = 22
    },
  ]
}
`;
    const value = list([obj({ from_port: lit(443), to_port: lit(443) }), obj({ from_port: lit(2222), to_port: lit(22) })]);
    const out = patch(src, [set('aws_security_group.web', 'ingress', value)]);
    expectApplied(out, 'aws_security_group.web', 'ingress', value);
    expect(out.text).toBe(src.replace('from_port = 22 # SSH', 'from_port = 2222 # SSH'));
  });

  it('a one-line list with an inline comment', () => {
    const src = 'resource "aws_instance" "web" {\n  vpc_security_group_ids = [aws_security_group.a.id /* main */]\n}\n';
    const value = list([ref('aws_security_group.a.id'), ref('aws_security_group.b.id')]);
    const out = patch(src, [set('aws_instance.web', 'vpc_security_group_ids', value)]);
    expectApplied(out, 'aws_instance.web', 'vpc_security_group_ids', value);
    expect(out.text).toContain('[aws_security_group.a.id, aws_security_group.b.id /* main */]');
  });
});

const TAGS = `resource "aws_s3_bucket" "logs" {
  bucket = "logs"

  tags = { # cost allocation
    # who to page
    Team = "platform" # slack: #platform
    Env  = "prod"
  }
}
`;

describe('objects with comments inside', () => {
  it('changing a value keeps the comments around it', () => {
    const value = obj({ Team: lit('infra'), Env: lit('prod') });
    const out = patch(TAGS, [set('aws_s3_bucket.logs', 'tags', value)]);
    expectApplied(out, 'aws_s3_bucket.logs', 'tags', value);
    expect(out.text).toBe(TAGS.replace('Team = "platform" # slack', 'Team = "infra" # slack'));
  });

  it('adding a key puts it after the last field, aligned; removing one takes its line', () => {
    const added = obj({ Team: lit('platform'), Env: lit('prod'), Tier: lit('gold') });
    const out = patch(TAGS, [set('aws_s3_bucket.logs', 'tags', added)]);
    expectApplied(out, 'aws_s3_bucket.logs', 'tags', added);
    expect(out.text).toBe(TAGS.replace('    Env  = "prod"\n', '    Env  = "prod"\n    Tier = "gold"\n'));

    const removed = obj({ Env: lit('prod') });
    const gone = patch(TAGS, [set('aws_s3_bucket.logs', 'tags', removed)]);
    expectApplied(gone, 'aws_s3_bucket.logs', 'tags', removed);
    // the field's own comment goes with it; the ones above it and on the `{` line stay
    expect(gone.text).toBe(TAGS.replace('    Team = "platform" # slack: #platform\n', ''));
  });

  it('a longer new key widens the aligned column, as terraform fmt would', () => {
    const value = obj({ Team: lit('platform'), Env: lit('prod'), CostCenter: lit('42') });
    const out = patch(TAGS, [set('aws_s3_bucket.logs', 'tags', value)]);
    expectApplied(out, 'aws_s3_bucket.logs', 'tags', value);
    expect(out.text).toContain(
      '    Team       = "platform" # slack: #platform\n    Env        = "prod"\n    CostCenter = "42"\n  }',
    );
  });

  it('a nested object: only the inner field is rewritten', () => {
    const src = `resource "aws_lambda_function" "fn" {
  environment_vars = {
    DB = {
      host = "db.internal" # private DNS
      port = 5432
    }
    MODE = "prod" # or "dev"
  }
}
`;
    const value = obj({ DB: obj({ host: lit('db.internal'), port: lit(6432) }), MODE: lit('prod') });
    const out = patch(src, [set('aws_lambda_function.fn', 'environment_vars', value)]);
    expectApplied(out, 'aws_lambda_function.fn', 'environment_vars', value);
    expect(out.text).toBe(src.replace('port = 5432', 'port = 6432'));
  });

  it('keeps CRLF line endings', () => {
    const src = TAGS.replace(/\n/g, '\r\n');
    const value = obj({ Team: lit('platform'), Env: lit('prod'), Tier: lit('gold') });
    const out = patch(src, [set('aws_s3_bucket.logs', 'tags', value)]);
    expectApplied(out, 'aws_s3_bucket.logs', 'tags', value);
    expect(out.text).not.toMatch(/(^|[^\r])\n/);
    expect(out.text).toContain('# slack: #platform\r\n');
  });
});

describe('when the comments can’t be kept, nothing is written', () => {
  it('a list with comments turned into an expression', () => {
    const out = patch(CIDRS, [set('aws_security_group.web', 'cidr_blocks', raw('var.cidrs'))]);
    expect(out.refused?.message).toBe(
      'Canvas edit not applied: cidr_blocks in aws_security_group.web has comments inside that the edit would lose. Edit it in the code.',
    );
    expect(out.text).toBe(CIDRS);
  });

  it('a single-line nested block that has to grow (re-emitted) with a comment inside', () => {
    const src = 'resource "aws_security_group" "web" {\n  ingress { from_port = 80 /* http */ }\n}\n';
    const out = patch(src, [
      set('aws_security_group.web', 'ingress', { kind: 'block', body: { from_port: lit(80), to_port: lit(80) } }),
    ]);
    expect(out.refused?.message).toMatch(/ingress in aws_security_group\.web has comments inside/);
    expect(out.text).toBe(src);
  });

  it('a single-line block re-emitted whole, with a comment inside a value', () => {
    const src = 'resource "aws_s3_bucket" "logs" { tags = { Team = "a" /* owner */ } }\n';
    const out = patch(src, [set('aws_s3_bucket.logs', 'acl', lit('private'))]);
    expect(out.refused?.message).toBe('Canvas edit not applied: aws_s3_bucket.logs has comments that the edit would lose. Edit it in the code.');
    expect(out.text).toBe(src);
  });

  it('…but a removed argument may take its comments along', () => {
    const src = 'resource "aws_s3_bucket" "logs" { tags = { Team = "a" /* owner */ } }\n';
    const out = patch(src, [{ kind: 'unset_arg', nodeId: 'aws_s3_bucket.logs', field: 'tags' }]);
    expect(out.refused).toBeUndefined();
    expect(out.ir.resources[0].args.tags).toBeUndefined();
  });

  it('says so in Portuguese too', async () => {
    const { useLocale } = await import('@/i18n/locale');
    useLocale.getState().setLocale('pt-BR');
    try {
      const out = patch(CIDRS, [set('aws_security_group.web', 'cidr_blocks', raw('var.cidrs'))]);
      expect(out.refused?.message).toBe(
        'Edição do canvas não aplicada: cidr_blocks em aws_security_group.web tem comentários que a edição perderia. Edite no código.',
      );
    } finally {
      useLocale.getState().setLocale('en');
    }
  });
});

describe('what counts as a comment', () => {
  it('not a # or // inside a string, a template or a heredoc', () => {
    expect(hasComments('["#1", "a//b", "${join("#", var.x)}"]')).toBe(false);
    expect(hasComments('<<EOF\n# not a comment\nEOF')).toBe(false);
    expect(hasComments('["a", # yes\n]')).toBe(true);
    expect(hasComments('{ a = 1 /* yes */ }')).toBe(true);
    expect(hasComments('{ a = 1 // yes\n}')).toBe(true);
  });

  it('values without comments go the usual way (undefined), code over code too', () => {
    expect(keepComments(list([lit('a')]), list([lit('b')]), '["a"]', '  ')).toBeUndefined();
    expect(keepComments(raw('f(x) # c'), raw('f(y) # c'), 'f(x) # c', '  ')).toBeUndefined();
  });

  it('a string holding "#" is edited as before', () => {
    const src = 'resource "aws_s3_bucket" "b" {\n  names = [\n    "#1",\n    "#2",\n  ]\n}\n';
    const value = list([lit('#1'), lit('#3')]);
    const out = patch(src, [set('aws_s3_bucket.b', 'names', value)]);
    expectApplied(out, 'aws_s3_bucket.b', 'names', value);
    expect(out.text).toBe(src.replace('"#2"', '"#3"'));
  });

  it('lostComments compares as text and ignores the managed position comment', () => {
    expect(lostComments('# a\n# @blueprint:pos=1,2\nx = 1 # b', '# @blueprint:pos=5,6\n# a\nx = 2 # b')).toEqual([]);
    expect(lostComments('x = [1, # one\n2]', 'x = [1, 2]')).toEqual(['# one']);
  });
});
