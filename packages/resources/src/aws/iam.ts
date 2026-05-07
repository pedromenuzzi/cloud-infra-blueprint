import { defineResource } from '@blueprint/ir';
import { z } from 'zod';

export const awsIamRole = defineResource({
  provider: 'aws',
  type: 'aws_iam_role',
  category: 'Identity',
  displayName: 'IAM Role',
  description: 'Identity and Access Management role.',
  icon: '/icons/aws/iam-role.svg',
  tags: ['iam', 'security', 'permissions'],
  schema: z.object({
    name: z.string(),
    assume_role_policy: z.string().describe('JSON document, usually heredoc.'),
    managed_policy_arns: z.array(z.string()).optional(),
    tags: z.record(z.string()).optional(),
  }),
  defaults: {},
  ports: {
    in: [{ kind: 'iam', label: 'assumed by' }],
    out: [{ kind: 'iam', label: 'grants' }],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['aws_iam_role', res.name], res.args);
  },
});

export const awsSecurityGroup = defineResource({
  provider: 'aws',
  type: 'aws_security_group',
  category: 'Identity',
  displayName: 'Security Group',
  description: 'Stateful firewall rules attached to ENIs.',
  icon: '/icons/aws/security-group.svg',
  tags: ['firewall', 'security', 'sg'],
  schema: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    vpc_id: z.string(),
    tags: z.record(z.string()).optional(),
  }),
  defaults: { description: 'Managed by Cloud Blueprint' },
  ports: {
    in: [{ kind: 'network', label: 'attached to' }],
    out: [{ kind: 'iam', label: 'protects' }],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['aws_security_group', res.name], res.args);
  },
});
