/**
 * IPv4 CIDR helpers for picking a new subnet's range inside its network.
 */

interface Range {
  start: number;
  size: number;
}

export function parseCidr(cidr: string): Range | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return undefined;
  const octets = m.slice(1, 5).map(Number);
  const prefix = Number(m[5]);
  if (octets.some((o) => o > 255) || prefix > 32) return undefined;
  const ip = octets.reduce((acc, o) => acc * 256 + o, 0);
  const size = 2 ** (32 - prefix);
  return { start: ip - (ip % size), size };
}

function format(start: number, prefix: number): string {
  const octets = [24, 16, 8, 0].map((shift) => Math.floor(start / 2 ** shift) % 256);
  return `${octets.join('.')}/${prefix}`;
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
