/**
 * Serverless sharing: the whole project (name + .tf files) is deflated and
 * packed into the URL fragment. Opening the link imports it as a local copy.
 * The fragment never leaves the browser (servers don't see `#…`).
 *
 * Links are untrusted input: decoding is size-capped (a tiny link can inflate
 * to hundreds of MB) and the payload shape is validated strictly.
 */
import { deflateSync, Inflate, strFromU8, strToU8 } from 'fflate';
import { messagesFor } from '@/i18n/messages';
import { libMessages } from './messages';
import { isProjectFilePath } from './projectPath';

export interface SharePayload {
  name: string;
  files: Record<string, string>;
}

const VERSION = 1;
/** Inflated payload cap — the same order as the localStorage quota. */
export const MAX_SHARE_BYTES = 5 * 1024 * 1024;
/** Longest fragment we try to decode (browsers cap URLs around 2 MB anyway). */
const MAX_ENCODED_CHARS = 2 * 1024 * 1024;
const MAX_FILES = 500;
/** Links longer than this get cut off by some chat apps, mail clients and browsers. */
export const SHARE_URL_SOFT_LIMIT = 32 * 1024;

export type ShareError = 'invalid' | 'too-large' | 'version';
export type ShareDecodeResult = { ok: true; payload: SharePayload } | { ok: false; error: ShareError };

