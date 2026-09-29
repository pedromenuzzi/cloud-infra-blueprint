/**
 * CIDR math for networks and subnets: strict parsing of IPv4 / IPv6 ranges
 * (what the validation checks and the CIDR planner rely on) plus the helpers
 * that pick a new subnet's range inside its network.
 */

export type IpFamily = 'ipv4' | 'ipv6';

/** An address range: `start` and `end` are the first and last address (inclusive). */
export interface CidrBlock {
  family: IpFamily;
  start: bigint;
  end: bigint;
  prefix: number;
}

export type CidrParse =
  | {
      ok: true;
      block: CidrBlock;
      /** `10.0.1.5/24`: the address isn't the first of its range (clouds reject it) */
      hostBits: boolean;
    }
  | { ok: false };

const BITS: Record<IpFamily, number> = { ipv4: 32, ipv6: 128 };

/** an octet without leading zeros (`010` is ambiguous, and Terraform rejects it) */
const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function parseV4(ip: string): bigint | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4 || !parts.every((p) => OCTET.test(p))) return undefined;
  return parts.reduce((n, p) => (n << 8n) | BigInt(Number(p)), 0n);
}

function parseV6(ip: string): bigint | undefined {
  let text = ip.toLowerCase();
  // an embedded IPv4 tail (`::ffff:10.0.0.1`) counts as the last two groups
  const lastColon = text.lastIndexOf(':');
  if (text.includes('.', lastColon)) {
    const v4 = parseV4(text.slice(lastColon + 1));
    if (v4 === undefined) return undefined;
    text = `${text.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return undefined;
  return groups.reduce((n, g) => (n << 16n) | BigInt(parseInt(g, 16)), 0n);
}

/**
 * `"10.0.0.0/16"`, `"2001:db8::/56"` → the range. The prefix length is
 * required (a bare address isn't a range) and whitespace isn't trimmed:
 * clouds reject `" 10.0.0.0/16"` too.
 */
export function parseCidrBlock(text: string): CidrParse {
  const slash = text.indexOf('/');
  if (slash === -1) return { ok: false };
  const ip = text.slice(0, slash);
  const len = text.slice(slash + 1);
  const family: IpFamily = ip.includes(':') ? 'ipv6' : 'ipv4';
  const address = family === 'ipv4' ? parseV4(ip) : parseV6(ip);
  if (address === undefined || !/^(0|[1-9]\d{0,2})$/.test(len)) return { ok: false };
  const prefix = Number(len);
  const bits = BITS[family];
  if (prefix > bits) return { ok: false };
  const host = (1n << BigInt(bits - prefix)) - 1n;
  const start = address & ~host;
  return { ok: true, block: { family, start, end: start | host, prefix }, hostBits: start !== address };
}

/** The range, or undefined when `text` isn't a valid CIDR (host bits are masked). */
export function cidrBlock(text: string): CidrBlock | undefined {
  const parsed = parseCidrBlock(text);
  return parsed.ok ? parsed.block : undefined;
}

function formatV6(n: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) => Number((n >> BigInt((7 - i) * 16)) & 0xffffn));
  // the longest run (2+) of zero groups collapses to `::` (RFC 5952)
  let best = { at: -1, len: 1 };
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > best.len) best = { at: i, len: j - i };
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best.at === -1) return hex.join(':');
  return `${hex.slice(0, best.at).join(':')}::${hex.slice(best.at + best.len).join(':')}`;
}

/** One address of `family`, as text: `10.0.1.4`, `2001:db8::1`. */
export function formatAddress(n: bigint, family: IpFamily): string {
  if (family === 'ipv6') return formatV6(n);
  return [24n, 16n, 8n, 0n].map((shift) => String((n >> shift) & 0xffn)).join('.');
}

export function formatCidrBlock(block: CidrBlock): string {
  return `${formatAddress(block.start, block.family)}/${block.prefix}`;
}

/** Number of addresses in the range. */
export function blockSize(block: CidrBlock): bigint {
  return block.end - block.start + 1n;
}

export function blockContains(outer: CidrBlock, inner: CidrBlock): boolean {
  return outer.family === inner.family && outer.start <= inner.start && inner.end <= outer.end;
}

export function blocksOverlap(a: CidrBlock, b: CidrBlock): boolean {
  return a.family === b.family && a.start <= b.end && b.start <= a.end;
}

/** Addresses `blocks` cover together, counting overlaps once. */
export function coveredSize(blocks: CidrBlock[]): bigint {
  const sorted = [...blocks].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  let total = 0n;
  let reach = -1n; // last address counted so far
  for (const b of sorted) {
    if (b.end <= reach) continue;
    total += b.end - (b.start > reach ? b.start : reach + 1n) + 1n;
    reach = b.end;
  }
  return total;
}

/** Addresses each cloud keeps for itself in every subnet (network, gateway, DNS, broadcast…). */
export const RESERVED_IPS = { aws: 5, azure: 5, gcp: 4 } as const;
export type CloudProvider = keyof typeof RESERVED_IPS;

/**
 * The addresses a subnet can hand out: AWS and Azure keep the first four and
 * the last one, GCP the first two and the last two.
 */
export function usableRange(block: CidrBlock, provider: CloudProvider): { first: bigint; last: bigint; count: bigint } | undefined {
  const [head, tail] = provider === 'gcp' ? [2n, 2n] : [4n, 1n];
  const count = blockSize(block) - head - tail;
  if (count <= 0n) return undefined;
  return { first: block.start + head, last: block.end - tail, count };
}

/** Usable addresses in a subnet of this range (0 when it is too small to hold any). */
export function usableIps(block: CidrBlock, provider: CloudProvider): bigint {
  return usableRange(block, provider)?.count ?? 0n;
}

/**
 * The next free /`prefix` inside `ranges` that overlaps none of `taken`. The
 * search starts right after the highest block already taken in a range (so
 * subnets come out in order: 10.0.1.0/24, 10.0.2.0/24 → 10.0.3.0/24) and then
 * wraps around to fill the gaps before it.
 */
export function nextFreeBlock(ranges: CidrBlock[], taken: CidrBlock[], prefix: number): CidrBlock | undefined {
  for (const range of ranges) {
    if (prefix < range.prefix || prefix > BITS[range.family]) continue;
    const inside = taken.filter((t) => blocksOverlap(t, range));
    const highest = inside.reduce((max, t) => (t.end > max ? t.end : max), range.start - 1n);
    const from = highest >= range.end ? range.start : highest + 1n;
    const found = firstFit(range, inside, prefix, from) ?? firstFit(range, inside, prefix, range.start);
    if (found) return found;
  }
  return undefined;
}

/** Lowest aligned /`prefix` at or after `from` in `range` that misses every one of `taken`. */
function firstFit(range: CidrBlock, taken: CidrBlock[], prefix: number, from: bigint): CidrBlock | undefined {
  const size = 1n << BigInt(BITS[range.family] - prefix);
  let cursor = from;
  for (;;) {
    const start = ((cursor - range.start + size - 1n) / size) * size + range.start;
    const end = start + size - 1n;
    if (end > range.end) return undefined;
    const hit = taken.find((t) => t.start <= end && start <= t.end);
    if (!hit) return { family: range.family, start, end, prefix };
    cursor = hit.end + 1n;
  }
}

/**
 * `count` free /`prefix` blocks for new subnets (each one taken before the
 * next is picked), or undefined when they don't all fit.
 */
export function allocateBlocks(
  ranges: CidrBlock[],
  taken: CidrBlock[],
  prefix: number,
  count: number,
): CidrBlock[] | undefined {
  const out: CidrBlock[] = [];
  for (let i = 0; i < count; i++) {
    const next = nextFreeBlock(ranges, [...taken, ...out], prefix);
    if (!next) return undefined;
    out.push(next);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * String helpers used when a subnet is dropped on the canvas (see newNode.ts)
 * ------------------------------------------------------------------------- */

interface Range {
  start: number;
  size: number;
}

/** IPv4 only: the range as plain numbers (host bits masked). */
export function parseCidr(cidr: string): Range | undefined {
  const block = cidrBlock(cidr.trim());
  if (block?.family !== 'ipv4') return undefined;
  return { start: Number(block.start), size: Number(blockSize(block)) };
}

function format(start: number, prefix: number): string {
  return formatCidrBlock({ family: 'ipv4', start: BigInt(start), end: BigInt(start), prefix });
}

export function cidrsOverlap(a: string, b: string): boolean {
  const ra = parseCidr(a);
  const rb = parseCidr(b);
  if (!ra || !rb) return false;
  return ra.start < rb.start + rb.size && rb.start < ra.start + ra.size;
}

/**
 * The first /`prefix` block inside `network` that overlaps none of `taken`,
 * starting from `preferred` when it lies inside the network (so an empty VPC
 * keeps the familiar 10.0.1.0/24), else from the network's second block.
 * Undefined when the network isn't a literal CIDR or is full.
 */
export function nextFreeCidr(
  network: string,
  taken: string[],
  preferred?: string,
  prefix = 24,
): string | undefined {
  const net = parseCidr(network);
  if (!net) return undefined;
  const size = 2 ** (32 - prefix);
  const count = Math.floor(net.size / size);
  if (count < 1) return undefined;
  const pref = preferred ? parseCidr(preferred) : undefined;
  const first =
    pref && pref.size === size && pref.start >= net.start && pref.start + size <= net.start + net.size
      ? (pref.start - net.start) / size
      : Math.min(1, count - 1);
  for (let i = 0; i < count; i++) {
    const candidate = format(net.start + ((first + i) % count) * size, prefix);
    if (!taken.some((t) => cidrsOverlap(candidate, t))) return candidate;
  }
  return undefined;
}
