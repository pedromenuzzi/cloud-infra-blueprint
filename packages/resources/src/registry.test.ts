import { defineResource, type ResourceDefinition } from '@blueprint/ir';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  clearProviderRegistry,
  getRegisteredCatalog,
  getRegisteredProviders,
  registerProvider,
  setProviderResources,
  unregisterProvider,
} from './registry.js';

import { findResourceDef, getAllResources } from './index.js';

function fakeResource(type: string): ResourceDefinition {
  return defineResource({
    type,
    provider: 'aws',
    category: 'Network',
    displayName: type,
    icon: `/icons/${type}.svg`,
    description: `fake ${type}`,
    schema: z.object({ name: z.string().default('demo') }),
    defaults: { name: 'demo' },
    ports: { in: [], out: [] },
    emit: (res, ctx) => ctx.block('resource', [res.type, res.name], res.args),
  });
}

afterEach(() => {
  clearProviderRegistry();
});

describe('provider plugin registry', () => {
  it('registers a new provider with its resources', () => {
    registerProvider({
      provider: 'cloudflare',
      resources: [fakeResource('cloudflare_zone'), fakeResource('cloudflare_record')],
    });
    const all = getRegisteredProviders();
    expect(all).toHaveLength(1);
    expect(all[0]?.provider).toBe('cloudflare');
    expect(all[0]?.resources.map((r) => r.type)).toEqual(['cloudflare_zone', 'cloudflare_record']);
  });

  it('appends new resources when called twice for the same provider', () => {
    registerProvider({
      provider: 'cloudflare',
      resources: [fakeResource('cloudflare_zone')],
    });
    registerProvider({
      provider: 'cloudflare',
      resources: [fakeResource('cloudflare_record')],
    });
    const flat = getRegisteredCatalog().map((r) => r.type);
    expect(flat).toEqual(['cloudflare_zone', 'cloudflare_record']);
  });

  it('is idempotent on (provider, type) pairs', () => {
    registerProvider({
      provider: 'cloudflare',
      resources: [fakeResource('cloudflare_zone'), fakeResource('cloudflare_zone')],
    });
    registerProvider({
      provider: 'cloudflare',
      resources: [fakeResource('cloudflare_zone')],
    });
    expect(getRegisteredCatalog()).toHaveLength(1);
  });

  it('uses provided displayName, falling back to a capitalized provider key', () => {
    registerProvider({
      provider: 'cloudflare',
      resources: [],
      displayName: 'Cloudflare (Community)',
    });
    expect(getRegisteredProviders()[0]?.displayName).toBe('Cloudflare (Community)');
    registerProvider({ provider: 'oracle', resources: [] });
    const oracle = getRegisteredProviders().find((p) => p.provider === 'oracle');
    expect(oracle?.displayName).toBe('Oracle');
  });

  it('setProviderResources replaces the resource list wholesale', () => {
    registerProvider({
      provider: 'cloudflare',
      resources: [fakeResource('cloudflare_zone'), fakeResource('cloudflare_record')],
    });
    setProviderResources('cloudflare', [fakeResource('cloudflare_worker')]);
    expect(getRegisteredCatalog().map((r) => r.type)).toEqual(['cloudflare_worker']);
  });

  it('unregisterProvider removes the entry', () => {
    registerProvider({ provider: 'cloudflare', resources: [fakeResource('cloudflare_zone')] });
    expect(unregisterProvider('cloudflare')).toBe(true);
    expect(getRegisteredProviders()).toHaveLength(0);
    expect(unregisterProvider('cloudflare')).toBe(false);
  });

  it('exposes registered resources via the public catalog helpers', () => {
    registerProvider({
      provider: 'cloudflare',
      resources: [fakeResource('cloudflare_zone')],
    });
    const all = getAllResources();
    expect(all.some((r) => r.type === 'cloudflare_zone')).toBe(true);
    expect(findResourceDef('cloudflare_zone')?.type).toBe('cloudflare_zone');
  });
});