class TooLarge extends Error {}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Inflate, giving up as soon as the output passes `cap` bytes. */
function inflateCapped(data: Uint8Array, cap: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  const inflater = new Inflate((chunk, final) => {
    size += chunk.length;
    if (size > cap) throw new TooLarge();
    chunks.push(chunk);
    if (final) done = true;
  });
  // small input slices bound how much one push can inflate (~1000:1 at most)
  const STEP = 4096;
  for (let i = 0; i < data.length; i += STEP) {
    inflater.push(data.subarray(i, i + STEP), i + STEP >= data.length);
  }
  if (!done) throw new Error('truncated');
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function encodeShare(payload: SharePayload): string {
  const json = JSON.stringify({ v: VERSION, n: payload.name, f: payload.files });
  return toBase64Url(deflateSync(strToU8(json), { level: 9 }));
}

export function decodeShareResult(encoded: string): ShareDecodeResult {
  if (!encoded || encoded.length > MAX_ENCODED_CHARS) {
    return { ok: false, error: encoded ? 'too-large' : 'invalid' };
  }
  let data: unknown;
  try {
    data = JSON.parse(strFromU8(inflateCapped(fromBase64Url(encoded), MAX_SHARE_BYTES)));
  } catch (err) {
    return { ok: false, error: err instanceof TooLarge ? 'too-large' : 'invalid' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, error: 'invalid' };
  const { v, n, f } = data as Record<string, unknown>;
  if (typeof v === 'number' && v > VERSION) return { ok: false, error: 'version' };
  if (v !== VERSION || typeof n !== 'string') return { ok: false, error: 'invalid' };
  if (typeof f !== 'object' || f === null || Array.isArray(f)) return { ok: false, error: 'invalid' };
  const entries = Object.entries(f);
  if (entries.length > MAX_FILES || entries.some(([, text]) => typeof text !== 'string')) {
    return { ok: false, error: 'invalid' };
  }
  const files: Record<string, string> = {};
  for (const [name, text] of entries) {
    // a file name, or a child module's file in its folder (`modules/net/main.tf`) — never `..`
    if (isProjectFilePath(name)) files[name] = text as string;
  }
  return { ok: true, payload: { name: n.trim().slice(0, 80) || messagesFor(libMessages).sharedProject, files } };
}

/** Decoded payload, or null for anything invalid (see decodeShareResult for why). */
export function decodeShare(encoded: string): SharePayload | null {
  const result = decodeShareResult(encoded);
  return result.ok ? result.payload : null;
}

export function shareUrl(payload: SharePayload): string {
  const base = `${location.origin}${import.meta.env.BASE_URL ?? '/'}`;
  return `${base}#share=${encodeShare(payload)}`;
}

/**
 * A read-only view link: the same compact payload as a share link, opened in
 * the viewer instead of imported. `embed` hides the app chrome (for iframes).
 */
export function viewUrl(payload: SharePayload, options: { embed?: boolean } = {}): string {
  const base = `${location.origin}${import.meta.env.BASE_URL ?? '/'}`;
  return `${base}#view=${encodeShare(payload)}${options.embed ? '&embed=1' : ''}`;
}

export interface ShareLinkInfo {
  url: string;
  /** length of the URL in bytes (it's ASCII) */
  bytes: number;
  /** longer than SHARE_URL_SOFT_LIMIT: may get cut off when pasted around */
  long: boolean;
  /** too big for anyone to open (over the decode cap) */
  tooLarge: boolean;
  /** a sentence for a toast when the link is risky (in the UI language of the moment), else null */
  warning: string | null;
}

/** The share URL plus a warning when it's too long to travel safely. */
export function shareLinkInfo(payload: SharePayload): ShareLinkInfo {
  return linkInfo(shareUrl(payload), payload);
}

/** The read-only view URL, with the same size checks as a share link. */
export function viewLinkInfo(payload: SharePayload, options: { embed?: boolean } = {}): ShareLinkInfo {
  return linkInfo(viewUrl(payload, options), payload);
}

function linkInfo(url: string, payload: SharePayload): ShareLinkInfo {
  const bytes = url.length;
  const tooLarge = strToU8(JSON.stringify({ v: VERSION, n: payload.name, f: payload.files })).length > MAX_SHARE_BYTES;
  const long = bytes > SHARE_URL_SOFT_LIMIT;
  const m = messagesFor(libMessages);
  const warning = tooLarge ? m.shareTooLarge : long ? m.shareLong(Math.round(bytes / 1024)) : null;
  return { url, bytes, long, tooLarge, warning };
}

/**
 * Stable content hash of a payload (cyrb53 over name + sorted files), used to
 * spot a link that was already imported.
 */
export function shareHash(payload: SharePayload): string {
  const text = JSON.stringify([
    payload.name,
    Object.keys(payload.files)
      .sort()
      .map((k) => [k, payload.files[k]]),
  ]);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const SHARE_FRAGMENT = /^#share=(.*)$/s;

/** null when the URL has no share fragment; otherwise the decoded (or failed) payload. */
export function readShareFromLocation(): ShareDecodeResult | null {
  const m = SHARE_FRAGMENT.exec(location.hash);
  if (!m) return null;
  return /^[A-Za-z0-9_-]+$/.test(m[1]) ? decodeShareResult(m[1]) : { ok: false, error: 'invalid' };
}

export interface ViewLink {
  result: ShareDecodeResult;
  /** `&embed=1`: no app chrome — the diagram and an "Open" link only */
  embed: boolean;
}

const VIEW_FRAGMENT = /^#view=([^&]*)((?:&[^&]*)*)$/s;

/** `#view=<payload>[&embed=1]` — null when `hash` isn't a view link. */
export function parseViewHash(hash: string): ViewLink | null {
  const m = VIEW_FRAGMENT.exec(hash);
  if (!m) return null;
  const embed = new URLSearchParams(m[2].slice(1)).get('embed') === '1';
  const result: ShareDecodeResult = /^[A-Za-z0-9_-]+$/.test(m[1])
    ? decodeShareResult(m[1])
    : { ok: false, error: 'invalid' };
  return { result, embed };
}

/** Is this fragment a view link? (cheap: nothing is decoded) */
export function isViewHash(hash: string): boolean {
  return hash.startsWith('#view=');
}

/** Is this fragment an embedded view link (`#view=…&embed=1`)? */
export function isEmbedHash(hash: string): boolean {
  const amp = hash.indexOf('&');
  return isViewHash(hash) && amp !== -1 && new URLSearchParams(hash.slice(amp + 1)).get('embed') === '1';
}

/** Drop the `#share=…` fragment without a navigation (keeps the router's history state). */
export function clearShareFragment() {
  history.replaceState(history.state, '', location.pathname + location.search);
}
