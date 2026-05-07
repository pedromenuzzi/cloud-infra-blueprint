import { defineResource } from '@blueprint/ir';
import { z } from 'zod';

export const awsInstance = defineResource({
  provider: 'aws',
  type: 'aws_instance',
  category: 'Compute',
  displayName: 'EC2 Instance',
  description: 'Amazon EC2 virtual machine.',
  icon: '/icons/aws/ec2.svg',
  tags: ['compute', 'vm', 'server'],
  schema: z.object({
    ami: z.string().describe('AMI id, e.g. ami-0abc...'),
    instance_type: z
      .enum(['t3.micro', 't3.small', 't3.medium', 'm5.large', 'm5.xlarge', 'c5.large'])
      .describe('Instance size'),
    subnet_id: z.string().optional(),
    key_name: z.string().optional(),
    vpc_security_group_ids: z.array(z.string()).optional(),
    iam_instance_profile: z.string().optional(),
    user_data: z.string().optional(),
    tags: z.record(z.string()).optional(),
  }),
  defaults: { instance_type: 't3.micro' },
  ports: {
    in: [{ kind: 'network', label: 'subnet', acceptsTypes: ['aws_subnet'] }],
    out: [
      { kind: 'network', label: 'connects to' },
      { kind: 'iam', label: 'role', acceptsTypes: ['aws_iam_role'] },
    ],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['aws_instance', res.name], res.args);
  },
});
