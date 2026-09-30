import { deflateSync, strToU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeShare, decodeShareResult, encodeShare, shareHash, shareLinkInfo } from './share';
import { getTemplate } from '@/templates';

/** Encode an arbitrary JSON value the way share links are packed. */
function pack(value: unknown): string {
  const bytes = deflateSync(strToU8(JSON.stringify(value)), { level: 9 });
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('share links', () => {
  it('round-trips a full project through the URL fragment', () => {
    const files = getTemplate('aws-web-app')!.build('shared-app');
    const encoded = encodeShare({ name: 'My Shared App', files });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe
    const decoded = decodeShare(encoded)!;
    expect(decoded.name).toBe('My Shared App');
    expect(decoded.files).toEqual(files);
  });

  it('rejects garbage and truncated payloads gracefully', () => {
    expect(decodeShare('not-a-real-payload')).toBeNull();
    expect(decodeShare('')).toBeNull();
    const encoded = encodeShare({ name: 'X', files: { 'main.tf': 'resource "aws_vpc" "a" {}\n'.repeat(50) } });
    expect(decodeShareResult(encoded.slice(0, Math.floor(encoded.length / 2)))).toEqual({
      ok: false,
      error: 'invalid',
    });
  });

  it('drops files with suspicious names, including dot-only names', () => {
    const encoded = encodeShare({
      name: 'X',
      files: { 'main.tf': 'a', '../evil': 'b', '..': 'c', '.': 'd', 'ü.tf': 'e' } as Record<string, string>,
    });
    const decoded = decodeShare(encoded)!;
    expect(Object.keys(decoded.files).sort()).toEqual(['main.tf', 'ü.tf']);
  });

  it('keeps child modules in their folders, never paths that climb out', () => {
    const files = { 'main.tf': 'module "net" {\n  source = "./modules/net"\n}\n', 'modules/net/main.tf': 'resource "aws_vpc" "this" {}\n' };
    expect(decodeShare(encodeShare({ name: 'X', files }))!.files).toEqual(files);
    const tricky = { 'main.tf': 'a', 'modules/../../evil.tf': 'b', 'modules//x.tf': 'c', '/abs.tf': 'd', 'a/./b.tf': 'e' };
    expect(Object.keys(decodeShare(encodeShare({ name: 'X', files: tricky }))!.files)).toEqual(['main.tf']);
  });

  it('validates the version and the shape', () => {
    expect(decodeShareResult(pack({ v: 1, n: 'ok', f: { 'main.tf': 'x' } })).ok).toBe(true);
    expect(decodeShareResult(pack({ v: 2, n: 'future', f: {} }))).toEqual({ ok: false, error: 'version' });
    expect(decodeShareResult(pack({ n: 'no version', f: {} }))).toEqual({ ok: false, error: 'invalid' });
    expect(decodeShareResult(pack({ v: 1, n: 'array files', f: ['a', 'b'] }))).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(decodeShareResult(pack({ v: 1, n: 'non-string file', f: { 'main.tf': 1 } }))).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(decodeShareResult(pack([1, 2]))).toEqual({ ok: false, error: 'invalid' });
    expect(decodeShareResult(pack({ v: 1, n: 7, f: {} }))).toEqual({ ok: false, error: 'invalid' });
  });

  it('caps decompression (a tiny link must not inflate to hundreds of MB)', () => {
    const bomb = pack({ v: 1, n: 'bomb', f: { 'main.tf': '#'.repeat(12 * 1024 * 1024) } });
    expect(bomb.length).toBeLessThan(100_000);
    const started = Date.now();
    expect(decodeShareResult(bomb)).toEqual({ ok: false, error: 'too-large' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('hashes content stably for dedupe', () => {
    const a = { name: 'x', files: { 'main.tf': '1', 'variables.tf': '2' } };
    const b = { name: 'x', files: { 'variables.tf': '2', 'main.tf': '1' } };
    expect(shareHash(a)).toBe(shareHash(b));
    expect(shareHash(a)).not.toBe(shareHash({ ...a, name: 'y' }));
    expect(shareHash(a)).not.toBe(shareHash({ ...a, files: { ...a.files, 'main.tf': '3' } }));
  });

  it('warns when a link gets too long to travel', () => {
    vi.stubGlobal('location', { origin: 'https://example.test' });
    expect(shareLinkInfo({ name: 'small', files: { 'main.tf': 'x' } }).warning).toBeNull();
    // incompressible content: random hex
    const text = [...crypto.getRandomValues(new Uint8Array(30_000))].map((b) => b.toString(16)).join('');
    const info = shareLinkInfo({ name: 'big', files: { 'main.tf': text } });
    expect(info.long).toBe(true);
    expect(info.bytes).toBeGreaterThan(32 * 1024);
    expect(info.warning).toMatch(/KB/);
  });
});
