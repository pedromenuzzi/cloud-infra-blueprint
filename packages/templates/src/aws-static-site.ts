import { newResource } from '@blueprint/ir';
import { z } from 'zod';

import { defineTemplate } from './types.js';

export const staticSiteAws = defineTemplate({
  slug: 'static-site-aws',
  name: 'Static Site on AWS',
  description: 'S3 (website) + CloudFront. Add ACM + Route53 manually after applying.',
  provider: 'aws',
  thumbnail: '/templates/static-site-aws.png',
  params: z.object({
    siteName: z.string().min(1).default('my-site'),
    region: z.string().default('us-east-1'),
  }),
  build({ siteName }) {
    const bucket = newResource('aws_s3_bucket', `${siteName}-site`, {
      bucket: `${siteName}-site`,
      force_destroy: true,
      tags: { Name: siteName },
    });
    return {
      addResources: [bucket],
      addEdges: [],
      setProviders: { aws: { region: 'us-east-1' } },
    };
  },
});
