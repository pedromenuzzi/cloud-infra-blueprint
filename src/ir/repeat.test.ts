import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { applyOpsWithPatches } from '@/hcl/patch';
import { getDef } from '@/resources/registry';
import { raw, ref } from './expr';
import { deriveStructure } from './graph';
import {
  appendReference,
  instanceAddress,
  instanceCount,
  instanceRef,
  rekeyInExpression,
  rekeyInHcl,
  repeatOf,
  splitConditional,
} from './repeat';

const load = (src: string) => parseProject({ 'main.tf': src }).ir;
const node = (src: string, id: string) => {
  const ir = load(src);
  return { ir, node: ir.resources.find((r) => r.id === id)! };
};
const res = (meta: string) => `resource "aws_instance" "web" {\n  ${meta}\n  ami = "ami-1"\n}\n`;

describe('repeatOf', () => {
  it('is null for a plain resource', () => {
    const { ir, node: n } = node(res('instance_type = "t3.micro"'), 'aws_instance.web');
    expect(repeatOf(n, ir)).toBeNull();
    expect(instanceCount(n, ir)).toBe(1);
  });

  it('reads a literal count, a variable default, length() of a literal or variable', () => {
    expect(repeatOf(node(res('count = 3'), 'aws_instance.web').node)).toMatchObject({ kind: 'count', size: 3 });
    const v = node(`variable "n" {\n  default = 2\n}\n${res('count = var.n')}`, 'aws_instance.web');
    expect(repeatOf(v.node, v.ir)).toMatchObject({ kind: 'count', size: 2, via: 'var.n' });
    expect(repeatOf(node(res('count = length(["a", "b", "c"])'), 'aws_instance.web').node)).toMatchObject({ size: 3 });
    const azs = node(`variable "azs" {\n  default = ["a", "b"]\n}\n${res('count = length(var.azs)')}`, 'aws_instance.web');
    expect(repeatOf(azs.node, azs.ir)).toMatchObject({ kind: 'count', size: 2, via: 'var.azs' });
  });

  it('marks `cond ? 1 : 0` optional and other expressions unknown', () => {
    const opt = repeatOf(node(res('count = var.enabled ? 1 : 0'), 'aws_instance.web').node)!;
    expect(opt).toMatchObject({ kind: 'count', optional: true });
    expect(opt.size).toBeUndefined();
    expect(repeatOf(node(res('count = var.off ? 0 : 1'), 'aws_instance.web').node)).toMatchObject({ optional: true });
    const unknown = repeatOf(node(res('count = local.n * 2'), 'aws_instance.web').node)!;
    expect(unknown.size).toBeUndefined();
    expect(unknown.optional).toBeUndefined();
    expect(instanceCount(node(res('count = local.n * 2'), 'aws_instance.web').node)).toBeUndefined();
  });

  it('reads for_each keys from literal maps and sets, variables and locals', () => {
    expect(repeatOf(node(res('for_each = toset(["a", "b"])'), 'aws_instance.web').node)).toMatchObject({
      kind: 'for_each',
      keys: ['a', 'b'],
      size: 2,
    });
    const map = node(`resource "aws_instance" "web" {\n  for_each = {\n    blue  = "t3.micro"\n    green = "t3.small"\n  }\n}\n`, 'aws_instance.web');
    expect(repeatOf(map.node)).toMatchObject({ keys: ['blue', 'green'], size: 2 });
    const v = node(`variable "azs" {\n  default = ["us-east-1a", "us-east-1b", "us-east-1c"]\n}\n${res('for_each = toset(var.azs)')}`, 'aws_instance.web');
    expect(repeatOf(v.node, v.ir)).toMatchObject({ keys: ['us-east-1a', 'us-east-1b', 'us-east-1c'], via: 'var.azs' });
    const l = node(`locals {\n  sites = {\n    one = { host = "a" }\n    two = { host = "b" }\n  }\n}\n${res('for_each = local.sites')}`, 'aws_instance.web');
    expect(repeatOf(l.node, l.ir)).toMatchObject({ keys: ['one', 'two'], size: 2, via: 'local.sites' });
  });

  it('follows for_each chained on another resource', () => {
    const src = `resource "aws_s3_bucket" "data" {\n  for_each = toset(["logs", "raw"])\n  bucket = each.key\n}\nresource "aws_s3_bucket_versioning" "data" {\n  for_each = aws_s3_bucket.data\n  bucket   = each.value.id\n}\n`;
    const { ir, node: n } = node(src, 'aws_s3_bucket_versioning.data');
    expect(repeatOf(n, ir)).toMatchObject({ kind: 'for_each', keys: ['logs', 'raw'], via: 'aws_s3_bucket.data' });
  });

  it('keeps for_each over an expression unknown', () => {
    const r = repeatOf(node(res('for_each = var.enabled ? toset(["a"]) : toset([])'), 'aws_instance.web').node)!;
    expect(r.kind).toBe('for_each');
    expect(r.size).toBeUndefined();
  });

  it('splits conditionals at the top level only', () => {
    expect(splitConditional('var.a ? 1 : 0')).toEqual(['var.a', '1', '0']);
    expect(splitConditional('length(var.x) > 0 ? { a = 1 } : {}')).toEqual(['length(var.x) > 0', '{ a = 1 }', '{}']);
    expect(splitConditional('var.a ? (var.b ? 2 : 3) : 0')).toEqual(['var.a', '(var.b ? 2 : 3)', '0']);
    expect(splitConditional('"a ? b : c"')).toBeNull();
    expect(splitConditional('local.n')).toBeNull();
  });
});

