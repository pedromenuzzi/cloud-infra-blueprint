import { newResource } from '@blueprint/ir';
import { z } from 'zod';

import { defineTemplate } from './types.js';

export const staticSiteGcp = defineTemplate({
  slug: 'static-site-gcp',
  name: 'Static Site on GCP',
  description: 'Cloud Storage bucket configured for website hosting (add LB + DNS later).',
  provider: 'gcp',
  thumbnail: '/templates/static-site-gcp.png',
  params: z.object({
    siteName: z.string().min(1).default('my-site'),
    location: z.string().default('US'),
  }),
  build({ siteName, location }) {
    const bucket = newResource('google_storage_bucket', `${siteName}-site`, {
      name: `${siteName}-site`,
      location,
      uniform_bucket_level_access: true,
      force_destroy: true,
    });
    return {
      addResources: [bucket],
      addEdges: [],
      setProviders: { gcp: { region: location.toLowerCase() } },
    };
  },
});
