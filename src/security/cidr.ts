/**
 * Just enough CIDR math for the audit: parse IPv4 / IPv6 ranges, tell whether
 * a set of ranges covers a whole address family ("0.0.0.0/1" + "128.0.0.0/1"
 * is the internet too) and whether a range is private.
 */
export type IpFamily = 'ipv4' | 'ipv6';

export interface CidrRange {
  family: IpFamily;
  start: bigint;
  end: bigint;
  prefix: number;
}

function parseV4(ip: string): bigint | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return undefined;
    n = (n << 8n) | BigInt(Number(p));
  }
  return n;
}

function parseV6(ip: string): bigint | undefined {
  const halves = ip.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return undefined;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** "10.0.0.0/16", "2001:db8::/32", "1.2.3.4" (a single host) → range */
export function parseCidr(text: string): CidrRange | undefined {
  const [ip, len, ...rest] = text.trim().split('/');
  if (rest.length > 0 || !ip) return undefined;
  const family: IpFamily = ip.includes(':') ? 'ipv6' : 'ipv4';
  const bits = family === 'ipv4' ? 32 : 128;
  const addr = family === 'ipv4' ? parseV4(ip) : parseV6(ip);
  if (addr === undefined || (len !== undefined && !/^\d{1,3}$/.test(len))) return undefined;
  const prefix = len === undefined ? bits : Number(len);
  if (prefix > bits) return undefined;
  const host = (1n << BigInt(bits - prefix)) - 1n;
  const start = addr & ~host;
  return { family, start, end: start | host, prefix };
}

export function cidrFamily(text: string): IpFamily | undefined {
  return parseCidr(text)?.family;
}

const byStart = (a: CidrRange, b: CidrRange) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

/** Do these ranges, together, cover every address of the family? */
export function coversFamily(cidrs: readonly string[], family: IpFamily): boolean {
  const ranges = cidrs
    .map(parseCidr)
    .filter((r): r is CidrRange => r?.family === family)
    .sort(byStart);
  const max = (1n << (family === 'ipv4' ? 32n : 128n)) - 1n;
  let next = 0n;
  for (const r of ranges) {
    if (r.start > next) return false;
    if (r.end + 1n > next) next = r.end + 1n;
    if (next > max) return true;
  }
  return false;
}

const PRIVATE = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  'fc00::/7',
  'fe80::/10',
  '::1/128',
].map((c) => parseCidr(c)!);

export function isPrivateCidr(text: string): boolean {
  const r = parseCidr(text);
  return !!r && PRIVATE.some((p) => p.family === r.family && r.start >= p.start && r.end <= p.end);
}
