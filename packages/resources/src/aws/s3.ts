import { defineResource } from '@blueprint/ir';
import { z } from 'zod';

export const awsS3Bucket = defineResource({
  provider: 'aws',
  type: 'aws_s3_bucket',
  category: 'Storage',
  displayName: 'S3 Bucket',
  description: 'Amazon S3 object storage bucket.',
  icon: '/icons/aws/s3.svg',
  tags: ['storage', 'object', 'bucket'],
  schema: z.object({
    bucket: z.string().describe('Globally unique bucket name.'),
    force_destroy: z.boolean().optional(),
    tags: z.record(z.string()).optional(),
  }),
  defaults: {},
  ports: {
    in: [],
    out: [{ kind: 'reference', label: 'used by' }],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['aws_s3_bucket', res.name], res.args);
  },
});
