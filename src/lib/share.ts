/**
 * Serverless sharing: the whole project (name + .tf files) is deflated and
 * packed into the URL fragment. Opening the link imports it as a local copy.
 * The fragment never leaves the browser (servers don't see `#…`).
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

export interface SharePayload {
  name: string;
  files: Record<string, string>;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodeShare(payload: SharePayload): string {
  const json = JSON.stringify({ v: 1, n: payload.name, f: payload.files });
  return toBase64Url(deflateSync(strToU8(json), { level: 9 }));
}

export function decodeShare(encoded: string): SharePayload | null {
  try {
    const json = strFromU8(inflateSync(fromBase64Url(encoded)));
    const data = JSON.parse(json) as { v: number; n: string; f: Record<string, string> };
    if (!data || typeof data.n !== 'string' || typeof data.f !== 'object' || data.f === null) {
      return null;
    }
    const files: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.f)) {
      if (typeof v === 'string' && /^[\w.-]+$/.test(k)) files[k] = v;
    }
    return { name: data.n.slice(0, 80) || 'Shared project', files };
  } catch {
    return null;
  }
}

export function shareUrl(payload: SharePayload): string {
  const base = `${location.origin}${import.meta.env.BASE_URL ?? '/'}`;
  return `${base}#share=${encodeShare(payload)}`;
}

export function readShareFromLocation(): SharePayload | null {
  const m = /#share=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return null;
  return decodeShare(m[1]);
}
