import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare } from './share';
import { getTemplate } from '@/templates';

describe('share links', () => {
  it('round-trips a full project through the URL fragment', () => {
    const files = getTemplate('aws-web-app')!.build('shared-app');
    const encoded = encodeShare({ name: 'My Shared App', files });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe
    const decoded = decodeShare(encoded)!;
    expect(decoded.name).toBe('My Shared App');
    expect(decoded.files).toEqual(files);
  });

  it('rejects garbage payloads gracefully', () => {
    expect(decodeShare('not-a-real-payload')).toBeNull();
    expect(decodeShare('')).toBeNull();
  });

  it('drops files with suspicious names', () => {
    const encoded = encodeShare({
      name: 'X',
      files: { 'main.tf': 'a', '../evil': 'b' } as Record<string, string>,
    });
    const decoded = decodeShare(encoded)!;
    expect(Object.keys(decoded.files)).toEqual(['main.tf']);
  });
});
