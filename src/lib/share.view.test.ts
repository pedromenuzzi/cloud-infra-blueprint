/** Read-only view links: `#view=<payload>[&embed=1]`, the share-link encoding. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeShare, isEmbedHash, isViewHash, parseViewHash, shareUrl, viewLinkInfo, viewUrl } from './share';
import { getTemplate } from '@/templates';

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://example.test' });
  return () => vi.unstubAllGlobals();
});

const hashOf = (url: string) => url.slice(url.indexOf('#'));

describe('view links', () => {
  const files = getTemplate('aws-web-app')!.build('viewed-app');
  const payload = { name: 'Viewed App', files };

  it('round-trips a project through the fragment', () => {
    const url = viewUrl(payload);
    expect(url.startsWith('https://example.test/#view=')).toBe(true);
    const link = parseViewHash(hashOf(url))!;
    expect(link.embed).toBe(false);
    expect(link.result).toEqual({ ok: true, payload: { name: 'Viewed App', files } });
  });

  it('uses exactly the share-link encoding', () => {
    expect(hashOf(viewUrl(payload)).slice('#view='.length)).toBe(hashOf(shareUrl(payload)).slice('#share='.length));
    expect(hashOf(viewUrl(payload)).slice('#view='.length)).toBe(encodeShare(payload));
  });

  it('carries the embed flag after the payload', () => {
    const url = viewUrl(payload, { embed: true });
    expect(url.endsWith('&embed=1')).toBe(true);
    expect(parseViewHash(hashOf(url))!.embed).toBe(true);
    expect(isEmbedHash(hashOf(url))).toBe(true);
    expect(isEmbedHash(hashOf(viewUrl(payload)))).toBe(false);
    expect(parseViewHash(`#view=${encodeShare(payload)}&embed=0`)!.embed).toBe(false);
    expect(parseViewHash(`#view=${encodeShare(payload)}&theme=dark&embed=1`)!.embed).toBe(true);
  });

  it('tells view links from everything else', () => {
    expect(isViewHash('#view=abc')).toBe(true);
    expect(isViewHash('#share=abc')).toBe(false);
    expect(isViewHash('')).toBe(false);
    expect(parseViewHash('#share=abc')).toBeNull();
    expect(parseViewHash('')).toBeNull();
    expect(isEmbedHash('#share=abc&embed=1')).toBe(false);
  });

  it('refuses damaged payloads with the share-link errors', () => {
    const encoded = encodeShare(payload);
    expect(parseViewHash(`#view=${encoded.slice(0, 60)}`)!.result).toEqual({ ok: false, error: 'invalid' });
    expect(parseViewHash('#view=')!.result).toEqual({ ok: false, error: 'invalid' });
    expect(parseViewHash('#view=not%20base64!')!.result).toEqual({ ok: false, error: 'invalid' });
  });

  it('warns about long links the way share links do', () => {
    expect(viewLinkInfo(payload).warning).toBeNull();
    expect(viewLinkInfo(payload, { embed: true }).url.endsWith('&embed=1')).toBe(true);
    const text = [...crypto.getRandomValues(new Uint8Array(30_000))].map((b) => b.toString(16)).join('');
    const big = viewLinkInfo({ name: 'big', files: { 'main.tf': text } });
    expect(big.long).toBe(true);
    expect(big.url.startsWith('https://example.test/#view=')).toBe(true);
    expect(big.warning).toMatch(/KB/);
  });
});
