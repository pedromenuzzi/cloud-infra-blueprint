import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  clearTemplateRegistry,
  findRegisteredTemplate,
  getRegisteredTemplates,
  registerTemplate,
  unregisterTemplate,
} from './registry.js';
import { defineTemplate } from './types.js';

import { findTemplate, getAllTemplates } from './index.js';

function fakeTemplate(slug: string) {
  return defineTemplate({
    slug,
    name: `Fake ${slug}`,
    description: `Test template ${slug}`,
    provider: 'aws',
    thumbnail: `/templates/${slug}.png`,
    params: z.object({ appName: z.string().default('demo') }),
    build: () => ({ addResources: [], addEdges: [] }),
  });
}

afterEach(() => {
  clearTemplateRegistry();
});

describe('template plugin registry', () => {
  it('registers a single template via the shorthand overload', () => {
    registerTemplate(fakeTemplate('eks-ha'));
    expect(getRegisteredTemplates().map((t) => t.slug)).toEqual(['eks-ha']);
  });

  it('registers multiple templates via the bulk overload', () => {
    registerTemplate({ templates: [fakeTemplate('a'), fakeTemplate('b')] });
    expect(getRegisteredTemplates().map((t) => t.slug)).toEqual(['a', 'b']);
  });

  it('preserves insertion order across multiple register calls', () => {
    registerTemplate(fakeTemplate('first'));
    registerTemplate({ templates: [fakeTemplate('second'), fakeTemplate('third')] });
    expect(getRegisteredTemplates().map((t) => t.slug)).toEqual(['first', 'second', 'third']);
  });

  it('overrides an existing slug with the most recent registration', () => {
    registerTemplate(fakeTemplate('eks-ha'));
    const replacement = fakeTemplate('eks-ha');
    registerTemplate(replacement);
    expect(findRegisteredTemplate('eks-ha')).toBe(replacement);
  });

  it('unregisterTemplate removes the entry by slug', () => {
    registerTemplate(fakeTemplate('eks-ha'));
    expect(unregisterTemplate('eks-ha')).toBe(true);
    expect(unregisterTemplate('eks-ha')).toBe(false);
  });

  it('exposes registered templates through the public catalog helpers', () => {
    registerTemplate(fakeTemplate('eks-ha'));
    expect(getAllTemplates().some((t) => t.slug === 'eks-ha')).toBe(true);
    expect(findTemplate('eks-ha')?.slug).toBe('eks-ha');
  });
});
