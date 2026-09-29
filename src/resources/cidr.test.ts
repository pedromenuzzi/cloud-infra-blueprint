import { describe, expect, it } from 'vitest';
import {
  allocateBlocks,
  blockContains,
  blocksOverlap,
  blockSize,
  cidrBlock,
  coveredSize,
  formatAddress,
  formatCidrBlock,
  nextFreeBlock,
  parseCidrBlock,
  usableIps,
  usableRange,
  type CidrBlock,
} from './cidr';

const b = (text: string): CidrBlock => {
  const block = cidrBlock(text);
  if (!block) throw new Error(`bad test CIDR ${text}`);
  return block;
};
const texts = (blocks: CidrBlock[] | undefined) => blocks?.map(formatCidrBlock);

describe('parsing', () => {
  it('reads IPv4 ranges and flags host bits', () => {
    expect(parseCidrBlock('10.0.0.0/16')).toEqual({
      ok: true,
      block: { family: 'ipv4', start: 0x0a000000n, end: 0x0a00ffffn, prefix: 16 },
      hostBits: false,
    });
    const loose = parseCidrBlock('10.0.1.5/24');
    expect(loose.ok && loose.hostBits).toBe(true);
    expect(loose.ok && formatCidrBlock(loose.block)).toBe('10.0.1.0/24');
    expect(formatCidrBlock(b('0.0.0.0/0'))).toBe('0.0.0.0/0');
    expect(blockSize(b('192.168.7.9/32'))).toBe(1n);
  });

  it('rejects what clouds reject', () => {
    for (const bad of ['10.0.0.0', '10.0.0/16', '10.0.0.256/24', '10.0.0.0/33', '010.0.0.0/8', '10.0.0.0/016', ' 10.0.0.0/16', '10.0.0.0/', 'var.cidr', '']) {
      expect(parseCidrBlock(bad).ok, bad).toBe(false);
    }
  });

  it('reads IPv6 ranges, compressed or not, with an embedded IPv4 tail', () => {
    const v6 = b('2001:db8::/56');
    expect(v6.family).toBe('ipv6');
    expect(blockSize(v6)).toBe(1n << 72n);
    expect(formatCidrBlock(b('2001:0db8:0000:0000:0000:0000:0000:0000/32'))).toBe('2001:db8::/32');
    expect(formatCidrBlock(b('::/0'))).toBe('::/0');
    expect(formatCidrBlock(b('::ffff:10.0.0.0/120'))).toBe('::ffff:a00:0/120');
    // the longest run of zero groups collapses; the first one on a tie
    expect(formatAddress(b('fd00:1:0:0:2::/128').start, 'ipv6')).toBe('fd00:1:0:0:2::');
    expect(formatAddress(b('fd00:0:0:1:0:0:1:1/128').start, 'ipv6')).toBe('fd00::1:0:0:1:1');
    for (const bad of ['2001:db8:::/48', '2001:db8::/129', '1:2:3:4:5:6:7:8:9/64', 'g::/64']) {
      expect(parseCidrBlock(bad).ok, bad).toBe(false);
    }
  });
});

describe('contains and overlap', () => {
  it('compares ranges of one family only', () => {
    expect(blockContains(b('10.0.0.0/16'), b('10.0.3.0/24'))).toBe(true);
    expect(blockContains(b('10.0.0.0/16'), b('10.0.0.0/16'))).toBe(true);
    expect(blockContains(b('10.0.0.0/16'), b('10.1.0.0/24'))).toBe(false);
    expect(blockContains(b('10.0.0.0/24'), b('10.0.0.0/16'))).toBe(false);
    expect(blocksOverlap(b('10.0.0.0/16'), b('10.0.255.0/24'))).toBe(true);
    expect(blocksOverlap(b('10.0.1.0/24'), b('10.0.2.0/24'))).toBe(false);
    expect(blocksOverlap(b('0.0.0.0/0'), b('::/0'))).toBe(false);
    expect(blockContains(b('2001:db8::/56'), b('2001:db8:0:1::/64'))).toBe(true);
  });

  it('counts covered addresses once', () => {
    expect(coveredSize([b('10.0.1.0/24'), b('10.0.2.0/24')])).toBe(512n);
    expect(coveredSize([b('10.0.0.0/22'), b('10.0.1.0/24'), b('10.0.3.128/25')])).toBe(1024n);
    expect(coveredSize([])).toBe(0n);
  });
});

