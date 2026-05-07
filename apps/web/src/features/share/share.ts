import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

import type { IR } from '@blueprint/ir';

/**
 * Bumped whenever the shared payload schema changes in a non-additive way.
 *
 * Decoders refuse payloads with a different version so an old browser tab
 * cannot crash on a newer URL. The current shape is deliberately minimal:
 * `{ v, ir }`. Anything we add in the future (cursor positions, viewport,
 * theme override) must go behind a new optional field — never break v1.
 */
const SHARE_VERSION = 1 as const;

/**
 * Hard cap on the encoded hash length, in characters.
 *
 * Modern browsers tolerate 8 kB+ in the URL but enterprise proxies, GitHub
 * READMEs, Slack unfurlers and WhatsApp truncate aggressively somewhere
 * between 2 kB and 8 kB. We pick 6 kB as a defensive sweet spot — covers
 * realistic projects while staying safely shareable everywhere.
 *
 * `encodeIR` reports a clear error past this limit so callers can fall back
 * to "Save and share via account" instead of producing an unusable URL.
 */
export const MAX_SHARE_LENGTH = 6 * 1024;

export interface ShareEnvelope {
  v: typeof SHARE_VERSION;
  ir: IR;
}

export class ShareTooLargeError extends Error {
  constructor(
    public readonly length: number,
    public readonly limit: number,
  ) {
    super(
      `Shared blueprint is ${length.toLocaleString()} chars, exceeding the ${limit.toLocaleString()}-char URL limit.`,
    );
    this.name = 'ShareTooLargeError';
  }
}

export class ShareDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareDecodeError';
  }
}

/**
 * Encode an IR into a URL-safe, LZ-compressed hash.
 *
 * Why LZ-string + base64url:
 *   - `compressToEncodedURIComponent` is base64url already, no extra escaping.
 *   - 60-80 % size reduction on typical Terraform IRs (lots of repeated keys).
 *   - Pure JS, ~3 kB, MIT — fits the "zero recurring cost" rule with no
 *     server round-trip.
 *
 * Throws `ShareTooLargeError` when the encoded payload would not survive
 * mainstream URL handlers — see `MAX_SHARE_LENGTH`.
 */
export function encodeIR(ir: IR): string {
  const envelope: ShareEnvelope = { v: SHARE_VERSION, ir };
  const json = JSON.stringify(envelope);
  const encoded = compressToEncodedURIComponent(json);
  if (encoded.length > MAX_SHARE_LENGTH) {
    throw new ShareTooLargeError(encoded.length, MAX_SHARE_LENGTH);
  }
  return encoded;
}

/**
 * Inverse of `encodeIR`. Throws `ShareDecodeError` on any failure path
 * (corrupt payload, mismatched version, missing fields).
 *
 * We deliberately do _not_ Zod-validate the IR here: that's the job of the
 * IR layer when the data lands. Here we only verify the envelope so we can
 * fail fast and route to a friendly /not-found instead of crashing the
 * canvas with a parse error from inside React.
 */
export function decodeIR(hash: string): IR {
  if (!hash) {
    throw new ShareDecodeError('Empty share hash.');
  }
  let raw: string | null;
  try {
    raw = decompressFromEncodedURIComponent(hash);
  } catch (err) {
    throw new ShareDecodeError(`Failed to decompress share hash: ${(err as Error).message}`);
  }
  if (!raw) {
    throw new ShareDecodeError('Share hash decompressed to empty payload.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ShareDecodeError(`Share payload is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ShareDecodeError('Share payload is not an object.');
  }
  const envelope = parsed as Partial<ShareEnvelope>;
  if (envelope.v !== SHARE_VERSION) {
    throw new ShareDecodeError(
      `Unsupported share version: expected ${SHARE_VERSION}, got ${envelope.v ?? 'undefined'}.`,
    );
  }
  if (!envelope.ir || typeof envelope.ir !== 'object') {
    throw new ShareDecodeError('Share payload is missing the `ir` field.');
  }
  return envelope.ir;
}

/**
 * Build a fully-qualified `/p/:hash` URL pointing at the current origin.
 *
 * Falls back to a relative path on the (rare) server-side render path so
 * the function never throws when `window` is unavailable.
 */
export function buildShareUrl(hash: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/p/${hash}`;
}

/**
 * Build the "Open in Blueprint" SVG badge URL the README snippet renders.
 *
 * We use shields.io's static endpoint with the project palette so the badge
 * matches the site's primary blue without us having to host an asset. The
 * `link` attribute on the badge in the README handles the click — this URL
 * is just the image source.
 */
export const OPEN_IN_BLUEPRINT_BADGE_URL =
  'https://img.shields.io/badge/Open%20in-Blueprint-2563eb?style=for-the-badge&logo=cloudsmith&logoColor=white';