describe('references to repeated resources', () => {
  const src = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "private" {
  count      = 2
  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
}

resource "aws_subnet" "keyed" {
  for_each   = toset(["a", "b"])
  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, 10)
}

resource "aws_instance" "indexed" {
  subnet_id = aws_subnet.private[0].id
}

resource "aws_instance" "counted" {
  count     = 2
  subnet_id = aws_subnet.private[count.index].id
}

resource "aws_instance" "keyed" {
  subnet_id = aws_subnet.keyed["a"].id
}

resource "aws_instance" "each" {
  for_each  = aws_subnet.keyed
  subnet_id = aws_subnet.keyed[each.key].id
}

resource "aws_instance" "spread" {
  count     = 4
  subnet_id = element(aws_subnet.private[*].id, count.index)
}

resource "aws_lb" "splat" {
  subnets = aws_subnet.private[*].id
}

resource "aws_lb" "values" {
  subnets = values(aws_subnet.keyed)[*].id
}

resource "aws_lb" "legacy" {
  subnets = aws_subnet.private.*.id
}

resource "aws_eip" "one" {
  instance = one(aws_instance.indexed[*].id)
}
`;

  it('contain and connect like plain references', () => {
    const ir = load(src);
    const edges = deriveStructure(ir, getDef);
    const parent = (id: string) => ir.resources.find((r) => r.id === id)!.parentId;
    expect(parent('aws_subnet.private')).toBe('aws_vpc.main');
    expect(parent('aws_subnet.keyed')).toBe('aws_vpc.main');
    expect(parent('aws_instance.indexed')).toBe('aws_subnet.private');
    expect(parent('aws_instance.counted')).toBe('aws_subnet.private');
    expect(parent('aws_instance.keyed')).toBe('aws_subnet.keyed');
    expect(parent('aws_instance.each')).toBe('aws_subnet.keyed');
    expect(parent('aws_instance.spread')).toBe('aws_subnet.private');
    const edge = (s: string, t: string) => edges.some((e) => e.source === s && e.target === t);
    expect(edge('aws_lb.splat', 'aws_subnet.private')).toBe(true);
    expect(edge('aws_lb.values', 'aws_subnet.keyed')).toBe(true);
    expect(edge('aws_lb.legacy', 'aws_subnet.private')).toBe(true);
    expect(edge('aws_eip.one', 'aws_instance.indexed')).toBe(true);
  });

  it('are written per instance, or all of them for a list', () => {
    const ir = load(src);
    const byId = (id: string) => ir.resources.find((r) => r.id === id)!;
    const plain = byId('aws_vpc.main');
    const counted = byId('aws_subnet.private');
    const keyed = byId('aws_subnet.keyed');
    expect(instanceRef(plain, 'id', { ir })).toEqual(ref('aws_vpc.main.id'));
    expect(instanceRef(counted, 'id', { ir })).toEqual(ref('aws_subnet.private[0].id'));
    expect(instanceRef(counted, 'id', { ir, all: true })).toEqual(ref('aws_subnet.private[*].id'));
    expect(instanceRef(counted, 'id', { ir, from: byId('aws_instance.counted') })).toEqual(ref('aws_subnet.private[count.index].id'));
    // a different count: the first instance
    expect(instanceRef(counted, 'id', { ir, from: byId('aws_instance.spread') })).toEqual(ref('aws_subnet.private[0].id'));
    expect(instanceRef(keyed, 'id', { ir })).toEqual(ref('aws_subnet.keyed["a"].id'));
    expect(instanceRef(keyed, 'id', { ir, all: true })).toEqual(raw('values(aws_subnet.keyed)[*].id'));
    expect(instanceRef(keyed, 'id', { ir, from: byId('aws_instance.each') })).toEqual(ref('aws_subnet.keyed[each.key].id'));
    const unknown = load(res('for_each = var.names')).resources[0];
    expect(instanceRef(unknown, 'arn', {})).toEqual(raw('values(aws_instance.web)[0].arn'));
  });

  it('are appended to lists without nesting a list in a list', () => {
    const one = ref('aws_subnet.a.id');
    const all = ref('aws_subnet.b[*].id');
    expect(appendReference(undefined, one)).toEqual({ kind: 'list', items: [one] });
    expect(appendReference(undefined, all)).toEqual(all);
    expect(appendReference({ kind: 'list', items: [one] }, all)).toEqual(raw('concat([aws_subnet.a.id], aws_subnet.b[*].id)'));
    expect(appendReference(all, one)).toEqual(raw('concat(aws_subnet.b[*].id, [aws_subnet.a.id])'));
    expect(appendReference(all, all)).toBeNull();
    expect(appendReference({ kind: 'list', items: [one] }, one)).toBeNull();
  });

  it('name instances by address', () => {
    expect(instanceAddress('aws_instance.web')).toBe('aws_instance.web');
    expect(instanceAddress('aws_instance.web', 'count', 0)).toBe('aws_instance.web[0]');
    expect(instanceAddress('aws_instance.web', 'for_each', 'a')).toBe('aws_instance.web["a"]');
  });
});

describe('re-keying references', () => {
  const a = 'aws_instance.web';
  it('adds an instance key to attribute access only', () => {
    expect(rekeyInExpression(ref('aws_instance.web.id'), a, { add: '0' })).toEqual(ref('aws_instance.web[0].id'));
    expect(rekeyInExpression(ref('aws_instance.web'), a, { add: '0' })).toEqual(ref('aws_instance.web'));
    expect(rekeyInExpression(ref('aws_instance.web2.id'), a, { add: '0' })).toEqual(ref('aws_instance.web2.id'));
    expect(rekeyInExpression(ref('aws_instance.web.*.id'), a, { add: '0' })).toEqual(ref('aws_instance.web.*.id'));
    expect(rekeyInHcl('"${aws_instance.web.private_ip}:80"', a, { add: '"a"' })).toBe('"${aws_instance.web["a"].private_ip}:80"');
  });

  it('drops any instance key but a splat', () => {
    expect(rekeyInExpression(ref('aws_instance.web[0].id'), a, { drop: true })).toEqual(ref('aws_instance.web.id'));
    expect(rekeyInExpression(ref('aws_instance.web["k"].id'), a, { drop: true })).toEqual(ref('aws_instance.web.id'));
    expect(rekeyInExpression(ref('aws_instance.web[count.index].id'), a, { drop: true })).toEqual(ref('aws_instance.web.id'));
    expect(rekeyInExpression(ref('aws_instance.web[*].id'), a, { drop: true })).toEqual(ref('aws_instance.web[*].id'));
    expect(rekeyInHcl('element(aws_instance.web[count.index].id, 0) # aws_instance.web[1]', a, { drop: true })).toBe(
      'element(aws_instance.web.id, 0) # aws_instance.web[1]',
    );
    expect(rekeyInHcl('lookup(aws_instance.web[each.key].tags, "x")', a, { drop: true })).toBe('lookup(aws_instance.web.tags, "x")');
  });

  it('maps keys', () => {
    expect(rekeyInExpression(ref('aws_instance.web[1].id'), a, { map: { '1': '"b"' } })).toEqual(ref('aws_instance.web["b"].id'));
    expect(rekeyInExpression(ref('aws_instance.web[2].id'), a, { map: { '1': '"b"' } })).toEqual(ref('aws_instance.web[2].id'));
  });

  it('rewrite only the tokens that change, keeping comments', () => {
    const files = {
      'main.tf': `resource "aws_instance" "web" {
  ami = "ami-1"
}

resource "aws_eip" "ip" {
  instance = aws_instance.web.id # the web box
  tags = {
    Name = "\${aws_instance.web.id}-ip" # keep me
  }
}

output "ip" {
  value = [
    aws_instance.web.public_ip, # first
  ]
}
`,
    };
    const { ir } = parseProject(files);
    const out = applyOpsWithPatches(files, ir, [
      { kind: 'set_arg', nodeId: a, field: 'count', value: { kind: 'literal', value: 2 } },
      { kind: 'rekey_refs', address: a, rekey: { add: '0' } },
    ]);
    expect(out.refused).toBeUndefined();
    expect(out.files['main.tf']).toBe(`resource "aws_instance" "web" {
  count = 2

  ami = "ami-1"
}

resource "aws_eip" "ip" {
  instance = aws_instance.web[0].id # the web box
  tags = {
    Name = "\${aws_instance.web[0].id}-ip" # keep me
  }
}

output "ip" {
  value = [
    aws_instance.web[0].public_ip, # first
  ]
}
`);
  });
});
