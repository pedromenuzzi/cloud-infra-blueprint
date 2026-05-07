import { applyOps, edge, emptyIR, lit, newResource } from '@blueprint/ir';
import { compressToEncodedURIComponent } from 'lz-string';
import { describe, expect, it } from 'vitest';

import {
  buildShareUrl,
  decodeIR,
  encodeIR,
  MAX_SHARE_LENGTH,
  ShareDecodeError,
  ShareTooLargeError,
} from './share';

function buildSampleIR() {
  const vpc = newResource('aws_vpc', 'main', { cidr_block: '10.0.0.0/16' });
  const subnet = newResource('aws_subnet', 'public', {
    vpc_id: '${aws_vpc.main.id}',
    cidr_block: '10.0.1.0/24',
  });
  const ec2 = newResource('aws_instance', 'web', {
    instance_type: 't3.micro',
    ami: 'ami-0123456789',
    subnet_id: '${aws_subnet.public.id}',
  });
  return applyOps(emptyIR(), [
    { kind: 'add_resource', node: vpc },
    { kind: 'add_resource', node: subnet },
    { kind: 'add_resource', node: ec2 },
    { kind: 'add_edge', edge: edge(vpc, subnet, 'network') },
    { kind: 'add_edge', edge: edge(subnet, ec2, 'network') },
    { kind: 'set_arg', nodeId: ec2.id, field: 'instance_type', value: lit('t3.small') },
  ]);
}

describe('share encode / decode', () => {
  it('round-trips a non-trivial IR through the LZ-compressed envelope', () => {
    const ir = buildSampleIR();
    const hash = encodeIR(ir);
    const decoded = decodeIR(hash);
    expect(decoded).toEqual(ir);
  });

  it('returns a URL-safe payload (no `?`, `#`, `&` or whitespace)', () => {
    const hash = encodeIR(buildSampleIR());
    expect(hash).not.toMatch(/[?#&\s]/);
  });

  it('produces noticeably smaller output than raw JSON', () => {
    const ir = buildSampleIR();
    const json = JSON.stringify({ v: 1, ir });
    const hash = encodeIR(ir);
    // We don't pin a ratio to avoid flakiness, but compression must beat 1:1.
    expect(hash.length).toBeLessThan(json.length);
  });

  it('throws ShareTooLargeError when the encoded payload exceeds the URL cap', () => {
    let huge = emptyIR();
    // 600 resources is far past the 6 KB encoded ceiling for any realistic
    // payload — empirically this lands around 12-15 KB encoded.
    for (let i = 0; i < 600; i += 1) {
      huge = applyOps(huge, [
        {
          kind: 'add_resource',
          node: newResource('aws_instance', `web_${i}`, {
            instance_type: 't3.micro',
            ami: 'ami-0123456789abcdef0',
            tags: { Name: `web-${i}`, Owner: 'platform-team' },
          }),
        },
      ]);
    }
    expect(() => encodeIR(huge)).toThrowError(ShareTooLargeError);
    try {
      encodeIR(huge);
    } catch (err) {
      expect(err).toBeInstanceOf(ShareTooLargeError);
      expect((err as ShareTooLargeError).limit).toBe(MAX_SHARE_LENGTH);
    }
  });

  it('decodeIR rejects empty hashes', () => {
    expect(() => decodeIR('')).toThrowError(ShareDecodeError);
  });

  it('decodeIR rejects malformed payloads', () => {
    expect(() => decodeIR('not-a-real-hash-at-all')).toThrowError(ShareDecodeError);
  });

  it('decodeIR rejects mismatched envelope versions', () => {
    const futurePayload = compressToEncodedURIComponent(JSON.stringify({ v: 999, ir: emptyIR() }));
    expect(() => decodeIR(futurePayload)).toThrowError(/Unsupported share version/);
  });

  it('buildShareUrl honors an explicit origin', () => {
    expect(buildShareUrl('abc', 'https://example.com')).toBe('https://example.com/p/abc');
  });
});