describe('next free block', () => {
  const vpc = [b('10.0.0.0/16')];

  it('continues after the highest subnet, then fills the gaps', () => {
    expect(formatCidrBlock(nextFreeBlock(vpc, [], 24)!)).toBe('10.0.0.0/24');
    expect(formatCidrBlock(nextFreeBlock(vpc, [b('10.0.1.0/24'), b('10.0.2.0/24')], 24)!)).toBe('10.0.3.0/24');
    // aligned: a /20 after 10.0.2.0/24 starts on a /20 boundary
    expect(formatCidrBlock(nextFreeBlock(vpc, [b('10.0.1.0/24'), b('10.0.2.0/24')], 20)!)).toBe('10.0.16.0/20');
    // the top is taken: wrap around to the gap at the start
    expect(formatCidrBlock(nextFreeBlock(vpc, [b('10.0.255.0/24')], 24)!)).toBe('10.0.0.0/24');
  });

  it('skips a wider sibling and moves on to secondary ranges', () => {
    expect(formatCidrBlock(nextFreeBlock(vpc, [b('10.0.0.0/17')], 18)!)).toBe('10.0.128.0/18');
    const full = [b('10.0.0.0/24')];
    expect(nextFreeBlock(full, [b('10.0.0.0/25'), b('10.0.0.128/25')], 26)).toBeUndefined();
    expect(formatCidrBlock(nextFreeBlock([...full, b('10.1.0.0/16')], [b('10.0.0.0/24')], 24)!)).toBe('10.1.0.0/24');
  });

  it("never offers a block larger than the network, or one that doesn't fit", () => {
    expect(nextFreeBlock(vpc, [], 15)).toBeUndefined();
    expect(nextFreeBlock([b('10.0.0.0/24')], [b('10.0.0.64/26')], 24)).toBeUndefined();
  });
});

describe('split', () => {
  it('allocates several blocks one after another', () => {
    expect(texts(allocateBlocks([b('10.0.0.0/16')], [b('10.0.1.0/24'), b('10.0.2.0/24')], 24, 3))).toEqual([
      '10.0.3.0/24',
      '10.0.4.0/24',
      '10.0.5.0/24',
    ]);
    expect(texts(allocateBlocks([b('10.0.0.0/16')], [], 18, 4))).toEqual([
      '10.0.0.0/18',
      '10.0.64.0/18',
      '10.0.128.0/18',
      '10.0.192.0/18',
    ]);
  });

  it('refuses when they would not all fit', () => {
    expect(allocateBlocks([b('10.0.0.0/16')], [], 18, 5)).toBeUndefined();
    expect(allocateBlocks([b('10.0.0.0/24')], [b('10.0.0.0/25')], 26, 3)).toBeUndefined();
  });
});

describe('usable addresses', () => {
  it('leaves out what each cloud reserves', () => {
    expect(usableIps(b('10.0.1.0/24'), 'aws')).toBe(251n);
    expect(usableIps(b('10.0.1.0/24'), 'azure')).toBe(251n);
    expect(usableIps(b('10.0.1.0/24'), 'gcp')).toBe(252n);
    expect(usableIps(b('10.0.0.0/28'), 'aws')).toBe(11n);
    expect(usableIps(b('10.0.0.0/29'), 'gcp')).toBe(4n);
    expect(usableIps(b('10.0.0.0/30'), 'aws')).toBe(0n);
  });

  it('names the first and last usable address', () => {
    const aws = usableRange(b('10.0.1.0/24'), 'aws')!;
    expect([formatAddress(aws.first, 'ipv4'), formatAddress(aws.last, 'ipv4')]).toEqual(['10.0.1.4', '10.0.1.254']);
    const gcp = usableRange(b('10.0.1.0/24'), 'gcp')!;
    expect([formatAddress(gcp.first, 'ipv4'), formatAddress(gcp.last, 'ipv4')]).toEqual(['10.0.1.2', '10.0.1.253']);
  });
});
